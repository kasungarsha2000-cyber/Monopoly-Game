import { expect, test } from '@playwright/test';
import { autoPlay, trackErrors, waitForGame, waitIdle } from './helpers';

test('mobile layout is usable and touch taps select tiles', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  const vw = page.viewportSize()?.width ?? 0;
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBe(true);
  await page.getByTestId('menu-solo').tap();
  await page.getByTestId('start-solo').tap();
  await waitForGame(page);
  await waitIdle(page);

  // Bottom bar and its buttons fit on screen.
  for (const id of ['btn-roll', 'btn-end-turn', 'btn-properties', 'btn-trade']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, id).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= vw + 1, id).toBe(true);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  }

  await page.getByTestId('btn-roll').tap();
  await autoPlay(page, 6);

  await expect(page.getByTestId('card-popup')).toHaveCount(0);
  const pos = await page.evaluate(() => (window as unknown as { __pe: { tileScreenPos: (n: number) => { x: number; y: number } } }).__pe.tileScreenPos(5));
  // The tile must be visible (not under the action dock) and a tap must open its title deed.
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, pos);
  expect(hit).toBe('CANVAS');
  await page.touchscreen.tap(pos.x, pos.y);
  await expect(page.getByTestId('inspector').getByTestId('deed')).toHaveAttribute('data-space', '5');
  expect(errors).toEqual([]);
});
