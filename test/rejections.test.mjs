import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REJECTION_CODE_OPERATIONS, rejectionOperation } from '../src/rejections.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseLimitationsTable() {
  const source = readFileSync(join(root, 'docs/limitations.md'), 'utf8');
  return source
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const match = line.match(/^\| `([A-Z_]+)`\s+\| `([a-z]+)`\s+\|/);
      if (!match) throw new Error(`unparsable limitations table row: ${line}`);
      return [match[1], match[2]];
    });
}

describe('rejection catalog', () => {
  it('defines exactly fourteen code/operation pairs', () => {
    assert.equal(Object.keys(REJECTION_CODE_OPERATIONS).length, 14);
  });

  it('docs/limitations.md table matches the catalog exactly', () => {
    const documented = parseLimitationsTable();
    const catalog = Object.entries(REJECTION_CODE_OPERATIONS);
    assert.equal(documented.length, catalog.length);
    for (const [code, operation] of catalog) {
      const row = documented.find(([docCode]) => docCode === code);
      assert.ok(row, `missing from docs table: ${code}`);
      assert.equal(row[1], operation, `operation mismatch in docs table: ${code}`);
    }
    for (const [docCode] of documented) {
      assert.ok(
        REJECTION_CODE_OPERATIONS[docCode] !== undefined,
        `docs table code not in catalog: ${docCode}`,
      );
    }
  });

  it('rejectionOperation derives the operation and throws on unknown code', () => {
    assert.equal(rejectionOperation('LEASE_ISSUER_MISMATCH'), 'lease');
    assert.throws(() => rejectionOperation('NOT_A_REJECTION_CODE'), /unknown rejection code/);
  });
});
