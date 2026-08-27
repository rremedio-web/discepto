import { createHash } from 'node:crypto';
import {
  validateRun,
  validateDiagnosis,
  validateLease,
  validateMeasurement,
  validateFreeze,
  validateReview,
  validateCorrection,
  validateDispute,
  validateMutation,
  PHASES,
} from './schema.mjs';

export const PROTOCOL_VERSION = 'discepto-protocol-2';

const PHASE_INDEX = Object.fromEntries(PHASES.map((phase, index) => [phase, index]));

function sortObservations(observations) {
  return observations
    .map((obs) => ({ key: obs.key, value: obs.value }))
    .sort((a, b) => {
      const keyCmp = a.key.localeCompare(b.key);
      return keyCmp !== 0 ? keyCmp : a.value.localeCompare(b.value);
    });
}

export function canonicalMeasurementHash(measurement) {
  const payload = {
    method: measurement.method,
    observations: sortObservations(measurement.observations),
    result: measurement.result,
  };
  if (measurement.artifact_identity !== undefined) {
    payload.artifact_identity = { kind: measurement.artifact_identity.kind };
    if (measurement.artifact_identity.url !== undefined) {
      payload.artifact_identity.url = measurement.artifact_identity.url;
    }
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function deriveFreezeBinding(run, freeze, changedPaths, measurementHash) {
  const payload = {
    protocol_version: PROTOCOL_VERSION,
    run_id: run.id,
    coordinator_id: run.coordinator_id,
    freeze_id: freeze.id,
    base_id: freeze.base_id,
    candidate_id: freeze.candidate_id,
    changed_paths: [...changedPaths].sort(),
    measurement_hash: measurementHash,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function deriveChangedPaths(mutations) {
  return [...new Set(mutations.map((m) => m.path))].sort();
}

function scopeSubset(newScope, currentScope) {
  const current = new Set(currentScope);
  return newScope.every((path) => current.has(path));
}

function copyLease(lease) {
  return {
    issuer_id: lease.issuer_id,
    writer_id: lease.writer_id,
    scope: [...lease.scope],
    active: lease.active,
  };
}

export function createInitialState(run) {
  const validated = validateRun(run);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  return {
    run,
    phase: 'DIAGNOSE',
    writerId: validated.writerId,
    writerSeatId: validated.writerSeatId,
    challengerId: validated.challengerId,
    challengerSeatId: validated.challengerSeatId,
    coordinatorId: validated.coordinatorId,
    diagnoses: new Map(),
    disputes: [],
    measurement: null,
    lease: null,
    mutations: [],
    freezes: [],
    currentFreezeId: null,
    reviews: [],
    corrections: [],
    correctionCount: 0,
    final: false,
    errors: [],
    rejections: [],
  };
}

function fail(state, message) {
  state.errors.push(message);
  return false;
}

function reject(state, code, operation, message) {
  state.rejections.push({ code, operation, message });
  return false;
}

function agentRole(state, agentId) {
  const agent = state.run.agents.find((item) => item.id === agentId);
  return agent?.role ?? null;
}

function requirePhase(state, expected) {
  if (state.phase !== expected) {
    fail(state, `expected phase ${expected}, got ${state.phase}`);
    return false;
  }
  return true;
}

function advancePhase(state, next) {
  if (PHASE_INDEX[next] <= PHASE_INDEX[state.phase]) {
    fail(state, `cannot advance to ${next} from ${state.phase}`);
    return false;
  }
  state.phase = next;
  return true;
}

function currentFreeze(state) {
  return state.freezes.find((item) => item.id === state.currentFreezeId) ?? null;
}

export function applyDiagnosis(state, diagnosis) {
  const result = validateDiagnosis(diagnosis);
  if (!result.ok) return fail(state, result.error);
  if (!requirePhase(state, 'DIAGNOSE')) return false;

  const role = agentRole(state, diagnosis.agent_id);
  if (!role) return fail(state, 'diagnosis agent_id not in run');
  if (state.diagnoses.has(diagnosis.agent_id)) {
    return fail(state, 'duplicate diagnosis for agent');
  }

  state.diagnoses.set(diagnosis.agent_id, diagnosis);
  if (state.diagnoses.size === 2) {
    advancePhase(state, 'DISPUTE');
  }
  return true;
}

export function applyDispute(state, dispute) {
  const result = validateDispute(dispute);
  if (!result.ok) return fail(state, result.error);
  if (!requirePhase(state, 'DISPUTE')) return false;

  const role = agentRole(state, dispute.agent_id);
  if (!role) return fail(state, 'dispute agent_id not in run');
  if (state.disputes.some((item) => item.agent_id === dispute.agent_id)) {
    return fail(state, 'duplicate dispute for agent');
  }

  state.disputes.push(dispute);
  return true;
}

export function applyMeasurement(state, measurement) {
  const result = validateMeasurement(measurement);
  if (!result.ok) return fail(state, result.error);

  if (state.phase === 'DISPUTE') {
    if (state.disputes.length < 2) {
      return fail(state, 'measurement requires both dispute claims');
    }
    state.measurement = measurement;
    advancePhase(state, 'MEASURE');
    return true;
  }

  if (state.phase === 'MEASURE') {
    return fail(state, 'duplicate measurement rejected');
  }

  return fail(state, 'measurement not allowed in current phase');
}

export function applyLease(state, lease) {
  const result = validateLease(lease);
  if (!result.ok) return fail(state, result.error);

  const isFirstLease = state.lease === null;

  if (isFirstLease) {
    if (!requirePhase(state, 'MEASURE')) return false;
    if (lease.issuer_id !== state.coordinatorId) {
      return reject(state, 'LEASE_ISSUER_MISMATCH', 'lease', 'first lease must be coordinator-issued');
    }
    if (lease.writer_id !== state.writerId) {
      return reject(state, 'LEASE_WRITER_MISMATCH', 'lease', 'lease writer_id must match predesignated writer');
    }
    if (!lease.active) {
      return reject(state, 'LEASE_INITIAL_INACTIVE', 'lease', 'first lease must be active');
    }
    state.lease = copyLease(lease);
    advancePhase(state, 'IMPLEMENT');
    return true;
  }

  if (state.phase !== 'IMPLEMENT' && state.phase !== 'CORRECT') {
    return fail(state, 'lease not allowed in current phase');
  }
  if (lease.issuer_id !== state.coordinatorId) {
    return reject(state, 'LEASE_ISSUER_MISMATCH', 'lease', 'lease must be coordinator-issued');
  }
  if (lease.writer_id !== state.writerId) {
    return reject(state, 'LEASE_WRITER_MISMATCH', 'lease', 'lease writer_id must match predesignated writer');
  }
  if (!scopeSubset(lease.scope, state.lease.scope)) {
    return reject(state, 'LEASE_SCOPE_WIDENING', 'lease', 'lease scope widening rejected');
  }

  state.lease = copyLease(lease);
  return true;
}

export function applyMutation(state, mutation) {
  const result = validateMutation(mutation);
  if (!result.ok) return fail(state, result.error);

  const { agent_id: agentId, path } = mutation;

  if (state.phase !== 'IMPLEMENT' && state.phase !== 'CORRECT') {
    return fail(state, 'mutation not allowed in current phase');
  }

  const role = agentRole(state, agentId);
  if (role === 'challenger') return reject(state, 'MUTATION_CHALLENGER', 'mutation', 'challenger mutation rejected');
  if (role !== 'writer') return fail(state, 'mutation agent_id not in run');

  if (!state.lease || !state.lease.active) {
    return reject(state, 'MUTATION_NO_ACTIVE_LEASE', 'mutation', 'mutation rejected without active lease');
  }
  if (state.lease.writer_id !== agentId) {
    return reject(state, 'MUTATION_WRITER_MISMATCH', 'mutation', 'mutation writer_id mismatch');
  }
  if (!state.lease.scope.includes(path)) {
    return reject(state, 'MUTATION_OUTSIDE_SCOPE', 'mutation', 'mutation path outside lease scope');
  }

  state.mutations.push({ agent_id: agentId, path });
  return true;
}

export function applyFreeze(state, freeze) {
  const result = validateFreeze(freeze);
  if (!result.ok) return fail(state, result.error);
  if (state.phase !== 'IMPLEMENT') {
    return fail(state, 'freeze not allowed in current phase');
  }
  if (state.mutations.length === 0) {
    return fail(state, 'freeze requires at least one scoped mutation');
  }
  if (!state.measurement) {
    return fail(state, 'freeze requires measured evidence');
  }
  if (state.freezes.some((item) => item.id === freeze.id)) {
    return fail(state, 'duplicate freeze id rejected');
  }

  const changedPaths = deriveChangedPaths(state.mutations);
  const measurementHash = canonicalMeasurementHash(state.measurement);
  const binding = deriveFreezeBinding(state.run, freeze, changedPaths, measurementHash);

  state.freezes.push({
    id: freeze.id,
    base_id: freeze.base_id,
    candidate_id: freeze.candidate_id,
    changed_paths: changedPaths,
    measurement_hash: measurementHash,
    binding,
  });
  state.currentFreezeId = freeze.id;
  advancePhase(state, 'FREEZE');
  advancePhase(state, 'REVIEW');
  return true;
}

function validateReviewAuthority(state, review) {
  if (review.reviewer_id !== state.challengerId) {
    return reject(state, 'REVIEW_REVIEWER_MISMATCH', 'review', 'reviewer must be challenger');
  }
  if (review.seat_id === state.writerSeatId) {
    return reject(state, 'REVIEW_SAME_SEAT', 'review', 'reviewer and writer seats must differ');
  }
  const freeze = currentFreeze(state);
  if (!freeze) return reject(state, 'REVIEW_NO_CURRENT_FREEZE', 'review', 'review requires current freeze');
  if (review.freeze_binding !== freeze.binding) {
    return reject(state, 'REVIEW_BINDING_MISMATCH', 'review', 'freeze_binding mismatch');
  }
  return true;
}

export function applyReview(state, review) {
  const result = validateReview(review);
  if (!result.ok) return fail(state, result.error);
  if (!requirePhase(state, 'REVIEW')) return false;
  if (!state.currentFreezeId) return reject(state, 'REVIEW_NO_CURRENT_FREEZE', 'review', 'review requires current freeze');
  if (review.freeze_id !== state.currentFreezeId) {
    return reject(state, 'REVIEW_FREEZE_MISMATCH', 'review', 'review must reference current freeze');
  }
  if (!validateReviewAuthority(state, review)) return false;

  state.reviews.push(review);

  if (review.verdict === 'PASS') {
    advancePhase(state, 'FINAL');
    state.final = true;
    return true;
  }

  if (review.verdict === 'CHANGES_NEEDED') {
    advancePhase(state, 'CORRECT');
    return true;
  }

  return fail(state, 'invalid review verdict');
}

export function applyCorrection(state, correction) {
  const result = validateCorrection(correction);
  if (!result.ok) return fail(state, result.error);
  if (state.correctionCount >= 1) {
    return fail(state, 'second correction rejected');
  }
  if (!requirePhase(state, 'CORRECT')) return false;
  if (correction.supersedes !== state.currentFreezeId) {
    return fail(state, 'correction must supersede current freeze');
  }

  state.corrections.push(correction);
  state.correctionCount += 1;
  state.mutations = [];
  state.currentFreezeId = null;
  state.phase = 'IMPLEMENT';
  return true;
}

export function snapshotState(state) {
  const freeze = currentFreeze(state);
  return {
    phase: state.phase,
    final: state.final,
    writer_id: state.writerId,
    challenger_id: state.challengerId,
    diagnosis_count: state.diagnoses.size,
    dispute_count: state.disputes.length,
    has_measurement: state.measurement !== null,
    lease_active: state.lease?.active ?? false,
    mutation_count: state.mutations.length,
    current_freeze_id: state.currentFreezeId,
    freeze_binding: freeze?.binding ?? null,
    review_count: state.reviews.length,
    correction_count: state.correctionCount,
    rejection_count: state.rejections.length,
    rejections: state.rejections.map((item) => ({
      code: item.code,
      operation: item.operation,
      message: item.message,
    })),
    errors: [...state.errors],
  };
}

export function replayEvents(run, events) {
  const state = createInitialState(run);

  for (const event of events) {
    if (!event || typeof event.type !== 'string') {
      fail(state, 'event requires type');
      break;
    }

    switch (event.type) {
      case 'diagnosis':
        applyDiagnosis(state, event.diagnosis);
        break;
      case 'dispute':
        applyDispute(state, event.dispute);
        break;
      case 'measurement':
        applyMeasurement(state, event.measurement);
        break;
      case 'lease':
        applyLease(state, event.lease);
        break;
      case 'mutation':
        applyMutation(state, event.mutation);
        break;
      case 'freeze':
        applyFreeze(state, event.freeze);
        break;
      case 'review':
        applyReview(state, event.review);
        break;
      case 'correction':
        applyCorrection(state, event.correction);
        break;
      default:
        fail(state, `unknown event type: ${event.type}`);
    }

    if (state.errors.length > 0) break;
  }

  return state;
}
