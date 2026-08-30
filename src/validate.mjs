import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateRun } from './schema.mjs';
import { replayEvents, snapshotState } from './protocol.mjs';
import { loadFixtures } from './replay.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let errors = 0;

function report(message) {
  console.error(message);
  errors += 1;
}

const { scenario, events, expected } = loadFixtures();

const runResult = validateRun(scenario.run);
if (!runResult.ok) report(`invalid run: ${runResult.error}`);

const state = replayEvents(scenario.run, events);
const snapshot = snapshotState(state);

if (snapshot.errors.length > 0) {
  report(`replay errors: ${snapshot.errors.join('; ')}`);
}

if (snapshot.phase !== expected.phase) {
  report(`phase mismatch: expected ${expected.phase}, got ${snapshot.phase}`);
}

if (snapshot.final !== expected.final) {
  report(`final mismatch: expected ${expected.final}, got ${snapshot.final}`);
}

const freeze = state.freezes.find((item) => item.id === expected.freeze_id);
if (!freeze) {
  report('expected freeze not found');
} else if (freeze.binding !== expected.freeze_binding) {
  report('freeze binding mismatch');
}

if (errors > 0) {
  process.exit(1);
}

console.log('validate: ok');
