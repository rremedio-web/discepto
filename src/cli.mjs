import { readFileSync } from 'node:fs';
import { sha256Canonical } from './canonical.mjs';
import { replayEvents, PROTOCOL_VERSION } from './protocol.mjs';
import { validateScenario, validateEvents } from './schema.mjs';

export const USAGE =
  'Usage: node bin/discepto.mjs replay --scenario <file> --events <file> [--expected <file>] [--pretty]';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false;
}

function valuesEqual(actual, expected) {
  return sha256Canonical(actual) === sha256Canonical(expected);
}

export function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { ok: true, help: true };
  }

  if (argv.length === 0) {
    return { ok: false, error: USAGE };
  }

  const [command, ...rest] = argv;
  if (command !== 'replay') {
    return { ok: false, error: `unknown command: ${command}` };
  }

  const options = {
    scenario: null,
    events: null,
    expected: null,
    pretty: false,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--pretty') {
      options.pretty = true;
      continue;
    }
    if (arg === '--scenario' || arg === '--events' || arg === '--expected') {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return { ok: false, error: `${arg} requires a path` };
      }
      options[arg.slice(2)] = value;
      i += 1;
      continue;
    }
    return { ok: false, error: `unknown argument: ${arg}` };
  }

  if (!options.scenario) return { ok: false, error: '--scenario is required' };
  if (!options.events) return { ok: false, error: '--events is required' };
  return { ok: true, help: false, options };
}

function readJsonFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err && err.message ? err.message : 'read failed';
    throw new Error(`cannot read ${path}: ${reason}`, { cause: err });
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    const reason = err && err.message ? err.message : 'invalid JSON';
    throw new Error(`invalid JSON in ${path}: ${reason}`, { cause: err });
  }
}

function compareExpected(snapshot, expected) {
  if (!isPlainObject(expected)) {
    throw new Error('expected result must be an object');
  }

  const match = {};
  if ('phase' in expected) match.phase = snapshot.phase === expected.phase;
  if ('final' in expected) match.final = snapshot.final === expected.final;
  if ('freeze_id' in expected) match.freeze_id = snapshot.current_freeze_id === expected.freeze_id;
  if ('freeze_binding' in expected)
    match.freeze_binding = snapshot.freeze_binding === expected.freeze_binding;
  if ('correction_count' in expected)
    match.correction_count = snapshot.correction_count === expected.correction_count;
  if ('rejection_count' in expected)
    match.rejection_count = snapshot.rejection_count === expected.rejection_count;
  if ('rejections' in expected)
    match.rejections = valuesEqual(snapshot.rejections, expected.rejections);
  if ('errors' in expected) match.errors = valuesEqual(snapshot.errors, expected.errors);
  return match;
}

export function replayFromFiles({ scenarioPath, eventsPath, expectedPath }) {
  const scenario = readJsonFile(scenarioPath);
  const scenarioResult = validateScenario(scenario);
  if (!scenarioResult.ok) {
    throw new Error(`invalid scenario: ${scenarioResult.error}`);
  }

  const events = readJsonFile(eventsPath);
  const eventsResult = validateEvents(events);
  if (!eventsResult.ok) {
    throw new Error(`invalid events: ${eventsResult.error}`);
  }

  const { snapshot } = replayEvents(scenario.run, events);
  const body = {
    protocol_version: PROTOCOL_VERSION,
    run_id: scenario.run.id,
    phase: snapshot.phase,
    final: snapshot.final,
    current_freeze_id: snapshot.current_freeze_id,
    freeze_binding: snapshot.freeze_binding,
    correction_count: snapshot.correction_count,
    rejection_count: snapshot.rejection_count,
    rejections: snapshot.rejections,
    errors: snapshot.errors,
  };

  let expectedMatch = null;
  if (expectedPath) {
    expectedMatch = compareExpected(snapshot, readJsonFile(expectedPath));
    body.expected_match = expectedMatch;
  }

  const receipt_hash = sha256Canonical(body);
  const output = { ...body, receipt_hash };
  const expectedFailed =
    expectedMatch !== null && Object.values(expectedMatch).some((value) => value === false);
  const fatal = snapshot.errors.length > 0;
  return { output, fatal, expectedFailed };
}

function stringifyOutput(output, pretty) {
  return pretty ? `${JSON.stringify(output, null, 2)}\n` : `${JSON.stringify(output)}\n`;
}

export function runCli(argv, io = process) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    io.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (!parsed.ok) {
    io.stderr.write(`${parsed.error}\n`);
    return 1;
  }

  try {
    const { output, fatal, expectedFailed } = replayFromFiles({
      scenarioPath: parsed.options.scenario,
      eventsPath: parsed.options.events,
      expectedPath: parsed.options.expected,
    });
    io.stdout.write(stringifyOutput(output, parsed.options.pretty));
    if (fatal || expectedFailed) return 1;
    return 0;
  } catch (err) {
    const message = err && err.message ? err.message : 'replay failed';
    io.stderr.write(`${message}\n`);
    return 1;
  }
}
