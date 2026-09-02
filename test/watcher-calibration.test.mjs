import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watcherRoot = join(root, 'experiments/watcher');

function loadJson(rel) {
  return JSON.parse(readFileSync(join(watcherRoot, rel), 'utf8'));
}

describe('watcher calibration module', () => {
  it('classifier matches rule-example keys exactly', async () => {
    const { classify } = await import('../experiments/watcher/classifier.mjs');
    const scenarios = loadJson('fixtures/rule-examples.json');
    const keys = loadJson('fixtures/rule-example-keys.json');
    for (const scenario of scenarios) {
      const expected = keys[scenario.id];
      const actual = classify(scenario);
      assert.deepEqual(actual, expected, `rule-example mismatch for ${scenario.id}`);
    }
  });

  it('classifier matches conformance keys exactly', async () => {
    const { classify } = await import('../experiments/watcher/classifier.mjs');
    const scenarios = loadJson('fixtures/conformance-scenarios.json');
    const keys = loadJson('fixtures/conformance-keys.json');
    for (const scenario of scenarios) {
      const expected = keys[scenario.id];
      const actual = classify(scenario);
      assert.deepEqual(actual, expected, `conformance mismatch for ${scenario.id}`);
    }
  });

  it('deliberately wrong conformance answers score non-perfect against keys', async () => {
    const { scoreAnswers } = await import('../experiments/watcher/scorer.mjs');
    const keys = loadJson('fixtures/conformance-keys.json');
    const wrong = loadJson('fixtures/conformance-wrong-answers.json');
    const result = scoreAnswers(wrong, keys);
    assert.ok(result.total > 0);
    assert.ok(result.exact < result.total);
    assert.ok(result.accuracy < 1);
  });

  it('scoreAnswers throws on missing or extra answer IDs', async () => {
    const { scoreAnswers } = await import('../experiments/watcher/scorer.mjs');
    const shape = {
      classification: 'UNKNOWN',
      disposition: 'OBSERVE',
      owner_decision: 'no',
    };
    const keys = { 'only-id': shape };
    assert.throws(
      () => scoreAnswers({}, keys),
      (err) => /missing/i.test(err.message),
    );
    assert.throws(
      () => scoreAnswers({ 'only-id': shape, extra: shape }, keys),
      (err) => /extra/i.test(err.message),
    );
  });

  it('scoreClassifier enforces exact scenario and key ID alignment', async () => {
    const { scoreClassifier } = await import('../experiments/watcher/scorer.mjs');
    const scenarios = loadJson('fixtures/rule-examples.json').slice(0, 2);
    const keys = loadJson('fixtures/rule-example-keys.json');
    assert.throws(
      () => scoreClassifier(scenarios, keys),
      (err) => /missing|extra|mismatch/i.test(err.message),
    );
  });

  it('scoreClassifier rejects duplicate scenario IDs', async () => {
    const { scoreClassifier } = await import('../experiments/watcher/scorer.mjs');
    const scenario = loadJson('fixtures/rule-examples.json')[0];
    const keys = loadJson('fixtures/rule-example-keys.json');
    const dupScenarios = [scenario, { ...scenario }];
    assert.throws(
      () => scoreClassifier(dupScenarios, { [scenario.id]: keys[scenario.id] }),
      (err) => /duplicate/i.test(err.message),
    );
  });

  it('classify rejects invalid scenario at public boundary', async () => {
    const { classify } = await import('../experiments/watcher/classifier.mjs');
    const base = loadJson('fixtures/rule-examples.json')[0];
    assert.throws(
      () => classify({ ...base, failure_class: 'X' }),
      (err) => /forbidden field: failure_class/.test(err.message),
    );
    const { facts: _facts, ...withoutFacts } = base;
    assert.throws(
      () => classify(withoutFacts),
      (err) => /facts/.test(err.message),
    );
  });

  it('conformance precedence conflicts favor higher-priority rule', async () => {
    const { classify } = await import('../experiments/watcher/classifier.mjs');
    const scenarios = loadJson('fixtures/conformance-scenarios.json');
    const keys = loadJson('fixtures/conformance-keys.json');
    const precedenceIds = [
      'held-p01-ext-idle',
      'held-p02-idle-auth',
      'held-p03-auth-gap',
      'held-p04-contra-unstable',
      'held-p05-unstable-parity',
      'held-p06-parity-mutated',
      'held-p07-mutated-ref',
    ];
    for (const id of precedenceIds) {
      const scenario = scenarios.find((s) => s.id === id);
      assert.ok(scenario, `missing precedence scenario ${id}`);
      assert.deepEqual(classify(scenario), keys[id], `precedence mismatch for ${id}`);
    }
  });

  it('schema rejects prototype pollution reserved ids', async () => {
    const { validateScenario, validateKeys, RESERVED_IDS } =
      await import('../experiments/watcher/schema.mjs');
    const base = loadJson('fixtures/rule-examples.json')[0];
    for (const reserved of ['__proto__', 'prototype', 'constructor']) {
      assert.ok(RESERVED_IDS.includes(reserved), `RESERVED_IDS must include ${reserved}`);
      assert.equal(validateScenario({ ...base, id: reserved }).ok, false);
      assert.equal(
        validateKeys({
          [reserved]: {
            classification: 'UNKNOWN',
            disposition: 'OBSERVE',
            owner_decision: 'no',
          },
        }).ok,
        false,
      );
    }
  });

  it('schema rejects forbidden and unknown fields and reserved ids', async () => {
    const { validateScenario } = await import('../experiments/watcher/schema.mjs');
    const base = loadJson('fixtures/rule-examples.json')[0];
    assert.equal(validateScenario(base).ok, true);
    assert.equal(validateScenario({ ...base, failure_class: 'X' }).ok, false);
    assert.equal(validateScenario({ ...base, answer: 'X' }).ok, false);
    assert.equal(validateScenario({ ...base, extra: true }).ok, false);
    assert.equal(validateScenario({ ...base, id: 'failure_class' }).ok, false);
  });

  it('schema rejects empty evidence array', async () => {
    const { validateScenario } = await import('../experiments/watcher/schema.mjs');
    const base = loadJson('fixtures/rule-examples.json')[0];
    assert.equal(validateScenario({ ...base, evidence: [] }).ok, false);
  });

  it('fixture id sets align exactly between scenarios and keys', () => {
    const trainScenarios = loadJson('fixtures/rule-examples.json');
    const trainKeys = loadJson('fixtures/rule-example-keys.json');
    const heldScenarios = loadJson('fixtures/conformance-scenarios.json');
    const heldKeys = loadJson('fixtures/conformance-keys.json');
    assert.deepEqual(new Set(trainScenarios.map((s) => s.id)), new Set(Object.keys(trainKeys)));
    assert.deepEqual(new Set(heldScenarios.map((s) => s.id)), new Set(Object.keys(heldKeys)));
  });

  it('all classifications and dispositions reachable in rule examples and conformance', () => {
    const classifications = [
      'EXTERNAL_ACTION',
      'IDLE',
      'RECORDS_TRUST',
      'FAILED_CHECK',
      'TOOLING',
      'UNKNOWN',
    ];
    const dispositions = ['ESCALATE', 'OBSERVE', 'HOLD', 'STEER', 'VERIFY'];
    for (const [label, keys] of [
      ['rule-examples', loadJson('fixtures/rule-example-keys.json')],
      ['conformance', loadJson('fixtures/conformance-keys.json')],
    ]) {
      const cls = new Set(Object.values(keys).map((k) => k.classification));
      const disp = new Set(Object.values(keys).map((k) => k.disposition));
      for (const c of classifications)
        assert.ok(cls.has(c), `${label} missing classification ${c}`);
      for (const d of dispositions) assert.ok(disp.has(d), `${label} missing disposition ${d}`);
    }
  });

  it('classifier does not import or read key files', async () => {
    const source = readFileSync(join(watcherRoot, 'classifier.mjs'), 'utf8');
    assert.doesNotMatch(source, /rule-example-keys\.json/);
    assert.doesNotMatch(source, /conformance-keys\.json/);
    assert.doesNotMatch(source, /conformance-wrong-answers\.json/);
    assert.doesNotMatch(source, /readFileSync/);
    assert.doesNotMatch(source, /from ['"].*keys/);
  });

  it('claim and evidence prose do not affect classification', async () => {
    const { classify } = await import('../experiments/watcher/classifier.mjs');
    const base = loadJson('fixtures/rule-examples.json')[0];
    const first = classify(base);
    const mutated = {
      ...base,
      claim: 'completely different claim prose',
      evidence: [{ ref: 'alt', kind: 'note', summary: 'other summary text' }],
    };
    assert.deepEqual(classify(mutated), first);
  });
});
