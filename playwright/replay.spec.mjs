import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureBase = `file://${join(root, 'playwright/fixture.html')}`;
const VIEWPORTS = [320, 375, 768];

async function measure(page, variant, width) {
  const url = variant === 'after' ? `${fixtureBase}?variant=after` : fixtureBase;
  await page.setViewportSize({ width, height: 480 });
  await page.goto(url);

  return page.evaluate(() => {
    const seq = document.querySelector('[data-testid="seq-a"]');
    const seqToken = seq.querySelector('.seq-token') ?? seq;
    const range = document.createRange();
    range.selectNodeContents(seqToken);
    const lineCount = Math.max(1, range.getClientRects().length);
    const overflowX = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
    const overflowY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return {
      seq_line_count: lineCount,
      overflow_x_px: overflowX,
      overflow_y_px: overflowY,
      seq_width: seq.getBoundingClientRect().width,
    };
  });
}

test.describe('neutral fixture measurements', () => {
  for (const width of VIEWPORTS) {
    test(`before variant shows intra-word split and horizontal overflow at ${width}px (RED)`, async ({
      page,
    }) => {
      const result = await measure(page, 'before', width);
      expect(result.seq_line_count).toBeGreaterThan(1);
      expect(result.overflow_x_px).toBeGreaterThan(0);
      expect(result.overflow_y_px).toBe(0);
    });

    test(`after variant shows single-line zero horizontal overflow at ${width}px (GREEN)`, async ({
      page,
    }) => {
      const result = await measure(page, 'after', width);
      expect(result.seq_line_count).toBe(1);
      expect(result.overflow_x_px).toBe(0);
    });
  }
});
