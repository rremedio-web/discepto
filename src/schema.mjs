export const PHASES = Object.freeze([
  'DIAGNOSE',
  'DISPUTE',
  'MEASURE',
  'IMPLEMENT',
  'FREEZE',
  'REVIEW',
  'CORRECT',
  'FINAL',
]);

export const ROLES = Object.freeze(['writer', 'challenger']);

export const VERDICTS = Object.freeze(['PASS', 'CHANGES_NEEDED']);

const RUN_FIELDS = new Set(['id', 'worktree_id', 'coordinator_id', 'agents', 'phase']);
const AGENT_FIELDS = new Set(['id', 'role', 'seat_id']);
const DIAGNOSIS_FIELDS = new Set(['agent_id', 'read_only', 'findings']);
const LEASE_FIELDS = new Set(['issuer_id', 'writer_id', 'scope', 'active']);
const MEASUREMENT_FIELDS = new Set(['method', 'observations', 'result', 'artifact_identity']);
const OBSERVATION_FIELDS = new Set(['key', 'value']);
const ARTIFACT_IDENTITY_FIELDS = new Set(['kind', 'url']);
const ARTIFACT_IDENTITY_KINDS = Object.freeze(['file', 'local-server', 'staging', 'production']);
const FREEZE_REQUEST_FIELDS = new Set(['id', 'base_id', 'candidate_id']);
const REVIEW_FIELDS = new Set(['reviewer_id', 'seat_id', 'freeze_id', 'freeze_binding', 'verdict', 'findings']);
const CORRECTION_FIELDS = new Set(['supersedes', 'red_ref', 'green_ref', 'count']);
const DISPUTE_FIELDS = new Set(['agent_id', 'claim', 'estimate']);
const MUTATION_FIELDS = new Set(['agent_id', 'path']);

function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((key) => !allowed.has(key));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isLowercaseSha256Hex(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function hasUniqueStrings(values) {
  return new Set(values).size === values.length;
}

export function validateRun(run) {
  if (typeof run !== 'object' || run === null || Array.isArray(run)) {
    return { ok: false, error: 'run must be an object' };
  }
  const unknown = unknownKeys(run, RUN_FIELDS);
  if (unknown.length > 0) {
    return { ok: false, error: `run has unknown fields: ${unknown.join(', ')}` };
  }
  for (const field of ['id', 'worktree_id', 'coordinator_id', 'phase']) {
    if (!isNonEmptyString(run[field])) {
      return { ok: false, error: `run.${field} is required` };
    }
  }
  if (!PHASES.includes(run.phase)) {
    return { ok: false, error: `invalid phase: ${run.phase}` };
  }
  if (run.phase !== 'DIAGNOSE') {
    return { ok: false, error: 'fresh run must start at DIAGNOSE' };
  }
  if (!Array.isArray(run.agents) || run.agents.length !== 2) {
    return { ok: false, error: 'run.agents must contain exactly two agents' };
  }
  const agentIds = new Set();
  const seatIds = new Set();
  let writers = 0;
  let challengers = 0;
  for (let i = 0; i < run.agents.length; i += 1) {
    const agent = run.agents[i];
    if (typeof agent !== 'object' || agent === null || Array.isArray(agent)) {
      return { ok: false, error: `run.agents[${i}] must be an object` };
    }
    const agentUnknown = unknownKeys(agent, AGENT_FIELDS);
    if (agentUnknown.length > 0) {
      return { ok: false, error: `run.agents[${i}] has unknown fields: ${agentUnknown.join(', ')}` };
    }
    if (!isNonEmptyString(agent.id)) {
      return { ok: false, error: `run.agents[${i}].id is required` };
    }
    if (!isNonEmptyString(agent.seat_id)) {
      return { ok: false, error: `run.agents[${i}].seat_id is required` };
    }
    if (!ROLES.includes(agent.role)) {
      return { ok: false, error: `invalid role: ${agent.role}` };
    }
    if (agentIds.has(agent.id)) {
      return { ok: false, error: 'agent ids must be unique' };
    }
    if (seatIds.has(agent.seat_id)) {
      return { ok: false, error: 'seat ids must be unique' };
    }
    agentIds.add(agent.id);
    seatIds.add(agent.seat_id);
    if (agent.role === 'writer') writers += 1;
    if (agent.role === 'challenger') challengers += 1;
  }
  if (writers !== 1 || challengers !== 1) {
    return { ok: false, error: 'run must have exactly one writer and one challenger' };
  }
  if (agentIds.has(run.coordinator_id)) {
    return { ok: false, error: 'run.coordinator_id must be distinct from agent ids' };
  }
  const writerId = [...run.agents].find((a) => a.role === 'writer').id;
  const challengerId = [...run.agents].find((a) => a.role === 'challenger').id;
  const writerSeatId = [...run.agents].find((a) => a.role === 'writer').seat_id;
  const challengerSeatId = [...run.agents].find((a) => a.role === 'challenger').seat_id;
  return {
    ok: true,
    writerId,
    writerSeatId,
    challengerId,
    challengerSeatId,
    coordinatorId: run.coordinator_id,
  };
}

export function validateDiagnosis(diagnosis) {
  if (typeof diagnosis !== 'object' || diagnosis === null || Array.isArray(diagnosis)) {
    return { ok: false, error: 'diagnosis must be an object' };
  }
  const unknown = unknownKeys(diagnosis, DIAGNOSIS_FIELDS);
  if (unknown.length > 0) {
    return { ok: false, error: `diagnosis has unknown fields: ${unknown.join(', ')}` };
  }
  if (!isNonEmptyString(diagnosis.agent_id)) {
    return { ok: false, error: 'diagnosis.agent_id is required' };
  }
  if (diagnosis.read_only !== true) {
    return { ok: false, error: 'diagnosis.read_only must be true' };
  }
  if (!Array.isArray(diagnosis.findings)) {
    return { ok: false, error: 'diagnosis.findings must be an array' };
  }
  for (let i = 0; i < diagnosis.findings.length; i += 1) {
    if (!isNonEmptyString(diagnosis.findings[i])) {
      return { ok: false, error: `diagnosis.findings[${i}] must be a non-empty string` };
    }
  }
  return { ok: true };
}

export function validateLease(lease) {
  if (typeof lease !== 'object' || lease === null || Array.isArray(lease)) {
    return { ok: false, error: 'lease must be an object' };
  }
  const unknown = unknownKeys(lease, LEASE_FIELDS);
  if (unknown.length > 0) {
    return { ok: false, error: `lease has unknown fields: ${unknown.join(', ')}` };
  }
  if (!isNonEmptyString(lease.issuer_id)) {
    return { ok: false, error: 'lease.issuer_id is required' };
  }
  if (!isNonEmptyString(lease.writer_id)) {
    return { ok: false, error: 'lease.writer_id is required' };
  }
  if (!isStringArray(lease.scope) || lease.scope.length === 0) {
    return { ok: false, error: 'lease.scope must be a non-empty string array' };
  }
  if (!hasUniqueStrings(lease.scope)) {
    return { ok: false, error: 'lease.scope must contain unique paths' };
  }
  if (typeof lease.active !== 'boolean') {
    return { ok: false, error: 'lease.active must be boolean' };
  }
  return { ok: true };
}

export function validateMeasurement(measurement) {
  if (typeof measurement !== 'object' || measurement === null || Array.isArray(measurement)) {
    return { ok: false, error: 'measurement must be an object' };
  }
  const unknown = unknownKeys(measurement, MEASUREMENT_FIELDS);
  if (unknown.length > 0) {
    return { ok: false, error: `measurement has unknown fields: ${unknown.join(', ')}` };
  }
  if (!isNonEmptyString(measurement.method)) {
    return { ok: false, error: 'measurement.method is required' };
  }
  if (!Array.isArray(measurement.observations) || measurement.observations.length === 0) {
    return { ok: false, error: 'measurement.observations must be a non-empty array' };
  }
  for (let i = 0; i < measurement.observations.length; i += 1) {
    const obs = measurement.observations[i];
    if (typeof obs !== 'object' || obs === null || Array.isArray(obs)) {
      return { ok: false, error: `measurement.observations[${i}] must be an object` };
    }
    const obsUnknown = unknownKeys(obs, OBSERVATION_FIELDS);
    if (obsUnknown.length > 0) {
      return { ok: false, error: `measurement.observations[${i}] has unknown fields: ${obsUnknown.join(', ')}` };
    }
    if (!isNonEmptyString(obs.key) || !isNonEmptyString(obs.value)) {
      return { ok: false, error: `measurement.observations[${i}] requires key and value` };
    }
  }
  if (!isNonEmptyString(measurement.result)) {
    return { ok: false, error: 'measurement.result is required' };
  }
  if (measurement.artifact_identity !== undefined) {
    const identity = measurement.artifact_identity;
    if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) {
      return { ok: false, error: 'measurement.artifact_identity must be an object' };
    }
    const identityUnknown = unknownKeys(identity, ARTIFACT_IDENTITY_FIELDS);
    if (identityUnknown.length > 0) {
      return { ok: false, error: `measurement.artifact_identity has unknown fields: ${identityUnknown.join(', ')}` };
    }
    if (!ARTIFACT_IDENTITY_KINDS.includes(identity.kind)) {
      return {
        ok: false,
        error: `measurement.artifact_identity.kind must be one of: ${ARTIFACT_IDENTITY_KINDS.join(', ')}`,
      };
    }
    if (identity.url !== undefined) {
      if (!isNonEmptyString(identity.url)) {
        return { ok: false, error: 'measurement.artifact_identity.url must be a non-empty string' };
      }
      let parsedUrl;
      try {
        parsedUrl = new URL(identity.url);
      } catch {
        return { ok: false, error: 'measurement.artifact_identity.url must be a valid URL' };
      }
      const expectedProtocol = identity.kind === 'file' ? 'file:' : null;
      if (expectedProtocol && parsedUrl.protocol !== expectedProtocol) {
        return { ok: false, error: 'measurement.artifact_identity.url must use file' };
      }
      if (!expectedProtocol && !['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { ok: false, error: 'measurement.artifact_identity.url must use http or https' };
      }
    }
  }
  return { ok: true };
}

export function validateFreeze(freeze) {
  if (typeof freeze !== 'object' || freeze === null || Array.isArray(freeze)) {
    return { ok: false, error: 'freeze must be an object' };
  }
  const unknown = unknownKeys(freeze, FREEZE_REQUEST_FIELDS);
  if (unknown.length > 0) {
    return { ok: false, error: `freeze has unknown fields: ${unknown.join(', ')}` };
  }
  for (const field of ['id', 'base_id', 'candidate_id']) {
    if (!isNonEmptyString(freeze[field])) {
      return { ok: false, error: `freeze.${field} is required` };
    }
  }
  return { ok: true };
}

export function validateReview(review) {
  if (typeof review !== 'object' || review === null || Array.isArray(review)) {
    return { ok: false, error: 'review must be an object' };
  }
  const unknown = unknownKeys(review, REVIEW_FIELDS);
  if (unknown.length > 0) {
    return { ok: false, error: `review has unknown fields: ${unknown.join(', ')}` };
  }
  if (!isNonEmptyString(review.reviewer_id)) {
    return { ok: false, error: 'review.reviewer_id is required' };
  }
  if (!isNonEmptyString(review.seat_id)) {
    return { ok: false, error: 'review.seat_id is required' };
  }
  if (!isNonEmptyString(review.freeze_id)) {
    return { ok: false, error: 'review.freeze_id is required' };
  }
  if (!isNonEmptyString(review.freeze_binding)) {
    return { ok: false, error: 'review.freeze_binding is required' };
  }
  if (!isLowercaseSha256Hex(review.freeze_binding)) {
    return { ok: false, error: 'review.freeze_binding must be a lowercase 64-character hex digest' };
  }
  if (!VERDICTS.includes(review.verdict)) {
    return { ok: false, error: `invalid verdict: ${review.verdict}` };
  }
  if (!Array.isArray(review.findings)) {
    return { ok: false, error: 'review.findings must be an array' };
  }
  for (let i = 0; i < review.findings.length; i += 1) {
    if (!isNonEmptyString(review.findings[i])) {
      return { ok: false, error: `review.findings[${i}] must be a non-empty string` };
    }
  }
  return { ok: true };
}

export function validateCorrection(correction) {
  if (typeof correction !== 'object' || correction === null || Array.isArray(correction)) {
    return { ok: false, error: 'correction must be an object' };
  }
  const unknown = unknownKeys(correction, CORRECTION_FIELDS);
  if (unknown.length > 0) {
    return { ok: false, error: `correction has unknown fields: ${unknown.join(', ')}` };
  }
  for (const field of ['supersedes', 'red_ref', 'green_ref']) {
    if (!isNonEmptyString(correction[field])) {
      return { ok: false, error: `correction.${field} is required` };
    }
  }
  if (correction.count !== 1) {
    return { ok: false, error: 'correction.count must be exactly 1' };
  }
  return { ok: true };
}

export function validateDispute(dispute) {
  if (typeof dispute !== 'object' || dispute === null || Array.isArray(dispute)) {
    return { ok: false, error: 'dispute must be an object' };
  }
  const unknown = unknownKeys(dispute, DISPUTE_FIELDS);
  if (unknown.length > 0) {
    return { ok: false, error: `dispute has unknown fields: ${unknown.join(', ')}` };
  }
  for (const field of ['agent_id', 'claim', 'estimate']) {
    if (!isNonEmptyString(dispute[field])) {
      return { ok: false, error: `dispute.${field} is required` };
    }
  }
  return { ok: true };
}

export function validateMutation(mutation) {
  if (typeof mutation !== 'object' || mutation === null || Array.isArray(mutation)) {
    return { ok: false, error: 'mutation must be an object' };
  }
  const unknown = unknownKeys(mutation, MUTATION_FIELDS);
  if (unknown.length > 0) {
    return { ok: false, error: `mutation has unknown fields: ${unknown.join(', ')}` };
  }
  if (!isNonEmptyString(mutation.agent_id)) {
    return { ok: false, error: 'mutation.agent_id is required' };
  }
  if (!isNonEmptyString(mutation.path)) {
    return { ok: false, error: 'mutation.path is required' };
  }
  return { ok: true };
}

export function validatePhase(value) {
  if (!PHASES.includes(value)) {
    return { ok: false, error: `invalid phase: ${value}` };
  }
  return { ok: true };
}

export const EVENT_VALIDATORS = Object.freeze({
  diagnosis: validateDiagnosis,
  dispute: validateDispute,
  measurement: validateMeasurement,
  lease: validateLease,
  mutation: validateMutation,
  freeze: validateFreeze,
  review: validateReview,
  correction: validateCorrection,
});
