import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const FORBIDDEN = [
  'cus' + 'todio',
  'openai',
  'anthropic',
  'claude',
  'gpt-4',
  'copilot',
  'cursor',
  'sub' + 'surface',
  'wordpress',
];

const SCAN_DIRS = ['src', 'fixtures', 'playwright', 'docs', 'experiments', 'bin', 'examples'];

function collectFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(path, acc);
    } else if (/\.(mjs|json|md|html)$/.test(entry.name)) {
      acc.push(path);
    }
  }
  return acc;
}

describe('neutrality and no private vendor terms', () => {
  it('scanned public artifacts contain no forbidden vendor tokens', () => {
    const files = SCAN_DIRS.flatMap((rel) => collectFiles(join(root, rel)));
    assert.ok(files.length > 0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const term of FORBIDDEN) {
        assert.doesNotMatch(text, new RegExp(term), `${term} found in ${file}`);
      }
    }
  });

  it('fixture sequences are generic neutral strings', () => {
    const scenario = JSON.parse(readFileSync(join(root, 'fixtures/scenario.json'), 'utf8'));
    assert.match(scenario.sequence, /^[A-Z]{10,32}$/);
    const html = readFileSync(join(root, 'playwright/fixture.html'), 'utf8');
    assert.ok(html.includes(scenario.sequence));
  });
});
