import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { replayEvents } from './protocol.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadFixtures(baseDir = root) {
  const scenario = JSON.parse(readFileSync(join(baseDir, 'fixtures/scenario.json'), 'utf8'));
  const events = JSON.parse(readFileSync(join(baseDir, 'fixtures/events.json'), 'utf8'));
  const expected = JSON.parse(readFileSync(join(baseDir, 'fixtures/expected.json'), 'utf8'));
  return { scenario, events, expected };
}

export function runReplay(baseDir = root) {
  const { scenario, events, expected } = loadFixtures(baseDir);
  const { snapshot } = replayEvents(scenario.run, events);

  const output = {
    run_id: scenario.run.id,
    phase: snapshot.phase,
    final: snapshot.final,
    current_freeze_id: snapshot.current_freeze_id,
    freeze_binding: snapshot.freeze_binding,
    correction_count: snapshot.correction_count,
    rejection_count: snapshot.rejection_count,
    rejections: snapshot.rejections,
    errors: snapshot.errors,
    expected_match: {
      phase: snapshot.phase === expected.phase,
      final: snapshot.final === expected.final,
      freeze_binding: snapshot.freeze_binding === expected.freeze_binding,
    },
  };

  return { snapshot, output, expected };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { output } = runReplay();
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.errors.length > 0) process.exit(1);
}
