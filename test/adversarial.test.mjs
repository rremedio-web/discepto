import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveFreezeBinding,
  canonicalMeasurementHash,
  replayEvents,
  snapshotState,
} from '../src/protocol.mjs';
import {
  loadAdversarialFixtures,
  runAdversarialDemo,
} from '../src/adversarial-demo.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function replayWithoutRejections(scenario, events) {
  const filtered = events.filter((event) => {
    if (event.type === 'lease' && event.lease.issuer_id !== scenario.run.coordinator_id) {
      return false;
    }
    if (event.type === 'mutation' && event.mutation.agent_id === 'agent-beta') {
      return false;
    }
    if (event.type === 'review' && event.review.reviewer_id === 'agent-alpha') {
      return false;
    }
    return true;
  });
  return replayEvents(scenario.run, filtered);
}

describe('adversarial trace', () => {
  it('replays fixture to FINAL with exact ordered rejections', () => {
    const { scenario, events, expected } = loadAdversarialFixtures();
    const state = replayEvents(scenario.run, events);
    const snapshot = snapshotState(state);

    assert.equal(state.errors.length, 0);
    assert.equal(snapshot.phase, 'FINAL');
    assert.equal(snapshot.final, true);
    assert.equal(snapshot.current_freeze_id, expected.freeze_id);
    assert.equal(snapshot.freeze_binding, expected.freeze_binding);
    assert.equal(snapshot.rejection_count, expected.rejection_count);
    assert.deepEqual(snapshot.rejections, expected.rejections);
  });

  it('rejected attempts do not alter final freeze binding', () => {
    const { scenario, events, expected } = loadAdversarialFixtures();
    const withRejections = replayEvents(scenario.run, events);
    const withoutRejections = replayWithoutRejections(scenario, events);

    assert.equal(withRejections.errors.length, 0);
    assert.equal(withoutRejections.errors.length, 0);
    assert.equal(withRejections.phase, 'FINAL');
    assert.equal(withoutRejections.phase, 'FINAL');

    const snapWith = snapshotState(withRejections);
    const snapWithout = snapshotState(withoutRejections);
    assert.equal(snapWith.freeze_binding, expected.freeze_binding);
    assert.equal(snapWithout.freeze_binding, expected.freeze_binding);
    assert.equal(snapWith.freeze_binding, snapWithout.freeze_binding);
    assert.equal(snapWith.current_freeze_id, snapWithout.current_freeze_id);
  });

  it('binding matches canonical digest for scenario measurement and mutation', () => {
    const { scenario, events, expected } = loadAdversarialFixtures();
    const measurement = events.find((event) => event.type === 'measurement').measurement;
    const freeze = events.find((event) => event.type === 'freeze').freeze;
    const measurementHash = canonicalMeasurementHash(measurement);
    const binding = deriveFreezeBinding(
      scenario.run,
      freeze,
      ['playwright/fixture.html'],
      measurementHash,
    );
    assert.equal(binding, expected.freeze_binding);
  });

  it('demo emits deterministic JSON receipt to stdout', () => {
    const first = spawnSync('node', [join(root, 'src/adversarial-demo.mjs')], { encoding: 'utf8' });
    const second = spawnSync('node', [join(root, 'src/adversarial-demo.mjs')], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);

    const receipt = JSON.parse(first.stdout);
    assert.equal(receipt.protocol_version, 'discepto-protocol-2');
    assert.equal(receipt.fixture_id, 'adversarial-neutral-001');
    assert.equal(receipt.run_id, 'run-neutral-001');
    assert.equal(receipt.phase, 'FINAL');
    assert.equal(receipt.final, true);
    assert.equal(receipt.current_freeze_id, 'freeze-001');
    assert.equal(receipt.rejection_count, 4);
    assert.deepEqual(receipt.errors, []);
    assert.deepEqual(receipt.expected_match, {
      phase: true,
      final: true,
      freeze_id: true,
      freeze_binding: true,
      rejection_count: true,
      rejections: true,
    });
    assert.match(receipt.receipt_hash, /^[0-9a-f]{64}$/);
  });

  it('runAdversarialDemo matches spawned demo output', () => {
    const spawned = spawnSync('node', [join(root, 'src/adversarial-demo.mjs')], { encoding: 'utf8' });
    const { output } = runAdversarialDemo();
    assert.equal(spawned.stdout, `${JSON.stringify(output, null, 2)}\n`);
  });
});
