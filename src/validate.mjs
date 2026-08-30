import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
} from './schema.mjs';
import { replayEvents } from './protocol.mjs';
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

for (const event of events) {
  switch (event.type) {
    case 'diagnosis':
      if (!validateDiagnosis(event.diagnosis).ok) report('invalid diagnosis in events');
      break;
    case 'dispute':
      if (!validateDispute(event.dispute).ok) report('invalid dispute in events');
      break;
    case 'measurement':
      if (!validateMeasurement(event.measurement).ok) report('invalid measurement in events');
      break;
    case 'lease':
      if (!validateLease(event.lease).ok) report('invalid lease in events');
      break;
    case 'mutation':
      if (!validateMutation(event.mutation).ok) report('invalid mutation in events');
      break;
    case 'freeze':
      if (!validateFreeze(event.freeze).ok) report('invalid freeze in events');
      break;
    case 'review':
      if (!validateReview(event.review).ok) report('invalid review in events');
      break;
    case 'correction':
      if (!validateCorrection(event.correction).ok) report('invalid correction in events');
      break;
    default:
      break;
  }
}

const { snapshot } = replayEvents(scenario.run, events);

if (snapshot.errors.length > 0) {
  report(`replay errors: ${snapshot.errors.join('; ')}`);
}

if (snapshot.phase !== expected.phase) {
  report(`phase mismatch: expected ${expected.phase}, got ${snapshot.phase}`);
}

if (snapshot.final !== expected.final) {
  report(`final mismatch: expected ${expected.final}, got ${snapshot.final}`);
}

if (snapshot.current_freeze_id !== expected.freeze_id) {
  report('expected freeze not found');
} else if (snapshot.freeze_binding !== expected.freeze_binding) {
  report('freeze binding mismatch');
}

if (errors > 0) {
  process.exit(1);
}

console.log('validate: ok');
