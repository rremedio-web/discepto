import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  confusionMatrix,
  perClassSupport,
  scoreBaseline,
  scoreClassifier,
} from './scorer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)));

function loadJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

const trainScenarios = loadJson('fixtures/train-scenarios.json');
const trainKeys = loadJson('fixtures/train-keys.json');
const heldScenarios = loadJson('fixtures/held-out-scenarios.json');
const heldKeys = loadJson('fixtures/held-out-keys.json');

const trainScore = scoreClassifier(trainScenarios, trainKeys);
const heldScore = scoreClassifier(heldScenarios, heldKeys);
const baselineTrain = scoreBaseline(trainScenarios, trainKeys);
const baselineHeld = scoreBaseline(heldScenarios, heldKeys);

const output = {
  train: {
    exact: trainScore.exact,
    total: trainScore.total,
    accuracy: trainScore.accuracy,
  },
  held_out: {
    exact: heldScore.exact,
    total: heldScore.total,
    accuracy: heldScore.accuracy,
  },
  confusion_matrix: {
    train: confusionMatrix(trainScenarios, trainKeys),
    held_out: confusionMatrix(heldScenarios, heldKeys),
  },
  per_class_support: {
    train: perClassSupport(trainKeys),
    held_out: perClassSupport(heldKeys),
  },
  baseline_unknown_observe_no: {
    train: baselineTrain,
    held_out: baselineHeld,
  },
};

process.stdout.write(`${JSON.stringify(output)}\n`);
