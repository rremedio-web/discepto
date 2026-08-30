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

const ARTIFACT_IDENTITY_KINDS = Object.freeze(['file', 'local-server', 'staging', 'production']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isLowercaseSha256Hex(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Field-rule vocabulary for record specs. A rule either passes (null) or
 * returns the exact error string for that field.
 */
const STRING = Object.freeze({ kind: 'string' });
const BOOLEAN = Object.freeze({ kind: 'boolean' });
const TRUE = Object.freeze({ kind: 'literal', value: true });
const ONE = Object.freeze({ kind: 'exactly', value: 1 });
const SHA256_HEX = Object.freeze({ kind: 'sha256Hex' });
const STRING_LIST = Object.freeze({ kind: 'stringList' });
const UNCHECKED = Object.freeze({ kind: 'unchecked' });

function enumOf(values) {
  return { kind: 'enum', values };
}

function nonEmptyStringArray({ unique = false } = {}) {
  return { kind: 'nonEmptyStringArray', unique };
}

function record(spec) {
  return { kind: 'record', spec };
}

function recordArray(spec) {
  return { kind: 'recordArray', spec };
}

function fieldError(rule, value, label, field) {
  switch (rule.kind) {
    case 'string':
      return isNonEmptyString(value) ? null : `${label} is required`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${label} must be boolean`;
    case 'literal':
      return value === rule.value ? null : `${label} must be ${rule.value}`;
    case 'exactly':
      return value === rule.value ? null : `${label} must be exactly ${rule.value}`;
    case 'enum':
      return rule.values.includes(value) ? null : `invalid ${field}: ${value}`;
    case 'sha256Hex':
      if (!isNonEmptyString(value)) return `${label} is required`;
      return isLowercaseSha256Hex(value) ? null : `${label} must be a lowercase 64-character hex digest`;
    case 'nonEmptyStringArray': {
      if (!Array.isArray(value) || value.length === 0 || !value.every(isNonEmptyString)) {
        return `${label} must be a non-empty string array`;
      }
      if (rule.unique && new Set(value).size !== value.length) {
        return `${label} must contain unique paths`;
      }
      return null;
    }
    case 'stringList': {
      if (!Array.isArray(value)) return `${label} must be an array`;
      const bad = value.findIndex((item) => !isNonEmptyString(item));
      return bad === -1 ? null : `${label}[${bad}] must be a non-empty string`;
    }
    case 'record':
      return value === undefined ? `${label} is required` : strictValidate(rule.spec, value, label);
    case 'recordArray': {
      if (!Array.isArray(value) || value.length === 0) {
        return `${label} must be a non-empty array`;
      }
      for (let i = 0; i < value.length; i += 1) {
        const error = strictValidate(rule.spec, value[i], `${label}[${i}]`);
        if (error) return error;
      }
      return null;
    }
    case 'unchecked':
      return null;
    default:
      if (typeof rule.check === 'function') {
        return rule.check(value, label, field) ?? null;
      }
      throw new Error(`unknown field rule: ${rule.kind}`);
  }
}

function strictValidate(spec, value, label = spec.name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `${label} must be an object`;
  }
  const allowed = new Set(Object.keys(spec.fields));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    return `${label} has unknown fields: ${unknown.join(', ')}`;
  }
  for (const [field, rule] of Object.entries(spec.fields)) {
    if (rule.optional && value[field] === undefined) continue;
    const error = fieldError(rule, value[field], `${label}.${field}`, field);
    if (error) return error;
  }
  if (spec.check) {
    return spec.check(value, label) ?? null;
  }
  return null;
}

/**
 * The one strict-record kernel: object guard, unknown-field rejection,
 * required fields, enums, nested records — declared once, reused by every
 * record spec below.
 */
export function strictRecord(spec) {
  return (value) => {
    const error = strictValidate(spec, value);
    return error === null ? { ok: true } : { ok: false, error };
  };
}

const AGENT_SPEC = Object.freeze({
  name: 'agent',
  fields: Object.freeze({
    id: STRING,
    seat_id: STRING,
    role: enumOf(ROLES),
  }),
});

const OBSERVATION_SPEC = Object.freeze({
  name: 'observation',
  fields: Object.freeze({
    key: UNCHECKED,
    value: UNCHECKED,
  }),
  check: Object.freeze((item, label) =>
    (!isNonEmptyString(item.key) || !isNonEmptyString(item.value)
      ? `${label} requires key and value`
      : null)),
});

const ARTIFACT_IDENTITY_SPEC = Object.freeze({
  name: 'artifact_identity',
  fields: Object.freeze({
    kind: UNCHECKED,
    url: Object.freeze({ kind: 'unchecked', optional: true }),
  }),
  check: Object.freeze((identity) => {
    if (!ARTIFACT_IDENTITY_KINDS.includes(identity.kind)) {
      return `measurement.artifact_identity.kind must be one of: ${ARTIFACT_IDENTITY_KINDS.join(', ')}`;
    }
    if (identity.url !== undefined) {
      if (!isNonEmptyString(identity.url)) {
        return 'measurement.artifact_identity.url must be a non-empty string';
      }
      let parsedUrl;
      try {
        parsedUrl = new URL(identity.url);
      } catch {
        return 'measurement.artifact_identity.url must be a valid URL';
      }
      const expectedProtocol = identity.kind === 'file' ? 'file:' : null;
      if (expectedProtocol && parsedUrl.protocol !== expectedProtocol) {
        return 'measurement.artifact_identity.url must use file';
      }
      if (!expectedProtocol && !['http:', 'https:'].includes(parsedUrl.protocol)) {
        return 'measurement.artifact_identity.url must use http or https';
      }
    }
    return null;
  }),
});

function agentsFieldError(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    return 'run.agents must contain exactly two agents';
  }
  const agentIds = new Set();
  const seatIds = new Set();
  let writers = 0;
  let challengers = 0;
  for (let i = 0; i < value.length; i += 1) {
    const error = strictValidate(AGENT_SPEC, value[i], `run.agents[${i}]`);
    if (error) return error;
    const agent = value[i];
    if (agentIds.has(agent.id)) return 'agent ids must be unique';
    if (seatIds.has(agent.seat_id)) return 'seat ids must be unique';
    agentIds.add(agent.id);
    seatIds.add(agent.seat_id);
    if (agent.role === 'writer') writers += 1;
    if (agent.role === 'challenger') challengers += 1;
  }
  if (writers !== 1 || challengers !== 1) {
    return 'run must have exactly one writer and one challenger';
  }
  return null;
}

const RUN_SPEC = Object.freeze({
  name: 'run',
  fields: Object.freeze({
    id: STRING,
    worktree_id: STRING,
    coordinator_id: STRING,
    phase: Object.freeze({
      kind: 'custom',
      check(value) {
        if (!PHASES.includes(value)) return `invalid phase: ${value}`;
        return value === 'DIAGNOSE' ? null : 'fresh run must start at DIAGNOSE';
      },
    }),
    agents: Object.freeze({ kind: 'custom', check: agentsFieldError }),
  }),
  check: Object.freeze((run) =>
    (run.agents.some((agent) => agent.id === run.coordinator_id)
      ? 'run.coordinator_id must be distinct from agent ids'
      : null)),
});

const DIAGNOSIS_SPEC = Object.freeze({
  name: 'diagnosis',
  fields: Object.freeze({
    agent_id: STRING,
    read_only: TRUE,
    findings: STRING_LIST,
  }),
});

const LEASE_SPEC = Object.freeze({
  name: 'lease',
  fields: Object.freeze({
    issuer_id: STRING,
    writer_id: STRING,
    scope: nonEmptyStringArray({ unique: true }),
    active: BOOLEAN,
  }),
});

const MEASUREMENT_SPEC = Object.freeze({
  name: 'measurement',
  fields: Object.freeze({
    method: STRING,
    observations: recordArray(OBSERVATION_SPEC),
    result: STRING,
    artifact_identity: Object.freeze({ ...record(ARTIFACT_IDENTITY_SPEC), optional: true }),
  }),
});

const FREEZE_REQUEST_SPEC = Object.freeze({
  name: 'freeze',
  fields: Object.freeze({
    id: STRING,
    base_id: STRING,
    candidate_id: STRING,
  }),
});

const REVIEW_SPEC = Object.freeze({
  name: 'review',
  fields: Object.freeze({
    reviewer_id: STRING,
    seat_id: STRING,
    freeze_id: STRING,
    freeze_binding: SHA256_HEX,
    verdict: enumOf(VERDICTS),
    findings: STRING_LIST,
  }),
});

const CORRECTION_SPEC = Object.freeze({
  name: 'correction',
  fields: Object.freeze({
    supersedes: STRING,
    red_ref: STRING,
    green_ref: STRING,
    count: ONE,
  }),
});

const DISPUTE_SPEC = Object.freeze({
  name: 'dispute',
  fields: Object.freeze({
    agent_id: STRING,
    claim: STRING,
    estimate: STRING,
  }),
});

const MUTATION_SPEC = Object.freeze({
  name: 'mutation',
  fields: Object.freeze({
    agent_id: STRING,
    path: STRING,
  }),
});

export const validateRun = strictRecord(RUN_SPEC);
export const validateDiagnosis = strictRecord(DIAGNOSIS_SPEC);
export const validateLease = strictRecord(LEASE_SPEC);
export const validateMeasurement = strictRecord(MEASUREMENT_SPEC);
export const validateFreeze = strictRecord(FREEZE_REQUEST_SPEC);
export const validateReview = strictRecord(REVIEW_SPEC);
export const validateCorrection = strictRecord(CORRECTION_SPEC);
export const validateDispute = strictRecord(DISPUTE_SPEC);
export const validateMutation = strictRecord(MUTATION_SPEC);
