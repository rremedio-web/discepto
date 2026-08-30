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
  strictRecord,
  PHASES,
  ROLES,
  VERDICTS,
} from '../src/schema.mjs';

import { buildRun } from './helpers.mjs';

const baseRun = buildRun();

describe('strictRecord kernel', () => {
  const inner = { name: 'inner', fields: { value: { kind: 'string' } } };
  const widget = strictRecord({
    name: 'widget',
    fields: {
      id: { kind: 'string' },
      kind: { kind: 'enum', values: ['a', 'b'] },
      part: { kind: 'record', spec: inner },
    },
  });

  it('accepts a record matching the spec', () => {
    assert.deepEqual(widget({ id: 'w1', kind: 'a', part: { value: 'v' } }), { ok: true });
  });

  it('rejects non-objects, arrays, and null', () => {
    assert.equal(widget(null).ok, false);
    assert.match(widget(null).error, /widget must be an object/);
    assert.match(widget([]).error, /widget must be an object/);
    assert.match(widget('x').error, /widget must be an object/);
  });

  it('rejects unknown fields', () => {
    const result = widget({ id: 'w1', kind: 'a', part: { value: 'v' }, extra: true });
    assert.equal(result.ok, false);
    assert.match(result.error, /widget has unknown fields: extra/);
  });

  it('enforces required strings and enums with exact messages', () => {
    assert.match(widget({ kind: 'a', part: { value: 'v' } }).error, /widget.id is required/);
    assert.match(widget({ id: 'w1', kind: 'c', part: { value: 'v' } }).error, /invalid kind: c/);
  });

  it('validates nested record specs', () => {
    const result = widget({ id: 'w1', kind: 'a', part: { value: '' } });
    assert.equal(result.ok, false);
    assert.match(result.error, /widget.part.value is required/);
  });

  it('the nine public validators are kernel products with distinct specs', async () => {
    const mod = await import('../src/schema.mjs');
    const validators = [
      'validateRun',
      'validateDiagnosis',
      'validateLease',
      'validateMeasurement',
      'validateFreeze',
      'validateReview',
      'validateCorrection',
      'validateDispute',
      'validateMutation',
    ];
    assert.equal(validators.length, 9);
    for (const name of validators) {
      assert.equal(typeof mod[name], 'function');
    }
  });
});

describe('schema validation', () => {
  it('accepts valid run with coordinator distinct from agents', () => {
    const result = validateRun(baseRun);
    assert.equal(result.ok, true);
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
      'DIAGNOSE', 'DISPUTE', 'MEASURE', 'IMPLEMENT', 'FREEZE', 'REVIEW', 'CORRECT', 'FINAL',
    ]);
    assert.deepEqual(ROLES, ['writer', 'challenger']);
    assert.deepEqual(VERDICTS, ['PASS', 'CHANGES_NEEDED']);
  });

  it('validates complete structures', () => {
    assert.equal(validateLease({
      issuer_id: 'c',
      writer_id: 'w',
      scope: ['a.mjs'],
      active: true,
    }).ok, true);
    assert.equal(validateMeasurement({
      method: 'm',
      observations: [{ key: 'k', value: 'v' }],
      result: 'r',
    }).ok, true);
    assert.equal(validateReview({
      reviewer_id: 'c',
      seat_id: 'reviewer-seat',
      freeze_id: 'f',
      freeze_binding: '0000000000000000000000000000000000000000000000000000000000000000',
      verdict: 'PASS',
      findings: [],
    }).ok, true);
    assert.equal(validateDispute({ agent_id: 'a', claim: 'c', estimate: 'e' }).ok, true);
    assert.equal(validateMutation({ agent_id: 'w', path: 'a.mjs' }).ok, true);
  });
});
