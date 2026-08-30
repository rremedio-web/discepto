import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
    const { snapshot, output, expected } = runReplay();
    assert.deepEqual(snapshot.errors, []);
    assert.equal(output.phase, 'FINAL');
    assert.equal(output.final, true);
    assert.equal(output.correction_count, 1);
    assert.equal(output.rejection_count, 0);
    assert.equal(output.current_freeze_id, 'freeze-002');

    assert.equal(snapshot.current_freeze_id, expected.freeze_id);
    assert.equal(output.freeze_binding, expected.freeze_binding);
    assert.equal(snapshot.freeze_binding, expected.freeze_binding);
  });

  it('hard-coded phase expectations independent of expected.json drift', () => {
    const { snapshot } = runReplay();
    assert.equal(snapshot.phase, 'FINAL');
    assert.equal(snapshot.final, true);
    assert.equal(snapshot.writer_id, 'agent-alpha');
    assert.equal(snapshot.challenger_id, 'agent-beta');
    assert.equal(snapshot.correction_count, 1);
    assert.equal(snapshot.review_count, 2);
    assert.equal(snapshot.current_freeze_id, 'freeze-002');
  });
});
