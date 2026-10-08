/**
 * Core type definitions for Property Empire 3D.
 *
 * Everything in this file is plain data so it can be serialized to JSON for
 * saves and network snapshots. The rules engine never stores class instances
 * in the game state.
 */

/* ------------------------------------------------------------------ */
/* Board and card data                                                 */
/* ------------------------------------------------------------------ */

export type SpaceType =
  | 'go'
  | 'street'
  | 'transport'
  | 'utility'
  | 'tax'
  | 'chance'
  | 'community'
  | 'jail'
  | 'free_parking'
  | 'go_to_jail';

/** Static definition of one board space, loaded from data/board.json. */
export interface SpaceDef {
  id: string;
  index: number;
  name: string;
  shortName: string;
  type: SpaceType;
  /** Color/ownership group for ownable spaces. */
  group?: string;
  price?: number;
  /**
   * Rent table.
   * - street: [base, 1 house, 2 houses, 3 houses, 4 houses, hotel]
   * - transport: rent by number owned [1, 2, 3, 4]
   * - utility: dice multiplier by number owned [1, 2]
   */
  rent?: number[];
  houseCost?: number;
  mortgage?: number;
  /** Tax amount for tax spaces. */
  amount?: number;
}

export interface GroupDef {
  id: string;
  name: string;
  color: string;
}

export interface BoardDef {
  id: string;
  name: string;
  version: number;
  groups: GroupDef[];
  spaces: SpaceDef[];
}

export type DeckId = 'chance' | 'community';

export type CardEffect =
  | { kind: 'advance'; to: number }
  | { kind: 'advance_nearest'; target: 'transport' | 'utility'; rentMultiplier?: number; diceMultiplier?: number }
  | { kind: 'move'; steps: number }
  | { kind: 'go_to_jail' }
  | { kind: 'collect'; amount: number }
  | { kind: 'pay'; amount: number }
  | { kind: 'collect_each'; amount: number }
  | { kind: 'pay_each'; amount: number }
  | { kind: 'repairs'; perHouse: number; perHotel: number }
  | { kind: 'jail_free' };

export interface CardDef {
  id: string;
  title: string;
  text: string;
  effect: CardEffect;
}

export interface CardsDef {
  version: number;
  chance: CardDef[];
  community: CardDef[];
}

/** Configurable rules. Defaults live in data/rules.json. */
export interface RulesConfig {
  startingCash: number;
  goSalary: number;
  jailFine: number;
  maxJailTurns: number;
  doublesToJail: number;
  auctions: boolean;
  bankruptcyAuctions: boolean;
  freeParkingJackpot: boolean;
  bankHouses: number;
  bankHotels: number;
  mortgageInterestPercent: number;
  evenBuild: boolean;
  minPlayers: number;
  maxPlayers: number;
  /** 0 = unlimited. Otherwise the richest player wins after this many rounds. */
  maxRounds: number;
  maxTradeProposalsPerTurn: number;
}

export interface RulesPreset {
  id: string;
  name: string;
  description: string;
  overrides: Partial<RulesConfig>;
}

export interface RulesData {
  version: number;
  defaults: RulesConfig;
  presets: RulesPreset[];
}

/* ------------------------------------------------------------------ */
/* Players                                                             */
/* ------------------------------------------------------------------ */

export type PlayerKind = 'human' | 'bot';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type TokenId = 'pawn' | 'gem' | 'rocket' | 'crown' | 'star' | 'puck' | 'tower' | 'orb';

export interface PlayerSetup {
  id: string;
  name: string;
  kind: PlayerKind;
  difficulty?: Difficulty;
  token: TokenId;
  color: string;
}

export interface Player {
  id: string;
  name: string;
  kind: PlayerKind;
  difficulty: Difficulty | null;
  token: TokenId;
  color: string;
  cash: number;
  position: number;
  inJail: boolean;
  /** Failed doubles attempts made during the current Jail stay. */
  jailTurns: number;
  /** Held Get Out of Jail Free cards, recorded by the deck they return to. */
  jailCards: DeckId[];
  bankrupt: boolean;
  /** Network presence. Always true in solo games. */
  connected: boolean;
}

export interface PlayerStats {
  rentCollected: number;
  rentPaid: number;
  propertiesBought: number;
  auctionsWon: number;
  turnsPlayed: number;
  timesJailed: number;
  passedGo: number;
  /** Turn number on which the player went bankrupt, used for final ranking. */
  bankruptOnTurn: number | null;
}

/* ------------------------------------------------------------------ */
/* Match state                                                         */
/* ------------------------------------------------------------------ */

/** Ownership and development of one ownable space. Null for non-ownable spaces. */
export interface PropertyState {
  owner: string | null;
  /** 0-4 houses, 5 = hotel. */
  houses: number;
  mortgaged: boolean;
}

export type Phase =
  | 'AWAIT_ROLL'
  | 'JAIL_DECISION'
  | 'PROPERTY_DECISION'
  | 'AUCTION'
  | 'DEBT_RESOLUTION'
  | 'TRADE'
  | 'TURN_END'
  | 'GAME_OVER';

export interface Debt {
  debtorId: string;
  /** null = the Bank. */
  creditorId: string | null;
  amount: number;
  reason: string;
}

export interface AuctionState {
  space: number;
  highestBid: number;
  highestBidderId: string | null;
  /** Players still in the auction, in bidding order. */
  bidders: string[];
  /** Index into bidders of the player who must act. */
  turn: number;
}

export interface TradeOffer {
  fromId: string;
  toId: string;
  offerCash: number;
  requestCash: number;
  offerSpaces: number[];
  requestSpaces: number[];
  offerJailCards: number;
  requestJailCards: number;
}

export interface PendingTrade extends TradeOffer {
  id: number;
  counterCount: number;
}

export interface TurnState {
  playerId: string;
  /** Total turns taken in the match (1-based). */
  number: number;
  /** True once the player has rolled at least once this turn. */
  rolled: boolean;
  /** True when doubles grant another roll. */
  extraRoll: boolean;
  doublesCount: number;
  dice: [number, number] | null;
  /** Number of accepted actions this turn; bots use it as a loop guard. */
  actionCount: number;
  /** Trade proposals made this turn, per player. */
  tradeProposals: Record<string, number>;
}

export interface LogEntry {
  turn: number;
  text: string;
}

export interface DrawnCard {
  deck: DeckId;
  cardId: string;
  playerId: string;
  turn: number;
}

export interface GameState {
  schemaVersion: number;
  gameId: string;
  boardId: string;
  createdAt: number;
  /** Increments on every accepted action; used for sync and duplicate detection. */
  revision: number;
  config: RulesConfig;
  players: Player[];
  /** Indexed by board space. Null for spaces that cannot be owned. */
  properties: (PropertyState | null)[];
  bank: { houses: number; hotels: number };
  /** Card ids in draw order (top of deck first). Held jail cards are absent. */
  decks: Record<DeckId, string[]>;
  freeParkingPot: number;
  phase: Phase;
  turn: TurnState;
  /** Current round (1-based). A round ends when play passes the starting seat again. */
  round: number;
  /** Seat index of the player who took the first turn; used for round counting. */
  startSeat: number;
  pendingPurchase: number | null;
  auction: AuctionState | null;
  auctionQueue: number[];
  debts: Debt[];
  trade: PendingTrade | null;
  nextTradeId: number;
  lastCard: DrawnCard | null;
  winnerId: string | null;
  endReason: string | null;
  rngState: number;
  stats: Record<string, PlayerStats>;
  log: LogEntry[];
}

/* ------------------------------------------------------------------ */
/* Actions and events                                                  */
/* ------------------------------------------------------------------ */

export type Action =
  | { type: 'ROLL' }
  | { type: 'BUY' }
  | { type: 'DECLINE' }
  | { type: 'BID'; amount: number }
  | { type: 'PASS_BID' }
  | { type: 'PAY_JAIL_FINE' }
  | { type: 'USE_JAIL_CARD' }
  | { type: 'BUILD'; space: number }
  | { type: 'SELL_BUILDING'; space: number }
  | { type: 'SELL_GROUP_BUILDINGS'; space: number }
  | { type: 'MORTGAGE'; space: number }
  | { type: 'UNMORTGAGE'; space: number }
  | { type: 'PAY_DEBT' }
  | { type: 'DECLARE_BANKRUPTCY' }
  | { type: 'PROPOSE_TRADE'; offer: TradeOffer }
  | { type: 'ACCEPT_TRADE' }
  | { type: 'REJECT_TRADE' }
  | { type: 'CANCEL_TRADE' }
  | { type: 'COUNTER_TRADE'; offer: TradeOffer }
  | { type: 'END_TURN' };

export type ActionType = Action['type'];

export type MoneyParty = string | 'bank';

export type GameEvent =
  | { type: 'GAME_STARTED'; firstPlayerId: string }
  | { type: 'TURN_STARTED'; playerId: string; turn: number; round: number }
  | { type: 'DICE_ROLLED'; playerId: string; dice: [number, number]; doubles: boolean; inJail: boolean }
  | { type: 'MOVED'; playerId: string; from: number; to: number; steps: number; passedGo: boolean; direct: boolean }
  | { type: 'MONEY'; from: MoneyParty; to: MoneyParty; amount: number; reason: string }
  | { type: 'SENT_TO_JAIL'; playerId: string; reason: string }
  | { type: 'LEFT_JAIL'; playerId: string; method: 'doubles' | 'fine' | 'card' | 'forced_fine' }
  | { type: 'JAIL_ROLL_FAILED'; playerId: string; attempt: number }
  | { type: 'PROPERTY_OFFERED'; playerId: string; space: number }
  | { type: 'PROPERTY_BOUGHT'; playerId: string; space: number; price: number }
  | { type: 'AUCTION_STARTED'; space: number; bidders: string[] }
  | { type: 'BID_PLACED'; playerId: string; space: number; amount: number }
  | { type: 'BID_PASSED'; playerId: string; space: number }
  | { type: 'AUCTION_WON'; playerId: string; space: number; amount: number }
  | { type: 'AUCTION_UNSOLD'; space: number }
  | { type: 'RENT_PAID'; from: string; to: string; space: number; amount: number }
  | { type: 'TAX_PAID'; playerId: string; space: number; amount: number }
  | { type: 'CARD_DRAWN'; playerId: string; deck: DeckId; cardId: string }
  | { type: 'JACKPOT'; playerId: string; amount: number }
  | { type: 'BUILT'; playerId: string; space: number; houses: number }
  | { type: 'BUILDING_SOLD'; playerId: string; space: number; houses: number }
  | { type: 'MORTGAGED'; playerId: string; space: number }
  | { type: 'UNMORTGAGED'; playerId: string; space: number }
  | { type: 'DEBT_CREATED'; debtorId: string; creditorId: string | null; amount: number; reason: string }
  | { type: 'DEBT_PAID'; debtorId: string; creditorId: string | null; amount: number }
  | { type: 'TRADE_PROPOSED'; tradeId: number; fromId: string; toId: string; counter: boolean }
  | { type: 'TRADE_ACCEPTED'; tradeId: number; fromId: string; toId: string }
  | { type: 'TRADE_REJECTED'; tradeId: number; fromId: string; toId: string }
  | { type: 'TRADE_CANCELLED'; tradeId: number; fromId: string; toId: string }
  | { type: 'PROPERTY_TRANSFERRED'; space: number; from: string | null; to: string | null }
  | { type: 'BANKRUPT'; playerId: string; creditorId: string | null }
  | { type: 'TURN_ENDED'; playerId: string }
  | { type: 'GAME_OVER'; winnerId: string | null; reason: string };

export type GameEventType = GameEvent['type'];

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };

/** Static data the rules engine needs. Kept outside the state so saves and snapshots stay small. */
export interface RulesContext {
  board: BoardDef;
  cards: CardsDef;
  rules: RulesData;
}
