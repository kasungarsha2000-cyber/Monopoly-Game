import { expect, test } from '@playwright/test';
import { act, autoPlay, info, pickAction, trackErrors, waitForGame, waitForMyMove, waitIdle } from './helpers';

test.describe('solo play', () => {
  test('a human plays against bots with real buttons, entirely in the browser (no WebSocket)', async ({ page }) => {
    const errors = trackErrors(page);
    const sockets: string[] = [];
    page.on('websocket', (ws) => sockets.push(ws.url()));
    await page.goto('/?e2e=1');
    await page.getByTestId('menu-solo').click();
    await expect(page.getByTestId('solo-setup')).toBeVisible();
    await page.getByTestId('solo-name').fill('Tester');
    await page.getByTestId('start-solo').click();
    await waitForGame(page);

    // Play our first turn with the visible controls.
    let s = await waitForMyMove(page);
    expect(s.players).toHaveLength(4);
    expect(s.players[0]?.name).toBe('Tester');
    await expect(page.getByTestId('btn-roll')).toBeEnabled();
    await page.getByTestId('btn-roll').click();
    s = await waitIdle(page);
    expect(s.turn).toBeGreaterThanOrEqual(1);
    for (let guard = 0; guard < 20; guard++) {
      s = await waitIdle(page);
      if (s.current !== s.me) break;
      if (s.legal.canBuy) await page.getByTestId('btn-buy').click();
      else if (s.legal.canPassBid) await page.getByTestId('btn-pass').click();
      else if (s.legal.canRoll) await page.getByTestId('btn-roll').click();
      else if (s.legal.canEndTurn) await page.getByTestId('btn-end-turn').click();
      else if (s.legal.canPayDebt) await page.getByTestId('btn-pay-debt').click();
      else break;
    }
    // Bots take their turns and play comes back to us.
    s = await waitForMyMove(page);
    expect(s.turn).toBeGreaterThan(1);

    // Keep playing for a while with a simple policy.
    s = await autoPlay(page, 40);
    expect(s.turn).toBeGreaterThan(8);
    const hudCash = await page.locator('[data-player="you"] .cash').innerText();
    expect(hudCash.replace(/[$,]/g, '')).toBe(String(s.players.find((p) => p.id === 'you')?.cash));
    expect(sockets).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('mouse clicks select board tiles and show the property card', async ({ page }) => {
    await page.goto('/?e2e=1');
    await page.getByTestId('menu-solo').click();
    await page.getByTestId('start-solo').click();
    await waitForGame(page);
    await waitIdle(page);
    for (const space of [39, 1, 24]) {
      const pos = await page.evaluate((i) => (window as unknown as { __pe: { tileScreenPos: (n: number) => { x: number; y: number } } }).__pe.tileScreenPos(i), space);
      await page.mouse.click(pos.x, pos.y);
      await expect(page.getByTestId('inspector').getByTestId('property-card')).toHaveAttribute('data-space', String(space));
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('inspector')).toHaveCount(0);
      await page.getByTestId('camera-reset').click();
      await page.waitForTimeout(100);
    }
  });

  test('keyboard shortcuts, properties, trade dialog and log work', async ({ page }) => {
    await page.goto('/?e2e=1');
    await page.getByTestId('menu-solo').click();
    await page.getByTestId('start-solo').click();
    await waitForGame(page);
    // Advance until rolling is legal (our first move may be an auction bid or a trade reply).
    let s0 = await waitForMyMove(page);
    for (let k = 0; k < 30 && !s0.legal.canRoll; k++) {
      const a = pickAction(s0);
      if (!a) break;
      await act(page, a);
      await page.waitForFunction((rev) => (window as unknown as { __pe: { display: () => { revision: number } } }).__pe.display().revision > rev, s0.revision);
      s0 = await waitForMyMove(page);
    }
    expect(s0.legal.canRoll).toBe(true);
    const before = s0.revision;
    await page.keyboard.press('Space');
    await expect.poll(async () => (await info(page)).revision).toBeGreaterThan(before);
    await waitIdle(page);
    await page.getByTestId('btn-properties').click();
    await expect(page.getByTestId('manage-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('btn-log').click();
    await expect(page.getByTestId('log-dialog')).toContainText('rolls');
    await page.keyboard.press('Escape');
    const s = await waitForMyMove(page);
    if (s.legal.canRoll || s.legal.canEndTurn) {
      await page.getByTestId('btn-trade').click();
      await expect(page.getByTestId('trade-dialog')).toBeVisible();
      // An empty trade cannot be sent.
      await expect(page.getByTestId('send-trade')).toBeDisabled();
      await page.keyboard.press('Escape');
    }
  });

  test('autosave restores the game after a reload', async ({ page }) => {
    await page.goto('/?e2e=1');
    await page.getByTestId('menu-solo').click();
    await page.getByTestId('start-solo').click();
    await waitForGame(page);
    const s = await autoPlay(page, 12);
    await page.waitForTimeout(1500); // autosave is debounced
    const saved = await info(page);
    await page.goto('/?e2e=1');
    await page.getByTestId('menu-continue').click();
    await expect(page.getByTestId('continue-screen')).toBeVisible();
    await page.getByTestId('load-autosave').click();
    await waitForGame(page);
    const restored = await info(page);
    expect(restored.turn).toBeGreaterThanOrEqual(saved.turn - 1);
    expect(restored.players.map((p) => p.name)).toEqual(s.players.map((p) => p.name));
    await autoPlay(page, 3);
  });
});
