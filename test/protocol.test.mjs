import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createInitialState,
  applyDiagnosis,
  applyDispute,
  applyMeasurement,
  applyLease,
  applyMutation,
  applyFreeze,
  applyReview,
  applyCorrection,
  deriveFreezeBinding,
  canonicalMeasurementHash,
  AUTHORITY_REJECTIONS,
  PROTOCOL_VERSION,
  replayEvents,
  snapshotState,
} from '../src/protocol.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const baseRun = {
  id: 'run-protocol',
  worktree_id: 'wt-protocol',
  coordinator_id: 'coordinator-1',
  agents: [
    { id: 'writer-1', role: 'writer', seat_id: 'writer-seat' },
    { id: 'challenger-1', role: 'challenger', seat_id: 'challenger-seat' },
  ],
  phase: 'DIAGNOSE',
};

const measurement = {
  method: 'm',
  observations: [{ key: 'k', value: 'v' }],
  result: 'resolved',
};

function coordinatorLease(state, scope = ['src/a.mjs'], active = true) {
  return applyLease(state, {
    issuer_id: 'coordinator-1',
    writer_id: 'writer-1',
    scope,
    active,
  });
}

function writerLease(state, scope = ['src/a.mjs'], active = true) {
  return applyLease(state, {
    issuer_id: 'writer-1',
    writer_id: 'writer-1',
    scope,
    active,
  });
}

function bothDiagnoses(state) {
  applyDiagnosis(state, { agent_id: 'writer-1', read_only: true, findings: ['a'] });
  applyDiagnosis(state, { agent_id: 'challenger-1', read_only: true, findings: ['b'] });
}

function throughDispute(state) {
  bothDiagnoses(state);
  applyDispute(state, { agent_id: 'writer-1', claim: 'c1', estimate: 'e1' });
  applyDispute(state, { agent_id: 'challenger-1', claim: 'c2', estimate: 'e2' });
}

function throughMeasurement(state) {
  throughDispute(state);
  applyMeasurement(state, measurement);
}

function throughFirstLease(state) {
  throughMeasurement(state);
  coordinatorLease(state);
}

function oneMutation(state) {
  throughFirstLease(state);
  applyMutation(state, { agent_id: 'writer-1', path: 'src/a.mjs' });
}

function freezeRequest(id, baseId = 'base', candidateId = 'candidate') {
  return { id, base_id: baseId, candidate_id: candidateId };
}

function oneFreeze(state, id = 'freeze-a') {
  oneMutation(state);
  applyFreeze(state, freezeRequest(id));
}

function currentBinding(state) {
  const freeze = state.freezes.find((item) => item.id === state.currentFreezeId);
  return freeze?.binding ?? null;
}

function challengerReview(state, freezeId, verdict, findings = []) {
  return applyReview(state, {
    reviewer_id: 'challenger-1',
    seat_id: 'challenger-seat',
    freeze_id: freezeId,
    freeze_binding: currentBinding(state),
    verdict,
    findings,
  });
}

describe('protocol authority and phase invariants', () => {
  it('rejects review when the declared reviewer seat matches the writer seat', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    const ok = applyReview(state, {
      reviewer_id: 'challenger-1',
      seat_id: 'writer-seat',
      freeze_id: 'freeze-a',
      freeze_binding: currentBinding(state),
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(ok, false);
    assert.equal(state.phase, 'REVIEW');
    assert.deepEqual(state.rejections.at(-1), {
      code: 'REVIEW_SAME_SEAT',
      operation: 'review',
      message: 'reviewer and writer seats must differ',
    });
  });

  it('rejects review when the declared reviewer seat is not the challenger seat', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    const ok = applyReview(state, {
      reviewer_id: 'challenger-1',
      seat_id: 'bogus-seat',
      freeze_id: 'freeze-a',
      freeze_binding: currentBinding(state),
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(ok, false);
    assert.equal(state.phase, 'REVIEW');
    assert.deepEqual(state.rejections.at(-1), {
      code: 'REVIEW_SEAT_MISMATCH',
      operation: 'review',
      message: 'reviewer seat must match registered challenger seat',
    });
  });
  it('advances DIAGNOSE to DISPUTE after both read-only diagnoses', () => {
    const state = createInitialState(baseRun);
    bothDiagnoses(state);
    assert.equal(state.phase, 'DISPUTE');
    assert.equal(state.diagnoses.size, 2);
  });

  it('rejects diagnosis when read_only is not true', () => {
    const state = createInitialState(baseRun);
    const ok = applyDiagnosis(state, { agent_id: 'writer-1', read_only: false, findings: ['x'] });
    assert.equal(ok, false);
    assert.match(state.errors[0], /read_only must be true/);
  });

  it('dispute cannot advance without discriminating measurement', () => {
    const state = createInitialState(baseRun);
    throughDispute(state);
    assert.equal(state.phase, 'DISPUTE');
    assert.equal(state.measurement, null);
  });

  it('measurement from DISPUTE advances only to observable MEASURE', () => {
    const state = createInitialState(baseRun);
    throughMeasurement(state);
    assert.equal(state.phase, 'MEASURE');
    assert.ok(state.measurement);
    assert.equal(snapshotState(state).has_measurement, true);
  });

  it('duplicate measurement in MEASURE is fatal', () => {
    const state = createInitialState(baseRun);
    throughMeasurement(state);
    const ok = applyMeasurement(state, measurement);
    assert.equal(ok, false);
    assert.match(state.errors.at(-1), /duplicate measurement rejected/);
  });

  it('inactive first lease stays in MEASURE', () => {
    const state = createInitialState(baseRun);
    throughMeasurement(state);
    const ok = coordinatorLease(state, ['src/a.mjs'], false);
    assert.equal(ok, false);
    assert.equal(state.phase, 'MEASURE');
    assert.equal(state.lease, null);
    assert.match(state.rejections.at(-1).message, /first lease must be active/);
    assert.equal(state.errors.length, 0);
  });

  it('first coordinator lease in MEASURE advances to IMPLEMENT', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    assert.equal(state.phase, 'IMPLEMENT');
    assert.equal(state.lease.active, true);
  });

  it('rejects writer self-issued first lease', () => {
    const state = createInitialState(baseRun);
    throughMeasurement(state);
    const ok = writerLease(state);
    assert.equal(ok, false);
    assert.equal(state.phase, 'MEASURE');
    assert.match(state.rejections.at(-1).message, /coordinator-issued/);
  });

  it('rejects mutation without active lease as nonfatal rejection', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    coordinatorLease(state, ['src/a.mjs'], false);
    const ok = applyMutation(state, { agent_id: 'writer-1', path: 'src/a.mjs' });
    assert.equal(ok, false);
    assert.match(state.rejections.at(-1).message, /active lease/);
    assert.equal(state.errors.length, 0);
  });

  it('rejects challenger mutation as nonfatal rejection', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    const ok = applyMutation(state, { agent_id: 'challenger-1', path: 'src/a.mjs' });
    assert.equal(ok, false);
    assert.match(state.rejections.at(-1).message, /challenger mutation rejected/);
    assert.equal(state.errors.length, 0);
  });

  it('rejects mutation outside lease scope as nonfatal rejection', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    const ok = applyMutation(state, { agent_id: 'writer-1', path: 'other.mjs' });
    assert.equal(ok, false);
    assert.match(state.rejections.at(-1).message, /outside lease scope/);
    assert.equal(state.errors.length, 0);
  });

  it('coordinator can narrow lease scope', () => {
    const state = createInitialState(baseRun);
    throughMeasurement(state);
    coordinatorLease(state, ['src/a.mjs', 'src/b.mjs']);
    const ok = coordinatorLease(state, ['src/a.mjs']);
    assert.equal(ok, true);
    assert.deepEqual(state.lease.scope, ['src/a.mjs']);
  });

  it('coordinator equal-scope lease update is accepted', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    const ok = coordinatorLease(state, ['src/a.mjs']);
    assert.equal(ok, true);
    assert.deepEqual(state.lease.scope, ['src/a.mjs']);
  });

  it('writer cannot widen lease scope', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    const ok = writerLease(state, ['src/a.mjs', 'src/b.mjs']);
    assert.equal(ok, false);
    assert.deepEqual(state.lease.scope, ['src/a.mjs']);
    assert.match(state.rejections.at(-1).message, /coordinator-issued/);
  });

  it('coordinator widening lease is rejected without changing prior lease', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    const ok = coordinatorLease(state, ['src/a.mjs', 'src/b.mjs']);
    assert.equal(ok, false);
    assert.deepEqual(state.lease.scope, ['src/a.mjs']);
    assert.match(state.rejections.at(-1).message, /widening rejected/);
  });

  it('coordinator can revoke lease with inactive equal scope', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    const ok = coordinatorLease(state, ['src/a.mjs'], false);
    assert.equal(ok, true);
    assert.equal(state.lease.active, false);
    assert.deepEqual(state.lease.scope, ['src/a.mjs']);
  });

  it('coordinator can reactivate equal scope after revoke', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    coordinatorLease(state, ['src/a.mjs'], false);
    const ok = coordinatorLease(state, ['src/a.mjs'], true);
    assert.equal(ok, true);
    assert.equal(state.lease.active, true);
  });

  it('inactive revoke cannot widen scope', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    const ok = coordinatorLease(state, ['src/a.mjs', 'src/b.mjs'], false);
    assert.equal(ok, false);
    assert.deepEqual(state.lease.scope, ['src/a.mjs']);
    assert.match(state.rejections.at(-1).message, /widening rejected/);
  });

  it('freeze requires measured evidence and scoped mutation', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    const ok = applyFreeze(state, freezeRequest('f1'));
    assert.equal(ok, false);
    assert.match(state.errors[0], /at least one scoped mutation/);
  });

  it('canonicalMeasurementHash is stable under observation reorder and sensitive to value change', () => {
    const base = {
      method: 'm',
      observations: [
        { key: 'b', value: '2' },
        { key: 'a', value: '1' },
        { key: 'c', value: '3' },
      ],
      result: 'resolved',
    };
    const reordered = {
      ...base,
      observations: [
        { key: 'c', value: '3' },
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
      ],
    };
    const changed = {
      ...base,
      observations: [
        { key: 'b', value: '2' },
        { key: 'a', value: 'changed' },
        { key: 'c', value: '3' },
      ],
    };
    const differentArtifact = {
      ...base,
      artifact_identity: { kind: 'staging', url: 'https://staging.example.test/fixture' },
    };
    const reorderedArtifact = {
      ...base,
      artifact_identity: { url: 'https://staging.example.test/fixture', kind: 'staging' },
    };
    const hash = canonicalMeasurementHash(base);
    assert.equal(canonicalMeasurementHash(reordered), hash);
    assert.notEqual(canonicalMeasurementHash(changed), hash);
    assert.notEqual(canonicalMeasurementHash(differentArtifact), hash);
    assert.equal(canonicalMeasurementHash(reorderedArtifact), canonicalMeasurementHash(differentArtifact));
  });

  it('produces canonical SHA-256 trace binding over protocol fields including coordinator_id', () => {
    const mHash = canonicalMeasurementHash(measurement);
    const binding = deriveFreezeBinding(baseRun, freezeRequest('freeze-x', 'base-x', 'cand-x'), ['b.mjs', 'a.mjs'], mHash);
    assert.match(binding, /^[0-9a-f]{64}$/);
    assert.equal(binding, deriveFreezeBinding(baseRun, freezeRequest('freeze-x', 'base-x', 'cand-x'), ['a.mjs', 'b.mjs'], mHash));
    assert.notEqual(binding, deriveFreezeBinding({ ...baseRun, coordinator_id: 'other-coordinator' }, freezeRequest('freeze-x', 'base-x', 'cand-x'), ['a.mjs', 'b.mjs'], mHash));
    assert.notEqual(binding, deriveFreezeBinding(baseRun, freezeRequest('other', 'base-x', 'cand-x'), ['a.mjs', 'b.mjs'], mHash));
    assert.notEqual(binding, deriveFreezeBinding(baseRun, freezeRequest('freeze-x', 'base-x', 'cand-x'), ['a.mjs'], mHash));
    assert.notEqual(binding, deriveFreezeBinding(baseRun, freezeRequest('freeze-x', 'base-x', 'cand-x'), ['a.mjs', 'b.mjs'], 'other-hash'));
  });

  it('binding changes when mutation path or measurement changes', () => {
    const freeze = freezeRequest('freeze-same', 'base-same', 'candidate-same');

    const stateA = createInitialState(baseRun);
    throughFirstLease(stateA);
    applyMutation(stateA, { agent_id: 'writer-1', path: 'src/a.mjs' });
    applyFreeze(stateA, freeze);
    const bindingA = currentBinding(stateA);

    const stateB = createInitialState(baseRun);
    throughMeasurement(stateB);
    coordinatorLease(stateB, ['src/b.mjs']);
    applyMutation(stateB, { agent_id: 'writer-1', path: 'src/b.mjs' });
    applyFreeze(stateB, freeze);
    const bindingB = currentBinding(stateB);

    const stateC = createInitialState(baseRun);
    throughDispute(stateC);
    applyMeasurement(stateC, { ...measurement, result: 'different' });
    coordinatorLease(stateC);
    applyMutation(stateC, { agent_id: 'writer-1', path: 'src/a.mjs' });
    applyFreeze(stateC, freeze);
    const bindingC = currentBinding(stateC);

    assert.notEqual(bindingA, bindingB);
    assert.notEqual(bindingA, bindingC);
  });

  it('accepted trace binding ignores rejected authority attempts', () => {
    const buildBinding = (withRejections) => {
      const state = createInitialState(baseRun);
      throughMeasurement(state);
      if (withRejections) {
        writerLease(state);
        coordinatorLease(state, ['src/a.mjs', 'src/b.mjs']);
      }
      coordinatorLease(state);
      applyMutation(state, { agent_id: 'writer-1', path: 'src/a.mjs' });
      applyFreeze(state, freezeRequest('freeze-bind'));
      return currentBinding(state);
    };
    assert.equal(buildBinding(false), buildBinding(true));
  });

  it('review wrong freeze id is nonfatal rejection', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    const ok = applyReview(state, {
      reviewer_id: 'challenger-1',
      seat_id: 'challenger-seat',
      freeze_id: 'wrong-freeze',
      freeze_binding: currentBinding(state),
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(ok, false);
    assert.match(state.rejections.at(-1).message, /current freeze/);
    assert.equal(state.errors.length, 0);
  });

  it('stale review rejection after freeze supersession via applyReview', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    challengerReview(state, 'freeze-a', 'CHANGES_NEEDED', ['fix']);
    applyCorrection(state, {
      supersedes: 'freeze-a',
      red_ref: 'red',
      green_ref: 'green',
      count: 1,
    });
    coordinatorLease(state);
    applyMutation(state, { agent_id: 'writer-1', path: 'src/a.mjs' });
    applyFreeze(state, freezeRequest('freeze-b', 'base', 'candidate-2'));
    const ok = applyReview(state, {
      reviewer_id: 'challenger-1',
      seat_id: 'challenger-seat',
      freeze_id: 'freeze-a',
      freeze_binding: currentBinding(state),
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(ok, false);
    assert.match(state.rejections.at(-1).message, /current freeze/);
    assert.equal(state.errors.length, 0);
  });

  it('challenger mutation rejection then valid path reaches FINAL', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    applyMutation(state, { agent_id: 'challenger-1', path: 'src/a.mjs' });
    assert.match(state.rejections.at(-1).message, /challenger/);
    applyMutation(state, { agent_id: 'writer-1', path: 'src/a.mjs' });
    applyFreeze(state, freezeRequest('freeze-a'));
    challengerReview(state, 'freeze-a', 'PASS');
    assert.equal(state.phase, 'FINAL');
    assert.equal(state.final, true);
  });

  it('CHANGES_NEEDED leads to CORRECT then requires new freeze', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    challengerReview(state, 'freeze-a', 'CHANGES_NEEDED', ['x']);
    assert.equal(state.phase, 'CORRECT');
    assert.equal(state.currentFreezeId, 'freeze-a');
  });

  it('rejects direct freeze from CORRECT without applyCorrection', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    challengerReview(state, 'freeze-a', 'CHANGES_NEEDED', ['x']);
    const ok = applyFreeze(state, freezeRequest('freeze-b', 'base', 'candidate-2'));
    assert.equal(ok, false);
    assert.equal(state.currentFreezeId, 'freeze-a');
    assert.equal(state.freezes.length, 1);
    assert.match(state.errors.at(-1), /freeze not allowed in current phase/);
  });

  it('second correction fails closed', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    challengerReview(state, 'freeze-a', 'CHANGES_NEEDED', ['x']);
    applyCorrection(state, {
      supersedes: 'freeze-a',
      red_ref: 'r',
      green_ref: 'g',
      count: 1,
    });
    const ok = applyCorrection(state, {
      supersedes: 'freeze-a',
      red_ref: 'r2',
      green_ref: 'g2',
      count: 1,
    });
    assert.equal(ok, false);
    assert.match(state.errors.at(-1), /second correction rejected/);
  });

  it('FINAL only after challenger PASS on current binding', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    challengerReview(state, 'freeze-a', 'PASS');
    assert.equal(state.phase, 'FINAL');
    assert.equal(state.final, true);
  });

  it('failed review requires new freeze path via correction', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    challengerReview(state, 'freeze-a', 'CHANGES_NEEDED', ['n']);
    applyCorrection(state, {
      supersedes: 'freeze-a',
      red_ref: 'r',
      green_ref: 'g',
      count: 1,
    });
    assert.equal(state.phase, 'IMPLEMENT');
    assert.equal(state.currentFreezeId, null);
    coordinatorLease(state);
    applyMutation(state, { agent_id: 'writer-1', path: 'src/a.mjs' });
    applyFreeze(state, freezeRequest('freeze-b', 'base', 'candidate-2'));
    challengerReview(state, 'freeze-b', 'PASS');
    assert.equal(state.phase, 'FINAL');
  });

  it('snapshot exposes rejection_count and rejections', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    applyMutation(state, { agent_id: 'challenger-1', path: 'src/a.mjs' });
    const snap = snapshotState(state);
    assert.equal(snap.rejection_count, 1);
    assert.equal(snap.rejections.length, 1);
    assert.match(snap.rejections[0].message, /challenger/);
  });
});

describe('stable structured nonfatal rejections', () => {
  function assertRejection(state, code, operation, message) {
    const rejection = state.rejections.at(-1);
    assert.deepEqual(rejection, { code, operation, message });
  }

  it('maps lease issuer mismatch on first lease', () => {
    const state = createInitialState(baseRun);
    throughMeasurement(state);
    writerLease(state);
    assertRejection(
      state,
      'LEASE_ISSUER_MISMATCH',
      'lease',
      'first lease must be coordinator-issued',
    );
  });

  it('maps lease issuer mismatch on subsequent lease', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    writerLease(state);
    assertRejection(state, 'LEASE_ISSUER_MISMATCH', 'lease', 'lease must be coordinator-issued');
  });

  it('maps lease writer mismatch on first lease', () => {
    const state = createInitialState(baseRun);
    throughMeasurement(state);
    applyLease(state, {
      issuer_id: 'coordinator-1',
      writer_id: 'challenger-1',
      scope: ['src/a.mjs'],
      active: true,
    });
    assertRejection(
      state,
      'LEASE_WRITER_MISMATCH',
      'lease',
      'lease writer_id must match predesignated writer',
    );
  });

  it('maps lease initial inactive', () => {
    const state = createInitialState(baseRun);
    throughMeasurement(state);
    coordinatorLease(state, ['src/a.mjs'], false);
    assertRejection(state, 'LEASE_INITIAL_INACTIVE', 'lease', 'first lease must be active');
  });

  it('maps lease scope widening', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    coordinatorLease(state, ['src/a.mjs', 'src/b.mjs']);
    assertRejection(state, 'LEASE_SCOPE_WIDENING', 'lease', 'lease scope widening rejected');
  });

  it('maps mutation challenger', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    applyMutation(state, { agent_id: 'challenger-1', path: 'src/a.mjs' });
    assertRejection(state, 'MUTATION_CHALLENGER', 'mutation', 'challenger mutation rejected');
  });

  it('maps mutation without active lease', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    coordinatorLease(state, ['src/a.mjs'], false);
    applyMutation(state, { agent_id: 'writer-1', path: 'src/a.mjs' });
    assertRejection(
      state,
      'MUTATION_NO_ACTIVE_LEASE',
      'mutation',
      'mutation rejected without active lease',
    );
  });

  it('maps mutation writer mismatch', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    state.lease.writer_id = 'other-writer';
    applyMutation(state, { agent_id: 'writer-1', path: 'src/a.mjs' });
    assertRejection(state, 'MUTATION_WRITER_MISMATCH', 'mutation', 'mutation writer_id mismatch');
  });

  it('maps mutation outside scope', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    applyMutation(state, { agent_id: 'writer-1', path: 'other.mjs' });
    assertRejection(state, 'MUTATION_OUTSIDE_SCOPE', 'mutation', 'mutation path outside lease scope');
  });

  it('maps review reviewer mismatch', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    applyReview(state, {
      reviewer_id: 'writer-1',
      seat_id: 'writer-seat',
      freeze_id: 'freeze-a',
      freeze_binding: currentBinding(state),
      verdict: 'PASS',
      findings: [],
    });
    assertRejection(state, 'REVIEW_REVIEWER_MISMATCH', 'review', 'reviewer must be challenger');
  });

  it('maps review without current freeze', () => {
    const state = createInitialState(baseRun);
    state.phase = 'REVIEW';
    applyReview(state, {
      reviewer_id: 'challenger-1',
      seat_id: 'challenger-seat',
      freeze_id: 'freeze-a',
      freeze_binding: '0000000000000000000000000000000000000000000000000000000000000000',
      verdict: 'PASS',
      findings: [],
    });
    assertRejection(state, 'REVIEW_NO_CURRENT_FREEZE', 'review', 'review requires current freeze');
  });

  it('maps review binding mismatch', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    applyReview(state, {
      reviewer_id: 'challenger-1',
      seat_id: 'challenger-seat',
      freeze_id: 'freeze-a',
      freeze_binding: '0000000000000000000000000000000000000000000000000000000000000000',
      verdict: 'PASS',
      findings: [],
    });
    assertRejection(state, 'REVIEW_BINDING_MISMATCH', 'review', 'freeze_binding mismatch');
  });

  it('maps review freeze mismatch', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    applyReview(state, {
      reviewer_id: 'challenger-1',
      seat_id: 'challenger-seat',
      freeze_id: 'wrong-freeze',
      freeze_binding: currentBinding(state),
      verdict: 'PASS',
      findings: [],
    });
    assertRejection(state, 'REVIEW_FREEZE_MISMATCH', 'review', 'review must reference current freeze');
  });

  it('snapshot returns structured rejection records', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    applyMutation(state, { agent_id: 'challenger-1', path: 'src/a.mjs' });
    const snap = snapshotState(state);
    assert.deepEqual(snap.rejections, [
      {
        code: 'MUTATION_CHALLENGER',
        operation: 'mutation',
        message: 'challenger mutation rejected',
      },
    ]);
  });
});

describe('reproduced attack rejection', () => {
  it('rejects later initial phase on fresh run', () => {
    assert.throws(
      () => createInitialState({ ...baseRun, phase: 'IMPLEMENT' }),
      /must start at DIAGNOSE/,
    );
  });

  it('rejects null mutation without throw from applyMutation', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    const ok = applyMutation(state, null);
    assert.equal(ok, false);
    assert.match(state.errors[0], /mutation must be an object/);
  });

  it('rejects unknown mutation fields without throw', () => {
    const state = createInitialState(baseRun);
    throughFirstLease(state);
    const ok = applyMutation(state, { agent_id: 'writer-1', path: 'src/a.mjs', forged: true });
    assert.equal(ok, false);
    assert.match(state.errors[0], /unknown fields/);
  });

  it('rejects fabricated changed_paths on freeze request', () => {
    const state = createInitialState(baseRun);
    oneMutation(state);
    const ok = applyFreeze(state, {
      id: 'f1',
      base_id: 'b',
      candidate_id: 'c',
      changed_paths: ['forged.mjs'],
    });
    assert.equal(ok, false);
    assert.match(state.errors.at(-1), /unknown fields/);
  });

  it('derives changed_paths from recorded mutations not request', () => {
    const state = createInitialState(baseRun);
    oneMutation(state);
    applyFreeze(state, freezeRequest('f1'));
    const freeze = state.freezes[0];
    assert.deepEqual(freeze.changed_paths, ['src/a.mjs']);
  });

  it('rejects globally duplicate freeze id', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    challengerReview(state, 'freeze-a', 'CHANGES_NEEDED', ['x']);
    applyCorrection(state, {
      supersedes: 'freeze-a',
      red_ref: 'r',
      green_ref: 'g',
      count: 1,
    });
    coordinatorLease(state);
    applyMutation(state, { agent_id: 'writer-1', path: 'src/a.mjs' });
    const ok = applyFreeze(state, freezeRequest('freeze-a', 'base', 'candidate-2'));
    assert.equal(ok, false);
    assert.match(state.errors.at(-1), /duplicate freeze id/);
  });

  it('rejects review with old binding hash ambiguity as nonfatal rejection', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    const staleBinding = currentBinding(state);
    challengerReview(state, 'freeze-a', 'CHANGES_NEEDED', ['x']);
    applyCorrection(state, {
      supersedes: 'freeze-a',
      red_ref: 'r',
      green_ref: 'g',
      count: 1,
    });
    coordinatorLease(state);
    applyMutation(state, { agent_id: 'writer-1', path: 'src/a.mjs' });
    applyFreeze(state, freezeRequest('freeze-b', 'base', 'candidate-2'));
    const ok = applyReview(state, {
      reviewer_id: 'challenger-1',
      seat_id: 'challenger-seat',
      freeze_id: 'freeze-b',
      freeze_binding: staleBinding,
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(ok, false);
    assert.match(state.rejections.at(-1).message, /freeze_binding mismatch/);
    assert.equal(state.errors.length, 0);
  });

  it('rejects unattributed review without reviewer_id as fatal schema error', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    const ok = applyReview(state, {
      freeze_id: 'freeze-a',
      seat_id: 'challenger-seat',
      freeze_binding: currentBinding(state),
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(ok, false);
    assert.match(state.errors.at(-1), /reviewer_id is required/);
  });

  it('rejects writer-authored review as nonfatal rejection', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    const ok = applyReview(state, {
      reviewer_id: 'writer-1',
      seat_id: 'writer-seat',
      freeze_id: 'freeze-a',
      freeze_binding: currentBinding(state),
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(ok, false);
    assert.match(state.rejections.at(-1).message, /reviewer must be challenger/);
    assert.equal(state.errors.length, 0);
  });

  it('rejects review with wrong binding as nonfatal rejection', () => {
    const state = createInitialState(baseRun);
    oneFreeze(state);
    const ok = applyReview(state, {
      reviewer_id: 'challenger-1',
      seat_id: 'challenger-seat',
      freeze_id: 'freeze-a',
      freeze_binding: '0000000000000000000000000000000000000000000000000000000000000000',
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(ok, false);
    assert.match(state.rejections.at(-1).message, /freeze_binding mismatch/);
    assert.equal(state.errors.length, 0);
  });

  it('exports protocol version constant discepto-protocol-3', () => {
    assert.equal(PROTOCOL_VERSION, 'discepto-protocol-3');
  });
});

describe('authority rejection catalogue derivation', () => {
  it('docs limitations table matches the catalogue exactly', () => {
    const markdown = readFileSync(join(root, 'docs/limitations.md'), 'utf8');
    const rows = [...markdown.matchAll(/^\| `([A-Z_]+)` \| `([a-z]+)` \| (?:Yes|No) \|$/gm)];
    const tableCodes = rows.map((match) => match[1]);
    assert.equal(tableCodes.length, 14);
    assert.deepEqual(
      [...tableCodes].sort(),
      Object.keys(AUTHORITY_REJECTIONS).sort(),
    );
    for (const [code, operation] of rows.map((match) => [match[1], match[2]])) {
      assert.equal(AUTHORITY_REJECTIONS[code].operation, operation, `docs table operation drift for ${code}`);
    }
  });

  it('every catalogue message is a non-empty string with a matching operation', () => {
    for (const [code, rule] of Object.entries(AUTHORITY_REJECTIONS)) {
      assert.equal(typeof rule.operation, 'string');
      assert.ok(['lease', 'mutation', 'review'].includes(rule.operation));
      const variants = Object.values(rule.messages);
      assert.ok(variants.length >= 1);
      for (const message of variants) {
        assert.equal(typeof message, 'string');
        assert.ok(message.length > 0);
      }
    }
  });
});

describe('replay integration', () => {
  it('replays fixture events without errors', async () => {
    const { loadFixtures } = await import('../src/replay.mjs');
    const { scenario, events } = loadFixtures();
    const state = replayEvents(scenario.run, events);
    assert.equal(state.errors.length, 0);
    assert.equal(state.phase, 'FINAL');
    assert.equal(state.final, true);
  });

  it('replay stops immediately on invalid first event before later diagnosis', () => {
    const state = replayEvents(baseRun, [
      null,
      { type: 'diagnosis', diagnosis: { agent_id: 'writer-1', read_only: true, findings: ['a'] } },
    ]);
    const snap = snapshotState(state);
    assert.equal(snap.errors.length, 1);
    assert.match(snap.errors[0], /event requires type/);
    assert.equal(snap.diagnosis_count, 0);
    assert.equal(snap.phase, 'DIAGNOSE');
  });

  it('replay continues after rejections and stops only on fatal errors', () => {
    const events = [
      { type: 'diagnosis', diagnosis: { agent_id: 'writer-1', read_only: true, findings: ['a'] } },
      { type: 'diagnosis', diagnosis: { agent_id: 'challenger-1', read_only: true, findings: ['b'] } },
      { type: 'dispute', dispute: { agent_id: 'writer-1', claim: 'c1', estimate: 'e1' } },
      { type: 'dispute', dispute: { agent_id: 'challenger-1', claim: 'c2', estimate: 'e2' } },
      { type: 'measurement', measurement },
      { type: 'lease', lease: { issuer_id: 'writer-1', writer_id: 'writer-1', scope: ['src/a.mjs'], active: true } },
      { type: 'lease', lease: { issuer_id: 'coordinator-1', writer_id: 'writer-1', scope: ['src/a.mjs'], active: true } },
      { type: 'mutation', mutation: { agent_id: 'challenger-1', path: 'src/a.mjs' } },
      { type: 'mutation', mutation: { agent_id: 'writer-1', path: 'src/a.mjs' } },
      { type: 'freeze', freeze: freezeRequest('freeze-a') },
      { type: 'review', review: {
        reviewer_id: 'challenger-1',
        seat_id: 'challenger-seat',
        freeze_id: 'freeze-a',
        freeze_binding: deriveFreezeBinding(
          baseRun,
          freezeRequest('freeze-a'),
          ['src/a.mjs'],
          canonicalMeasurementHash(measurement),
        ),
        verdict: 'PASS',
        findings: [],
      } },
    ];
    const state = replayEvents(baseRun, events);
    assert.equal(state.errors.length, 0);
    assert.ok(state.rejections.length >= 2);
    assert.equal(state.phase, 'FINAL');

    const stopped = replayEvents(baseRun, [
      ...events.slice(0, 8),
      { type: 'mutation', mutation: null },
    ]);
    assert.ok(stopped.errors.length > 0);
    assert.notEqual(stopped.phase, 'FINAL');
  });
});
