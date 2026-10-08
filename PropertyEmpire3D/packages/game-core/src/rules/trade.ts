/**
 * TradeManager: validation and atomic execution of trades. Trades may carry
 * cash, properties and Get Out of Jail Free cards. Buildings never change
 * hands (the group must be undeveloped) and nobody may end up with negative
 * cash, including the interest due on received mortgaged property.
 */
import type { GameEvent, GameState, RulesContext, TradeOffer } from '../types';
import { getSpace, isOwnable } from '../board';
import {
  addLog,
  findPlayer,
  formatMoney,
  getPlayer,
  groupHasBuildings,
  mortgageInterest,
  transfer
} from './helpers';

const MAX_CASH = 1_000_000_000;

function isCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

function spacesValid(state: GameState, ctx: RulesContext, ownerId: string, spaces: number[]): string | null {
  if (!Array.isArray(spaces) || spaces.length > ctx.board.spaces.length) return 'Invalid property list';
  const seen = new Set<number>();
  for (const s of spaces) {
    if (!Number.isInteger(s) || s < 0 || s >= ctx.board.spaces.length) return 'Invalid property';
    if (seen.has(s)) return 'Duplicate property in trade';
    seen.add(s);
    const def = getSpace(ctx, s);
    if (!isOwnable(def)) return `${def.name} cannot be traded`;
    const prop = state.properties[s];
    if (!prop || prop.owner !== ownerId) return `${getPlayer(state, ownerId).name} does not own ${def.name}`;
    if (def.type === 'street' && def.group && groupHasBuildings(state, ctx, def.group)) {
      return `Sell the buildings in ${def.name}'s group before trading it`;
    }
  }
  return null;
}

function interestDue(state: GameState, ctx: RulesContext, spaces: number[]): number {
  let total = 0;
  for (const s of spaces) {
    if (state.properties[s]?.mortgaged) total += mortgageInterest(state, getSpace(ctx, s));
  }
  return total;
}

/** Validate a trade offer against the current state. Returns an error or null. */
export function validateTradeOffer(state: GameState, ctx: RulesContext, offer: TradeOffer): string | null {
  const from = findPlayer(state, offer.fromId);
  const to = findPlayer(state, offer.toId);
  if (!from || !to) return 'Unknown trade partner';
  if (from.id === to.id) return 'You cannot trade with yourself';
  if (from.bankrupt || to.bankrupt) return 'Bankrupt players cannot trade';
  for (const n of [offer.offerCash, offer.requestCash, offer.offerJailCards, offer.requestJailCards]) {
    if (!isCount(n) || n > MAX_CASH) return 'Trade amounts must be whole non-negative numbers';
  }
  if (offer.offerCash > 0 && offer.requestCash > 0) return 'Only one side of a trade can include cash';
  if (offer.offerCash > from.cash) return `${from.name} does not have ${formatMoney(offer.offerCash)}`;
  if (offer.requestCash > to.cash) return `${to.name} does not have ${formatMoney(offer.requestCash)}`;
  if (offer.offerJailCards > from.jailCards.length) return `${from.name} does not hold that many jail cards`;
  if (offer.requestJailCards > to.jailCards.length) return `${to.name} does not hold that many jail cards`;
  const e1 = spacesValid(state, ctx, from.id, offer.offerSpaces);
  if (e1) return e1;
  const e2 = spacesValid(state, ctx, to.id, offer.requestSpaces);
  if (e2) return e2;
  const empty =
    offer.offerCash === 0 &&
    offer.requestCash === 0 &&
    offer.offerSpaces.length === 0 &&
    offer.requestSpaces.length === 0 &&
    offer.offerJailCards === 0 &&
    offer.requestJailCards === 0;
  if (empty) return 'A trade must include something';
  const fromAfter = from.cash - offer.offerCash + offer.requestCash - interestDue(state, ctx, offer.requestSpaces);
  const toAfter = to.cash - offer.requestCash + offer.offerCash - interestDue(state, ctx, offer.offerSpaces);
  if (fromAfter < 0) return `${from.name} could not afford the mortgage interest on this trade`;
  if (toAfter < 0) return `${to.name} could not afford the mortgage interest on this trade`;
  return null;
}

/** Perform a validated trade atomically. */
export function executeTrade(state: GameState, ctx: RulesContext, offer: TradeOffer, events: GameEvent[]): void {
  const from = getPlayer(state, offer.fromId);
  const to = getPlayer(state, offer.toId);
  if (offer.offerCash > 0) transfer(state, from.id, to.id, offer.offerCash, 'Trade', events);
  if (offer.requestCash > 0) transfer(state, to.id, from.id, offer.requestCash, 'Trade', events);
  const move = (spaces: number[], giver: string, receiver: string) => {
    for (const s of spaces) {
      const prop = state.properties[s];
      if (!prop) continue;
      prop.owner = receiver;
      events.push({ type: 'PROPERTY_TRANSFERRED', space: s, from: giver, to: receiver });
    }
  };
  move(offer.offerSpaces, from.id, to.id);
  move(offer.requestSpaces, to.id, from.id);
  for (let i = 0; i < offer.offerJailCards; i++) {
    const card = from.jailCards.shift();
    if (card) to.jailCards.push(card);
  }
  for (let i = 0; i < offer.requestJailCards; i++) {
    const card = to.jailCards.shift();
    if (card) from.jailCards.push(card);
  }
  // Interest is due immediately on mortgaged property that changes hands.
  const interestFrom = interestDue(state, ctx, offer.requestSpaces);
  const interestTo = interestDue(state, ctx, offer.offerSpaces);
  if (interestFrom > 0) transfer(state, from.id, null, interestFrom, 'Mortgage interest on traded property', events);
  if (interestTo > 0) transfer(state, to.id, null, interestTo, 'Mortgage interest on traded property', events);
  addLog(state, `${from.name} and ${to.name} complete a trade.`);
}

export function describeTrade(state: GameState, ctx: RulesContext, offer: TradeOffer): { gives: string[]; gets: string[] } {
  const gives: string[] = [];
  const gets: string[] = [];
  if (offer.offerCash) gives.push(formatMoney(offer.offerCash));
  for (const s of offer.offerSpaces) gives.push(getSpace(ctx, s).name);
  if (offer.offerJailCards) gives.push(`${offer.offerJailCards} jail card(s)`);
  if (offer.requestCash) gets.push(formatMoney(offer.requestCash));
  for (const s of offer.requestSpaces) gets.push(getSpace(ctx, s).name);
  if (offer.requestJailCards) gets.push(`${offer.requestJailCards} jail card(s)`);
  void state;
  return { gives, gets };
}
