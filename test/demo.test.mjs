import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('demo side effects', () => {
  it('writes deterministic JSON to stdout only', () => {
    const first = spawnSync('node', [join(root, 'src/demo.mjs')], { encoding: 'utf8' });
    const second = spawnSync('node', [join(root, 'src/demo.mjs')], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);
    const payload = JSON.parse(first.stdout);
    assert.equal(payload.phase, 'FINAL');
    assert.equal(payload.final, true);
    assert.deepEqual(payload.errors, []);
  });

  it('matches replay output byte-for-byte', () => {
    const demo = spawnSync('node', [join(root, 'src/demo.mjs')], { encoding: 'utf8' });
    const replay = spawnSync('node', [join(root, 'src/replay.mjs')], { encoding: 'utf8' });
    assert.equal(demo.stdout, replay.stdout);
  });
});
