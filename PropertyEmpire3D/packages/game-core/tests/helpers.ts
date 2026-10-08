import {
  applyAction,
  createGame,
  defaultContext,
  nextInt,
  PLAYER_COLORS,
  TOKENS,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerSetup,
  type RulesConfig
} from '../src/index';
import { checkInvariants } from '../src/invariants';
import { expect } from 'vitest';

export const ctx = defaultContext();

export function humans(n: number): PlayerSetup[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    kind: 'human' as const,
    token: TOKENS[i] as PlayerSetup['token'],
    color: PLAYER_COLORS[i] as string
  }));
}

/** New game whose first player is p1 (seat 0). */
export function newGame(n = 2, config: Partial<RulesConfig> = {}): GameState {
  for (let seed = 1; seed < 10000; seed++) {
    const { state } = createGame({ players: humans(n), seed, config }, ctx);
    if (state.turn.playerId === 'p1') return state;
  }
  throw new Error('no seed found');
}

const diceSeedCache = new Map<string, number>();
/** Make the next roll produce the given dice. */
export function forceDice(state: GameState, d1: number, d2: number): void {
  const key = `${d1},${d2}`;
  let seed = diceSeedCache.get(key);
  if (seed === undefined) {
    for (let s = 0; s < 1_000_000; s++) {
      const h = { rngState: s };
      if (nextInt(h, 1, 6) === d1 && nextInt(h, 1, 6) === d2) {
        seed = s;
        break;
      }
    }
    if (seed === undefined) throw new Error('dice seed not found');
    diceSeedCache.set(key, seed);
  }
  state.rngState = seed;
}

/** Apply an action that must succeed; checks invariants and returns new state + events. */
export function act(state: GameState, playerId: string, action: Action): { state: GameState; events: GameEvent[] } {
  const r = applyAction(state, playerId, action, ctx);
  if (!r.ok) throw new Error(`Action ${action.type} by ${playerId} failed: ${r.error}`);
  const errors = checkInvariants(r.state, ctx, state, r.events);
  expect(errors).toEqual([]);
  return { state: r.state, events: r.events };
}

export function reject(state: GameState, playerId: string, action: Action): string {
  const r = applyAction(state, playerId, action, ctx);
  if (r.ok) throw new Error(`Action ${action.type} by ${playerId} unexpectedly succeeded`);
  return r.error;
}

export function player(state: GameState, id: string) {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new Error('no player ' + id);
  return p;
}

/** Give a player a set of spaces (test setup only). */
export function own(state: GameState, playerId: string, spaces: number[], houses = 0): void {
  for (const s of spaces) {
    const prop = state.properties[s];
    if (!prop) throw new Error(`space ${s} not ownable`);
    prop.owner = playerId;
    prop.houses = houses;
    if (houses === 5) state.bank.hotels--;
    else state.bank.houses -= houses;
  }
}

/** Roll with forced dice for the current player. */
export function roll(state: GameState, d1: number, d2: number): { state: GameState; events: GameEvent[] } {
  const s = structuredClone(state);
  forceDice(s, d1, d2);
  return act(s, s.turn.playerId, { type: 'ROLL' });
}

export function moneyFor(events: GameEvent[], playerId: string): number {
  let total = 0;
  for (const e of events) {
    if (e.type !== 'MONEY') continue;
    if (e.to === playerId) total += e.amount;
    if (e.from === playerId) total -= e.amount;
  }
  return total;
}
