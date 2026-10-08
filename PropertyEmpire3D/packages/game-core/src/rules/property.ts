/**
 * PropertyManager: purchases, buildings and mortgages. Each operation has a
 * validator returning an error message (or null) and an executor that assumes
 * validation passed.
 */
import type { GameEvent, GameState, RulesContext } from '../types';
import { getSpace, groupSpaces, isOwnable } from '../board';
import {
  addLog,
  bankPays,
  buildingSaleValue,
  formatMoney,
  getPlayer,
  groupHasBuildings,
  ownsWholeGroup,
  stats,
  transfer,
  unmortgageCost
} from './helpers';

function ownedSpaceCheck(state: GameState, ctx: RulesContext, playerId: string, space: number): string | null {
  if (!Number.isInteger(space) || space < 0 || space >= ctx.board.spaces.length) return 'Invalid space';
  const def = getSpace(ctx, space);
  if (!isOwnable(def)) return `${def.name} cannot be owned`;
  const prop = state.properties[space];
  if (!prop || prop.owner !== playerId) return `You do not own ${def.name}`;
  return null;
}

/* ---------------------------- purchase ---------------------------- */

export function validateBuy(state: GameState, ctx: RulesContext, playerId: string): string | null {
  const space = state.pendingPurchase;
  if (space === null) return 'Nothing to buy';
  const def = getSpace(ctx, space);
  const p = getPlayer(state, playerId);
  if (p.cash < (def.price ?? 0)) return `You need ${formatMoney(def.price ?? 0)} to buy ${def.name}`;
  return null;
}

export function executeBuy(state: GameState, ctx: RulesContext, playerId: string, events: GameEvent[]): void {
  const space = state.pendingPurchase as number;
  const def = getSpace(ctx, space);
  const prop = state.properties[space];
  if (!prop) return;
  transfer(state, playerId, null, def.price ?? 0, `Bought ${def.name}`, events);
  prop.owner = playerId;
  state.pendingPurchase = null;
  stats(state, playerId).propertiesBought++;
  events.push({ type: 'PROPERTY_BOUGHT', playerId, space, price: def.price ?? 0 });
  events.push({ type: 'PROPERTY_TRANSFERRED', space, from: null, to: playerId });
  addLog(state, `${getPlayer(state, playerId).name} buys ${def.name} for ${formatMoney(def.price ?? 0)}.`);
}

/* ---------------------------- buildings --------------------------- */

export function validateBuild(state: GameState, ctx: RulesContext, playerId: string, space: number): string | null {
  const err = ownedSpaceCheck(state, ctx, playerId, space);
  if (err) return err;
  const def = getSpace(ctx, space);
  const prop = state.properties[space];
  if (!prop) return 'Invalid space';
  if (def.type !== 'street' || !def.group) return `You cannot build on ${def.name}`;
  if (!ownsWholeGroup(state, ctx, playerId, def.group)) return 'You must own the whole color group to build';
  const group = groupSpaces(ctx, def.group);
  if (group.some((i) => state.properties[i]?.mortgaged)) return 'Unmortgage every property in the group first';
  if (prop.houses >= 5) return `${def.name} already has a hotel`;
  if (state.config.evenBuild) {
    const min = Math.min(...group.map((i) => state.properties[i]?.houses ?? 0));
    if (prop.houses > min) return 'Build evenly: develop the other streets in this group first';
  }
  if (prop.houses < 4 && state.bank.houses < 1) return 'The Bank has no houses left';
  if (prop.houses === 4) {
    if (group.some((i) => (state.properties[i]?.houses ?? 0) < 4)) return 'Every street in the group needs 4 houses before a hotel';
    if (state.bank.hotels < 1) return 'The Bank has no hotels left';
  }
  const cost = def.houseCost ?? 0;
  if (getPlayer(state, playerId).cash < cost) return `You need ${formatMoney(cost)} to build`;
  return null;
}

export function executeBuild(state: GameState, ctx: RulesContext, playerId: string, space: number, events: GameEvent[]): void {
  const def = getSpace(ctx, space);
  const prop = state.properties[space];
  if (!prop) return;
  transfer(state, playerId, null, def.houseCost ?? 0, `Building on ${def.name}`, events);
  if (prop.houses === 4) {
    state.bank.hotels--;
    state.bank.houses += 4;
    prop.houses = 5;
    addLog(state, `${getPlayer(state, playerId).name} builds a hotel on ${def.name}.`);
  } else {
    state.bank.houses--;
    prop.houses++;
    addLog(state, `${getPlayer(state, playerId).name} builds house ${prop.houses} on ${def.name}.`);
  }
  events.push({ type: 'BUILT', playerId, space, houses: prop.houses });
}

export function validateSellBuilding(state: GameState, ctx: RulesContext, playerId: string, space: number): string | null {
  const err = ownedSpaceCheck(state, ctx, playerId, space);
  if (err) return err;
  const def = getSpace(ctx, space);
  const prop = state.properties[space];
  if (!prop || prop.houses === 0 || !def.group) return `${def.name} has no buildings`;
  if (state.config.evenBuild) {
    const max = Math.max(...groupSpaces(ctx, def.group).map((i) => state.properties[i]?.houses ?? 0));
    if (prop.houses < max) return 'Sell evenly: sell from the most developed street first';
  }
  if (prop.houses === 5 && state.bank.houses < 4) return 'The Bank needs 4 houses to break down a hotel; sell the whole group instead';
  return null;
}

export function executeSellBuilding(state: GameState, ctx: RulesContext, playerId: string, space: number, events: GameEvent[]): void {
  const def = getSpace(ctx, space);
  const prop = state.properties[space];
  if (!prop) return;
  if (prop.houses === 5) {
    state.bank.hotels++;
    state.bank.houses -= 4;
    prop.houses = 4;
  } else {
    state.bank.houses++;
    prop.houses--;
  }
  const value = buildingSaleValue(def);
  bankPays(state, playerId, value, `Sold building on ${def.name}`, events);
  events.push({ type: 'BUILDING_SOLD', playerId, space, houses: prop.houses });
  addLog(state, `${getPlayer(state, playerId).name} sells a building on ${def.name} for ${formatMoney(value)}.`);
}

export function validateSellGroup(state: GameState, ctx: RulesContext, playerId: string, space: number): string | null {
  const err = ownedSpaceCheck(state, ctx, playerId, space);
  if (err) return err;
  const def = getSpace(ctx, space);
  if (!def.group || !groupHasBuildings(state, ctx, def.group)) return 'This group has no buildings';
  if (groupSpaces(ctx, def.group).some((i) => state.properties[i]?.owner !== playerId)) return 'You do not own this group';
  return null;
}

/** Sell every building in a color group at half price. Never needs spare Bank houses. */
export function executeSellGroup(state: GameState, ctx: RulesContext, playerId: string, space: number, events: GameEvent[]): void {
  const def = getSpace(ctx, space);
  let total = 0;
  for (const i of groupSpaces(ctx, def.group ?? '')) {
    const prop = state.properties[i];
    if (!prop || prop.houses === 0) continue;
    const sDef = getSpace(ctx, i);
    if (prop.houses === 5) state.bank.hotels++;
    else state.bank.houses += prop.houses;
    total += prop.houses * buildingSaleValue(sDef);
    prop.houses = 0;
    events.push({ type: 'BUILDING_SOLD', playerId, space: i, houses: 0 });
  }
  bankPays(state, playerId, total, 'Sold group buildings', events);
  addLog(state, `${getPlayer(state, playerId).name} sells all buildings in the group for ${formatMoney(total)}.`);
}

/* ---------------------------- mortgages --------------------------- */

export function validateMortgage(state: GameState, ctx: RulesContext, playerId: string, space: number): string | null {
  const err = ownedSpaceCheck(state, ctx, playerId, space);
  if (err) return err;
  const def = getSpace(ctx, space);
  const prop = state.properties[space];
  if (!prop) return 'Invalid space';
  if (prop.mortgaged) return `${def.name} is already mortgaged`;
  if (def.type === 'street' && def.group && groupHasBuildings(state, ctx, def.group)) return 'Sell all buildings in this group first';
  return null;
}

export function executeMortgage(state: GameState, ctx: RulesContext, playerId: string, space: number, events: GameEvent[]): void {
  const def = getSpace(ctx, space);
  const prop = state.properties[space];
  if (!prop) return;
  prop.mortgaged = true;
  bankPays(state, playerId, def.mortgage ?? 0, `Mortgaged ${def.name}`, events);
  events.push({ type: 'MORTGAGED', playerId, space });
  addLog(state, `${getPlayer(state, playerId).name} mortgages ${def.name} for ${formatMoney(def.mortgage ?? 0)}.`);
}

export function validateUnmortgage(state: GameState, ctx: RulesContext, playerId: string, space: number): string | null {
  const err = ownedSpaceCheck(state, ctx, playerId, space);
  if (err) return err;
  const def = getSpace(ctx, space);
  const prop = state.properties[space];
  if (!prop || !prop.mortgaged) return `${def.name} is not mortgaged`;
  const cost = unmortgageCost(state, def);
  if (getPlayer(state, playerId).cash < cost) return `You need ${formatMoney(cost)} to lift this mortgage`;
  return null;
}

export function executeUnmortgage(state: GameState, ctx: RulesContext, playerId: string, space: number, events: GameEvent[]): void {
  const def = getSpace(ctx, space);
  const prop = state.properties[space];
  if (!prop) return;
  const cost = unmortgageCost(state, def);
  transfer(state, playerId, null, cost, `Unmortgaged ${def.name}`, events);
  prop.mortgaged = false;
  events.push({ type: 'UNMORTGAGED', playerId, space });
  addLog(state, `${getPlayer(state, playerId).name} lifts the mortgage on ${def.name} for ${formatMoney(cost)}.`);
}
