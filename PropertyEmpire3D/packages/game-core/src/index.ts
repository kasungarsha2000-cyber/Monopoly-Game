/**
 * @pe/game-core public API. Pure TypeScript with no runtime dependencies, so
 * it runs unchanged in the browser (solo play) and on the Node LAN server.
 */
export * from './types';
export * from './rng';
export * from './board';
export * from './engine';
export * from './legal';
export * from './validation';
export * from './invariants';
export * from './simulate';
export * from './protocol';
export { BotDriver } from './bots/driver';
export type { BotStepResult, BotDriverOptions } from './bots/driver';
export {
  chooseBotAction,
  createBotMemory,
  evaluateIncomingTrade,
  tradeValueFor,
  gainValue,
  loseValue,
  cashReserve
} from './bots/strategy';
export type { BotDecision, BotMemory } from './bots/strategy';
export {
  activePlayers,
  computeRent,
  countBuildings,
  countOwnedInGroup,
  currentPlayer,
  findPlayer,
  formatMoney,
  getPlayer,
  liquidationValue,
  mortgageInterest,
  netWorth,
  ownedSpaces,
  ownsWholeGroup,
  playerName,
  unmortgageCost,
  buildingSaleValue
} from './rules/helpers';
export { auctionMinBid, currentBidder } from './rules/auction';
export { rankPlayers } from './rules/bankruptcy';
export { rollDice } from './rules/turn';
export { describeTrade, validateTradeOffer } from './rules/trade';
