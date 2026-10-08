/**
 * BotStrategy: rule-based, weighted-heuristic decision making for offline
 * bots. Bots only ever *choose* an Action; the engine validates and applies
 * it exactly like a human command, so bots cannot mutate state directly.
 */
import type { Action, Difficulty, GameState, RulesContext, TradeOffer } from '../types';
import { getSpace, groupSpaces, isOwnable } from '../board';
import { getLegalActions, type LegalActions } from '../legal';
import { auctionMinBid } from '../rules/auction';
import { validateTradeOffer } from '../rules/trade';
import {
  computeRent,
  countOwnedInGroup,
  findPlayer,
  getPlayer,
  liquidationValue,
  ownedSpaces,
  ownsWholeGroup,
  unmortgageCost
} from '../rules/helpers';

export interface BotDecision {
  action: Action;
  reason: string;
}

/** Cross-turn memory kept by the bot driver (not part of the game state). */
export interface BotMemory {
  /** key `${botId}>${targetId}:${space}` -> turn number of the last proposal. */
  proposals: Record<string, number>;
}

export function createBotMemory(): BotMemory {
  return { proposals: {} };
}

interface Profile {
  baseReserve: number;
  mistake: number;
  auctionFactor: number;
  completionBonus: number;
  acceptMargin: number;
  initiateChance: number;
  usesGroupWeights: boolean;
  /** How much the bot values completing its own color group (x group price). */
  selfGroupPower: number;
  /** How much the bot fears an opponent completing a group (x group price). */
  otherGroupPower: number;
  /** Multiplier on the reserve kept when building. */
  buildReserveFactor: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: {
    baseReserve: 50,
    mistake: 0.2,
    auctionFactor: 0.8,
    completionBonus: 1.0,
    acceptMargin: -30,
    initiateChance: 0.1,
    usesGroupWeights: false,
    selfGroupPower: 0.8,
    otherGroupPower: 0.35,
    buildReserveFactor: 1
  },
  medium: {
    baseReserve: 80,
    mistake: 0.05,
    auctionFactor: 1.0,
    completionBonus: 1.5,
    acceptMargin: 25,
    initiateChance: 0.4,
    usesGroupWeights: false,
    selfGroupPower: 1.3,
    otherGroupPower: 1.0,
    buildReserveFactor: 0.8
  },
  hard: {
    baseReserve: 60,
    mistake: 0,
    auctionFactor: 1.15,
    completionBonus: 2.0,
    acceptMargin: 40,
    initiateChance: 0.6,
    usesGroupWeights: true,
    selfGroupPower: 1.5,
    otherGroupPower: 1.15,
    buildReserveFactor: 1
  }
};

/** Rough relative landing frequency / return by group, used by hard bots. */
const GROUP_WEIGHT: Record<string, number> = {
  brown: 0.85,
  sky: 0.95,
  pink: 1.0,
  orange: 1.18,
  red: 1.12,
  yellow: 1.05,
  green: 1.0,
  navy: 0.95,
  transport: 1.0,
  utility: 0.8
};

function profileOf(state: GameState, botId: string): { p: Profile; d: Difficulty } {
  const d = getPlayer(state, botId).difficulty ?? 'medium';
  return { p: PROFILES[d], d };
}

/** Largest rent an opponent could currently charge the bot (assuming a roll of 7). */
export function threatLevel(state: GameState, ctx: RulesContext, botId: string): number {
  let max = 0;
  state.properties.forEach((prop, i) => {
    if (!prop || !prop.owner || prop.owner === botId || prop.mortgaged) return;
    max = Math.max(max, computeRent(state, ctx, i, 7));
  });
  return max;
}

function unownedCount(state: GameState): number {
  return state.properties.filter((p) => p && !p.owner).length;
}

/** Probability of each two-dice total (index = total). */
const DICE_P = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((n) => n / 36);

/**
 * Rent risk for the bot's next roll: expected rent over the 2-12 spaces ahead
 * plus a share of the worst case in reach. Far better than "largest rent on
 * the board", which made cautious bots stop building and lose.
 */
export function rollRisk(state: GameState, ctx: RulesContext, botId: string): { expected: number; worst: number } {
  const pos = getPlayer(state, botId).position;
  let expected = 0;
  let worst = 0;
  for (let k = 2; k <= 12; k++) {
    const i = (pos + k) % ctx.board.spaces.length;
    const prop = state.properties[i];
    let rent = 0;
    if (prop?.owner && prop.owner !== botId && !prop.mortgaged) rent = computeRent(state, ctx, i, k);
    const def = getSpace(ctx, i);
    if (def.type === 'tax') rent = def.amount ?? 0;
    expected += (DICE_P[k] ?? 0) * rent;
    worst = Math.max(worst, rent);
  }
  return { expected, worst };
}

/** Cash a bot tries to keep in hand. */
export function cashReserve(state: GameState, ctx: RulesContext, botId: string): number {
  const { p, d } = profileOf(state, botId);
  if (d === 'easy') return p.baseReserve;
  const early = unownedCount(state) > 12;
  if (d === 'medium') {
    if (early) return 75;
    return Math.min(200, Math.max(p.baseReserve, Math.round(threatLevel(state, ctx, botId) * 0.15)));
  }
  if (early) return 40;
  const risk = rollRisk(state, ctx, botId);
  return Math.min(250, Math.max(p.baseReserve, Math.round(risk.expected * 1.5 + risk.worst * 0.15)));
}

/** Value to the bot of acquiring a space (in dollars). */
export function gainValue(state: GameState, ctx: RulesContext, botId: string, space: number): number {
  const { p, d } = profileOf(state, botId);
  const def = getSpace(ctx, space);
  const price = def.price ?? 0;
  let v = price;
  const group = def.group ?? '';
  const members = groupSpaces(ctx, group);
  const mine = members.filter((i) => i !== space && state.properties[i]?.owner === botId).length;
  if (def.type === 'street') {
    const others = members.filter((i) => i !== space && state.properties[i]?.owner && state.properties[i]?.owner !== botId);
    if (mine === members.length - 1) v += price * p.completionBonus;
    else if (others.length === 0 && mine > 0) v += price * 0.3 * mine;
    if (d !== 'easy' && others.length === members.length - 1) {
      const owners = new Set(others.map((i) => state.properties[i]?.owner));
      if (owners.size === 1) v += price * 0.5; // block an opponent's group
    }
  } else if (def.type === 'transport') {
    v += 35 * mine;
  } else if (def.type === 'utility') {
    v = price * 0.75 + (mine > 0 ? 40 : 0);
  }
  if (p.usesGroupWeights) v *= GROUP_WEIGHT[group] ?? 1;
  if (state.properties[space]?.mortgaged) v -= (def.mortgage ?? 0) * 0.55;
  return Math.round(v);
}

/** Value lost by the bot when giving a space to another player. */
export function loseValue(state: GameState, ctx: RulesContext, botId: string, space: number, toId: string): number {
  const { d } = profileOf(state, botId);
  const def = getSpace(ctx, space);
  const price = def.price ?? 0;
  let v = price;
  const group = def.group ?? '';
  if (def.type === 'street' && ownsWholeGroup(state, ctx, botId, group)) v += price * 1.5;
  if (def.type === 'transport') v += 35 * (countOwnedInGroup(state, ctx, botId, group) - 1);
  const members = groupSpaces(ctx, group);
  const receiverHasRest = members.every((i) => i === space || state.properties[i]?.owner === toId);
  if (def.type === 'street' && receiverHasRest) v += price * (d === 'hard' ? 2.5 : d === 'medium' ? 2 : 0.5);
  if (state.properties[space]?.mortgaged) v -= (def.mortgage ?? 0) * 0.55;
  return Math.round(v);
}

/** Plain value of a space ignoring group completion (used by trade valuation). */
function baseValue(state: GameState, ctx: RulesContext, space: number): number {
  const def = getSpace(ctx, space);
  let v = def.type === 'utility' ? (def.price ?? 0) * 0.75 : def.price ?? 0;
  if (state.properties[space]?.mortgaged) v -= (def.mortgage ?? 0) * 0.55;
  return v;
}

function groupPrice(ctx: RulesContext, group: string): number {
  return groupSpaces(ctx, group).reduce((sum, i) => sum + (getSpace(ctx, i).price ?? 0), 0);
}

/** Street groups a player would newly complete if ownership changed as described. */
function groupsCompleted(state: GameState, ctx: RulesContext, playerId: string, gains: number[], losses: number[]): string[] {
  const out: string[] = [];
  const groups = new Set(gains.map((s) => getSpace(ctx, s).group ?? ''));
  for (const g of groups) {
    const members = groupSpaces(ctx, g);
    if (getSpace(ctx, members[0] as number).type !== 'street') continue;
    const before = members.every((i) => state.properties[i]?.owner === playerId);
    const after = members.every((i) => !losses.includes(i) && (gains.includes(i) || state.properties[i]?.owner === playerId));
    if (!before && after) out.push(g);
  }
  return out;
}

/** Street groups a player fully owns that a trade would break up. */
function groupsBroken(state: GameState, ctx: RulesContext, playerId: string, losses: number[]): string[] {
  const out = new Set<string>();
  for (const s of losses) {
    const def = getSpace(ctx, s);
    if (def.type === 'street' && def.group && ownsWholeGroup(state, ctx, playerId, def.group)) out.add(def.group);
  }
  return [...out];
}

/**
 * Value of a trade from one participant's point of view, using a profile.
 * Completing your own group is valued at selfGroupPower x group price; the
 * partner completing a group costs otherGroupPower x group price. The
 * asymmetry (optimism about your own groups) is what lets two bots agree on a
 * mutual group-completing swap instead of stalling forever.
 */
export function tradeValueFor(
  state: GameState,
  ctx: RulesContext,
  viewerId: string,
  offer: TradeOffer,
  profile?: Difficulty
): number {
  const d = profile ?? getPlayer(state, viewerId).difficulty ?? 'medium';
  const p = PROFILES[d];
  const viewerIsFrom = offer.fromId === viewerId;
  const partnerId = viewerIsFrom ? offer.toId : offer.fromId;
  const gets = viewerIsFrom ? offer.requestSpaces : offer.offerSpaces;
  const gives = viewerIsFrom ? offer.offerSpaces : offer.requestSpaces;
  const cashIn = viewerIsFrom ? offer.requestCash : offer.offerCash;
  const cashOut = viewerIsFrom ? offer.offerCash : offer.requestCash;
  const jailIn = viewerIsFrom ? offer.requestJailCards : offer.offerJailCards;
  const jailOut = viewerIsFrom ? offer.offerJailCards : offer.requestJailCards;
  const weight = (g: string) => (p.usesGroupWeights ? GROUP_WEIGHT[g] ?? 1 : 1);
  let v = cashIn - cashOut + 50 * (jailIn - jailOut);
  for (const s of gets) v += baseValue(state, ctx, s);
  for (const s of gives) v -= baseValue(state, ctx, s);
  for (const g of groupsCompleted(state, ctx, viewerId, gets, gives)) v += groupPrice(ctx, g) * p.selfGroupPower * weight(g);
  for (const g of groupsCompleted(state, ctx, partnerId, gives, gets)) v -= groupPrice(ctx, g) * p.otherGroupPower * weight(g);
  for (const g of groupsBroken(state, ctx, viewerId, gives)) v -= groupPrice(ctx, g) * p.selfGroupPower * weight(g);
  return Math.round(v);
}

/** Net value of a trade for the bot when the bot is the receiver (toId). */
export function evaluateIncomingTrade(state: GameState, ctx: RulesContext, botId: string, offer: TradeOffer): number {
  return tradeValueFor(state, ctx, botId, offer);
}

function streetGroupOf(ctx: RulesContext, space: number): string | null {
  const def = getSpace(ctx, space);
  return def.type === 'street' && def.group ? def.group : null;
}

/* ------------------------------------------------------------------ */
/* Phase decisions                                                     */
/* ------------------------------------------------------------------ */

function decidePurchase(state: GameState, ctx: RulesContext, botId: string, legal: LegalActions, rand: () => number): BotDecision {
  const { p, d } = profileOf(state, botId);
  const space = state.pendingPurchase as number;
  const def = getSpace(ctx, space);
  const price = def.price ?? 0;
  const me = getPlayer(state, botId);
  const reserve = cashReserve(state, ctx, botId);
  const value = gainValue(state, ctx, botId, space);
  const group = def.group ?? '';
  const members = groupSpaces(ctx, group);
  const completes = members.every((i) => i === space || state.properties[i]?.owner === botId);

  if (!legal.canBuy) {
    // Hard/medium bots raise funds for a group-completing purchase.
    if (d !== 'easy' && (completes || value > price * 1.6)) {
      const candidates = legal.mortgageable
        .filter((i) => {
          const g = streetGroupOf(ctx, i);
          return !g || !ownsWholeGroup(state, ctx, botId, g);
        })
        .sort((a, b) => gainValue(state, ctx, botId, a) - gainValue(state, ctx, botId, b));
      const raisable = candidates.reduce((sum, i) => sum + (getSpace(ctx, i).mortgage ?? 0), 0);
      if (candidates.length > 0 && me.cash + raisable >= price) {
        return { action: { type: 'MORTGAGE', space: candidates[0] as number }, reason: `raise funds to buy ${def.name}` };
      }
    }
    return { action: { type: 'DECLINE' }, reason: `cannot afford ${def.name}` };
  }

  let want: boolean;
  if (d === 'easy') {
    want = me.cash - price >= p.baseReserve && rand() < 0.85;
  } else {
    const blocks = value > price * 1.3;
    want = me.cash - price >= reserve || completes || (blocks && me.cash - price >= reserve * 0.4);
    if (d === 'medium' && def.type === 'utility' && me.cash - price < reserve * 2) want = false;
  }
  if (rand() < p.mistake) want = !want;
  return want
    ? { action: { type: 'BUY' }, reason: `buy ${def.name} (value ${value}, reserve ${reserve})` }
    : { action: { type: 'DECLINE' }, reason: `decline ${def.name} (value ${value}, reserve ${reserve})` };
}

function decideBid(state: GameState, ctx: RulesContext, botId: string, legal: LegalActions, rand: () => number): BotDecision {
  const a = state.auction;
  if (!a || !legal.bid) return { action: { type: 'PASS_BID' }, reason: 'cannot bid' };
  const { p, d } = profileOf(state, botId);
  const def = getSpace(ctx, a.space);
  const price = def.price ?? 0;
  const me = getPlayer(state, botId);
  const reserveShare = d === 'easy' ? 1 : d === 'medium' ? 0.7 : 0.6;
  const cap = me.cash - Math.round(cashReserve(state, ctx, botId) * reserveShare);
  const maxBid = Math.floor(Math.min(cap, gainValue(state, ctx, botId, a.space) * p.auctionFactor));
  const min = auctionMinBid(state);
  if (min > maxBid || (d === 'easy' && rand() < p.mistake)) {
    return { action: { type: 'PASS_BID' }, reason: `max bid ${maxBid} below ${min}` };
  }
  const step = Math.max(1, Math.round((price * 0.05) / 5) * 5);
  const opening = a.highestBidderId ? min : Math.max(min, Math.round(price * 0.4));
  const amount = Math.max(min, Math.min(maxBid, a.highestBidderId ? min + step - 1 : opening));
  return { action: { type: 'BID', amount }, reason: `bid ${amount} (max ${maxBid})` };
}

function decideJail(state: GameState, ctx: RulesContext, botId: string, legal: LegalActions, rand: () => number): BotDecision {
  const { d } = profileOf(state, botId);
  const me = getPlayer(state, botId);
  const early = unownedCount(state) >= 8;
  const reserve = cashReserve(state, ctx, botId);
  if (d === 'easy') {
    if (legal.canUseJailCard && rand() < 0.5) return { action: { type: 'USE_JAIL_CARD' }, reason: 'easy: use card' };
    if (legal.canPayJailFine && rand() < 0.5) return { action: { type: 'PAY_JAIL_FINE' }, reason: 'easy: pay fine' };
    return { action: { type: 'ROLL' }, reason: 'easy: try doubles' };
  }
  if (early) {
    if (legal.canUseJailCard) return { action: { type: 'USE_JAIL_CARD' }, reason: 'early game: get out to buy property' };
    if (legal.canPayJailFine && me.cash - state.config.jailFine >= reserve) {
      return { action: { type: 'PAY_JAIL_FINE' }, reason: 'early game: pay to get out' };
    }
  }
  return { action: { type: 'ROLL' }, reason: early ? 'save cash, try doubles' : 'late game: stay safe in Jail' };
}

function decideDebt(state: GameState, ctx: RulesContext, botId: string, legal: LegalActions): BotDecision {
  const debt = state.debts[0];
  const me = getPlayer(state, botId);
  if (!debt) return { action: { type: 'PAY_DEBT' }, reason: 'no debt' };
  if (legal.canPayDebt) return { action: { type: 'PAY_DEBT' }, reason: `pay ${debt.amount}` };
  if (liquidationValue(state, ctx, botId) < debt.amount) {
    return { action: { type: 'DECLARE_BANKRUPTCY' }, reason: `cannot raise ${debt.amount} (has ${me.cash})` };
  }
  const byValue = (a: number, b: number) => gainValue(state, ctx, botId, a) - gainValue(state, ctx, botId, b);
  const looseMortgage = legal.mortgageable
    .filter((i) => {
      const g = streetGroupOf(ctx, i);
      return !g || !ownsWholeGroup(state, ctx, botId, g);
    })
    .sort(byValue);
  if (looseMortgage.length) return { action: { type: 'MORTGAGE', space: looseMortgage[0] as number }, reason: 'mortgage spare property' };
  if (legal.sellable.length) {
    const target = [...legal.sellable].sort((a, b) => (getSpace(ctx, a).houseCost ?? 0) - (getSpace(ctx, b).houseCost ?? 0))[0] as number;
    return { action: { type: 'SELL_BUILDING', space: target }, reason: 'sell a building' };
  }
  if (legal.sellGroup.length) return { action: { type: 'SELL_GROUP_BUILDINGS', space: legal.sellGroup[0] as number }, reason: 'sell group buildings' };
  if (legal.mortgageable.length) {
    return { action: { type: 'MORTGAGE', space: [...legal.mortgageable].sort(byValue)[0] as number }, reason: 'mortgage group property' };
  }
  return { action: { type: 'DECLARE_BANKRUPTCY' }, reason: 'no assets left' };
}

function decideTradeResponse(state: GameState, ctx: RulesContext, botId: string, rand: () => number): BotDecision {
  const t = state.trade;
  if (!t) return { action: { type: 'REJECT_TRADE' }, reason: 'no trade' };
  const { p, d } = profileOf(state, botId);
  const value = tradeValueFor(state, ctx, botId, t);
  const me = getPlayer(state, botId);
  const cashAfter = me.cash - t.requestCash + t.offerCash;
  const reserve = cashReserve(state, ctx, botId);
  let accept = value >= p.acceptMargin && cashAfter >= Math.min(reserve, me.cash) * 0.5;
  if (d === 'easy') accept = value >= p.acceptMargin && rand() < 0.7;
  return accept
    ? { action: { type: 'ACCEPT_TRADE' }, reason: `accept trade (value ${value})` }
    : { action: { type: 'REJECT_TRADE' }, reason: `reject trade (value ${value})` };
}

function tradeable(state: GameState, ctx: RulesContext, space: number): boolean {
  const def = getSpace(ctx, space);
  if (!isOwnable(def)) return false;
  if (def.type === 'street' && def.group) return !groupSpaces(ctx, def.group).some((i) => (state.properties[i]?.houses ?? 0) > 0);
  return true;
}

/** Find a trade that completes one of the bot's color groups, priced so the partner should accept. */
function findTradeProposal(
  state: GameState,
  ctx: RulesContext,
  botId: string,
  memory: BotMemory,
  rand: () => number
): BotDecision | null {
  const { p } = profileOf(state, botId);
  if (rand() >= p.initiateChance) return null;
  const me = getPlayer(state, botId);
  const reserve = cashReserve(state, ctx, botId);
  const spendable = Math.max(0, me.cash - Math.round(reserve * 0.5));
  const myMargin = Math.max(10, p.acceptMargin);
  for (const g of ctx.board.groups) {
    const members = groupSpaces(ctx, g.id);
    if (getSpace(ctx, members[0] as number).type !== 'street') continue;
    const missing = members.filter((i) => state.properties[i]?.owner !== botId);
    if (missing.length !== 1) continue;
    const target = missing[0] as number;
    const ownerId = state.properties[target]?.owner;
    const owner = findPlayer(state, ownerId);
    if (!owner || owner.bankrupt || !tradeable(state, ctx, target)) continue;
    const key = `${botId}>${owner.id}:${target}`;
    const last = memory.proposals[key];
    if (last !== undefined && state.turn.number - last < 6 * state.players.length) continue;
    const partnerProfile: Difficulty = owner.kind === 'bot' ? owner.difficulty ?? 'medium' : 'medium';
    const partnerMargin = Math.max(10, PROFILES[partnerProfile].acceptMargin) + 10;
    const base: TradeOffer = {
      fromId: botId,
      toId: owner.id,
      offerCash: 0,
      requestCash: 0,
      offerSpaces: [],
      requestSpaces: [target],
      offerJailCards: 0,
      requestJailCards: 0
    };
    // Candidate sweeteners: nothing, or one of my spare tradeable properties
    // (preferring ones that complete the partner's group: a mutual swap).
    const spares = ownedSpaces(state, botId)
      .filter((i) => tradeable(state, ctx, i) && getSpace(ctx, i).group !== g.id)
      .filter((i) => {
        const sg = streetGroupOf(ctx, i);
        return !(sg && ownsWholeGroup(state, ctx, botId, sg));
      });
    const candidates: number[][] = [[], ...spares.map((s) => [s])];
    let best: { offer: TradeOffer; mine: number } | null = null;
    for (const give of candidates) {
      const offer: TradeOffer = { ...base, offerSpaces: give };
      const partnerValue = tradeValueFor(state, ctx, owner.id, offer, partnerProfile);
      if (partnerValue < partnerMargin) {
        const need = Math.ceil((partnerMargin - partnerValue) / 10) * 10;
        if (need > spendable) continue;
        offer.offerCash = need;
      } else {
        const surplus = Math.floor((partnerValue - partnerMargin) / 20) * 10;
        if (surplus > 0) offer.requestCash = Math.min(surplus, owner.cash);
      }
      const mine = tradeValueFor(state, ctx, botId, offer);
      if (mine < myMargin) continue;
      if (validateTradeOffer(state, ctx, offer)) continue;
      if (!best || mine > best.mine) best = { offer, mine };
    }
    if (best) {
      memory.proposals[key] = state.turn.number;
      return {
        action: { type: 'PROPOSE_TRADE', offer: best.offer },
        reason: `complete ${g.name} by trading for ${getSpace(ctx, target).name} (my value ${best.mine})`
      };
    }
  }
  return null;
}

function buildScore(state: GameState, ctx: RulesContext, d: Difficulty, p: Profile, i: number): number {
  const def = getSpace(ctx, i);
  const h = state.properties[i]?.houses ?? 0;
  const gain = (def.rent?.[h + 1] ?? 0) - (h === 0 ? (def.rent?.[0] ?? 0) * 2 : def.rent?.[h] ?? 0);
  const roi = gain / (def.houseCost ?? 1);
  const toThree = d === 'hard' && h < 3 ? 1.5 : 1;
  return roi * toThree * (p.usesGroupWeights ? GROUP_WEIGHT[def.group ?? ''] ?? 1 : 1);
}

function decideManagement(
  state: GameState,
  ctx: RulesContext,
  botId: string,
  legal: LegalActions,
  memory: BotMemory,
  rand: () => number
): BotDecision {
  const { p, d } = profileOf(state, botId);
  const me = getPlayer(state, botId);
  const reserve = cashReserve(state, ctx, botId);
  const busy = state.turn.actionCount > 60;

  if (!busy) {
    // 1. Build on completed groups.
    if (legal.buildable.length) {
      const buildReserve = d === 'easy' ? p.baseReserve : Math.round(reserve * p.buildReserveFactor);
      const options = legal.buildable.filter((i) => me.cash - (getSpace(ctx, i).houseCost ?? 0) >= buildReserve);
      if (options.length) {
        const pick =
          d === 'easy'
            ? (options[Math.floor(rand() * options.length)] as number)
            : ([...options].sort((a, b) => buildScore(state, ctx, d, p, b) - buildScore(state, ctx, d, p, a))[0] as number);
        return { action: { type: 'BUILD', space: pick }, reason: `build on ${getSpace(ctx, pick).name}` };
      }
      // 2. Medium/hard bots mortgage spare single properties to fund houses (up to 2/3 per street).
      if (d !== 'easy') {
        const target = d === 'hard' ? 3 : 2;
        const cheapest = Math.min(...legal.buildable.map((i) => getSpace(ctx, i).houseCost ?? 0));
        const underThree = legal.buildable.some((i) => (state.properties[i]?.houses ?? 0) < target);
        const spare = legal.mortgageable
          .filter((i) => {
            const g = getSpace(ctx, i).group ?? '';
            const def = getSpace(ctx, i);
            if (def.type === 'street' && ownsWholeGroup(state, ctx, botId, g)) return false;
            // Keep pieces of groups the bot is one away from completing.
            if (def.type === 'street') {
              const members = groupSpaces(ctx, g);
              if (members.filter((x) => state.properties[x]?.owner !== botId).length === 1) return false;
            }
            return true;
          })
          .sort((a, b) => gainValue(state, ctx, botId, a) - gainValue(state, ctx, botId, b));
        if (underThree && spare.length && me.cash + (getSpace(ctx, spare[0] as number).mortgage ?? 0) - cheapest >= buildReserve) {
          return { action: { type: 'MORTGAGE', space: spare[0] as number }, reason: 'mortgage a spare property to fund houses' };
        }
      }
    }

    // 3. Lift mortgages when there is nothing better to spend on.
    if (legal.buildable.length === 0) {
      const unm = [...legal.unmortgageable].sort((a, b) => {
        const ga = streetGroupOf(ctx, a);
        const gb = streetGroupOf(ctx, b);
        const fa = ga && ownsWholeGroup(state, ctx, botId, ga) ? 0 : 1;
        const fb = gb && ownsWholeGroup(state, ctx, botId, gb) ? 0 : 1;
        return fa - fb;
      });
      for (const i of unm) {
        if (me.cash - unmortgageCost(state, getSpace(ctx, i)) >= reserve * 1.5) {
          return { action: { type: 'UNMORTGAGE', space: i }, reason: `unmortgage ${getSpace(ctx, i).name}` };
        }
      }
    }

    // 4. Trade to complete a group.
    if (legal.canProposeTrade && (state.turn.tradeProposals[botId] ?? 0) === 0) {
      const proposal = findTradeProposal(state, ctx, botId, memory, rand);
      if (proposal) return proposal;
    }
  }

  if (legal.canRoll) return { action: { type: 'ROLL' }, reason: 'roll' };
  return { action: { type: 'END_TURN' }, reason: 'end turn' };
}

/**
 * Choose the next action for a bot, or null if the bot has nothing to do.
 * The returned action is intended to be legal; callers still validate it.
 */
export function chooseBotAction(
  state: GameState,
  ctx: RulesContext,
  botId: string,
  memory: BotMemory,
  rand: () => number
): BotDecision | null {
  const me = findPlayer(state, botId);
  if (!me || me.bankrupt || state.phase === 'GAME_OVER') return null;
  const legal = getLegalActions(state, botId, ctx);
  switch (state.phase) {
    case 'TRADE':
      if (state.trade?.toId === botId) return decideTradeResponse(state, ctx, botId, rand);
      return null;
    case 'DEBT_RESOLUTION':
      if (state.debts[0]?.debtorId === botId) return decideDebt(state, ctx, botId, legal);
      return null;
    case 'AUCTION':
      if (legal.canPassBid) return decideBid(state, ctx, botId, legal, rand);
      return null;
    case 'PROPERTY_DECISION':
      if (state.turn.playerId === botId) return decidePurchase(state, ctx, botId, legal, rand);
      return null;
    case 'JAIL_DECISION':
      if (state.turn.playerId !== botId) return null;
      return decideJail(state, ctx, botId, legal, rand);
    case 'AWAIT_ROLL':
    case 'TURN_END':
      if (state.turn.playerId !== botId) return null;
      return decideManagement(state, ctx, botId, legal, memory, rand);
    default:
      return null;
  }
}

/** Safe fallback actions, tried in order if a chosen action is rejected. */
export function fallbackActions(state: GameState, ctx: RulesContext, botId: string): Action[] {
  switch (state.phase) {
    case 'AWAIT_ROLL':
    case 'JAIL_DECISION':
      return [{ type: 'ROLL' }];
    case 'TURN_END':
      return [{ type: 'END_TURN' }];
    case 'PROPERTY_DECISION':
      return [{ type: 'DECLINE' }];
    case 'AUCTION':
      return [{ type: 'PASS_BID' }];
    case 'TRADE':
      return [{ type: 'REJECT_TRADE' }, { type: 'CANCEL_TRADE' }];
    case 'DEBT_RESOLUTION': {
      const legal = getLegalActions(state, botId, ctx);
      const out: Action[] = [{ type: 'PAY_DEBT' }];
      for (const s of legal.mortgageable) out.push({ type: 'MORTGAGE', space: s });
      for (const s of legal.sellGroup) out.push({ type: 'SELL_GROUP_BUILDINGS', space: s });
      out.push({ type: 'DECLARE_BANKRUPTCY' });
      return out;
    }
    default:
      return [];
  }
}
