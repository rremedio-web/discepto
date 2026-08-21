import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReplay } from '../src/replay.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('replay determinism', () => {
  it('emits deterministic JSON to stdout', () => {
    const first = spawnSync('node', [join(root, 'src/replay.mjs')], { encoding: 'utf8' });
    const second = spawnSync('node', [join(root, 'src/replay.mjs')], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);
  });

  it('validates freeze/correction linkage against expected binding', () => {
    const { state, output, expected } = runReplay();
    assert.equal(state.errors.length, 0);
    assert.equal(output.phase, 'FINAL');
    assert.equal(output.final, true);
    assert.equal(output.correction_count, 1);
    assert.equal(output.rejection_count, 0);
    assert.equal(output.current_freeze_id, 'freeze-002');

    const freeze = state.freezes.find((item) => item.id === 'freeze-002');
    assert.equal(freeze.binding, expected.freeze_binding);
    assert.equal(output.freeze_binding, expected.freeze_binding);
  });

  it('hard-coded phase expectations independent of expected.json drift', () => {
    const { state } = runReplay();
    assert.equal(state.phase, 'FINAL');
    assert.equal(state.writerId, 'agent-alpha');
    assert.equal(state.challengerId, 'agent-beta');
    assert.equal(state.coordinatorId, 'coordinator-neutral');
    assert.equal(state.correctionCount, 1);
    assert.equal(state.reviews.length, 2);
    assert.equal(state.reviews[0].verdict, 'CHANGES_NEEDED');
    assert.equal(state.reviews[1].verdict, 'PASS');
    assert.equal(state.reviews[0].reviewer_id, 'agent-beta');
    assert.equal(state.reviews[1].reviewer_id, 'agent-beta');
  });
});
