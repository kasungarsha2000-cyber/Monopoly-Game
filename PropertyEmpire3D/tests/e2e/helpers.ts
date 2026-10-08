import { expect, type Page } from '@playwright/test';

export interface PeInfo {
  phase: string;
  current: string;
  me: string;
  busy: boolean;
  turn: number;
  revision: number;
  legal: {
    mustAct: boolean;
    canRoll: boolean;
    canEndTurn: boolean;
    canBuy: boolean;
    canDecline: boolean;
    canPassBid: boolean;
    canPayDebt: boolean;
    canDeclareBankruptcy: boolean;
    canRespondTrade: boolean;
    canPayJailFine: boolean;
    buildable: number[];
    bid: { min: number; max: number } | null;
  };
  players: { id: string; name: string; cash: number; position: number; bankrupt: boolean }[];
}

/** Collect uncaught errors and console errors for the whole test. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

export async function info(page: Page): Promise<PeInfo> {
  return page.evaluate(() => {
    const pe = (window as unknown as { __pe: Record<string, () => unknown> & { me: string } }).__pe;
    const s = pe.display() as {
      phase: string;
      revision: number;
      turn: { playerId: string; number: number };
      players: { id: string; name: string; cash: number; position: number; bankrupt: boolean }[];
    };
    return {
      phase: s.phase,
      current: s.turn.playerId,
      me: pe.me,
      busy: pe.busy() as boolean,
      turn: s.turn.number,
      revision: s.revision,
      legal: pe.legal() as PeInfo['legal'],
      players: s.players.map((p) => ({ id: p.id, name: p.name, cash: p.cash, position: p.position, bankrupt: p.bankrupt }))
    };
  });
}

export async function waitForGame(page: Page): Promise<void> {
  await expect(page.getByTestId('game-hud')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as { __pe?: unknown }).__pe);
}

export async function waitIdle(page: Page): Promise<PeInfo> {
  await page.waitForFunction(() => !(window as unknown as { __pe: { busy: () => boolean } }).__pe.busy());
  return info(page);
}

/** Wait until the local player must act (or the game ends). */
export async function waitForMyMove(page: Page, timeout = 60_000): Promise<PeInfo> {
  await page.waitForFunction(
    () => {
      const pe = (window as unknown as { __pe: { busy: () => boolean; legal: () => { mustAct: boolean; canEndTurn: boolean }; display: () => { phase: string } } }).__pe;
      if (pe.busy()) return false;
      const l = pe.legal();
      return l.mustAct || l.canEndTurn || pe.display().phase === 'GAME_OVER';
    },
    undefined,
    { timeout }
  );
  return info(page);
}

/** Choose a sensible legal action for the local player (simple human-like policy). */
export function pickAction(i: PeInfo): Record<string, unknown> | null {
  const l = i.legal;
  if (l.canRoll) return { type: 'ROLL' };
  if (l.canBuy) return { type: 'BUY' };
  if (l.canDecline) return { type: 'DECLINE' };
  if (l.canPassBid) return { type: 'PASS_BID' };
  if (l.canPayDebt) return { type: 'PAY_DEBT' };
  if (l.canRespondTrade) return { type: 'REJECT_TRADE' };
  if (l.buildable.length) return { type: 'BUILD', space: l.buildable[0] };
  if (l.canEndTurn) return { type: 'END_TURN' };
  if (l.canDeclareBankruptcy) return { type: 'DECLARE_BANKRUPTCY' };
  return null;
}

export async function act(page: Page, action: Record<string, unknown>): Promise<void> {
  await page.evaluate((a) => (window as unknown as { __pe: { act: (x: unknown) => void } }).__pe.act(a), action);
}

/** Play up to `n` of the local player's actions, letting bots play in between. */
export async function autoPlay(page: Page, n: number): Promise<PeInfo> {
  let last = await info(page);
  for (let k = 0; k < n; k++) {
    last = await waitForMyMove(page);
    if (last.phase === 'GAME_OVER') return last;
    const a = pickAction(last);
    if (!a) break;
    const before = last.revision;
    await act(page, a);
    await page.waitForFunction(
      (rev) => (window as unknown as { __pe: { display: () => { revision: number } } }).__pe.display().revision > rev,
      before,
      { timeout: 15_000 }
    );
  }
  return info(page);
}
