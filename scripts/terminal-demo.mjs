import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'bin/discepto.mjs');
const scenarioPath = join(root, 'fixtures/scenario.json');
const allEvents = JSON.parse(readFileSync(join(root, 'fixtures/adversarial-events.json'), 'utf8'));

const throughMeasurement = allEvents.slice(0, 5);
const selfIssuedLease = allEvents[5];
const coordinatorLease = allEvents[6];
const writerMutation = allEvents[8];
const freeze = allEvents[9];
const challengerPass = allEvents[12];

function replay(events) {
  const dir = mkdtempSync(join(tmpdir(), 'discepto-demo-'));
  const eventsPath = join(dir, 'events.json');
  writeFileSync(eventsPath, `${JSON.stringify(events)}\n`);
  const result = spawnSync(
    'node',
    [cli, 'replay', '--scenario', scenarioPath, '--events', eventsPath, '--pretty'],
    { encoding: 'utf8', cwd: root },
  );
  rmSync(dir, { recursive: true, force: true });
  if (result.error) throw result.error;
  return result;
}

function section(title, detail, events) {
  const result = replay(events);
  process.stdout.write(`\n# ${title}\n`);
  process.stdout.write(`# ${detail}\n`);
  process.stdout.write(result.stdout);
  if (result.stderr) process.stdout.write(result.stderr);
  process.stdout.write(`# exit ${result.status}\n`);
}

process.stdout.write(`# Discepto terminal demo — protocol v4 adversarial fixture
# Synthetic event replay. No agents, models, or repository writes.
# Reproduce: node scripts/terminal-demo.mjs
`);

section(
  '1. Self-issued writer lease is rejected; phase stays MEASURE',
  'prefix: diagnoses, disputes, measurement, writer-issued lease',
  [...throughMeasurement, selfIssuedLease],
);

section(
  '2. Coordinator lease is accepted; phase advances to IMPLEMENT',
  'same prefix, then coordinator-issued lease; prior rejection stays recorded',
  [...throughMeasurement, selfIssuedLease, coordinatorLease],
);

section(
  '3. Valid freeze and challenger PASS',
  'measurement, coordinator lease, writer mutation, freeze, challenger review',
  [...throughMeasurement, coordinatorLease, writerMutation, freeze, challengerPass],
);

section(
  '4. Full adversarial fixture — deterministic receipt',
  'node bin/discepto.mjs replay --scenario fixtures/scenario.json --events fixtures/adversarial-events.json --pretty',
  allEvents,
);
