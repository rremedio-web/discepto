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

export const PROTOCOL_VERSION = 'discepto-protocol-3';

/**
 * The single authority-rejection catalogue. Every code the protocol can emit
 * is declared here with its operation and its message variants; the watcher
 * adapter, the tests, the docs table, and the fixture expectations all derive
 * from this table. Adding a code means adding one entry here.
 */
export const AUTHORITY_REJECTIONS = Object.freeze({
  LEASE_ISSUER_MISMATCH: Object.freeze({
    operation: 'lease',
    messages: Object.freeze({
      default: 'lease must be coordinator-issued',
      first: 'first lease must be coordinator-issued',
    }),
  }),
  LEASE_WRITER_MISMATCH: Object.freeze({
    operation: 'lease',
    messages: Object.freeze({ default: 'lease writer_id must match predesignated writer' }),
  }),
  LEASE_INITIAL_INACTIVE: Object.freeze({
    operation: 'lease',
    messages: Object.freeze({ default: 'first lease must be active' }),
  }),
  LEASE_SCOPE_WIDENING: Object.freeze({
    operation: 'lease',
    messages: Object.freeze({ default: 'lease scope widening rejected' }),
  }),
  MUTATION_CHALLENGER: Object.freeze({
    operation: 'mutation',
    messages: Object.freeze({ default: 'challenger mutation rejected' }),
  }),
  MUTATION_NO_ACTIVE_LEASE: Object.freeze({
    operation: 'mutation',
    messages: Object.freeze({ default: 'mutation rejected without active lease' }),
  }),
  MUTATION_WRITER_MISMATCH: Object.freeze({
    operation: 'mutation',
    messages: Object.freeze({ default: 'mutation writer_id mismatch' }),
  }),
  MUTATION_OUTSIDE_SCOPE: Object.freeze({
    operation: 'mutation',
    messages: Object.freeze({ default: 'mutation path outside lease scope' }),
  }),
  REVIEW_REVIEWER_MISMATCH: Object.freeze({
    operation: 'review',
    messages: Object.freeze({ default: 'reviewer must be challenger' }),
  }),
  REVIEW_SAME_SEAT: Object.freeze({
    operation: 'review',
    messages: Object.freeze({ default: 'reviewer and writer seats must differ' }),
  }),
  REVIEW_SEAT_MISMATCH: Object.freeze({
    operation: 'review',
    messages: Object.freeze({ default: 'reviewer seat must match registered challenger seat' }),
  }),
  REVIEW_NO_CURRENT_FREEZE: Object.freeze({
    operation: 'review',
    messages: Object.freeze({ default: 'review requires current freeze' }),
  }),
  REVIEW_BINDING_MISMATCH: Object.freeze({
    operation: 'review',
    messages: Object.freeze({ default: 'freeze_binding mismatch' }),
  }),
  REVIEW_FREEZE_MISMATCH: Object.freeze({
    operation: 'review',
    messages: Object.freeze({ default: 'review must reference current freeze' }),
  }),
});

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

/**
 * Replay outcomes are values, not side effects to be read off the state:
 *   { status: 'accepted' }
 *   { status: 'rejected', code, operation, message }
 *   { status: 'fatal', message }
 * The mutable state struct below is private to this module; the only public
 * read of a replay is the snapshot plus the ordered outcome list.
 */

function createInitialState(run) {
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
  return { status: 'fatal', message };
}

function reject(state, code, variant = 'default') {
  const rule = AUTHORITY_REJECTIONS[code];
  const message = rule?.messages[variant];
  if (rule === undefined || message === undefined) {
    throw new Error(`uncatalogued rejection: ${code} (${variant})`);
  }
  const rejection = { code, operation: rule.operation, message };
  state.rejections.push(rejection);
  return { status: 'rejected', ...rejection };
}

function agentRole(state, agentId) {
  const agent = state.run.agents.find((item) => item.id === agentId);
  return agent?.role ?? null;
}

function requirePhase(state, expected) {
  if (state.phase !== expected) {
    return fail(state, `expected phase ${expected}, got ${state.phase}`);
  }
  return null;
}

function advancePhase(state, next) {
  if (PHASE_INDEX[next] <= PHASE_INDEX[state.phase]) {
    return fail(state, `cannot advance to ${next} from ${state.phase}`);
  }
  state.phase = next;
  return null;
}

function currentFreeze(state) {
  return state.freezes.find((item) => item.id === state.currentFreezeId) ?? null;
}

function applyDiagnosis(state, diagnosis) {
  const result = validateDiagnosis(diagnosis);
  if (!result.ok) return fail(state, result.error);
  const phaseOutcome = requirePhase(state, 'DIAGNOSE');
  if (phaseOutcome) return phaseOutcome;

  const role = agentRole(state, diagnosis.agent_id);
  if (!role) return fail(state, 'diagnosis agent_id not in run');
  if (state.diagnoses.has(diagnosis.agent_id)) {
    return fail(state, 'duplicate diagnosis for agent');
  }

  state.diagnoses.set(diagnosis.agent_id, diagnosis);
  if (state.diagnoses.size === 2) {
    const advanceOutcome = advancePhase(state, 'DISPUTE');
    if (advanceOutcome) return advanceOutcome;
  }
  return { status: 'accepted' };
}

function applyDispute(state, dispute) {
  const result = validateDispute(dispute);
  if (!result.ok) return fail(state, result.error);
  const phaseOutcome = requirePhase(state, 'DISPUTE');
  if (phaseOutcome) return phaseOutcome;

  const role = agentRole(state, dispute.agent_id);
  if (!role) return fail(state, 'dispute agent_id not in run');
  if (state.disputes.some((item) => item.agent_id === dispute.agent_id)) {
    return fail(state, 'duplicate dispute for agent');
  }

  state.disputes.push(dispute);
  return { status: 'accepted' };
}

function applyMeasurement(state, measurement) {
  const result = validateMeasurement(measurement);
  if (!result.ok) return fail(state, result.error);

  if (state.phase === 'DISPUTE') {
    if (state.disputes.length < 2) {
      return fail(state, 'measurement requires both dispute claims');
    }
    state.measurement = measurement;
    const advanceOutcome = advancePhase(state, 'MEASURE');
    if (advanceOutcome) return advanceOutcome;
    return { status: 'accepted' };
  }

  if (state.phase === 'MEASURE') {
    return fail(state, 'duplicate measurement rejected');
  }

  return fail(state, 'measurement not allowed in current phase');
}

function applyLease(state, lease) {
  const result = validateLease(lease);
  if (!result.ok) return fail(state, result.error);

  const isFirstLease = state.lease === null;

  if (isFirstLease) {
    const phaseOutcome = requirePhase(state, 'MEASURE');
    if (phaseOutcome) return phaseOutcome;
    if (lease.issuer_id !== state.coordinatorId) {
      return reject(state, 'LEASE_ISSUER_MISMATCH', 'first');
    }
    if (lease.writer_id !== state.writerId) {
      return reject(state, 'LEASE_WRITER_MISMATCH');
    }
    if (!lease.active) {
      return reject(state, 'LEASE_INITIAL_INACTIVE');
    }
    state.lease = copyLease(lease);
    const advanceOutcome = advancePhase(state, 'IMPLEMENT');
    if (advanceOutcome) return advanceOutcome;
    return { status: 'accepted' };
  }

  if (state.phase !== 'IMPLEMENT' && state.phase !== 'CORRECT') {
    return fail(state, 'lease not allowed in current phase');
  }
  if (lease.issuer_id !== state.coordinatorId) {
    return reject(state, 'LEASE_ISSUER_MISMATCH');
  }
  if (lease.writer_id !== state.writerId) {
    return reject(state, 'LEASE_WRITER_MISMATCH');
  }
  if (!scopeSubset(lease.scope, state.lease.scope)) {
    return reject(state, 'LEASE_SCOPE_WIDENING');
  }

  state.lease = copyLease(lease);
  return { status: 'accepted' };
}

function applyMutation(state, mutation) {
  const result = validateMutation(mutation);
  if (!result.ok) return fail(state, result.error);

  const { agent_id: agentId, path } = mutation;

  if (state.phase !== 'IMPLEMENT' && state.phase !== 'CORRECT') {
    return fail(state, 'mutation not allowed in current phase');
  }

  const role = agentRole(state, agentId);
  if (role === 'challenger') return reject(state, 'MUTATION_CHALLENGER');
  if (role !== 'writer') return fail(state, 'mutation agent_id not in run');

  if (!state.lease || !state.lease.active) {
    return reject(state, 'MUTATION_NO_ACTIVE_LEASE');
  }
  // Fail-closed defence, documented unreachable: applyLease already pins every
  // accepted lease's writer_id to the predesignated writer, so no legal event
  // sequence can reach this guard. Kept per doctrine: guards stay.
  if (state.lease.writer_id !== agentId) {
    return reject(state, 'MUTATION_WRITER_MISMATCH');
  }
  if (!state.lease.scope.includes(path)) {
    return reject(state, 'MUTATION_OUTSIDE_SCOPE');
  }

  state.mutations.push({ agent_id: agentId, path });
  return { status: 'accepted' };
}

function applyFreeze(state, freeze) {
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
  const advanceFreezeOutcome = advancePhase(state, 'FREEZE');
  if (advanceFreezeOutcome) return advanceFreezeOutcome;
  const advanceReviewOutcome = advancePhase(state, 'REVIEW');
  if (advanceReviewOutcome) return advanceReviewOutcome;
  return { status: 'accepted' };
}

function validateReviewAuthority(state, review) {
  if (review.reviewer_id !== state.challengerId) {
    return reject(state, 'REVIEW_REVIEWER_MISMATCH');
  }
  if (review.seat_id === state.writerSeatId) {
    return reject(state, 'REVIEW_SAME_SEAT');
  }
  if (review.seat_id !== state.challengerSeatId) {
    return reject(state, 'REVIEW_SEAT_MISMATCH');
  }
  // Fail-closed defence, documented unreachable: REVIEW is only reachable
  // after a freeze set currentFreezeId, and corrections always clear it on
  // the way back to IMPLEMENT. Kept per doctrine: guards stay.
  const freeze = currentFreeze(state);
  if (!freeze) return reject(state, 'REVIEW_NO_CURRENT_FREEZE');
  if (review.freeze_binding !== freeze.binding) {
    return reject(state, 'REVIEW_BINDING_MISMATCH');
  }
  return null;
}

function applyReview(state, review) {
  const result = validateReview(review);
  if (!result.ok) return fail(state, result.error);
  const phaseOutcome = requirePhase(state, 'REVIEW');
  if (phaseOutcome) return phaseOutcome;
  // Fail-closed defence, documented unreachable (see validateReviewAuthority).
  if (!state.currentFreezeId) return reject(state, 'REVIEW_NO_CURRENT_FREEZE');
  if (review.freeze_id !== state.currentFreezeId) {
    return reject(state, 'REVIEW_FREEZE_MISMATCH');
  }
  const authorityOutcome = validateReviewAuthority(state, review);
  if (authorityOutcome) return authorityOutcome;

  state.reviews.push(review);

  if (review.verdict === 'PASS') {
    const advanceOutcome = advancePhase(state, 'FINAL');
    if (advanceOutcome) return advanceOutcome;
    state.final = true;
    return { status: 'accepted' };
  }

  if (review.verdict === 'CHANGES_NEEDED') {
    const advanceOutcome = advancePhase(state, 'CORRECT');
    if (advanceOutcome) return advanceOutcome;
    return { status: 'accepted' };
  }

  return fail(state, 'invalid review verdict');
}

function applyCorrection(state, correction) {
  const result = validateCorrection(correction);
  if (!result.ok) return fail(state, result.error);
  if (state.correctionCount >= 1) {
    return fail(state, 'second correction rejected');
  }
  const phaseOutcome = requirePhase(state, 'CORRECT');
  if (phaseOutcome) return phaseOutcome;
  if (correction.supersedes !== state.currentFreezeId) {
    return fail(state, 'correction must supersede current freeze');
  }

  state.corrections.push(correction);
  state.correctionCount += 1;
  state.mutations = [];
  state.currentFreezeId = null;
  state.phase = 'IMPLEMENT';
  return { status: 'accepted' };
}

function snapshotState(state) {
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
  const outcomes = [];

  for (const event of events) {
    if (!event || typeof event.type !== 'string') {
      outcomes.push(fail(state, 'event requires type'));
      break;
    }

    let outcome;
    switch (event.type) {
      case 'diagnosis':
        outcome = applyDiagnosis(state, event.diagnosis);
        break;
      case 'dispute':
        outcome = applyDispute(state, event.dispute);
        break;
      case 'measurement':
        outcome = applyMeasurement(state, event.measurement);
        break;
      case 'lease':
        outcome = applyLease(state, event.lease);
        break;
      case 'mutation':
        outcome = applyMutation(state, event.mutation);
        break;
      case 'freeze':
        outcome = applyFreeze(state, event.freeze);
        break;
      case 'review':
        outcome = applyReview(state, event.review);
        break;
      case 'correction':
        outcome = applyCorrection(state, event.correction);
        break;
      default:
        outcome = fail(state, `unknown event type: ${event.type}`);
    }

    outcomes.push(outcome);
    if (outcome.status === 'fatal') break;
  }

  return { snapshot: snapshotState(state), outcomes };
}
