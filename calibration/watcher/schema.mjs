export const CLASSIFICATIONS = Object.freeze([
  'EXTERNAL_ACTION',
  'IDLE',
  'RECORDS_TRUST',
  'FAILED_CHECK',
  'TOOLING',
  'UNKNOWN',
]);

export const DISPOSITIONS = Object.freeze([
  'ESCALATE',
  'OBSERVE',
  'HOLD',
  'STEER',
  'VERIFY',
]);

export const RESERVED_IDS = Object.freeze([
  '__proto__',
  'prototype',
  'constructor',
  'failure_class',
  'answer',
  'classification',
  'disposition',
  'owner_decision',
]);

const SCENARIO_FIELDS = new Set(['id', 'claim', 'evidence', 'scope', 'status', 'facts']);
const FORBIDDEN_SCENARIO_FIELDS = new Set(['failure_class', 'answer']);
const EVIDENCE_FIELDS = new Set(['ref', 'kind', 'summary']);
const FACTS_FIELDS = new Set([
  'requested_action',
  'activity',
  'authority_status',
  'claimed_steps',
  'receipted_steps',
  'check_stability',
  'reference_status',
  'evidence_consistency',
  'output_status',
  'parity_claimed',
  'identifier_status',
  'vantage',
  'absence_claimed',
]);
const KEY_FIELDS = new Set(['classification', 'disposition', 'owner_decision']);
const OWNER_DECISIONS = new Set(['yes', 'no']);

const REQUESTED_ACTIONS = new Set(['none', 'read', 'write', 'external']);
const ACTIVITIES = new Set(['active', 'idle']);
const AUTHORITY_STATUSES = new Set(['match', 'mismatch', 'unknown', 'not_applicable']);
const CHECK_STABILITIES = new Set(['stable', 'unstable', 'not_checked']);
const REFERENCE_STATUSES = new Set(['match', 'mismatch', 'unverified', 'not_applicable']);
const EVIDENCE_CONSISTENCIES = new Set(['consistent', 'contradictory', 'unknown']);
const OUTPUT_STATUSES = new Set(['present', 'empty', 'not_applicable']);
const IDENTIFIER_STATUSES = new Set(['stable', 'mutated', 'not_applicable']);
const VANTAGES = new Set(['direct', 'blind', 'not_applicable']);

function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((key) => !allowed.has(key));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isIntegerAtLeastZero(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateEvidenceItem(item, index) {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return { ok: false, error: `evidence[${index}] must be an object` };
  }
  const extra = unknownKeys(item, EVIDENCE_FIELDS);
  if (extra.length > 0) {
    return { ok: false, error: `evidence[${index}] has unknown fields: ${extra.join(', ')}` };
  }
  if (!isNonEmptyString(item.ref)) {
    return { ok: false, error: `evidence[${index}].ref must be a non-empty string` };
  }
  if (!isNonEmptyString(item.kind)) {
    return { ok: false, error: `evidence[${index}].kind must be a non-empty string` };
  }
  if (!isNonEmptyString(item.summary)) {
    return { ok: false, error: `evidence[${index}].summary must be a non-empty string` };
  }
  return { ok: true };
}

function validateFacts(facts) {
  if (typeof facts !== 'object' || facts === null || Array.isArray(facts)) {
    return { ok: false, error: 'facts must be an object' };
  }
  const extra = unknownKeys(facts, FACTS_FIELDS);
  if (extra.length > 0) {
    return { ok: false, error: `facts has unknown fields: ${extra.join(', ')}` };
  }
  if (!REQUESTED_ACTIONS.has(facts.requested_action)) {
    return { ok: false, error: 'facts.requested_action invalid' };
  }
  if (!ACTIVITIES.has(facts.activity)) {
    return { ok: false, error: 'facts.activity invalid' };
  }
  if (!AUTHORITY_STATUSES.has(facts.authority_status)) {
    return { ok: false, error: 'facts.authority_status invalid' };
  }
  if (!isIntegerAtLeastZero(facts.claimed_steps)) {
    return { ok: false, error: 'facts.claimed_steps must be integer >= 0' };
  }
  if (!isIntegerAtLeastZero(facts.receipted_steps)) {
    return { ok: false, error: 'facts.receipted_steps must be integer >= 0' };
  }
  if (!CHECK_STABILITIES.has(facts.check_stability)) {
    return { ok: false, error: 'facts.check_stability invalid' };
  }
  if (!REFERENCE_STATUSES.has(facts.reference_status)) {
    return { ok: false, error: 'facts.reference_status invalid' };
  }
  if (!EVIDENCE_CONSISTENCIES.has(facts.evidence_consistency)) {
    return { ok: false, error: 'facts.evidence_consistency invalid' };
  }
  if (!OUTPUT_STATUSES.has(facts.output_status)) {
    return { ok: false, error: 'facts.output_status invalid' };
  }
  if (typeof facts.parity_claimed !== 'boolean') {
    return { ok: false, error: 'facts.parity_claimed must be boolean' };
  }
  if (!IDENTIFIER_STATUSES.has(facts.identifier_status)) {
    return { ok: false, error: 'facts.identifier_status invalid' };
  }
  if (!VANTAGES.has(facts.vantage)) {
    return { ok: false, error: 'facts.vantage invalid' };
  }
  if (typeof facts.absence_claimed !== 'boolean') {
    return { ok: false, error: 'facts.absence_claimed must be boolean' };
  }
  return { ok: true };
}

export function validateScenario(scenario) {
  if (typeof scenario !== 'object' || scenario === null || Array.isArray(scenario)) {
    return { ok: false, error: 'scenario must be an object' };
  }
  for (const field of FORBIDDEN_SCENARIO_FIELDS) {
    if (field in scenario) {
      return { ok: false, error: `forbidden field: ${field}` };
    }
  }
  const extra = unknownKeys(scenario, SCENARIO_FIELDS);
  if (extra.length > 0) {
    return { ok: false, error: `scenario has unknown fields: ${extra.join(', ')}` };
  }
  if (!isNonEmptyString(scenario.id)) {
    return { ok: false, error: 'id must be a non-empty string' };
  }
  if (RESERVED_IDS.includes(scenario.id)) {
    return { ok: false, error: `reserved id: ${scenario.id}` };
  }
  if (!isNonEmptyString(scenario.claim)) {
    return { ok: false, error: 'claim must be a non-empty string' };
  }
  if (!Array.isArray(scenario.evidence)) {
    return { ok: false, error: 'evidence must be an array' };
  }
  if (scenario.evidence.length === 0) {
    return { ok: false, error: 'evidence must be non-empty' };
  }
  for (let i = 0; i < scenario.evidence.length; i += 1) {
    const result = validateEvidenceItem(scenario.evidence[i], i);
    if (!result.ok) return result;
  }
  if (!isNonEmptyString(scenario.scope)) {
    return { ok: false, error: 'scope must be a non-empty string' };
  }
  if (!isNonEmptyString(scenario.status)) {
    return { ok: false, error: 'status must be a non-empty string' };
  }
  return validateFacts(scenario.facts);
}

export function validateKeyEntry(entry) {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return { ok: false, error: 'key entry must be an object' };
  }
  const extra = unknownKeys(entry, KEY_FIELDS);
  if (extra.length > 0) {
    return { ok: false, error: `key entry has unknown fields: ${extra.join(', ')}` };
  }
  if (!CLASSIFICATIONS.includes(entry.classification)) {
    return { ok: false, error: 'classification invalid' };
  }
  if (!DISPOSITIONS.includes(entry.disposition)) {
    return { ok: false, error: 'disposition invalid' };
  }
  if (!OWNER_DECISIONS.has(entry.owner_decision)) {
    return { ok: false, error: 'owner_decision must be yes or no' };
  }
  return { ok: true };
}

export function validateKeys(keys) {
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) {
    return { ok: false, error: 'keys must be an object' };
  }
  for (const [id, entry] of Object.entries(keys)) {
    if (RESERVED_IDS.includes(id)) {
      return { ok: false, error: `reserved key id: ${id}` };
    }
    const result = validateKeyEntry(entry);
    if (!result.ok) {
      return { ok: false, error: `${id}: ${result.error}` };
    }
  }
  return { ok: true };
}
