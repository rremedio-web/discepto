import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './classifier.mjs';
import { scoreClassifier } from './scorer.mjs';
import { validateScenario, validateKeys } from './schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)));

let errors = 0;

function report(message) {
  console.error(message);
  errors += 1;
}

function loadJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

function validateScenarioSet(scenarios, label) {
  if (!Array.isArray(scenarios)) {
    report(`${label}: scenarios must be an array`);
    return new Set();
  }
  const ids = new Set();
  for (const scenario of scenarios) {
    const result = validateScenario(scenario);
    if (!result.ok) {
      report(`${label}: invalid scenario ${scenario?.id ?? '?'}: ${result.error}`);
      continue;
    }
    if (ids.has(scenario.id)) {
      report(`${label}: duplicate id ${scenario.id}`);
    }
    ids.add(scenario.id);
  }
  return ids;
}

function validateKeyAlignment(scenarioIds, keys, label) {
  const keyResult = validateKeys(keys);
  if (!keyResult.ok) report(`${label}: invalid keys: ${keyResult.error}`);

  const keyIds = new Set(Object.keys(keys));
  if (scenarioIds.size !== keyIds.size) {
    report(`${label}: scenario/key count mismatch`);
  }
  for (const id of scenarioIds) {
    if (!keyIds.has(id)) report(`${label}: missing key for ${id}`);
  }
  for (const id of keyIds) {
    if (!scenarioIds.has(id)) report(`${label}: orphan key ${id}`);
  }
}

function validateClassifierGate(scenarios, keys, label) {
  const score = scoreClassifier(scenarios, keys);
  if (score.exact !== score.total) {
    report(`${label}: classifier gate failed ${score.exact}/${score.total}`);
  }
  for (const scenario of scenarios) {
    const expected = keys[scenario.id];
    if (!expected) continue;
    const actual = classify(scenario);
    if (
      actual.classification !== expected.classification ||
      actual.disposition !== expected.disposition ||
      actual.owner_decision !== expected.owner_decision
    ) {
      report(`${label}: mismatch for ${scenario.id}`);
    }
  }
}

const ruleExamples = loadJson('fixtures/rule-examples.json');
const ruleExampleKeys = loadJson('fixtures/rule-example-keys.json');
const conformanceScenarios = loadJson('fixtures/conformance-scenarios.json');
const conformanceKeys = loadJson('fixtures/conformance-keys.json');

const ruleIds = validateScenarioSet(ruleExamples, 'rule-examples');
const conformanceIds = validateScenarioSet(conformanceScenarios, 'conformance');

validateKeyAlignment(ruleIds, ruleExampleKeys, 'rule-examples');
validateKeyAlignment(conformanceIds, conformanceKeys, 'conformance');

validateClassifierGate(ruleExamples, ruleExampleKeys, 'rule-examples');
validateClassifierGate(conformanceScenarios, conformanceKeys, 'conformance');

if (errors > 0) {
  process.exit(1);
}

console.log('validate:watcher: ok');
