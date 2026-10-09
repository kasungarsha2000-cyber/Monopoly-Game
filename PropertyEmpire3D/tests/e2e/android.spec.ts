/**
 * The Android app (apps/android) shows the single-file build in a WebView,
 * served from a private https origin with a strict content policy and a
 * `PEAndroid` bridge. Real devices cannot run in CI, so this test recreates
 * that environment in Chromium: the same page, origin, policy (read from
 * MainActivity.java) and bridge, on a phone-sized touch screen.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { autoPlay, info, trackErrors, waitForGame } from './helpers';

const ORIGIN = 'https://appassets.androidplatform.net';
const root = process.cwd();
const pagePath = join(root, 'test-results', 'android', 'index.html');

function appCsp(): string {
  const java = readFileSync(join(root, 'apps/android/java/app/propertyempire3d/MainActivity.java'), 'utf8');
  const decl = /String CSP =([\s\S]*?);\n/.exec(java)?.[1] ?? '';
  const csp = [...decl.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
  if (!csp.includes("connect-src 'none'")) throw new Error('Could not read the CSP from MainActivity.java');
  return csp;
}

const back = (page: Page) => page.evaluate(() => (window as unknown as { peHandleBack: () => boolean }).peHandleBack());

test.beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'scripts', 'build-artifact.mjs'), pagePath, '--document'], { stdio: 'ignore' });
});

test('android app page runs offline with back-button and pause hooks', async ({ page, context }) => {
  const html = readFileSync(pagePath, 'utf8');
  const csp = appCsp();
  await context.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'Content-Security-Policy': csp }, body: html });
    return route.fulfill({ status: 404, body: '' });
  });
  const outside: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(ORIGIN) && !u.startsWith('data:') && !u.startsWith('blob:')) outside.push(u);
  });
  await page.addInitScript(() => {
    (window as unknown as { PEAndroid: unknown }).PEAndroid = { exitApp: () => undefined };
  });
  const errors = trackErrors(page);

  await page.goto(`${ORIGIN}/index.html?e2e=1`);
  const menu = page.getByTestId('main-menu');
  await expect(menu).toBeVisible();
  // App mode: always full screen, solo only, and back on the main menu closes the app.
  await expect(menu).not.toContainText('Fullscreen');
  await expect(menu).toContainText('fully offline');
  expect(await back(page)).toBe(false);

  await page.getByTestId('menu-settings').tap();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(page.getByTestId('settings-screen')).not.toContainText('Full screen');
  expect(await back(page)).toBe(true);
  await expect(menu).toBeVisible();

  await page.getByTestId('menu-solo').tap();
  await page.getByTestId('start-solo').tap();
  await waitForGame(page);
  const played = await autoPlay(page, 6);

  // Back opens the pause menu; a second back closes it again.
  expect(await back(page)).toBe(true);
  await expect(page.getByTestId('game-menu')).toBeVisible();
  expect(await back(page)).toBe(true);
  await expect(page.getByTestId('game-menu')).toHaveCount(0);

  // Leaving the app saves the game; reopening it can continue from there.
  await page.evaluate(() => (window as unknown as { peOnPause: () => void }).peOnPause());
  await page.waitForTimeout(500);
  await page.goto(`${ORIGIN}/index.html?e2e=1`);
  await page.getByTestId('menu-continue').tap();
  await page.getByTestId('load-autosave').tap();
  await waitForGame(page);
  const restored = await info(page);
  expect(restored.turn).toBeGreaterThanOrEqual(played.turn - 1);

  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});
