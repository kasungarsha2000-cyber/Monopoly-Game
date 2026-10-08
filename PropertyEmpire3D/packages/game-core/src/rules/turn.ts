/**
 * TurnManager: dice, doubles, Jail, turn progression and the `settle` step
 * that derives the current phase from pending obligations. Deriving the phase
 * (instead of storing ad-hoc transitions) keeps every state reachable only
 * through legal, explicit transitions.
 */
import type { GameEvent, GameState, RulesContext } from '../types';
import { nextInt } from '../rng';
import { activePlayers, addLog, charge, currentPlayer, formatMoney, getPlayer, netWorth, stats, transfer } from './helpers';
import { moveBy, resolveSpace, sendToJail } from './movement';
import { startAuction } from './auction';
import { checkWinner, finishGame } from './bankruptcy';

export function rollDice(state: GameState): [number, number] {
  return [nextInt(state, 1, 6), nextInt(state, 1, 6)];
}

export function startTurn(state: GameState, playerId: string, events: GameEvent[]): void {
  state.turn = {
    playerId,
    number: state.turn.number + 1,
    rolled: false,
    extraRoll: false,
    doublesCount: 0,
    dice: null,
    actionCount: 0,
    tradeProposals: {}
  };
  state.lastCard = null;
  events.push({ type: 'TURN_STARTED', playerId, turn: state.turn.number, round: state.round });
  addLog(state, `Turn ${state.turn.number}: ${getPlayer(state, playerId).name}'s turn.`);
}

/** Next solvent player after the current one, and whether play passes the starting seat. */
export function nextPlayer(state: GameState): { id: string; newRound: boolean } {
  const n = state.players.length;
  const cur = state.players.findIndex((p) => p.id === state.turn.playerId);
  const rel = (i: number) => (i - state.startSeat + n) % n;
  for (let k = 1; k <= n; k++) {
    const idx = (cur + k) % n;
    const p = state.players[idx];
    if (p && !p.bankrupt) {
      return { id: p.id, newRound: rel(idx) <= rel(cur) };
    }
  }
  return { id: state.turn.playerId, newRound: false };
}

export function endTurn(state: GameState, ctx: RulesContext, events: GameEvent[]): void {
  const cur = state.turn.playerId;
  stats(state, cur).turnsPlayed++;
  events.push({ type: 'TURN_ENDED', playerId: cur });
  const next = nextPlayer(state);
  if (next.newRound) {
    state.round++;
    if (state.config.maxRounds > 0 && state.round > state.config.maxRounds) {
      const ranked = activePlayers(state).sort((a, b) => netWorth(state, ctx, b.id) - netWorth(state, ctx, a.id));
      finishGame(state, ctx, ranked[0]?.id ?? null, `Round limit reached; richest player wins`, events);
      return;
    }
  }
  startTurn(state, next.id, events);
}

export function executeRoll(state: GameState, ctx: RulesContext, playerId: string, events: GameEvent[]): void {
  const p = getPlayer(state, playerId);
  const dice = rollDice(state);
  const doubles = dice[0] === dice[1];
  const total = dice[0] + dice[1];
  state.turn.dice = dice;
  state.turn.rolled = true;
  events.push({ type: 'DICE_ROLLED', playerId, dice, doubles, inJail: p.inJail });
  addLog(state, `${p.name} rolls ${dice[0]} + ${dice[1]}${doubles ? ' (doubles!)' : ''}.`);

  if (p.inJail) {
    state.turn.extraRoll = false;
    if (doubles) {
      p.inJail = false;
      p.jailTurns = 0;
      events.push({ type: 'LEFT_JAIL', playerId, method: 'doubles' });
      addLog(state, `${p.name} rolls doubles and leaves Jail.`);
      moveBy(state, ctx, playerId, total, events);
      resolveSpace(state, ctx, playerId, events);
      return;
    }
    p.jailTurns++;
    events.push({ type: 'JAIL_ROLL_FAILED', playerId, attempt: p.jailTurns });
    if (p.jailTurns >= state.config.maxJailTurns) {
      p.inJail = false;
      p.jailTurns = 0;
      events.push({ type: 'LEFT_JAIL', playerId, method: 'forced_fine' });
      addLog(state, `${p.name} must pay the ${formatMoney(state.config.jailFine)} fine and moves on.`);
      charge(state, playerId, null, state.config.jailFine, 'Jail fine', events, true);
      moveBy(state, ctx, playerId, total, events);
      resolveSpace(state, ctx, playerId, events);
    } else {
      addLog(state, `${p.name} stays in Jail.`);
    }
    return;
  }

  if (doubles) {
    state.turn.doublesCount++;
    if (state.turn.doublesCount >= state.config.doublesToJail) {
      sendToJail(state, ctx, playerId, `${state.config.doublesToJail} doubles in a row`, events);
      return;
    }
  }
  state.turn.extraRoll = doubles;
  moveBy(state, ctx, playerId, total, events);
  resolveSpace(state, ctx, playerId, events);
}

export function executePayJailFine(state: GameState, playerId: string, events: GameEvent[]): void {
  const p = getPlayer(state, playerId);
  transfer(state, playerId, null, state.config.jailFine, 'Jail fine', events, true);
  p.inJail = false;
  p.jailTurns = 0;
  events.push({ type: 'LEFT_JAIL', playerId, method: 'fine' });
  addLog(state, `${p.name} pays ${formatMoney(state.config.jailFine)} to leave Jail.`);
}

export function executeUseJailCard(state: GameState, ctx: RulesContext, playerId: string, events: GameEvent[]): void {
  const p = getPlayer(state, playerId);
  const deck = p.jailCards.shift();
  if (!deck) return;
  const cardId = ctx.cards[deck].find((c) => c.effect.kind === 'jail_free')?.id;
  if (cardId) state.decks[deck].push(cardId);
  p.inJail = false;
  p.jailTurns = 0;
  events.push({ type: 'LEFT_JAIL', playerId, method: 'card' });
  addLog(state, `${p.name} uses a Get Out of Jail Free card.`);
}

/**
 * Derive the phase from pending obligations, starting queued auctions and
 * moving past bankrupt players. Must run after every accepted action.
 */
export function settle(state: GameState, ctx: RulesContext, events: GameEvent[]): void {
  for (let guard = 0; guard < 200; guard++) {
    if (state.phase === 'GAME_OVER') return;
    if (checkWinner(state, ctx, events)) return;
    if (state.trade) {
      state.phase = 'TRADE';
      return;
    }
    if (state.debts.length > 0) {
      state.phase = 'DEBT_RESOLUTION';
      return;
    }
    if (state.auction) {
      state.phase = 'AUCTION';
      return;
    }
    if (state.auctionQueue.length > 0) {
      const space = state.auctionQueue.shift() as number;
      const starter = currentPlayer(state).bankrupt ? nextPlayer(state).id : state.turn.playerId;
      startAuction(state, ctx, space, starter, events);
      continue;
    }
    if (state.pendingPurchase !== null) {
      state.phase = 'PROPERTY_DECISION';
      return;
    }
    const cur = currentPlayer(state);
    if (cur.bankrupt) {
      endTurn(state, ctx, events);
      continue;
    }
    if (cur.inJail && !state.turn.rolled) state.phase = 'JAIL_DECISION';
    else if (!state.turn.rolled || state.turn.extraRoll) state.phase = 'AWAIT_ROLL';
    else state.phase = 'TURN_END';
    return;
  }
  throw new Error('settle: did not converge');
}
