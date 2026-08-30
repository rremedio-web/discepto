import { createHash } from 'node:crypto';
import { AUTHORITY_REJECTIONS } from './protocol.mjs';
import { classify } from '../calibration/watcher/classifier.mjs';

export const WATCHER_CALIBRATION_VERSION = 'watcher-calibration-1';

// Derived from the protocol's authority-rejection catalogue; not a second copy.
const REJECTION_CODE_OPERATIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(AUTHORITY_REJECTIONS).map(([code, rule]) => [code, rule.operation]),
  ),
);

function slugFromCode(code) {
  return code.toLowerCase().replace(/_/g, '-');
}

function resolveRunId(context) {
  if (context.run_id === undefined) {
    return 'discepto-run';
  }
  if (typeof context.run_id !== 'string' || context.run_id.length === 0) {
    throw new Error('context.run_id must be a non-empty string');
  }
  return context.run_id;
}

function sanitizeRunId(runId) {
  const sanitized = String(runId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slug = sanitized || 'run';
  const digest = createHash('sha256').update(runId).digest('hex');
  return `${slug}-${digest}`;
}

function resolveSequence(context) {
  const sequence = context.sequence === undefined ? 0 : context.sequence;
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error('context.sequence must be a non-negative integer');
  }
  return sequence;
}

function requestedActionForOperation(operation) {
  if (operation === 'review') return 'read';
  if (operation === 'lease' || operation === 'mutation') return 'write';
  throw new Error(`unsupported operation: ${operation}`);
}

function authorityFacts(operation) {
  return {
    requested_action: requestedActionForOperation(operation),
    activity: 'active',
    authority_status: 'mismatch',
    claimed_steps: 1,
    receipted_steps: 1,
    check_stability: 'stable',
    reference_status: 'match',
    evidence_consistency: 'consistent',
    output_status: 'present',
    parity_claimed: false,
    identifier_status: 'stable',
    vantage: 'direct',
    absence_claimed: false,
  };
}

function buildScenario(code, operation, context) {
  const runId = resolveRunId(context);
  const scope = context.scope ?? runId;
  const sequence = resolveSequence(context);
  const codeSlug = slugFromCode(code);
  const identitySuffix = `${sanitizeRunId(runId)}-${sequence}-${codeSlug}`;
  const scenarioId = `discepto-${identitySuffix}`;

  return {
    id: scenarioId,
    claim: `authority rejection ${codeSlug}`,
    evidence: [{
      ref: `ev-discepto-${identitySuffix}`,
      kind: 'rejection',
      summary: `structured ${operation} authority rejection ${codeSlug}`,
    }],
    scope,
    status: 'authority-rejected',
    facts: authorityFacts(operation),
  };
}

/**
 * The adapter's one function: turn a structured protocol rejection into the
 * watcher observation record the watcher receipt carries. Scenario
 * construction and classification are internal seams; the observation maps
 * `code` and `operation` only and never reads the rejection message.
 */
export function observeRejection(rejection, context = {}) {
  if (!rejection || typeof rejection !== 'object' || Array.isArray(rejection)) {
    throw new Error('rejection must be an object');
  }

  const code = rejection.code;
  const operation = rejection.operation;
  const expectedOperation = REJECTION_CODE_OPERATIONS[code];
  if (!expectedOperation) {
    throw new Error(`unknown rejection code: ${code}`);
  }
  if (operation !== expectedOperation) {
    throw new Error(`code/operation mismatch: ${code} expects ${expectedOperation}, got ${operation}`);
  }

  const scenario = buildScenario(code, operation, context);
  const result = classify(scenario);
  return {
    rejection_code: code,
    operation,
    scenario_id: scenario.id,
    evidence_ref: scenario.evidence[0].ref,
    classification: result.classification,
    disposition: result.disposition,
    owner_decision: result.owner_decision,
  };
}
