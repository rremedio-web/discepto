import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
  validateEvent,
  validateEvents,
  validateScenario,
  PHASES,
  ROLES,
  VERDICTS,
  EVENT_TYPES,
} from '../src/schema.mjs';

const baseRun = {
  id: 'run-test',
  worktree_id: 'wt-test',
  coordinator_id: 'coordinator-test',
  agents: [
    { id: 'writer-1', role: 'writer', seat_id: 'writer-seat' },
    { id: 'challenger-1', role: 'challenger', seat_id: 'challenger-seat' },
  ],
  phase: 'DIAGNOSE',
};

describe('schema validation', () => {
  it('accepts valid run with coordinator distinct from agents', () => {
    const result = validateRun(baseRun);
    assert.equal(result.ok, true);
    assert.equal(result.writerId, 'writer-1');
    assert.equal(result.challengerId, 'challenger-1');
    assert.equal(result.coordinatorId, 'coordinator-test');
  });

  it('rejects run without coordinator_id', () => {
    const { coordinator_id: _, ...noCoordinator } = baseRun;
    const result = validateRun(noCoordinator);
    assert.equal(result.ok, false);
    assert.match(result.error, /coordinator_id is required/);
  });

  it('rejects coordinator_id equal to an agent id', () => {
    const result = validateRun({ ...baseRun, coordinator_id: 'writer-1' });
    assert.equal(result.ok, false);
    assert.match(result.error, /distinct from agent ids/);
  });

  it('rejects duplicate agent seat ids', () => {
    const result = validateRun({
      ...baseRun,
      agents: [
        { id: 'writer-1', role: 'writer', seat_id: 'same-seat' },
        { id: 'challenger-1', role: 'challenger', seat_id: 'same-seat' },
      ],
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /seat ids must be unique/);
  });

  it('rejects run with wrong agent count', () => {
    const result = validateRun({ ...baseRun, agents: [baseRun.agents[0]] });
    assert.equal(result.ok, false);
    assert.match(result.error, /exactly two agents/);
  });

  it('rejects duplicate agent ids', () => {
    const result = validateRun({
      ...baseRun,
      agents: [
        { id: 'same', role: 'writer', seat_id: 'writer-seat' },
        { id: 'same', role: 'challenger', seat_id: 'challenger-seat' },
      ],
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /unique/);
  });

  it('rejects two writers', () => {
    const result = validateRun({
      ...baseRun,
      agents: [
        { id: 'a', role: 'writer', seat_id: 'a-seat' },
        { id: 'b', role: 'writer', seat_id: 'b-seat' },
      ],
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /exactly one writer/);
  });

  it('rejects unknown phase enum', () => {
    const result = validateRun({ ...baseRun, phase: 'UNKNOWN' });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid phase/);
  });

  it('rejects fresh run not starting at DIAGNOSE', () => {
    const result = validateRun({ ...baseRun, phase: 'IMPLEMENT' });
    assert.equal(result.ok, false);
    assert.match(result.error, /must start at DIAGNOSE/);
  });

  it('rejects diagnosis without read_only true', () => {
    const result = validateDiagnosis({
      agent_id: 'writer-1',
      read_only: false,
      findings: ['x'],
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /read_only must be true/);
  });

  it('rejects lease without issuer_id', () => {
    const result = validateLease({
      writer_id: 'w',
      scope: ['a.mjs'],
      active: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /issuer_id is required/);
  });

  it('rejects lease with duplicate scope paths', () => {
    const result = validateLease({
      issuer_id: 'c',
      writer_id: 'w',
      scope: ['a.mjs', 'a.mjs'],
      active: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /unique paths/);
  });

  it('rejects unknown fields on freeze request', () => {
    const result = validateFreeze({
      id: 'f1',
      base_id: 'b1',
      candidate_id: 'c1',
      changed_paths: [],
      extra: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /unknown fields/);
  });

  it('accepts freeze request with only id, base_id, candidate_id', () => {
    const result = validateFreeze({
      id: 'f1',
      base_id: 'b1',
      candidate_id: 'c1',
    });
    assert.equal(result.ok, true);
  });

  it('rejects correction count other than 1', () => {
    const result = validateCorrection({
      supersedes: 'f1',
      red_ref: 'r1',
      green_ref: 'g1',
      count: 2,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /count must be exactly 1/);
  });

  it('rejects null mutation', () => {
    const result = validateMutation(null);
    assert.equal(result.ok, false);
    assert.match(result.error, /mutation must be an object/);
  });

  it('rejects array mutation', () => {
    const result = validateMutation(['agent_id', 'path']);
    assert.equal(result.ok, false);
    assert.match(result.error, /mutation must be an object/);
  });

  it('rejects mutation with unknown fields', () => {
    const result = validateMutation({ agent_id: 'w', path: 'a.mjs', extra: true });
    assert.equal(result.ok, false);
    assert.match(result.error, /unknown fields/);
  });

  it('rejects mutation with empty agent_id', () => {
    const result = validateMutation({ agent_id: '', path: 'a.mjs' });
    assert.equal(result.ok, false);
    assert.match(result.error, /agent_id is required/);
  });

  it('rejects review without reviewer_id', () => {
    const result = validateReview({
      freeze_id: 'f',
      freeze_binding: 'abc',
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /reviewer_id is required/);
  });

  it('rejects review without seat_id', () => {
    const result = validateReview({
      reviewer_id: 'c',
      freeze_id: 'f',
      freeze_binding: '0000000000000000000000000000000000000000000000000000000000000000',
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /review.seat_id is required/);
  });

  it('rejects review without freeze_binding', () => {
    const result = validateReview({
      reviewer_id: 'c',
      seat_id: 'reviewer-seat',
      freeze_id: 'f',
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /freeze_binding is required/);
  });

  it('rejects review with malformed freeze_binding', () => {
    const result = validateReview({
      reviewer_id: 'c',
      seat_id: 'reviewer-seat',
      freeze_id: 'f',
      freeze_binding: 'abc',
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /lowercase 64-character hex digest/);
  });

  it('rejects review with uppercase freeze_binding', () => {
    const result = validateReview({
      reviewer_id: 'c',
      seat_id: 'reviewer-seat',
      freeze_id: 'f',
      freeze_binding: 'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789',
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /lowercase 64-character hex digest/);
  });

  it('rejects review with wrong-length freeze_binding', () => {
    const result = validateReview({
      reviewer_id: 'c',
      seat_id: 'reviewer-seat',
      freeze_id: 'f',
      freeze_binding: '000000000000000000000000000000000000000000000000000000000000000',
      verdict: 'PASS',
      findings: [],
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /lowercase 64-character hex digest/);
  });

  it('accepts a measurement with a file artifact identity', () => {
    const result = validateMeasurement({
      method: 'm',
      observations: [{ key: 'k', value: 'v' }],
      result: 'r',
      artifact_identity: { kind: 'file' },
    });
    assert.equal(result.ok, true);
  });

  it('rejects a measurement with an unsupported artifact identity kind', () => {
    const result = validateMeasurement({
      method: 'm',
      observations: [{ key: 'k', value: 'v' }],
      result: 'r',
      artifact_identity: { kind: 'local' },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /artifact_identity.kind must be one of/);
  });

  it('rejects a served artifact identity with a non-http URL', () => {
    const result = validateMeasurement({
      method: 'm',
      observations: [{ key: 'k', value: 'v' }],
      result: 'r',
      artifact_identity: { kind: 'staging', url: 'file:///tmp/fixture.html' },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /artifact_identity.url must use http or https/);
  });

  it('exports frozen phase and role enums', () => {
    assert.deepEqual(PHASES, [
      'DIAGNOSE',
      'DISPUTE',
      'MEASURE',
      'IMPLEMENT',
      'FREEZE',
      'REVIEW',
      'CORRECT',
      'FINAL',
    ]);
    assert.deepEqual(ROLES, ['writer', 'challenger']);
    assert.deepEqual(VERDICTS, ['PASS', 'CHANGES_NEEDED']);
    assert.deepEqual(EVENT_TYPES, [
      'diagnosis',
      'dispute',
      'measurement',
      'lease',
      'mutation',
      'freeze',
      'review',
      'correction',
    ]);
  });

  it('validates complete structures', () => {
    assert.equal(
      validateLease({
        issuer_id: 'c',
        writer_id: 'w',
        scope: ['a.mjs'],
        active: true,
      }).ok,
      true,
    );
    assert.equal(
      validateMeasurement({
        method: 'm',
        observations: [{ key: 'k', value: 'v' }],
        result: 'r',
      }).ok,
      true,
    );
    assert.equal(
      validateReview({
        reviewer_id: 'c',
        seat_id: 'reviewer-seat',
        freeze_id: 'f',
        freeze_binding: '0000000000000000000000000000000000000000000000000000000000000000',
        verdict: 'PASS',
        findings: [],
      }).ok,
      true,
    );
    assert.equal(validateDispute({ agent_id: 'a', claim: 'c', estimate: 'e' }).ok, true);
    assert.equal(validateMutation({ agent_id: 'w', path: 'a.mjs' }).ok, true);
  });

  it('validateScenario requires a valid run', () => {
    assert.equal(validateScenario({ run: baseRun }).ok, true);
    assert.equal(validateScenario(null).ok, false);
    assert.equal(validateScenario({}).ok, false);
  });

  it('validateEvent and validateEvents reject unknown types and extra fields', () => {
    const diagnosis = {
      type: 'diagnosis',
      diagnosis: { agent_id: 'writer-1', read_only: true, findings: ['a'] },
    };
    assert.equal(validateEvent(diagnosis).ok, true);
    assert.equal(validateEvent({ type: 'sabotage', sabotage: {} }).ok, false);
    assert.equal(validateEvent({ type: 'diagnosis' }).ok, false);
    assert.equal(validateEvent({ ...diagnosis, extra: true }).ok, false);
    assert.equal(validateEvents([diagnosis]).ok, true);
    assert.equal(validateEvents({ type: 'diagnosis' }).ok, false);
    assert.match(validateEvents([diagnosis, { type: 'nope' }]).error, /events\[1\]/);
  });
});
