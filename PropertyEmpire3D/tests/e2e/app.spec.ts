import { expect, test } from '@playwright/test';
import { trackErrors } from './helpers';

test('web app loads the main menu without errors and the 3D canvas initializes', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(page).toHaveTitle('Property Empire 3D');
  const canvas = page.locator('#stage canvas');
  await expect(canvas).toBeVisible();
  const hasGl = await page.evaluate(() => {
    const c = document.querySelector('#stage canvas') as HTMLCanvasElement | null;
    return !!c && !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  });
  expect(hasGl).toBe(true);
  expect(errors).toEqual([]);
});

test('canvas responds to resize', async ({ page }) => {
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  const size = () => page.evaluate(() => {
    const c = document.querySelector('#stage canvas') as HTMLCanvasElement;
    return { w: c.width, h: c.height };
  });
  const a = await size();
  await page.setViewportSize({ width: 800, height: 600 });
  await expect.poll(async () => (await size()).w).not.toBe(a.w);
  const b = await size();
  expect(b.w / b.h).toBeCloseTo(800 / 600, 1);
});

test('settings persist and how-to-play opens', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Fast' }).click();
  await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pe.settings.v1') ?? '{}').animationSpeed);
  expect(saved).toBe('fast');
  await page.goto('/?e2e=1');
  await page.getByTestId('menu-howto').click();
  await expect(page.getByText('Building', { exact: true })).toBeVisible();
});

test('health endpoint and static security headers', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.ok()).toBe(true);
  const page = await request.get('/');
  expect(page.headers()['x-content-type-options']).toBe('nosniff');
  expect(page.headers()['content-security-policy']).toContain("default-src 'self'");
});
