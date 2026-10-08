/**
 * BankruptcyManager: debt payment, bankruptcy, asset transfer and winner
 * detection.
 */
import type { DeckId, GameEvent, GameState, RulesContext } from '../types';
import { getSpace } from '../board';
import {
  activePlayers,
  addLog,
  bankPays,
  buildingSaleValue,
  charge,
  findPlayer,
  formatMoney,
  getPlayer,
  mortgageInterest,
  netWorth,
  ownedSpaces,
  playerName,
  stats,
  transfer
} from './helpers';

function resolveCreditor(state: GameState, creditorId: string | null): string | null {
  if (!creditorId) return null;
  const c = findPlayer(state, creditorId);
  return c && !c.bankrupt ? c.id : null;
}

export function payDebt(state: GameState, ctx: RulesContext, debtorId: string, events: GameEvent[]): void {
  const debt = state.debts[0];
  if (!debt || debt.debtorId !== debtorId) return;
  const creditorId = resolveCreditor(state, debt.creditorId);
  transfer(state, debtorId, creditorId, debt.amount, debt.reason, events, creditorId === null);
  state.debts.shift();
  events.push({ type: 'DEBT_PAID', debtorId, creditorId, amount: debt.amount });
  addLog(state, `${getPlayer(state, debtorId).name} pays ${formatMoney(debt.amount)} to ${playerName(state, creditorId)}.`);
  void ctx;
}

function jailCardIdFor(ctx: RulesContext, deck: DeckId): string | null {
  return ctx.cards[deck].find((c) => c.effect.kind === 'jail_free')?.id ?? null;
}

/**
 * Declare the debtor at the head of the debt queue bankrupt. Buildings are
 * sold to the Bank; cash, property and jail cards go to the creditor player,
 * or back to the Bank (property is then auctioned) when the Bank is owed.
 */
export function declareBankruptcy(state: GameState, ctx: RulesContext, debtorId: string, events: GameEvent[]): void {
  const debt = state.debts.find((d) => d.debtorId === debtorId);
  const creditorId = resolveCreditor(state, debt?.creditorId ?? null);
  const p = getPlayer(state, debtorId);

  // 1. Buildings go back to the Bank at half price.
  for (const i of ownedSpaces(state, debtorId)) {
    const prop = state.properties[i];
    if (!prop || prop.houses === 0) continue;
    const value = prop.houses * buildingSaleValue(getSpace(ctx, i));
    if (prop.houses === 5) state.bank.hotels++;
    else state.bank.houses += prop.houses;
    prop.houses = 0;
    events.push({ type: 'BUILDING_SOLD', playerId: debtorId, space: i, houses: 0 });
    bankPays(state, debtorId, value, 'Buildings sold in bankruptcy', events);
  }

  // 2. Remaining cash.
  if (p.cash > 0) transfer(state, debtorId, creditorId, p.cash, 'Bankruptcy settlement', events);

  // 3. Property.
  const interestOwed: number[] = [];
  for (const i of ownedSpaces(state, debtorId)) {
    const prop = state.properties[i];
    if (!prop) continue;
    if (creditorId) {
      prop.owner = creditorId;
      if (prop.mortgaged) interestOwed.push(i);
      events.push({ type: 'PROPERTY_TRANSFERRED', space: i, from: debtorId, to: creditorId });
    } else {
      prop.owner = null;
      prop.mortgaged = false;
      events.push({ type: 'PROPERTY_TRANSFERRED', space: i, from: debtorId, to: null });
      if (state.config.auctions && state.config.bankruptcyAuctions) state.auctionQueue.push(i);
    }
  }

  // 4. Jail cards.
  for (const deck of p.jailCards) {
    if (creditorId) getPlayer(state, creditorId).jailCards.push(deck);
    else {
      const id = jailCardIdFor(ctx, deck);
      if (id) state.decks[deck].push(id);
    }
  }
  p.jailCards = [];

  p.bankrupt = true;
  p.cash = 0;
  p.inJail = false;
  p.jailTurns = 0;
  stats(state, debtorId).bankruptOnTurn = state.turn.number;
  state.debts = state.debts.filter((d) => d.debtorId !== debtorId);
  if (state.trade && (state.trade.fromId === debtorId || state.trade.toId === debtorId)) {
    events.push({ type: 'TRADE_CANCELLED', tradeId: state.trade.id, fromId: state.trade.fromId, toId: state.trade.toId });
    state.trade = null;
  }
  if (state.auction) {
    state.auction.bidders = state.auction.bidders.filter((id) => id !== debtorId);
    if (state.auction.turn >= state.auction.bidders.length) state.auction.turn = 0;
  }
  events.push({ type: 'BANKRUPT', playerId: debtorId, creditorId });
  addLog(state, `${p.name} is bankrupt! Assets go to ${playerName(state, creditorId)}.`);

  // 5. The creditor owes interest on mortgaged property received.
  if (creditorId) {
    for (const i of interestOwed) {
      charge(state, creditorId, null, mortgageInterest(state, getSpace(ctx, i)), `Mortgage interest on ${getSpace(ctx, i).name}`, events);
    }
  }

  checkWinner(state, ctx, events);
}

/** End the game if at most one solvent player remains. */
export function checkWinner(state: GameState, ctx: RulesContext, events: GameEvent[]): boolean {
  if (state.phase === 'GAME_OVER') return true;
  const active = activePlayers(state);
  if (active.length > 1) return false;
  finishGame(state, ctx, active[0]?.id ?? null, 'Last solvent player standing', events);
  return true;
}

/** Ranking by elimination order and net worth (best first). */
export function rankPlayers(state: GameState, ctx: RulesContext): string[] {
  return [...state.players]
    .sort((a, b) => {
      if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
      if (a.bankrupt && b.bankrupt) {
        return (stats(state, b.id).bankruptOnTurn ?? 0) - (stats(state, a.id).bankruptOnTurn ?? 0);
      }
      return netWorth(state, ctx, b.id) - netWorth(state, ctx, a.id);
    })
    .map((p) => p.id);
}

export function finishGame(state: GameState, ctx: RulesContext, winnerId: string | null, reason: string, events: GameEvent[]): void {
  state.phase = 'GAME_OVER';
  state.winnerId = winnerId;
  state.endReason = reason;
  state.pendingPurchase = null;
  state.auction = null;
  state.auctionQueue = [];
  state.debts = [];
  state.trade = null;
  events.push({ type: 'GAME_OVER', winnerId, reason });
  addLog(state, winnerId ? `${playerName(state, winnerId)} wins! (${reason})` : `Game over (${reason}).`);
  void ctx;
}
