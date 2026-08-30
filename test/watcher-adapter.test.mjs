import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAdversarialDemo } from '../src/adversarial-demo.mjs';
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
  it('all 14 code/operation pairs adapt and classify exactly', async () => {
    const { REJECTION_CODE_OPERATIONS, adaptAndClassify } = await import('../src/watcher-adapter.mjs');
    assert.equal(Object.keys(AUTHORITY_REJECTIONS).length, 14);
    assert.equal(Object.keys(REJECTION_CODE_OPERATIONS).length, Object.keys(AUTHORITY_REJECTIONS).length);
    for (const [code, operation] of ALL_REJECTION_PAIRS) {
      const result = adaptAndClassify(rejection(code, operation), CONTEXT);
      assert.equal(result.scenario.facts.authority_status, 'mismatch');
      assert.equal(
        result.scenario.facts.requested_action,
        operation === 'review' ? 'read' : 'write',
      );
      assert.deepEqual(
        {
          classification: result.classification,
          disposition: result.disposition,
          owner_decision: result.owner_decision,
        },
        EXPECTED_CLASSIFICATION,
        `unexpected classification for ${code}`,
      );
    }
  });

  it('unknown code and code/operation mismatch throw', async () => {
    const { adaptRejection } = await import('../src/watcher-adapter.mjs');
    assert.throws(
      () => adaptRejection(rejection('UNKNOWN_CODE', 'lease')),
      (err) => /unknown rejection code/i.test(err.message),
    );
    assert.throws(
      () => adaptRejection(rejection('LEASE_ISSUER_MISMATCH', 'mutation')),
      (err) => /code\/operation mismatch/i.test(err.message),
    );
  });

  it('same code with distinct sequences yields distinct deterministic scenario IDs and evidence refs', async () => {
    const { adaptRejection } = await import('../src/watcher-adapter.mjs');
    const rejectionItem = rejection('MUTATION_CHALLENGER', 'mutation');
    const first = adaptRejection(rejectionItem, { ...CONTEXT, sequence: 0 });
    const second = adaptRejection(rejectionItem, { ...CONTEXT, sequence: 1 });
    assert.notEqual(first.id, second.id);
    assert.notEqual(first.evidence[0].ref, second.evidence[0].ref);
    assert.equal(first.id, `discepto-${RUN_ID_SLUG}-0-mutation-challenger`);
    assert.equal(second.id, `discepto-${RUN_ID_SLUG}-1-mutation-challenger`);
    assert.equal(first.evidence[0].ref, `ev-discepto-${RUN_ID_SLUG}-0-mutation-challenger`);
    assert.equal(second.evidence[0].ref, `ev-discepto-${RUN_ID_SLUG}-1-mutation-challenger`);
  });

  it('distinct run_id slugs that sanitize the same stay distinct via digest', async () => {
    const { adaptRejection } = await import('../src/watcher-adapter.mjs');
    const rejectionItem = rejection('MUTATION_CHALLENGER', 'mutation');
    const slash = adaptRejection(rejectionItem, { run_id: 'run/a', sequence: 0 });
    const hyphen = adaptRejection(rejectionItem, { run_id: 'run-a', sequence: 0 });
    assert.notEqual(slash.id, hyphen.id);
    assert.notEqual(slash.evidence[0].ref, hyphen.evidence[0].ref);
  });

  it('distinct Unicode-only run_ids stay distinct', async () => {
    const { adaptRejection } = await import('../src/watcher-adapter.mjs');
    const rejectionItem = rejection('MUTATION_CHALLENGER', 'mutation');
    const rocket = adaptRejection(rejectionItem, { run_id: '🚀', sequence: 0 });
    const star = adaptRejection(rejectionItem, { run_id: '★', sequence: 0 });
    assert.notEqual(rocket.id, star.id);
    assert.notEqual(rocket.evidence[0].ref, star.evidence[0].ref);
  });

  it('invalid context.run_id fails closed', async () => {
    const { adaptRejection } = await import('../src/watcher-adapter.mjs');
    const rejectionItem = rejection('MUTATION_CHALLENGER', 'mutation');
    for (const run_id of ['', null, 0, 1.5, false, {}]) {
      assert.throws(
        () => adaptRejection(rejectionItem, { run_id }),
        (err) => /run_id must be a non-empty string/i.test(err.message),
        `expected throw for run_id=${String(run_id)}`,
      );
    }
  });

  it('same exact inputs produce byte-identical adapted output', async () => {
    const { adaptAndClassify } = await import('../src/watcher-adapter.mjs');
    const rejectionItem = rejection('MUTATION_CHALLENGER', 'mutation');
    const first = adaptAndClassify(rejectionItem, CONTEXT);
    const second = adaptAndClassify(rejectionItem, CONTEXT);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it('invalid context.sequence fails closed', async () => {
    const { adaptRejection } = await import('../src/watcher-adapter.mjs');
    const rejectionItem = rejection('MUTATION_CHALLENGER', 'mutation');
    for (const sequence of [-1, 1.5, '0', null, undefined]) {
      if (sequence === undefined) continue;
      assert.throws(
        () => adaptRejection(rejectionItem, { ...CONTEXT, sequence }),
        (err) => /sequence must be a non-negative integer/i.test(err.message),
        `expected throw for sequence=${String(sequence)}`,
      );
    }
  });

  it('changing only message produces byte-identical adapted scenario/classification', async () => {
    const { adaptAndClassify } = await import('../src/watcher-adapter.mjs');
    const base = rejection('MUTATION_CHALLENGER', 'mutation', 'first prose');
    const mutated = rejection('MUTATION_CHALLENGER', 'mutation', 'completely different prose');
    const first = adaptAndClassify(base, CONTEXT);
    const second = adaptAndClassify(mutated, CONTEXT);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
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
