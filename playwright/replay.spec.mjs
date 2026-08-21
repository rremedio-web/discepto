import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureBase = `file://${join(root, 'playwright/fixture.html')}`;

async function measure(page, variant) {
  const url = variant === 'after' ? `${fixtureBase}?variant=after` : fixtureBase;
  await page.goto(url);
  await page.setViewportSize({ width: 320, height: 480 });

  return page.evaluate(() => {
    const seq = document.querySelector('[data-testid="seq-a"]');
    const range = document.createRange();
    range.selectNodeContents(seq);
    const lineCount = Math.max(1, range.getClientRects().length);
    const overflowX = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
    const overflowY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return {
      seq_line_count: lineCount,
      document_overflow_px: overflowX + overflowY,
      seq_width: seq.getBoundingClientRect().width,
    };
  });
}

test.describe('neutral fixture measurements', () => {
  test('before variant shows intra-word split (RED)', async ({ page }) => {
    const result = await measure(page, 'before');
    expect(result.seq_line_count).toBeGreaterThan(1);
    expect(result.document_overflow_px).toBeGreaterThan(0);
  });

  test('after variant shows single-line zero overflow (GREEN)', async ({ page }) => {
    const result = await measure(page, 'after');
    expect(result.seq_line_count).toBe(1);
    expect(result.document_overflow_px).toBe(0);
  });
});
