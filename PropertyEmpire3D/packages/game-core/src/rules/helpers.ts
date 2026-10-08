/**
 * Shared low-level helpers used by the rule modules: player lookup, money
 * movement, ownership queries and logging. All mutating helpers operate on a
 * draft state that the engine cloned before applying an action.
 */
import type { GameEvent, GameState, Player, RulesContext, SpaceDef, PlayerStats } from '../types';
import { getSpace, groupSpaces, isOwnable } from '../board';

export const MAX_LOG = 120;

export function getPlayer(state: GameState, id: string): Player {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`Unknown player ${id}`);
  return p;
}

export function findPlayer(state: GameState, id: string | null | undefined): Player | undefined {
  if (!id) return undefined;
  return state.players.find((pl) => pl.id === id);
}

export function activePlayers(state: GameState): Player[] {
  return state.players.filter((p) => !p.bankrupt);
}

export function currentPlayer(state: GameState): Player {
  return getPlayer(state, state.turn.playerId);
}

export function emptyStats(): PlayerStats {
  return {
    rentCollected: 0,
    rentPaid: 0,
    propertiesBought: 0,
    auctionsWon: 0,
    turnsPlayed: 0,
    timesJailed: 0,
    passedGo: 0,
    bankruptOnTurn: null
  };
}

export function stats(state: GameState, id: string): PlayerStats {
  let s = state.stats[id];
  if (!s) {
    s = emptyStats();
    state.stats[id] = s;
  }
  return s;
}

export function addLog(state: GameState, text: string): void {
  state.log.push({ turn: state.turn.number, text });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

export function formatMoney(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

export function playerName(state: GameState, id: string | null): string {
  if (id === null) return 'the Bank';
  return findPlayer(state, id)?.name ?? 'Unknown';
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/** Pay money from the Bank to a player. */
export function bankPays(state: GameState, toId: string, amount: number, reason: string, events: GameEvent[]): void {
  if (amount <= 0) return;
  const p = getPlayer(state, toId);
  p.cash += amount;
  events.push({ type: 'MONEY', from: 'bank', to: toId, amount, reason });
}

/**
 * Move money that the payer is known to have. Callers must check cash first;
 * this never lets a balance go negative.
 */
export function transfer(
  state: GameState,
  fromId: string,
  toId: string | null,
  amount: number,
  reason: string,
  events: GameEvent[],
  toPot = false
): void {
  if (amount <= 0) return;
  const from = getPlayer(state, fromId);
  if (from.cash < amount) throw new Error(`transfer: ${from.name} cannot afford ${amount}`);
  from.cash -= amount;
  if (toId) {
    getPlayer(state, toId).cash += amount;
    events.push({ type: 'MONEY', from: fromId, to: toId, amount, reason });
  } else {
    if (toPot && state.config.freeParkingJackpot) state.freeParkingPot += amount;
    events.push({ type: 'MONEY', from: fromId, to: 'bank', amount, reason });
  }
}

/**
 * Charge a player. If they cannot pay right now (or already have an unpaid
 * debt, preserving order) a Debt is queued and the game enters debt
 * resolution. Returns true when paid immediately.
 */
export function charge(
  state: GameState,
  debtorId: string,
  creditorId: string | null,
  amount: number,
  reason: string,
  events: GameEvent[],
  toPot = false
): boolean {
  if (amount <= 0) return true;
  const debtor = getPlayer(state, debtorId);
  if (debtor.bankrupt) return true;
  const alreadyInDebt = state.debts.some((d) => d.debtorId === debtorId);
  if (!alreadyInDebt && debtor.cash >= amount) {
    transfer(state, debtorId, creditorId, amount, reason, events, toPot);
    return true;
  }
  state.debts.push({ debtorId, creditorId, amount, reason });
  events.push({ type: 'DEBT_CREATED', debtorId, creditorId, amount, reason });
  addLog(state, `${debtor.name} owes ${formatMoney(amount)} to ${playerName(state, creditorId)} (${reason}) and must raise funds.`);
  return false;
}

/* ------------------------------------------------------------------ */
/* Ownership                                                           */
/* ------------------------------------------------------------------ */

export function ownedSpaces(state: GameState, playerId: string): number[] {
  const out: number[] = [];
  state.properties.forEach((p, i) => {
    if (p && p.owner === playerId) out.push(i);
  });
  return out;
}

export function ownsWholeGroup(state: GameState, ctx: RulesContext, playerId: string, group: string): boolean {
  const spaces = groupSpaces(ctx, group);
  return spaces.length > 0 && spaces.every((i) => state.properties[i]?.owner === playerId);
}

export function groupHasBuildings(state: GameState, ctx: RulesContext, group: string): boolean {
  return groupSpaces(ctx, group).some((i) => (state.properties[i]?.houses ?? 0) > 0);
}

export function groupHasMortgage(state: GameState, ctx: RulesContext, group: string): boolean {
  return groupSpaces(ctx, group).some((i) => state.properties[i]?.mortgaged === true);
}

export function countOwnedInGroup(state: GameState, ctx: RulesContext, playerId: string, group: string): number {
  return groupSpaces(ctx, group).filter((i) => state.properties[i]?.owner === playerId).length;
}

/** Interest-inclusive cost to lift a mortgage, using integer math. */
export function unmortgageCost(state: GameState, space: SpaceDef): number {
  const m = space.mortgage ?? 0;
  return m + mortgageInterest(state, space);
}

/** Interest charged on a mortgaged property (also due when one changes hands). */
export function mortgageInterest(state: GameState, space: SpaceDef): number {
  const m = space.mortgage ?? 0;
  return Math.ceil((m * state.config.mortgageInterestPercent) / 100);
}

/** Bank buyback price for one building level on a street. */
export function buildingSaleValue(space: SpaceDef): number {
  return Math.floor((space.houseCost ?? 0) / 2);
}

/**
 * Rent owed for landing on a space (0 if unowned, mortgaged or self-owned
 * is handled by the caller). diceTotal is needed for utilities.
 */
export function computeRent(
  state: GameState,
  ctx: RulesContext,
  spaceIndex: number,
  diceTotal: number,
  opts: { rentMultiplier?: number; diceMultiplier?: number } = {}
): number {
  const space = getSpace(ctx, spaceIndex);
  const prop = state.properties[spaceIndex];
  if (!prop || !prop.owner || prop.mortgaged || !isOwnable(space)) return 0;
  const owner = prop.owner;
  const rent = space.rent ?? [];
  let amount = 0;
  if (space.type === 'street') {
    if (prop.houses > 0) {
      amount = rent[prop.houses] ?? 0;
    } else {
      amount = rent[0] ?? 0;
      if (space.group && ownsWholeGroup(state, ctx, owner, space.group)) amount *= 2;
    }
  } else if (space.type === 'transport') {
    const n = countOwnedInGroup(state, ctx, owner, space.group ?? '');
    amount = rent[Math.max(0, n - 1)] ?? 0;
  } else if (space.type === 'utility') {
    const n = countOwnedInGroup(state, ctx, owner, space.group ?? '');
    const mult = opts.diceMultiplier ?? rent[Math.max(0, n - 1)] ?? 0;
    amount = mult * diceTotal;
  }
  if (opts.rentMultiplier) amount *= opts.rentMultiplier;
  return amount;
}

/** Cash plus asset value: unmortgaged property at price, mortgaged at price minus mortgage, buildings at cost. */
export function netWorth(state: GameState, ctx: RulesContext, playerId: string): number {
  const p = findPlayer(state, playerId);
  if (!p || p.bankrupt) return 0;
  let total = p.cash;
  for (const i of ownedSpaces(state, playerId)) {
    const space = getSpace(ctx, i);
    const prop = state.properties[i];
    if (!prop) continue;
    total += prop.mortgaged ? (space.price ?? 0) - (space.mortgage ?? 0) : space.price ?? 0;
    total += prop.houses * (space.houseCost ?? 0);
  }
  return total;
}

/** Total cash this player could raise by selling all buildings and mortgaging everything. */
export function liquidationValue(state: GameState, ctx: RulesContext, playerId: string): number {
  const p = getPlayer(state, playerId);
  let total = p.cash;
  for (const i of ownedSpaces(state, playerId)) {
    const space = getSpace(ctx, i);
    const prop = state.properties[i];
    if (!prop) continue;
    total += prop.houses * buildingSaleValue(space);
    if (!prop.mortgaged) total += space.mortgage ?? 0;
  }
  return total;
}

export function countBuildings(state: GameState, playerId: string): { houses: number; hotels: number } {
  let houses = 0;
  let hotels = 0;
  for (const prop of state.properties) {
    if (!prop || prop.owner !== playerId) continue;
    if (prop.houses === 5) hotels++;
    else houses += prop.houses;
  }
  return { houses, hotels };
}
