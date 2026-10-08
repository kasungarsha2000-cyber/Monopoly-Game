/**
 * Movement, space resolution and card effects (TurnManager movement half and
 * CardManager). Everything here runs inside the authoritative engine.
 */
import type { DeckId, GameEvent, GameState, RulesContext } from '../types';
import { BOARD_SIZE, deckName, findCard, getSpace, isOwnable, jailIndex } from '../board';
import {
  addLog,
  bankPays,
  charge,
  computeRent,
  countBuildings,
  formatMoney,
  getPlayer,
  playerName,
  stats
} from './helpers';

export interface LandingOptions {
  rentMultiplier?: number;
  diceMultiplier?: number;
}

/** Guard against pathological card chains (e.g. a custom deck that keeps moving players). */
const MAX_RESOLVE_DEPTH = 6;

export function sendToJail(state: GameState, ctx: RulesContext, playerId: string, reason: string, events: GameEvent[]): void {
  const p = getPlayer(state, playerId);
  const from = p.position;
  const jail = jailIndex(ctx);
  p.position = jail;
  p.inJail = true;
  p.jailTurns = 0;
  events.push({ type: 'MOVED', playerId, from, to: jail, steps: 0, passedGo: false, direct: true });
  events.push({ type: 'SENT_TO_JAIL', playerId, reason });
  stats(state, playerId).timesJailed++;
  if (state.turn.playerId === playerId) {
    state.turn.extraRoll = false;
    state.turn.doublesCount = 0;
  }
  addLog(state, `${p.name} goes to Jail (${reason}).`);
}

/** Move a player by a number of steps (negative = backwards, never collects GO). */
export function moveBy(state: GameState, ctx: RulesContext, playerId: string, steps: number, events: GameEvent[]): void {
  const p = getPlayer(state, playerId);
  const from = p.position;
  const to = (((from + steps) % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
  const passedGo = steps > 0 && from + steps >= BOARD_SIZE;
  p.position = to;
  events.push({ type: 'MOVED', playerId, from, to, steps, passedGo, direct: false });
  if (passedGo) {
    bankPays(state, playerId, state.config.goSalary, 'Passed GO', events);
    stats(state, playerId).passedGo++;
    addLog(state, `${p.name} passes GO and collects ${formatMoney(state.config.goSalary)}.`);
  }
  addLog(state, `${p.name} moves to ${getSpace(ctx, to).name}.`);
}

/** Advance forward to a target space, collecting GO if it is passed. */
export function advanceTo(state: GameState, ctx: RulesContext, playerId: string, target: number, events: GameEvent[]): void {
  const p = getPlayer(state, playerId);
  let steps = (target - p.position + BOARD_SIZE) % BOARD_SIZE;
  if (steps === 0) steps = BOARD_SIZE;
  moveBy(state, ctx, playerId, steps, events);
}

/** Resolve whatever happens on the space the player currently occupies. */
export function resolveSpace(
  state: GameState,
  ctx: RulesContext,
  playerId: string,
  events: GameEvent[],
  opts: LandingOptions = {},
  depth = 0
): void {
  if (depth > MAX_RESOLVE_DEPTH) return;
  const p = getPlayer(state, playerId);
  if (p.bankrupt) return;
  const space = getSpace(ctx, p.position);

  if (isOwnable(space)) {
    const prop = state.properties[space.index];
    if (!prop) return;
    if (!prop.owner) {
      state.pendingPurchase = space.index;
      events.push({ type: 'PROPERTY_OFFERED', playerId, space: space.index });
      return;
    }
    if (prop.owner === playerId) return;
    if (prop.mortgaged) {
      addLog(state, `${space.name} is mortgaged, so no rent is due.`);
      return;
    }
    const dice = state.turn.dice;
    const diceTotal = dice ? dice[0] + dice[1] : 0;
    const rent = computeRent(state, ctx, space.index, diceTotal, opts);
    if (rent > 0) {
      const ownerId = prop.owner;
      events.push({ type: 'RENT_PAID', from: playerId, to: ownerId, space: space.index, amount: rent });
      stats(state, playerId).rentPaid += rent;
      stats(state, ownerId).rentCollected += rent;
      addLog(state, `${p.name} owes ${formatMoney(rent)} rent to ${playerName(state, ownerId)} for ${space.name}.`);
      charge(state, playerId, ownerId, rent, `Rent for ${space.name}`, events);
    }
    return;
  }

  switch (space.type) {
    case 'tax': {
      const amount = space.amount ?? 0;
      events.push({ type: 'TAX_PAID', playerId, space: space.index, amount });
      addLog(state, `${p.name} pays ${formatMoney(amount)} ${space.name}.`);
      charge(state, playerId, null, amount, space.name, events, true);
      return;
    }
    case 'chance':
    case 'community':
      drawCard(state, ctx, playerId, space.type, events, depth);
      return;
    case 'go_to_jail':
      sendToJail(state, ctx, playerId, 'Go To Jail space', events);
      return;
    case 'free_parking': {
      if (state.config.freeParkingJackpot && state.freeParkingPot > 0) {
        const amount = state.freeParkingPot;
        state.freeParkingPot = 0;
        bankPays(state, playerId, amount, 'Free Parking jackpot', events);
        events.push({ type: 'JACKPOT', playerId, amount });
        addLog(state, `${p.name} wins the ${formatMoney(amount)} Free Parking jackpot!`);
      }
      return;
    }
    default:
      return;
  }
}

/** Find the next space of a type moving forward from a position. */
export function nearestForward(ctx: RulesContext, from: number, type: 'transport' | 'utility'): number {
  for (let step = 1; step <= BOARD_SIZE; step++) {
    const i = (from + step) % BOARD_SIZE;
    if (getSpace(ctx, i).type === type) return i;
  }
  return from;
}

/** Draw the top card of a deck and apply it exactly once. */
export function drawCard(state: GameState, ctx: RulesContext, playerId: string, deck: DeckId, events: GameEvent[], depth = 0): void {
  const pile = state.decks[deck];
  const cardId = pile.shift();
  if (!cardId) return;
  const found = findCard(ctx, cardId);
  if (!found) return;
  const card = found.card;
  const p = getPlayer(state, playerId);
  if (card.effect.kind === 'jail_free') {
    p.jailCards.push(deck);
  } else {
    pile.push(cardId);
  }
  state.lastCard = { deck, cardId, playerId, turn: state.turn.number };
  events.push({ type: 'CARD_DRAWN', playerId, deck, cardId });
  addLog(state, `${p.name} draws ${deckName(deck)}: "${card.text}"`);

  const effect = card.effect;
  switch (effect.kind) {
    case 'advance':
      advanceTo(state, ctx, playerId, effect.to, events);
      resolveSpace(state, ctx, playerId, events, {}, depth + 1);
      break;
    case 'advance_nearest': {
      const target = nearestForward(ctx, p.position, effect.target);
      advanceTo(state, ctx, playerId, target, events);
      const opts: LandingOptions = {};
      if (effect.rentMultiplier) opts.rentMultiplier = effect.rentMultiplier;
      if (effect.diceMultiplier) opts.diceMultiplier = effect.diceMultiplier;
      resolveSpace(state, ctx, playerId, events, opts, depth + 1);
      break;
    }
    case 'move':
      moveBy(state, ctx, playerId, effect.steps, events);
      resolveSpace(state, ctx, playerId, events, {}, depth + 1);
      break;
    case 'go_to_jail':
      sendToJail(state, ctx, playerId, card.title, events);
      break;
    case 'collect':
      bankPays(state, playerId, effect.amount, card.title, events);
      break;
    case 'pay':
      charge(state, playerId, null, effect.amount, card.title, events, true);
      break;
    case 'collect_each':
      for (const other of state.players) {
        if (other.id === playerId || other.bankrupt) continue;
        charge(state, other.id, playerId, effect.amount, card.title, events);
      }
      break;
    case 'pay_each':
      for (const other of state.players) {
        if (other.id === playerId || other.bankrupt) continue;
        charge(state, playerId, other.id, effect.amount, card.title, events);
      }
      break;
    case 'repairs': {
      const { houses, hotels } = countBuildings(state, playerId);
      const total = houses * effect.perHouse + hotels * effect.perHotel;
      if (total > 0) charge(state, playerId, null, total, card.title, events, true);
      else addLog(state, `${p.name} has no buildings to repair.`);
      break;
    }
    case 'jail_free':
      break;
  }
}
