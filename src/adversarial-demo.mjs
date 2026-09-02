import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { sha256Canonical } from './canonical.mjs';
import { replayEvents, snapshotState, PROTOCOL_VERSION } from './protocol.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadAdversarialFixtures(baseDir = root) {
  const scenario = JSON.parse(readFileSync(join(baseDir, 'fixtures/scenario.json'), 'utf8'));
  const events = JSON.parse(
    readFileSync(join(baseDir, 'fixtures/adversarial-events.json'), 'utf8'),
  );
  const expected = JSON.parse(
    readFileSync(join(baseDir, 'fixtures/adversarial-expected.json'), 'utf8'),
  );
  return { scenario, events, expected };
}

function rejectionsMatch(snapshot, expected) {
  if (snapshot.rejection_count !== expected.rejection_count) return false;
  if (snapshot.rejections.length !== expected.rejections.length) return false;
  return snapshot.rejections.every(
    (item, index) =>
      item.code === expected.rejections[index].code &&
      item.operation === expected.rejections[index].operation &&
      item.message === expected.rejections[index].message,
  );
}

export function buildAdversarialReceipt(scenario, snapshot, expected) {
  const expectedMatch = {
    phase: snapshot.phase === expected.phase,
    final: snapshot.final === expected.final,
    freeze_id: snapshot.current_freeze_id === expected.freeze_id,
    freeze_binding: snapshot.freeze_binding === expected.freeze_binding,
    rejection_count: snapshot.rejection_count === expected.rejection_count,
    rejections: rejectionsMatch(snapshot, expected),
  };

  const body = {
    protocol_version: PROTOCOL_VERSION,
    fixture_id: expected.fixture_id,
    run_id: scenario.run.id,
    phase: snapshot.phase,
    final: snapshot.final,
    current_freeze_id: snapshot.current_freeze_id,
    freeze_binding: snapshot.freeze_binding,
    rejection_count: snapshot.rejection_count,
    rejections: snapshot.rejections,
    errors: snapshot.errors,
    expected_match: expectedMatch,
  };

  const receipt_hash = sha256Canonical(body);
  return { ...body, receipt_hash };
}

export function runAdversarialDemo(baseDir = root) {
  const { scenario, events, expected } = loadAdversarialFixtures(baseDir);
  const state = replayEvents(scenario.run, events);
  const snapshot = snapshotState(state);
  const output = buildAdversarialReceipt(scenario, snapshot, expected);
  const allMatch = Object.values(output.expected_match).every(Boolean);
  return { state, output, expected, allMatch };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { output, allMatch } = runAdversarialDemo();
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.errors.length > 0 || !allMatch) {
    process.exit(1);
  }
}
