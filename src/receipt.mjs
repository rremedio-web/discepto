import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { replayEvents, PROTOCOL_VERSION } from './protocol.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The one definition of a sealed receipt: hash over the exact JSON body and
 * append the digest. Every receipt (adversarial, watcher) is sealed here.
 */
export function sealReceipt(body) {
  const receipt_hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { ...body, receipt_hash };
}

/**
 * The one fixture loader: every replay (neutral, adversarial) is the same
 * scenario run with a different events/expected pair.
 */
export function loadFixtureSet(eventsFile, expectedFile, baseDir = root) {
  const scenario = JSON.parse(readFileSync(join(baseDir, 'fixtures/scenario.json'), 'utf8'));
  const events = JSON.parse(readFileSync(join(baseDir, `fixtures/${eventsFile}`), 'utf8'));
  const expected = JSON.parse(readFileSync(join(baseDir, `fixtures/${expectedFile}`), 'utf8'));
  return { scenario, events, expected };
}

function rejectionsMatch(snapshot, expected) {
  if (snapshot.rejection_count !== expected.rejection_count) return false;
  if (snapshot.rejections.length !== expected.rejections.length) return false;
  return snapshot.rejections.every(
    (item, index) =>
      item.code === expected.rejections[index].code
      && item.operation === expected.rejections[index].operation
      && item.message === expected.rejections[index].message,
  );
}

/**
 * The one runner: replay a fixture triple and compare the snapshot against
 * the expected file. Both fixture demos layer their receipts on this output.
 */
export function runFixture(set) {
  const { snapshot, outcomes } = replayEvents(set.scenario.run, set.events);
  const { expected } = set;
  const match = {
    phase: snapshot.phase === expected.phase,
    final: snapshot.final === expected.final,
    freeze_id: snapshot.current_freeze_id === expected.freeze_id,
    freeze_binding: snapshot.freeze_binding === expected.freeze_binding,
    rejection_count: snapshot.rejection_count === expected.rejection_count,
    rejections: rejectionsMatch(snapshot, expected),
  };
  return { snapshot, outcomes, expected, match };
}

export function runReplay(baseDir = root) {
  const set = loadFixtureSet('events.json', 'expected.json', baseDir);
  const { snapshot, expected, match } = runFixture(set);

  const output = {
    run_id: set.scenario.run.id,
    phase: snapshot.phase,
    final: snapshot.final,
    current_freeze_id: snapshot.current_freeze_id,
    freeze_binding: snapshot.freeze_binding,
    correction_count: snapshot.correction_count,
    rejection_count: snapshot.rejection_count,
    rejections: snapshot.rejections,
    errors: snapshot.errors,
    expected_match: {
      phase: match.phase,
      final: match.final,
      freeze_binding: match.freeze_binding,
    },
  };

  return { snapshot, output, expected, match };
}

export function runAdversarialDemo(baseDir = root) {
  const set = loadFixtureSet('adversarial-events.json', 'adversarial-expected.json', baseDir);
  const { snapshot, expected, match } = runFixture(set);

  const body = {
    protocol_version: PROTOCOL_VERSION,
    fixture_id: expected.fixture_id,
    run_id: set.scenario.run.id,
    phase: snapshot.phase,
    final: snapshot.final,
    current_freeze_id: snapshot.current_freeze_id,
    freeze_binding: snapshot.freeze_binding,
    rejection_count: snapshot.rejection_count,
    rejections: snapshot.rejections,
    errors: snapshot.errors,
    expected_match: {
      phase: match.phase,
      final: match.final,
      freeze_id: match.freeze_id,
      freeze_binding: match.freeze_binding,
      rejection_count: match.rejection_count,
      rejections: match.rejections,
    },
  };

  const output = sealReceipt(body);
  const allMatch = Object.values(output.expected_match).every(Boolean);
  return { snapshot, output, expected, allMatch };
}
