import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION } from '../src/index.mjs';
import { parseArgs, USAGE } from '../src/cli.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'bin/discepto.mjs');

function runCli(args) {
  return spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd: root });
}

describe('public API', () => {
  it('exports the protocol replay surface', async () => {
    const api = await import('../src/index.mjs');
    assert.deepEqual(Object.keys(api).sort(), [
      'PROTOCOL_VERSION',
      'canonicalMeasurementHash',
      'deriveFreezeBinding',
      'replayEvents',
    ]);
    assert.equal(api.PROTOCOL_VERSION, PROTOCOL_VERSION);
  });
});

describe('CLI argument parsing', () => {
  it('requires replay, scenario, and events', () => {
    assert.equal(parseArgs(['--help']).help, true);
    assert.match(parseArgs([]).error, /Usage/);
    assert.match(parseArgs(['replay']).error, /--scenario is required/);
    assert.match(parseArgs(['replay', '--scenario', 'a.json']).error, /--events is required/);
    assert.match(
      parseArgs(['replay', '--scenario', '--events', 'e.json']).error,
      /requires a path/,
    );
    assert.match(parseArgs(['wat']).error, /unknown command/);
    assert.match(
      parseArgs(['replay', '--scenario', 'a.json', '--events', 'e.json', '--nope']).error,
      /unknown argument/,
    );
  });
});

describe('discepto replay CLI', () => {
  it('replays examples to FINAL with compact JSON on stdout', () => {
    const result = runCli([
      'replay',
      '--scenario',
      'examples/scenario.json',
      '--events',
      'examples/events.json',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.endsWith('\n'), true);
    assert.doesNotMatch(result.stdout, /\n {2}/);
    const output = JSON.parse(result.stdout);
    assert.equal(output.protocol_version, PROTOCOL_VERSION);
    assert.equal(output.phase, 'FINAL');
    assert.equal(output.final, true);
    assert.equal(output.correction_count, 1);
    assert.equal(output.rejection_count, 0);
    assert.deepEqual(output.errors, []);
    assert.match(output.receipt_hash, /^[0-9a-f]{64}$/);
  });

  it('pretty-prints when --pretty is set', () => {
    const compact = runCli([
      'replay',
      '--scenario',
      'examples/scenario.json',
      '--events',
      'examples/events.json',
    ]);
    const pretty = runCli([
      'replay',
      '--scenario',
      'examples/scenario.json',
      '--events',
      'examples/events.json',
      '--pretty',
    ]);
    assert.equal(pretty.status, 0, pretty.stderr);
    const parsedCompact = JSON.parse(compact.stdout);
    const parsedPretty = JSON.parse(pretty.stdout);
    assert.deepEqual(parsedPretty, parsedCompact);
    assert.equal(pretty.stdout, `${JSON.stringify(parsedPretty, null, 2)}\n`);
  });

  it('compares --expected and exits 0 on match', () => {
    const result = runCli([
      'replay',
      '--scenario',
      'fixtures/scenario.json',
      '--events',
      'fixtures/events.json',
      '--expected',
      'fixtures/expected.json',
    ]);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.expected_match, {
      phase: true,
      final: true,
      freeze_id: true,
      freeze_binding: true,
    });
  });

  it('exits 0 when nonfatal rejections are recorded', () => {
    const result = runCli([
      'replay',
      '--scenario',
      'fixtures/scenario.json',
      '--events',
      'fixtures/adversarial-events.json',
    ]);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.phase, 'FINAL');
    assert.equal(output.rejection_count, 4);
    assert.deepEqual(output.errors, []);
  });

  it('writes usage to stdout for --help', () => {
    const result = runCli(['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${USAGE}\n`);
  });

  it('writes missing-file errors to stderr and leaves stdout empty', () => {
    const result = runCli([
      'replay',
      '--scenario',
      'examples/missing-scenario.json',
      '--events',
      'examples/events.json',
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /cannot read/);
  });

  it('rejects invalid JSON on stderr', () => {
    const dir = mkdtempSync(join(tmpdir(), 'discepto-cli-json-'));
    try {
      const bad = join(dir, 'bad.json');
      writeFileSync(bad, '{');
      const result = runCli(['replay', '--scenario', bad, '--events', 'examples/events.json']);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /invalid JSON/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid scenario schema on stderr', () => {
    const dir = mkdtempSync(join(tmpdir(), 'discepto-cli-schema-'));
    try {
      const scenario = join(dir, 'scenario.json');
      writeFileSync(scenario, JSON.stringify({ run: { id: 'x' } }));
      const result = runCli(['replay', '--scenario', scenario, '--events', 'examples/events.json']);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /invalid scenario/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid events before replay', () => {
    const dir = mkdtempSync(join(tmpdir(), 'discepto-cli-events-'));
    try {
      const events = join(dir, 'events.json');
      writeFileSync(events, JSON.stringify([{ type: 'sabotage', sabotage: {} }]));
      const result = runCli(['replay', '--scenario', 'examples/scenario.json', '--events', events]);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /invalid events/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits JSON and exits 1 on fatal protocol errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'discepto-cli-fatal-'));
    try {
      const events = join(dir, 'events.json');
      writeFileSync(
        events,
        JSON.stringify([
          {
            type: 'measurement',
            measurement: {
              method: 'm',
              observations: [{ key: 'k', value: 'v' }],
              result: 'r',
            },
          },
        ]),
      );
      const result = runCli(['replay', '--scenario', 'examples/scenario.json', '--events', events]);
      assert.equal(result.status, 1);
      assert.equal(result.stderr, '');
      const output = JSON.parse(result.stdout);
      assert.ok(output.errors.length > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 when --expected does not match', () => {
    const dir = mkdtempSync(join(tmpdir(), 'discepto-cli-expected-'));
    try {
      const expected = join(dir, 'expected.json');
      const base = JSON.parse(readFileSync(join(root, 'fixtures/expected.json'), 'utf8'));
      writeFileSync(expected, JSON.stringify({ ...base, phase: 'REVIEW' }));
      const result = runCli([
        'replay',
        '--scenario',
        'fixtures/scenario.json',
        '--events',
        'fixtures/events.json',
        '--expected',
        expected,
      ]);
      assert.equal(result.status, 1);
      const output = JSON.parse(result.stdout);
      assert.equal(output.expected_match.phase, false);
      assert.equal(output.expected_match.final, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
