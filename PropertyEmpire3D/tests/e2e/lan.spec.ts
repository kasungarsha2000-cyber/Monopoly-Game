import { expect, test, type Browser, type Page } from '@playwright/test';
import { act, info, pickAction, trackErrors, waitForGame, waitIdle } from './helpers';

async function newPlayer(browser: Browser): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  return { page, errors: trackErrors(page) };
}

async function hostRoom(page: Page, name = 'Host'): Promise<string> {
  await page.goto('/?e2e=1');
  await page.getByTestId('menu-create-lan').click();
  await page.getByTestId('lan-name').fill(name);
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('lobby')).toBeVisible();
  return (await page.getByTestId('room-code').innerText()).trim();
}

test.describe('LAN multiplayer in real browsers', () => {
  test('host and guest join by code and invite link, play with a bot and stay in sync', async ({ browser }) => {
    const host = await newPlayer(browser);
    const guest = await newPlayer(browser);
    const code = await hostRoom(host.page);
    expect(code).toMatch(/^[A-Z2-9]{5}$/);

    // The guest opens the invite link, which pre-fills the room code.
    await guest.page.goto(`/?room=${code}&e2e=1`);
    await expect(guest.page.getByTestId('join-code')).toHaveValue(code);
    await guest.page.getByTestId('join-name').fill('Guest');
    await guest.page.getByTestId('join-room').click();
    await expect(guest.page.getByTestId('lobby')).toBeVisible();
    await expect(host.page.getByTestId('lobby-seats')).toContainText('Guest');

    await host.page.getByTestId('add-bot-medium').click();
    await expect(host.page.getByTestId('lobby-seats')).toContainText('(bot)');
    await expect(host.page.getByTestId('start-lan')).toBeDisabled();
    await guest.page.getByTestId('ready-toggle').click();
    await expect(host.page.getByTestId('start-lan')).toBeEnabled();
    await host.page.getByTestId('start-lan').click();
    await waitForGame(host.page);
    await waitForGame(guest.page);

    // Both browsers drive their own player until several turns have passed.
    const pages = [host.page, guest.page];
    let rounds = 0;
    for (let k = 0; k < 400 && rounds < 6; k++) {
      let acted = false;
      for (const p of pages) {
        const s = await info(p);
        if (s.busy || s.phase === 'GAME_OVER') continue;
        const a = s.legal.mustAct || s.legal.canEndTurn ? pickAction(s) : null;
        if (a) {
          await act(p, a);
          acted = true;
          await p.waitForFunction((rev) => (window as unknown as { __pe: { state: () => { revision: number } } }).__pe.state().revision > rev, s.revision, { timeout: 10_000 }).catch(() => undefined);
        }
      }
      const s = await info(host.page);
      rounds = s.turn / 3;
      if (!acted) await host.page.waitForTimeout(100);
    }
    expect(rounds).toBeGreaterThanOrEqual(2);

    // Both clients converge on the same authoritative state.
    await expect
      .poll(async () => {
        const [a, b] = await Promise.all([waitIdle(host.page), waitIdle(guest.page)]);
        return a.revision === b.revision ? 'same' : `${a.revision}/${b.revision}`;
      }, { timeout: 20_000 })
      .toBe('same');
    const [a, b] = await Promise.all([info(host.page), info(guest.page)]);
    expect(b.players).toEqual(a.players);
    expect(a.me).not.toBe(b.me);
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
  });

  test('a guest who reloads rejoins the same seat', async ({ browser }) => {
    const host = await newPlayer(browser);
    const guest = await newPlayer(browser);
    const code = await hostRoom(host.page);
    await guest.page.goto(`/?room=${code}&e2e=1`);
    await guest.page.getByTestId('join-name').fill('Rejoiner');
    await guest.page.getByTestId('join-room').click();
    await guest.page.getByTestId('ready-toggle').click();
    await host.page.getByTestId('start-lan').click();
    await waitForGame(guest.page);
    const before = await info(guest.page);

    await guest.page.goto('/?e2e=1');
    await guest.page.getByTestId('menu-continue').click();
    await guest.page.getByTestId('rejoin-lan').click();
    await waitForGame(guest.page);
    const after = await info(guest.page);
    expect(after.me).toBe(before.me);
    expect(after.players.map((p) => p.name)).toContain('Rejoiner');
    await expect(host.page.locator(`[data-player="${before.me}"]`)).not.toContainText('Offline');
  });

  test('wrong codes are reported and cross-origin pages cannot open a socket', async ({ page, baseURL }) => {
    await page.goto('/?e2e=1');
    await page.getByTestId('menu-join-lan').click();
    await page.getByTestId('join-code').fill('QQQQQ');
    await page.getByTestId('join-room').click();
    await expect(page.getByTestId('conn-status')).toContainText('Room not found');

    // A page served from another origin tries to talk to the LAN server.
    await page.route('http://evil.example.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body>evil</body></html>' }));
    await page.goto('http://evil.example.test/');
    const wsUrl = (baseURL ?? '').replace(/^http/, 'ws') + '/ws';
    const opened = await page.evaluate(
      (url) =>
        new Promise<boolean>((resolve) => {
          const ws = new WebSocket(url);
          ws.onopen = () => resolve(true);
          ws.onerror = () => resolve(false);
          ws.onclose = () => resolve(false);
          setTimeout(() => resolve(false), 5000);
        }),
      wsUrl
    );
    expect(opened).toBe(false);
  });
});
