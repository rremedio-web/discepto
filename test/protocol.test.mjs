import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveFreezeBinding,
  canonicalMeasurementHash,
  AUTHORITY_REJECTIONS,
  EVENTS,
  PROTOCOL_VERSION,
  replayEvents,
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

function ev(type, payload) {
  return { type, [type]: payload };
}

const diagnosisEv = (agentId, extra = {}) => ev('diagnosis', {
  agent_id: agentId,
  read_only: true,
  findings: ['a'],
  ...extra,
});
const disputeEv = (agentId) => ev('dispute', { agent_id: agentId, claim: 'c1', estimate: 'e1' });
const measurementEv = (m = measurement) => ev('measurement', m);
const leaseEv = (issuerId, { writerId = 'writer-1', scope = ['src/a.mjs'], active = true } = {}) =>
  ev('lease', { issuer_id: issuerId, writer_id: writerId, scope, active });
const coordinatorLease = (opts) => leaseEv('coordinator-1', opts);
const writerLease = (opts) => leaseEv('writer-1', opts);
const mutationEv = (agentId, path = 'src/a.mjs') => ev('mutation', { agent_id: agentId, path });
const freezeEv = (id, baseId = 'base', candidateId = 'candidate') =>
  ev('freeze', { id, base_id: baseId, candidate_id: candidateId });
const correctionEv = (supersedes) =>
  ev('correction', { supersedes, red_ref: 'r', green_ref: 'g', count: 1 });

function bindingFor(freezeId, changedPaths = ['src/a.mjs'], m = measurement, baseId = 'base', candidateId = 'candidate') {
  return deriveFreezeBinding(
    baseRun,
    { id: freezeId, base_id: baseId, candidate_id: candidateId },
    changedPaths,
    canonicalMeasurementHash(m),
  );
}

function reviewEv({
  reviewerId = 'challenger-1',
  seatId = 'challenger-seat',
  freezeId = 'freeze-a',
  binding,
  verdict = 'PASS',
} = {}) {
  return ev('review', {
    reviewer_id: reviewerId,
    seat_id: seatId,
    freeze_id: freezeId,
    freeze_binding: binding ?? bindingFor(freezeId),
    verdict,
    findings: [],
  });
}

const bothDiagnoses = [diagnosisEv('writer-1'), diagnosisEv('challenger-1')];
const bothDisputes = [disputeEv('writer-1'), disputeEv('challenger-1')];
const throughDispute = [...bothDiagnoses, ...bothDisputes];
const throughMeasurement = [...throughDispute, measurementEv()];
const throughFirstLease = [...throughMeasurement, coordinatorLease()];
const oneMutation = [...throughFirstLease, mutationEv('writer-1')];
const oneFreeze = [...oneMutation, freezeEv('freeze-a')];

function assertAccepted(result) {
  assert.deepEqual(result.outcomes.at(-1), { status: 'accepted' });
}

function assertRejected(result, code, variant = 'default') {
  const rule = AUTHORITY_REJECTIONS[code];
  assert.deepEqual(result.outcomes.at(-1), {
    status: 'rejected',
    code,
    operation: rule.operation,
    message: rule.messages[variant],
  });
}

function assertFatal(result, pattern) {
  const outcome = result.outcomes.at(-1);
  assert.equal(outcome.status, 'fatal');
  assert.match(outcome.message, pattern);
}

describe('protocol authority and phase invariants', () => {
  it('rejects review when the declared reviewer seat matches the writer seat', () => {
    const result = replayEvents(baseRun, [...oneFreeze, reviewEv({ seatId: 'writer-seat' })]);
    assertRejected(result, 'REVIEW_SAME_SEAT');
    assert.equal(result.snapshot.phase, 'REVIEW');
  });

  it('rejects review when the declared reviewer seat is not the challenger seat', () => {
    const result = replayEvents(baseRun, [...oneFreeze, reviewEv({ seatId: 'bogus-seat' })]);
    assertRejected(result, 'REVIEW_SEAT_MISMATCH');
    assert.equal(result.snapshot.phase, 'REVIEW');
  });

  it('advances DIAGNOSE to DISPUTE after both read-only diagnoses', () => {
    const result = replayEvents(baseRun, bothDiagnoses);
    assertAccepted(result);
    assert.equal(result.snapshot.phase, 'DISPUTE');
    assert.equal(result.snapshot.diagnosis_count, 2);
  });

  it('rejects diagnosis when read_only is not true', () => {
    const result = replayEvents(baseRun, [
      ev('diagnosis', { agent_id: 'writer-1', read_only: false, findings: ['x'] }),
    ]);
    assertFatal(result, /read_only must be true/);
  });

  it('dispute cannot advance without discriminating measurement', () => {
    const result = replayEvents(baseRun, throughDispute);
    assert.equal(result.snapshot.phase, 'DISPUTE');
    assert.equal(result.snapshot.has_measurement, false);
  });

  it('measurement from DISPUTE advances only to observable MEASURE', () => {
    const result = replayEvents(baseRun, throughMeasurement);
    assert.equal(result.snapshot.phase, 'MEASURE');
    assert.equal(result.snapshot.has_measurement, true);
  });

  it('duplicate measurement in MEASURE is fatal', () => {
    const result = replayEvents(baseRun, [...throughMeasurement, measurementEv()]);
    assertFatal(result, /duplicate measurement rejected/);
  });

  it('inactive first lease stays in MEASURE', () => {
    const result = replayEvents(baseRun, [...throughMeasurement, coordinatorLease({ active: false })]);
    assertRejected(result, 'LEASE_INITIAL_INACTIVE');
    assert.equal(result.snapshot.phase, 'MEASURE');
    assert.equal(result.snapshot.lease_active, false);
    assert.deepEqual(result.snapshot.errors, []);
  });

  it('first coordinator lease in MEASURE advances to IMPLEMENT', () => {
    const result = replayEvents(baseRun, throughFirstLease);
    assertAccepted(result);
    assert.equal(result.snapshot.phase, 'IMPLEMENT');
    assert.equal(result.snapshot.lease_active, true);
  });

  it('rejects writer self-issued first lease', () => {
    const result = replayEvents(baseRun, [...throughMeasurement, writerLease()]);
    assertRejected(result, 'LEASE_ISSUER_MISMATCH', 'first');
    assert.equal(result.snapshot.phase, 'MEASURE');
  });

  it('rejects mutation without active lease as nonfatal rejection', () => {
    const result = replayEvents(baseRun, [
      ...throughFirstLease,
      coordinatorLease({ active: false }),
      mutationEv('writer-1'),
    ]);
    assertRejected(result, 'MUTATION_NO_ACTIVE_LEASE');
    assert.deepEqual(result.snapshot.errors, []);
  });

  it('rejects challenger mutation as nonfatal rejection', () => {
    const result = replayEvents(baseRun, [...throughFirstLease, mutationEv('challenger-1')]);
    assertRejected(result, 'MUTATION_CHALLENGER');
    assert.deepEqual(result.snapshot.errors, []);
  });

  it('rejects mutation outside lease scope as nonfatal rejection', () => {
    const result = replayEvents(baseRun, [...throughFirstLease, mutationEv('writer-1', 'other.mjs')]);
    assertRejected(result, 'MUTATION_OUTSIDE_SCOPE');
    assert.deepEqual(result.snapshot.errors, []);
  });

  it('coordinator can narrow lease scope', () => {
    const result = replayEvents(baseRun, [
      ...throughMeasurement,
      coordinatorLease({ scope: ['src/a.mjs', 'src/b.mjs'] }),
      coordinatorLease({ scope: ['src/a.mjs'] }),
      mutationEv('writer-1', 'src/a.mjs'),
      mutationEv('writer-1', 'src/b.mjs'),
    ]);
    assertAccepted(replayEvents(baseRun, [
      ...throughMeasurement,
      coordinatorLease({ scope: ['src/a.mjs', 'src/b.mjs'] }),
      coordinatorLease({ scope: ['src/a.mjs'] }),
      mutationEv('writer-1', 'src/a.mjs'),
    ]));
    assertRejected(result, 'MUTATION_OUTSIDE_SCOPE');
  });

  it('coordinator equal-scope lease update is accepted', () => {
    const result = replayEvents(baseRun, [...throughFirstLease, coordinatorLease()]);
    assertAccepted(result);
  });

  it('writer cannot widen lease scope', () => {
    const result = replayEvents(baseRun, [
      ...throughFirstLease,
      writerLease({ scope: ['src/a.mjs', 'src/b.mjs'] }),
      mutationEv('writer-1', 'src/b.mjs'),
    ]);
    assert.equal(result.outcomes.at(-2).status, 'rejected');
    assert.match(result.outcomes.at(-2).message, /coordinator-issued/);
    assertRejected(result, 'MUTATION_OUTSIDE_SCOPE');
  });

  it('coordinator widening lease is rejected without changing prior lease', () => {
    const result = replayEvents(baseRun, [
      ...throughFirstLease,
      coordinatorLease({ scope: ['src/a.mjs', 'src/b.mjs'] }),
      mutationEv('writer-1', 'src/b.mjs'),
    ]);
    assert.equal(result.outcomes.at(-2).status, 'rejected');
    assert.match(result.outcomes.at(-2).message, /widening rejected/);
    assertRejected(result, 'MUTATION_OUTSIDE_SCOPE');
  });

  it('coordinator can revoke lease with inactive equal scope', () => {
    const result = replayEvents(baseRun, [
      ...throughFirstLease,
      coordinatorLease({ active: false }),
      mutationEv('writer-1'),
    ]);
    assertRejected(result, 'MUTATION_NO_ACTIVE_LEASE');
  });

  it('coordinator can reactivate equal scope after revoke', () => {
    const result = replayEvents(baseRun, [
      ...throughFirstLease,
      coordinatorLease({ active: false }),
      coordinatorLease({ active: true }),
      mutationEv('writer-1'),
    ]);
    assertAccepted(result);
  });

  it('inactive revoke cannot widen scope', () => {
    const result = replayEvents(baseRun, [
      ...throughFirstLease,
      coordinatorLease({ scope: ['src/a.mjs', 'src/b.mjs'], active: false }),
    ]);
    assertRejected(result, 'LEASE_SCOPE_WIDENING');
  });

  it('freeze requires measured evidence and scoped mutation', () => {
    const result = replayEvents(baseRun, [...throughFirstLease, freezeEv('f1')]);
    assertFatal(result, /at least one scoped mutation/);
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
    const freeze = { id: 'freeze-x', base_id: 'base-x', candidate_id: 'cand-x' };
    const binding = deriveFreezeBinding(baseRun, freeze, ['b.mjs', 'a.mjs'], mHash);
    assert.match(binding, /^[0-9a-f]{64}$/);
    assert.equal(binding, deriveFreezeBinding(baseRun, freeze, ['a.mjs', 'b.mjs'], mHash));
    assert.notEqual(binding, deriveFreezeBinding({ ...baseRun, coordinator_id: 'other-coordinator' }, freeze, ['a.mjs', 'b.mjs'], mHash));
    assert.notEqual(binding, deriveFreezeBinding(baseRun, { id: 'other', base_id: 'base-x', candidate_id: 'cand-x' }, ['a.mjs', 'b.mjs'], mHash));
    assert.notEqual(binding, deriveFreezeBinding(baseRun, freeze, ['a.mjs'], mHash));
    assert.notEqual(binding, deriveFreezeBinding(baseRun, freeze, ['a.mjs', 'b.mjs'], 'other-hash'));
  });

  it('binding changes when mutation path or measurement changes', () => {
    const freeze = freezeEv('freeze-same', 'base-same', 'candidate-same');

    const bindingA = replayEvents(baseRun, [
      ...throughFirstLease,
      mutationEv('writer-1', 'src/a.mjs'),
      freeze,
    ]).snapshot.freeze_binding;

    const bindingB = replayEvents(baseRun, [
      ...throughMeasurement,
      coordinatorLease({ scope: ['src/b.mjs'] }),
      mutationEv('writer-1', 'src/b.mjs'),
      freeze,
    ]).snapshot.freeze_binding;

    const bindingC = replayEvents(baseRun, [
      ...throughDispute,
      measurementEv({ ...measurement, result: 'different' }),
      coordinatorLease(),
      mutationEv('writer-1', 'src/a.mjs'),
      freeze,
    ]).snapshot.freeze_binding;

    assert.notEqual(bindingA, bindingB);
    assert.notEqual(bindingA, bindingC);
  });

  it('accepted trace binding ignores rejected authority attempts', () => {
    const buildEvents = (withRejections) => [
      ...throughMeasurement,
      ...(withRejections
        ? [writerLease(), coordinatorLease({ scope: ['src/a.mjs', 'src/b.mjs'] })]
        : []),
      coordinatorLease(),
      mutationEv('writer-1'),
      freezeEv('freeze-bind'),
    ];
    const withRejectionsResult = replayEvents(baseRun, buildEvents(true));
    const withoutRejectionsResult = replayEvents(baseRun, buildEvents(false));
    assert.ok(withRejectionsResult.snapshot.rejection_count >= 1);
    assert.equal(
      withoutRejectionsResult.snapshot.freeze_binding,
      withRejectionsResult.snapshot.freeze_binding,
    );
  });

  it('review wrong freeze id is nonfatal rejection', () => {
    const result = replayEvents(baseRun, [...oneFreeze, reviewEv({ freezeId: 'wrong-freeze' })]);
    assertRejected(result, 'REVIEW_FREEZE_MISMATCH');
    assert.deepEqual(result.snapshot.errors, []);
  });

  it('stale review rejection after freeze supersession', () => {
    const result = replayEvents(baseRun, [
      ...oneFreeze,
      reviewEv({ verdict: 'CHANGES_NEEDED' }),
      correctionEv('freeze-a'),
      coordinatorLease(),
      mutationEv('writer-1'),
      freezeEv('freeze-b', 'base', 'candidate-2'),
      reviewEv({ freezeId: 'freeze-a', binding: bindingFor('freeze-b', ['src/a.mjs']) }),
    ]);
    assertRejected(result, 'REVIEW_FREEZE_MISMATCH');
    assert.deepEqual(result.snapshot.errors, []);
  });

  it('challenger mutation rejection then valid path reaches FINAL', () => {
    const result = replayEvents(baseRun, [
      ...throughFirstLease,
      mutationEv('challenger-1'),
      mutationEv('writer-1'),
      freezeEv('freeze-a'),
      reviewEv({ verdict: 'PASS' }),
    ]);
    assert.equal(result.snapshot.rejection_count, 1);
    assert.equal(result.snapshot.phase, 'FINAL');
    assert.equal(result.snapshot.final, true);
  });

  it('CHANGES_NEEDED leads to CORRECT then requires new freeze', () => {
    const result = replayEvents(baseRun, [
      ...oneFreeze,
      reviewEv({ verdict: 'CHANGES_NEEDED' }),
    ]);
    assert.equal(result.snapshot.phase, 'CORRECT');
    assert.equal(result.snapshot.current_freeze_id, 'freeze-a');
  });

  it('rejects direct freeze from CORRECT without applyCorrection', () => {
    const result = replayEvents(baseRun, [
      ...oneFreeze,
      reviewEv({ verdict: 'CHANGES_NEEDED' }),
      freezeEv('freeze-b', 'base', 'candidate-2'),
    ]);
    assertFatal(result, /freeze not allowed in current phase/);
    assert.equal(result.snapshot.current_freeze_id, 'freeze-a');
  });

  it('second correction fails closed', () => {
    const result = replayEvents(baseRun, [
      ...oneFreeze,
      reviewEv({ verdict: 'CHANGES_NEEDED' }),
      correctionEv('freeze-a'),
      correctionEv('freeze-a'),
    ]);
    assertFatal(result, /second correction rejected/);
  });

  it('FINAL only after challenger PASS on current binding', () => {
    const result = replayEvents(baseRun, [...oneFreeze, reviewEv({ verdict: 'PASS' })]);
    assertAccepted(result);
    assert.equal(result.snapshot.phase, 'FINAL');
    assert.equal(result.snapshot.final, true);
  });

  it('failed review requires new freeze path via correction', () => {
    const result = replayEvents(baseRun, [
      ...oneFreeze,
      reviewEv({ verdict: 'CHANGES_NEEDED' }),
      correctionEv('freeze-a'),
      coordinatorLease(),
      mutationEv('writer-1'),
      freezeEv('freeze-b', 'base', 'candidate-2'),
      reviewEv({
        freezeId: 'freeze-b',
        binding: bindingFor('freeze-b', ['src/a.mjs'], measurement, 'base', 'candidate-2'),
        verdict: 'PASS',
      }),
    ]);
    assert.equal(result.snapshot.phase, 'FINAL');
  });

  it('snapshot exposes rejection_count and rejections', () => {
    const result = replayEvents(baseRun, [...throughFirstLease, mutationEv('challenger-1')]);
    assert.equal(result.snapshot.rejection_count, 1);
    assert.equal(result.snapshot.rejections.length, 1);
    assert.match(result.snapshot.rejections[0].message, /challenger/);
  });
});

describe('stable structured nonfatal rejections', () => {
  it('maps lease issuer mismatch on first lease', () => {
    const result = replayEvents(baseRun, [...throughMeasurement, writerLease()]);
    assertRejected(result, 'LEASE_ISSUER_MISMATCH', 'first');
  });

  it('maps lease issuer mismatch on subsequent lease', () => {
    const result = replayEvents(baseRun, [...throughFirstLease, writerLease()]);
    assertRejected(result, 'LEASE_ISSUER_MISMATCH');
  });

  it('maps lease writer mismatch on first lease', () => {
    const result = replayEvents(baseRun, [
      ...throughMeasurement,
      leaseEv('coordinator-1', { writerId: 'challenger-1' }),
    ]);
    assertRejected(result, 'LEASE_WRITER_MISMATCH');
  });

  it('maps lease initial inactive', () => {
    const result = replayEvents(baseRun, [...throughMeasurement, coordinatorLease({ active: false })]);
    assertRejected(result, 'LEASE_INITIAL_INACTIVE');
  });

  it('maps lease scope widening', () => {
    const result = replayEvents(baseRun, [
      ...throughFirstLease,
      coordinatorLease({ scope: ['src/a.mjs', 'src/b.mjs'] }),
    ]);
    assertRejected(result, 'LEASE_SCOPE_WIDENING');
  });

  it('maps mutation challenger', () => {
    const result = replayEvents(baseRun, [...throughFirstLease, mutationEv('challenger-1')]);
    assertRejected(result, 'MUTATION_CHALLENGER');
  });

  it('maps mutation without active lease', () => {
    const result = replayEvents(baseRun, [
      ...throughFirstLease,
      coordinatorLease({ active: false }),
      mutationEv('writer-1'),
    ]);
    assertRejected(result, 'MUTATION_NO_ACTIVE_LEASE');
  });

  it('maps mutation outside scope', () => {
    const result = replayEvents(baseRun, [...throughFirstLease, mutationEv('writer-1', 'other.mjs')]);
    assertRejected(result, 'MUTATION_OUTSIDE_SCOPE');
  });

  it('maps review reviewer mismatch', () => {
    const result = replayEvents(baseRun, [
      ...oneFreeze,
      reviewEv({ reviewerId: 'writer-1', seatId: 'writer-seat' }),
    ]);
    assertRejected(result, 'REVIEW_REVIEWER_MISMATCH');
  });

  it('maps review binding mismatch', () => {
    const result = replayEvents(baseRun, [
      ...oneFreeze,
      reviewEv({ binding: '0000000000000000000000000000000000000000000000000000000000000000' }),
    ]);
    assertRejected(result, 'REVIEW_BINDING_MISMATCH');
  });

  it('maps review freeze mismatch', () => {
    const result = replayEvents(baseRun, [...oneFreeze, reviewEv({ freezeId: 'wrong-freeze' })]);
    assertRejected(result, 'REVIEW_FREEZE_MISMATCH');
  });

  it('snapshot returns structured rejection records', () => {
    const result = replayEvents(baseRun, [...throughFirstLease, mutationEv('challenger-1')]);
    assert.deepEqual(result.snapshot.rejections, [
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
      () => replayEvents({ ...baseRun, phase: 'IMPLEMENT' }, []),
      /must start at DIAGNOSE/,
    );
  });

  it('rejects null mutation without throw', () => {
    const result = replayEvents(baseRun, [...throughFirstLease, ev('mutation', null)]);
    assertFatal(result, /mutation must be an object/);
  });

  it('rejects unknown mutation fields without throw', () => {
    const result = replayEvents(baseRun, [
      ...throughFirstLease,
      ev('mutation', { agent_id: 'writer-1', path: 'src/a.mjs', forged: true }),
    ]);
    assertFatal(result, /unknown fields/);
  });

  it('rejects fabricated changed_paths on freeze request', () => {
    const result = replayEvents(baseRun, [
      ...oneMutation,
      ev('freeze', { id: 'f1', base_id: 'b', candidate_id: 'c', changed_paths: ['forged.mjs'] }),
    ]);
    assertFatal(result, /unknown fields/);
  });

  it('derives changed_paths from recorded mutations not request', () => {
    const result = replayEvents(baseRun, [...oneMutation, freezeEv('f1')]);
    assert.equal(result.snapshot.freeze_binding, bindingFor('f1'));
  });

  it('rejects globally duplicate freeze id', () => {
    const result = replayEvents(baseRun, [
      ...oneFreeze,
      reviewEv({ verdict: 'CHANGES_NEEDED' }),
      correctionEv('freeze-a'),
      coordinatorLease(),
      mutationEv('writer-1'),
      freezeEv('freeze-a', 'base', 'candidate-2'),
    ]);
    assertFatal(result, /duplicate freeze id/);
  });

  it('rejects review with old binding hash ambiguity as nonfatal rejection', () => {
    const staleBinding = replayEvents(baseRun, [...oneFreeze]).snapshot.freeze_binding;
    const result = replayEvents(baseRun, [
      ...oneFreeze,
      reviewEv({ verdict: 'CHANGES_NEEDED' }),
      correctionEv('freeze-a'),
      coordinatorLease(),
      mutationEv('writer-1'),
      freezeEv('freeze-b', 'base', 'candidate-2'),
      reviewEv({ freezeId: 'freeze-b', binding: staleBinding }),
    ]);
    assertRejected(result, 'REVIEW_BINDING_MISMATCH');
    assert.deepEqual(result.snapshot.errors, []);
  });

  it('rejects unattributed review without reviewer_id as fatal schema error', () => {
    const result = replayEvents(baseRun, [
      ...oneFreeze,
      ev('review', {
        freeze_id: 'freeze-a',
        seat_id: 'challenger-seat',
        freeze_binding: bindingFor('freeze-a'),
        verdict: 'PASS',
        findings: [],
      }),
    ]);
    assertFatal(result, /reviewer_id is required/);
  });

  it('rejects writer-authored review as nonfatal rejection', () => {
    const result = replayEvents(baseRun, [
      ...oneFreeze,
      reviewEv({ reviewerId: 'writer-1', seatId: 'writer-seat' }),
    ]);
    assertRejected(result, 'REVIEW_REVIEWER_MISMATCH');
    assert.deepEqual(result.snapshot.errors, []);
  });

  it('rejects review with wrong binding as nonfatal rejection', () => {
    const result = replayEvents(baseRun, [
      ...oneFreeze,
      reviewEv({ binding: '0000000000000000000000000000000000000000000000000000000000000000' }),
    ]);
    assertRejected(result, 'REVIEW_BINDING_MISMATCH');
    assert.deepEqual(result.snapshot.errors, []);
  });

  it('exports protocol version constant discepto-protocol-3', () => {
    assert.equal(PROTOCOL_VERSION, 'discepto-protocol-3');
  });
});

describe('replay outcome values', () => {
  it('event catalogue drives dispatch as data', () => {
    assert.deepEqual(Object.keys(EVENTS), [
      'diagnosis',
      'dispute',
      'measurement',
      'lease',
      'mutation',
      'freeze',
      'review',
      'correction',
    ]);
    for (const [type, entry] of Object.entries(EVENTS)) {
      assert.equal(typeof entry.validate, 'function', `${type} validator missing`);
      assert.equal(typeof entry.apply, 'function', `${type} apply missing`);
    }
  });

  it('event payload schema violations surface as fatal outcomes with schema messages', () => {
    const result = replayEvents(baseRun, [
      ...throughFirstLease,
      ev('mutation', { agent_id: 'writer-1', path: 'src/a.mjs', forged: true }),
    ]);
    assert.deepEqual(result.outcomes.at(-1), {
      status: 'fatal',
      message: 'mutation has unknown fields: forged',
    });
  });

  it('clean trace yields accepted outcome for every event', () => {
    const result = replayEvents(baseRun, throughMeasurement);
    assert.deepEqual(result.outcomes, [
      { status: 'accepted' },
      { status: 'accepted' },
      { status: 'accepted' },
      { status: 'accepted' },
      { status: 'accepted' },
    ]);
  });

  it('rejected outcome carries the catalogue rejection record', () => {
    const result = replayEvents(baseRun, [...throughFirstLease, mutationEv('challenger-1')]);
    const outcome = result.outcomes.at(-1);
    assert.equal(outcome.status, 'rejected');
    const { status, ...rejection } = outcome;
    assert.deepEqual(rejection, result.snapshot.rejections.at(-1));
    assert.deepEqual(rejection, {
      code: 'MUTATION_CHALLENGER',
      operation: 'mutation',
      message: 'challenger mutation rejected',
    });
  });

  it('replay continues after rejected outcomes and stops after the first fatal one', () => {
    const result = replayEvents(baseRun, [
      ...throughFirstLease,
      mutationEv('challenger-1'),
      mutationEv('writer-1'),
      ev('mutation', null),
      mutationEv('writer-1'),
    ]);
    assert.equal(result.outcomes.length, 9);
    assert.equal(result.outcomes[6].status, 'rejected');
    assert.equal(result.outcomes[7].status, 'accepted');
    assert.equal(result.outcomes[8].status, 'fatal');
    assert.match(result.outcomes[8].message, /mutation must be an object/);
  });

  it('unknown event type is fatal', () => {
    const result = replayEvents(baseRun, [ev('bogus', {})]);
    assertFatal(result, /unknown event type: bogus/);
  });

  it('replayEvents returns only snapshot and outcomes, never the state struct', () => {
    const result = replayEvents(baseRun, throughFirstLease);
    assert.deepEqual(Object.keys(result).sort(), ['outcomes', 'snapshot']);
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
    const { loadFixtureSet } = await import('../src/receipt.mjs');
    const { scenario, events } = loadFixtureSet('events.json', 'expected.json');
    const { snapshot } = replayEvents(scenario.run, events);
    assert.deepEqual(snapshot.errors, []);
    assert.equal(snapshot.phase, 'FINAL');
    assert.equal(snapshot.final, true);
  });

  it('replay stops immediately on invalid first event before later diagnosis', () => {
    const result = replayEvents(baseRun, [
      null,
      diagnosisEv('writer-1'),
    ]);
    assert.equal(result.outcomes.length, 1);
    assert.equal(result.outcomes[0].status, 'fatal');
    assert.match(result.outcomes[0].message, /event requires type/);
    assert.equal(result.snapshot.errors.length, 1);
    assert.equal(result.snapshot.diagnosis_count, 0);
    assert.equal(result.snapshot.phase, 'DIAGNOSE');
  });

  it('replay continues after rejections and stops only on fatal errors', () => {
    const events = [
      ...bothDiagnoses,
      ...bothDisputes,
      measurementEv(),
      writerLease(),
      coordinatorLease(),
      mutationEv('challenger-1'),
      mutationEv('writer-1'),
      freezeEv('freeze-a'),
      reviewEv({ verdict: 'PASS' }),
    ];
    const result = replayEvents(baseRun, events);
    assert.deepEqual(result.snapshot.errors, []);
    assert.ok(result.snapshot.rejection_count >= 2);
    assert.equal(result.snapshot.phase, 'FINAL');

    const stopped = replayEvents(baseRun, [
      ...events.slice(0, 8),
      ev('mutation', null),
    ]);
    assert.ok(stopped.snapshot.errors.length > 0);
    assert.notEqual(stopped.snapshot.phase, 'FINAL');
  });
});
