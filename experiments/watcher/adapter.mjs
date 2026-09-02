import { createHash } from 'node:crypto';
import { classify } from './classifier.mjs';
import { REJECTION_CODE_OPERATIONS } from '../../src/rejections.mjs';

export const WATCHER_CALIBRATION_VERSION = 'watcher-calibration-1';

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

export function adaptRejection(rejection, context = {}) {
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
    throw new Error(
      `code/operation mismatch: ${code} expects ${expectedOperation}, got ${operation}`,
    );
  }

  const runId = resolveRunId(context);
  const scope = context.scope ?? runId;
  const sequence = resolveSequence(context);
  const codeSlug = slugFromCode(code);
  const identitySuffix = `${sanitizeRunId(runId)}-${sequence}-${codeSlug}`;
  const scenarioId = `discepto-${identitySuffix}`;

  return {
    id: scenarioId,
    claim: `authority rejection ${codeSlug}`,
    evidence: [
      {
        ref: `ev-discepto-${identitySuffix}`,
        kind: 'rejection',
        summary: `structured ${operation} authority rejection ${codeSlug}`,
      },
    ],
    scope,
    status: 'authority-rejected',
    facts: authorityFacts(operation),
  };
}

export function adaptAndClassify(rejection, context = {}) {
  const scenario = adaptRejection(rejection, context);
  const result = classify(scenario);
  return {
    scenario,
    classification: result.classification,
    disposition: result.disposition,
    owner_decision: result.owner_decision,
  };
}
