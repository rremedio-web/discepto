import { classify } from './classifier.mjs';
import { validateKeyEntry, RESERVED_IDS } from './schema.mjs';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a plain object`);
  }
}

function assertNoReservedIds(obj, label) {
  for (const id of Object.keys(obj)) {
    if (RESERVED_IDS.includes(id)) {
      throw new Error(`${label}: reserved id ${id}`);
    }
  }
}

function assertExactIds(actualIds, expectedIds, label) {
  if (actualIds.length !== new Set(actualIds).size) {
    throw new Error(`${label}: duplicate id`);
  }
  const actual = new Set(actualIds);
  const expected = new Set(expectedIds);
  for (const id of expected) {
    if (!actual.has(id)) {
      throw new Error(`${label}: missing id ${id}`);
    }
  }
  for (const id of actual) {
    if (!expected.has(id)) {
      throw new Error(`${label}: extra id ${id}`);
    }
  }
}

function answersEqual(actual, expected) {
  return (
    actual.classification === expected.classification &&
    actual.disposition === expected.disposition &&
    actual.owner_decision === expected.owner_decision
  );
}

export function scoreAnswers(answers, keys) {
  assertPlainObject(answers, 'answers');
  assertPlainObject(keys, 'keys');
  assertNoReservedIds(answers, 'answers');
  assertNoReservedIds(keys, 'keys');

  const keyIds = Object.keys(keys);
  const answerIds = Object.keys(answers);
  assertExactIds(answerIds, keyIds, 'answers');

  for (const id of keyIds) {
    const answerResult = validateKeyEntry(answers[id]);
    if (!answerResult.ok) {
      throw new Error(`answers[${id}]: ${answerResult.error}`);
    }
    const keyResult = validateKeyEntry(keys[id]);
    if (!keyResult.ok) {
      throw new Error(`keys[${id}]: ${keyResult.error}`);
    }
  }

  let exact = 0;
  const total = keyIds.length;
  for (const id of keyIds) {
    if (answersEqual(answers[id], keys[id])) exact += 1;
  }
  return {
    exact,
    total,
    accuracy: total === 0 ? 0 : exact / total,
  };
}

export function scoreClassifier(scenarios, keys) {
  if (!Array.isArray(scenarios)) {
    throw new Error('scenarios must be an array');
  }
  assertPlainObject(keys, 'keys');
  assertNoReservedIds(keys, 'keys');

  const scenarioIds = scenarios.map((scenario) => scenario.id);
  const keyIds = Object.keys(keys);
  assertExactIds(scenarioIds, keyIds, 'scenarios/keys');

  const predictions = Object.create(null);
  for (const scenario of scenarios) {
    predictions[scenario.id] = classify(scenario);
  }
  return scoreAnswers(predictions, keys);
}

export function confusionMatrix(scenarios, keys) {
  const matrix = Object.create(null);
  for (const scenario of scenarios) {
    const key = keys[scenario.id];
    if (!key) continue;
    const predicted = classify(scenario);
    const actualClass = key.classification;
    const predictedClass = predicted.classification;
    if (!matrix[actualClass]) matrix[actualClass] = Object.create(null);
    matrix[actualClass][predictedClass] = (matrix[actualClass][predictedClass] ?? 0) + 1;
  }
  return matrix;
}

export function perClassSupport(keys) {
  const support = Object.create(null);
  for (const entry of Object.values(keys)) {
    support[entry.classification] = (support[entry.classification] ?? 0) + 1;
  }
  return support;
}

export function scoreBaseline(scenarios, keys) {
  let exact = 0;
  let total = 0;
  for (const scenario of scenarios) {
    const key = keys[scenario.id];
    if (!key) continue;
    total += 1;
    if (
      key.classification === 'UNKNOWN' &&
      key.disposition === 'OBSERVE' &&
      key.owner_decision === 'no'
    ) {
      exact += 1;
    }
  }
  return {
    exact,
    total,
    accuracy: total === 0 ? 0 : exact / total,
  };
}
