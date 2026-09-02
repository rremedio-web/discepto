import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confusionMatrix, perClassSupport, scoreBaseline, scoreClassifier } from './scorer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)));

function loadJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

const ruleExamples = loadJson('fixtures/rule-examples.json');
const ruleExampleKeys = loadJson('fixtures/rule-example-keys.json');
const conformanceScenarios = loadJson('fixtures/conformance-scenarios.json');
const conformanceKeys = loadJson('fixtures/conformance-keys.json');

const ruleScore = scoreClassifier(ruleExamples, ruleExampleKeys);
const conformanceScore = scoreClassifier(conformanceScenarios, conformanceKeys);
const baselineRules = scoreBaseline(ruleExamples, ruleExampleKeys);
const baselineConformance = scoreBaseline(conformanceScenarios, conformanceKeys);

const output = {
  rule_examples: {
    exact: ruleScore.exact,
    total: ruleScore.total,
    accuracy: ruleScore.accuracy,
  },
  conformance: {
    exact: conformanceScore.exact,
    total: conformanceScore.total,
    accuracy: conformanceScore.accuracy,
  },
  confusion_matrix: {
    rule_examples: confusionMatrix(ruleExamples, ruleExampleKeys),
    conformance: confusionMatrix(conformanceScenarios, conformanceKeys),
  },
  per_class_support: {
    rule_examples: perClassSupport(ruleExampleKeys),
    conformance: perClassSupport(conformanceKeys),
  },
  baseline_unknown_observe_no: {
    rule_examples: baselineRules,
    conformance: baselineConformance,
  },
};

process.stdout.write(`${JSON.stringify(output)}\n`);
