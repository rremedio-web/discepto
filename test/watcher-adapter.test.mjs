import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAdversarialDemo } from '../src/receipt.mjs';
import { AUTHORITY_REJECTIONS } from '../src/protocol.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adapterPath = join(root, 'src/watcher-adapter.mjs');

const EXPECTED_CLASSIFICATION = {
  classification: 'RECORDS_TRUST',
  disposition: 'HOLD',
  owner_decision: 'yes',
};

// Derived from the protocol's authority-rejection catalogue; not a second copy.
const ALL_REJECTION_PAIRS = Object.entries(AUTHORITY_REJECTIONS).map(
  ([code, rule]) => [code, rule.operation],
);

const CONTEXT = {
  run_id: 'run-neutral-001',
  scope: 'adversarial-neutral-001',
};

const RUN_ID_DIGEST = 'ccdf0e6aa9b068a338b903bb919568c84f06a85750348276eaad0f883319fd88';
const RUN_ID_SLUG = `run-neutral-001-${RUN_ID_DIGEST}`;

function rejection(code, operation, message = 'display-only prose must not matter') {
  return { code, operation, message };
}

describe('watcher adapter', () => {
  it('adapter interface is exactly one observation function plus the version constant', async () => {
    const mod = await import('../src/watcher-adapter.mjs');
    assert.deepEqual(Object.keys(mod).sort(), ['WATCHER_CALIBRATION_VERSION', 'observeRejection']);
  });

  it('all 14 code/operation pairs observe and classify exactly', async () => {
    const { observeRejection } = await import('../src/watcher-adapter.mjs');
    assert.equal(Object.keys(AUTHORITY_REJECTIONS).length, 14);
    for (const [code, operation] of ALL_REJECTION_PAIRS) {
      const observation = observeRejection(rejection(code, operation), CONTEXT);
      assert.equal(observation.rejection_code, code);
      assert.equal(observation.operation, operation);
      assert.match(observation.scenario_id, /^discepto-/);
      assert.match(observation.evidence_ref, /^ev-discepto-/);
      assert.deepEqual(
        {
          classification: observation.classification,
          disposition: observation.disposition,
          owner_decision: observation.owner_decision,
        },
        EXPECTED_CLASSIFICATION,
        `unexpected classification for ${code}`,
      );
    }
  });

  it('unknown code and code/operation mismatch throw', async () => {
    const { observeRejection } = await import('../src/watcher-adapter.mjs');
    assert.throws(
      () => observeRejection(rejection('UNKNOWN_CODE', 'lease')),
      (err) => /unknown rejection code/i.test(err.message),
    );
    assert.throws(
      () => observeRejection(rejection('LEASE_ISSUER_MISMATCH', 'mutation')),
      (err) => /code\/operation mismatch/i.test(err.message),
    );
  });

  it('same code with distinct sequences yields distinct deterministic scenario IDs and evidence refs', async () => {
    const { observeRejection } = await import('../src/watcher-adapter.mjs');
    const rejectionItem = rejection('MUTATION_CHALLENGER', 'mutation');
    const first = observeRejection(rejectionItem, { ...CONTEXT, sequence: 0 });
    const second = observeRejection(rejectionItem, { ...CONTEXT, sequence: 1 });
    assert.notEqual(first.scenario_id, second.scenario_id);
    assert.notEqual(first.evidence_ref, second.evidence_ref);
    assert.equal(first.scenario_id, `discepto-${RUN_ID_SLUG}-0-mutation-challenger`);
    assert.equal(second.scenario_id, `discepto-${RUN_ID_SLUG}-1-mutation-challenger`);
    assert.equal(first.evidence_ref, `ev-discepto-${RUN_ID_SLUG}-0-mutation-challenger`);
    assert.equal(second.evidence_ref, `ev-discepto-${RUN_ID_SLUG}-1-mutation-challenger`);
  });

  it('distinct run_id slugs that sanitize the same stay distinct via digest', async () => {
    const { observeRejection } = await import('../src/watcher-adapter.mjs');
    const rejectionItem = rejection('MUTATION_CHALLENGER', 'mutation');
    const slash = observeRejection(rejectionItem, { run_id: 'run/a', sequence: 0 });
    const hyphen = observeRejection(rejectionItem, { run_id: 'run-a', sequence: 0 });
    assert.notEqual(slash.scenario_id, hyphen.scenario_id);
    assert.notEqual(slash.evidence_ref, hyphen.evidence_ref);
  });

  it('distinct Unicode-only run_ids stay distinct', async () => {
    const { observeRejection } = await import('../src/watcher-adapter.mjs');
    const rejectionItem = rejection('MUTATION_CHALLENGER', 'mutation');
    const rocket = observeRejection(rejectionItem, { run_id: '🚀', sequence: 0 });
    const star = observeRejection(rejectionItem, { run_id: '★', sequence: 0 });
    assert.notEqual(rocket.scenario_id, star.scenario_id);
    assert.notEqual(rocket.evidence_ref, star.evidence_ref);
  });

  it('invalid context.run_id fails closed', async () => {
    const { observeRejection } = await import('../src/watcher-adapter.mjs');
    const rejectionItem = rejection('MUTATION_CHALLENGER', 'mutation');
    for (const run_id of ['', null, 0, 1.5, false, {}]) {
      assert.throws(
        () => observeRejection(rejectionItem, { run_id }),
        (err) => /run_id must be a non-empty string/i.test(err.message),
        `expected throw for run_id=${String(run_id)}`,
      );
    }
  });

  it('same exact inputs produce byte-identical observations', async () => {
    const { observeRejection } = await import('../src/watcher-adapter.mjs');
    const rejectionItem = rejection('MUTATION_CHALLENGER', 'mutation');
    const first = observeRejection(rejectionItem, CONTEXT);
    const second = observeRejection(rejectionItem, CONTEXT);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it('invalid context.sequence fails closed', async () => {
    const { observeRejection } = await import('../src/watcher-adapter.mjs');
    const rejectionItem = rejection('MUTATION_CHALLENGER', 'mutation');
    for (const sequence of [-1, 1.5, '0', null, undefined]) {
      if (sequence === undefined) continue;
      assert.throws(
        () => observeRejection(rejectionItem, { ...CONTEXT, sequence }),
        (err) => /sequence must be a non-negative integer/i.test(err.message),
        `expected throw for sequence=${String(sequence)}`,
      );
    }
  });

  it('changing only message produces byte-identical observations', async () => {
    const { observeRejection } = await import('../src/watcher-adapter.mjs');
    const base = rejection('MUTATION_CHALLENGER', 'mutation', 'first prose');
    const mutated = rejection('MUTATION_CHALLENGER', 'mutation', 'completely different prose');
    const first = observeRejection(base, CONTEXT);
    const second = observeRejection(mutated, CONTEXT);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it('observation carries exactly the seven watcher receipt fields', async () => {
    const { observeRejection } = await import('../src/watcher-adapter.mjs');
    const observation = observeRejection(rejection('MUTATION_CHALLENGER', 'mutation'), CONTEXT);
    assert.deepEqual(Object.keys(observation), [
      'rejection_code',
      'operation',
      'scenario_id',
      'evidence_ref',
      'classification',
      'disposition',
      'owner_decision',
    ]);
  });

  it('source inspection confirms adapter does not access .message or parse message strings', () => {
    const source = readFileSync(adapterPath, 'utf8');
    assert.doesNotMatch(source, /\.message\b/);
    assert.doesNotMatch(source, /\['message'\]/);
    assert.doesNotMatch(source, /\["message"\]/);
    assert.doesNotMatch(source, /destructure.*message/i);
  });
});

describe('watcher adversarial receipt', () => {
  it('receipt is deterministic across two CLI runs and matches expected fixture exactly', () => {
    const first = spawnSync('node', [join(root, 'src/watcher-adversarial-demo.mjs')], {
      encoding: 'utf8',
    });
    const second = spawnSync('node', [join(root, 'src/watcher-adversarial-demo.mjs')], {
      encoding: 'utf8',
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);

    const receipt = JSON.parse(first.stdout);
    const expected = JSON.parse(
      readFileSync(join(root, 'fixtures/watcher-adversarial-expected.json'), 'utf8'),
    );
    assert.deepEqual(receipt, expected);
  });

  it('has four catches with valid hashes', async () => {
    const { runWatcherAdversarialDemo } = await import('../src/watcher-adversarial-demo.mjs');
    const { receipt, allCatches } = runWatcherAdversarialDemo();
    assert.equal(receipt.observation_count, 4);
    assert.equal(receipt.observations.length, 4);
    assert.ok(allCatches);
    assert.match(receipt.receipt_hash, /^[0-9a-f]{64}$/);
    assert.match(receipt.source_receipt_hash, /^[0-9a-f]{64}$/);
    for (const observation of receipt.observations) {
      assert.ok(!('message' in observation));
      assert.deepEqual(
        {
          classification: observation.classification,
          disposition: observation.disposition,
          owner_decision: observation.owner_decision,
        },
        EXPECTED_CLASSIFICATION,
      );
    }
  });

  it('runWatcherAdversarialDemo matches spawned demo output', async () => {
    const spawned = spawnSync('node', [join(root, 'src/watcher-adversarial-demo.mjs')], {
      encoding: 'utf8',
    });
    const { receipt } = await import('../src/watcher-adversarial-demo.mjs').then(
      (mod) => mod.runWatcherAdversarialDemo(),
    );
    assert.equal(spawned.stdout, `${JSON.stringify(receipt, null, 2)}\n`);
  });

  it('existing adversarial trace/freeze binding remains unchanged', () => {
    const { output, expected, allMatch } = runAdversarialDemo();
    assert.ok(allMatch);
    assert.equal(output.freeze_binding, expected.freeze_binding);
    assert.equal(output.current_freeze_id, expected.freeze_id);
    assert.equal(output.rejection_count, 4);
  });
});
