/**
 * AuctionManager: round-robin auctions that work identically for local play,
 * bots and the network. Players take turns to raise or pass; passing removes
 * them. The last remaining bidder holding the high bid wins.
 */
import type { GameEvent, GameState, RulesContext } from '../types';
import { getSpace } from '../board';
import { addLog, formatMoney, getPlayer, stats, transfer } from './helpers';

/** Seat-ordered active players starting from (and including) a given player. */
export function seatOrderFrom(state: GameState, startId: string): string[] {
  const n = state.players.length;
  let start = state.players.findIndex((p) => p.id === startId);
  if (start < 0) start = 0;
  const out: string[] = [];
  for (let k = 0; k < n; k++) {
    const p = state.players[(start + k) % n];
    if (p && !p.bankrupt) out.push(p.id);
  }
  return out;
}

export function auctionMinBid(state: GameState): number {
  const a = state.auction;
  if (!a) return 0;
  return a.highestBidderId ? a.highestBid + 1 : 1;
}

/** The player whose bid decision is pending, or null. */
export function currentBidder(state: GameState): string | null {
  const a = state.auction;
  if (!a || a.bidders.length === 0) return null;
  return a.bidders[a.turn] ?? null;
}

export function startAuction(state: GameState, ctx: RulesContext, space: number, starterId: string, events: GameEvent[]): void {
  const bidders = seatOrderFrom(state, starterId);
  state.auction = { space, highestBid: 0, highestBidderId: null, bidders, turn: 0 };
  events.push({ type: 'AUCTION_STARTED', space, bidders: [...bidders] });
  addLog(state, `${getSpace(ctx, space).name} goes up for auction.`);
  normalizeAuction(state, ctx, events);
}

/** Remove bidders who cannot afford the next bid and finish the auction when it is decided. */
export function normalizeAuction(state: GameState, ctx: RulesContext, events: GameEvent[]): void {
  for (let guard = 0; guard < 64; guard++) {
    const a = state.auction;
    if (!a) return;
    if (a.bidders.length === 0) {
      finishAuction(state, ctx, events);
      return;
    }
    if (a.turn >= a.bidders.length) a.turn = 0;
    if (a.bidders.length === 1 && a.highestBidderId === a.bidders[0]) {
      finishAuction(state, ctx, events);
      return;
    }
    const id = a.bidders[a.turn] as string;
    if (id === a.highestBidderId) {
      a.turn = (a.turn + 1) % a.bidders.length;
      continue;
    }
    const p = getPlayer(state, id);
    if (p.bankrupt || p.cash < auctionMinBid(state)) {
      a.bidders.splice(a.turn, 1);
      events.push({ type: 'BID_PASSED', playerId: id, space: a.space });
      continue;
    }
    return;
  }
}

export function placeBid(state: GameState, ctx: RulesContext, playerId: string, amount: number, events: GameEvent[]): void {
  const a = state.auction;
  if (!a) return;
  a.highestBid = amount;
  a.highestBidderId = playerId;
  a.turn = (a.turn + 1) % a.bidders.length;
  events.push({ type: 'BID_PLACED', playerId, space: a.space, amount });
  addLog(state, `${getPlayer(state, playerId).name} bids ${formatMoney(amount)}.`);
  normalizeAuction(state, ctx, events);
}

export function passBid(state: GameState, ctx: RulesContext, playerId: string, events: GameEvent[]): void {
  const a = state.auction;
  if (!a) return;
  const idx = a.bidders.indexOf(playerId);
  if (idx >= 0) {
    a.bidders.splice(idx, 1);
    if (idx < a.turn) a.turn--;
  }
  if (a.bidders.length > 0) a.turn = a.turn % a.bidders.length;
  events.push({ type: 'BID_PASSED', playerId, space: a.space });
  addLog(state, `${getPlayer(state, playerId).name} passes.`);
  normalizeAuction(state, ctx, events);
}

function finishAuction(state: GameState, ctx: RulesContext, events: GameEvent[]): void {
  const a = state.auction;
  if (!a) return;
  state.auction = null;
  const space = getSpace(ctx, a.space);
  const prop = state.properties[a.space];
  if (a.highestBidderId && prop && !prop.owner) {
    const winner = getPlayer(state, a.highestBidderId);
    transfer(state, winner.id, null, a.highestBid, `Auction: ${space.name}`, events);
    prop.owner = winner.id;
    stats(state, winner.id).auctionsWon++;
    stats(state, winner.id).propertiesBought++;
    events.push({ type: 'AUCTION_WON', playerId: winner.id, space: a.space, amount: a.highestBid });
    events.push({ type: 'PROPERTY_TRANSFERRED', space: a.space, from: null, to: winner.id });
    addLog(state, `${winner.name} wins ${space.name} at auction for ${formatMoney(a.highestBid)}.`);
  } else {
    events.push({ type: 'AUCTION_UNSOLD', space: a.space });
    addLog(state, `Nobody bid. ${space.name} stays with the Bank.`);
  }
}
