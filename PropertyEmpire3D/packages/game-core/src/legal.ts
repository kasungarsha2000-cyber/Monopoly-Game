/**
 * Legal action summary for a player. The UI uses it to enable only legal
 * controls and bots use it to pick from legal options. It is computed by
 * running the engine's own validators, so it can never disagree with them.
 */
import type { Action, GameState, RulesContext } from './types';
import { defaultContext, getSpace, isOwnable } from './board';
import { canProposeTrade, pendingActors, validateAction } from './engine';
import { auctionMinBid } from './rules/auction';
import { findPlayer, unmortgageCost } from './rules/helpers';

export interface LegalActions {
  /** True if this player is expected to act now. */
  mustAct: boolean;
  canRoll: boolean;
  canEndTurn: boolean;
  canBuy: boolean;
  canDecline: boolean;
  canPayJailFine: boolean;
  canUseJailCard: boolean;
  bid: { min: number; max: number } | null;
  canPassBid: boolean;
  canPayDebt: boolean;
  canDeclareBankruptcy: boolean;
  canProposeTrade: boolean;
  canRespondTrade: boolean;
  canCancelTrade: boolean;
  buildable: number[];
  sellable: number[];
  sellGroup: number[];
  mortgageable: number[];
  unmortgageable: number[];
}

export function emptyLegal(): LegalActions {
  return {
    mustAct: false,
    canRoll: false,
    canEndTurn: false,
    canBuy: false,
    canDecline: false,
    canPayJailFine: false,
    canUseJailCard: false,
    bid: null,
    canPassBid: false,
    canPayDebt: false,
    canDeclareBankruptcy: false,
    canProposeTrade: false,
    canRespondTrade: false,
    canCancelTrade: false,
    buildable: [],
    sellable: [],
    sellGroup: [],
    mortgageable: [],
    unmortgageable: []
  };
}

export function getLegalActions(state: GameState, playerId: string, ctx: RulesContext = defaultContext()): LegalActions {
  const out = emptyLegal();
  const p = findPlayer(state, playerId);
  if (!p || p.bankrupt || state.phase === 'GAME_OVER') return out;
  const ok = (a: Action) => validateAction(state, playerId, a, ctx) === null;
  out.mustAct = pendingActors(state).includes(playerId);
  out.canRoll = ok({ type: 'ROLL' });
  out.canEndTurn = ok({ type: 'END_TURN' });
  out.canBuy = ok({ type: 'BUY' });
  out.canDecline = ok({ type: 'DECLINE' });
  out.canPayJailFine = ok({ type: 'PAY_JAIL_FINE' });
  out.canUseJailCard = ok({ type: 'USE_JAIL_CARD' });
  out.canPassBid = ok({ type: 'PASS_BID' });
  if (out.canPassBid) {
    const min = auctionMinBid(state);
    out.bid = p.cash >= min ? { min, max: p.cash } : null;
  }
  out.canPayDebt = ok({ type: 'PAY_DEBT' });
  out.canDeclareBankruptcy = ok({ type: 'DECLARE_BANKRUPTCY' });
  out.canProposeTrade = canProposeTrade(state, playerId);
  out.canRespondTrade = ok({ type: 'REJECT_TRADE' });
  out.canCancelTrade = ok({ type: 'CANCEL_TRADE' });
  state.properties.forEach((prop, i) => {
    if (!prop || prop.owner !== playerId) return;
    if (!isOwnable(getSpace(ctx, i))) return;
    if (ok({ type: 'BUILD', space: i })) out.buildable.push(i);
    if (ok({ type: 'SELL_BUILDING', space: i })) out.sellable.push(i);
    if (ok({ type: 'SELL_GROUP_BUILDINGS', space: i })) out.sellGroup.push(i);
    if (ok({ type: 'MORTGAGE', space: i })) out.mortgageable.push(i);
    if (ok({ type: 'UNMORTGAGE', space: i })) out.unmortgageable.push(i);
  });
  return out;
}

/** Explain why a property action is unavailable (for tooltips), or null if it is legal. */
export function explainAction(state: GameState, playerId: string, action: Action, ctx: RulesContext = defaultContext()): string | null {
  return validateAction(state, playerId, action, ctx);
}

export { unmortgageCost };
