/**
 * Game-state invariants checked by tests and simulations: money is conserved
 * (every cash change is explained by a MONEY event), building stock is
 * conserved, no balance is negative and phases match pending obligations.
 */
import type { GameEvent, GameState, RulesContext } from './types';
import { getSpace } from './board';

export function checkInvariants(next: GameState, ctx: RulesContext, prev?: GameState, events?: GameEvent[]): string[] {
  const errors: string[] = [];
  const ids = new Set(next.players.map((p) => p.id));

  for (const p of next.players) {
    if (!Number.isInteger(p.cash)) errors.push(`${p.name} has non-integer cash`);
    if (p.cash < 0) errors.push(`${p.name} has negative cash ${p.cash}`);
    if (p.bankrupt && p.cash !== 0) errors.push(`Bankrupt ${p.name} still has cash`);
    if (p.position < 0 || p.position >= ctx.board.spaces.length) errors.push(`${p.name} off board`);
  }

  let houses = 0;
  let hotels = 0;
  next.properties.forEach((prop, i) => {
    if (!prop) return;
    if (prop.owner && !ids.has(prop.owner)) errors.push(`Space ${i} owned by unknown player`);
    if (prop.owner && next.players.find((p) => p.id === prop.owner)?.bankrupt) errors.push(`Space ${i} owned by bankrupt player`);
    if (prop.houses < 0 || prop.houses > 5) errors.push(`Space ${i} has ${prop.houses} buildings`);
    if (prop.houses > 0 && prop.mortgaged) errors.push(`Space ${i} is mortgaged with buildings`);
    if (prop.houses > 0 && getSpace(ctx, i).type !== 'street') errors.push(`Space ${i} cannot hold buildings`);
    if (prop.houses === 5) hotels++;
    else houses += prop.houses;
  });
  if (next.bank.houses < 0 || next.bank.hotels < 0) errors.push('Bank building supply is negative');
  if (houses + next.bank.houses !== next.config.bankHouses) errors.push(`House stock mismatch: ${houses} + ${next.bank.houses}`);
  if (hotels + next.bank.hotels !== next.config.bankHotels) errors.push(`Hotel stock mismatch: ${hotels} + ${next.bank.hotels}`);

  // Each jail card is either in its deck or held by exactly one player.
  for (const deck of ['chance', 'community'] as const) {
    const held = next.players.reduce((n, p) => n + p.jailCards.filter((d) => d === deck).length, 0);
    const total = next.decks[deck].length + held;
    if (total !== ctx.cards[deck].length) errors.push(`${deck} deck has ${total} cards, expected ${ctx.cards[deck].length}`);
  }

  // Phase consistency.
  if (next.phase !== 'GAME_OVER') {
    if (next.trade && next.phase !== 'TRADE') errors.push('Pending trade but phase is ' + next.phase);
    if (!next.trade && next.debts.length && next.phase !== 'DEBT_RESOLUTION') errors.push('Pending debt but phase is ' + next.phase);
    if (next.phase === 'AUCTION' && !next.auction) errors.push('AUCTION phase without auction');
    if (next.phase === 'PROPERTY_DECISION' && next.pendingPurchase === null) errors.push('PROPERTY_DECISION without property');
    const cur = next.players.find((p) => p.id === next.turn.playerId);
    if (!cur) errors.push('Current player is missing');
    // A bankrupt current player is only allowed while their assets are being
    // auctioned or a creditor settles interest, before play passes on.
    const turnPhases = ['AWAIT_ROLL', 'JAIL_DECISION', 'PROPERTY_DECISION', 'TURN_END'];
    if (cur?.bankrupt && turnPhases.includes(next.phase)) errors.push('Bankrupt player still holds the turn');
  } else if (next.players.filter((p) => !p.bankrupt).length > 1 && !next.endReason?.includes('Round limit')) {
    errors.push('Game over with multiple solvent players');
  }

  // Money conservation: cash deltas must equal MONEY events.
  if (prev && events) {
    const expected = new Map(prev.players.map((p) => [p.id, p.cash]));
    for (const e of events) {
      if (e.type !== 'MONEY') continue;
      if (e.amount <= 0) errors.push(`Non-positive MONEY event ${e.amount}`);
      if (e.from !== 'bank') expected.set(e.from, (expected.get(e.from) ?? 0) - e.amount);
      if (e.to !== 'bank') expected.set(e.to, (expected.get(e.to) ?? 0) + e.amount);
    }
    for (const p of next.players) {
      if (expected.get(p.id) !== p.cash) errors.push(`Cash for ${p.name} is ${p.cash}, events explain ${expected.get(p.id)}`);
    }
    if (next.revision !== prev.revision + 1) errors.push('Revision did not increment by one');
  }
  return errors;
}
