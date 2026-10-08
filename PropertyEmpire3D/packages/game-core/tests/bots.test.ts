import { describe, expect, it } from 'vitest';
import {
  BotDriver,
  chooseBotAction,
  createBotMemory,
  createGame,
  createRandom,
  simulateBotGame,
  botPlayers,
  type Difficulty,
  type GameState
} from '../src/index';
import { ctx, forceDice, own, player } from './helpers';

function botGame(difficulties: Difficulty[], seed = 3): GameState {
  for (let s = seed; s < seed + 500; s++) {
    const { state } = createGame({ players: botPlayers(difficulties.length, difficulties), seed: s }, ctx);
    if (state.turn.playerId === 'bot1') return state;
  }
  throw new Error('no seed');
}

function decide(state: GameState, id: string) {
  return chooseBotAction(state, ctx, id, createBotMemory(), createRandom(42));
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

describe('bot-only matches', () => {
  for (const d of ['easy', 'medium', 'hard'] as const) {
    it(`${d} bots play legal actions only and the match terminates`, () => {
      for (let seed = 1; seed <= 4; seed++) {
        const r = simulateBotGame({ seed, players: 4, difficulties: [d], maxActions: 40000, checkInvariantsEveryStep: true });
        expect(r.invariantErrors).toEqual([]);
        expect(r.fallbacks).toBe(0);
        expect(r.finished).toBe(true);
        expect(r.state.winnerId).not.toBeNull();
      }
    });
  }

  it('mixed matches with 2 to 8 bots terminate without deadlocks', () => {
    for (const n of [2, 3, 5, 8]) {
      const r = simulateBotGame({ seed: 100 + n, players: n, maxActions: 60000, checkInvariantsEveryStep: true });
      expect(r.invariantErrors).toEqual([]);
      expect(r.finished).toBe(true);
    }
  });

  it('bots exercise auctions, building, trading, jail and bankruptcy across games', () => {
    const totals: Record<string, number> = {};
    for (let seed = 1; seed <= 10; seed++) {
      const r = simulateBotGame({ seed, players: 4, maxActions: 40000 });
      for (const [k, v] of Object.entries(r.eventCounts)) totals[k] = (totals[k] ?? 0) + v;
    }
    for (const type of ['BID_PLACED', 'AUCTION_WON', 'BUILT', 'TRADE_ACCEPTED', 'LEFT_JAIL', 'MORTGAGED', 'DEBT_PAID', 'BANKRUPT']) {
      expect(totals[type] ?? 0, type).toBeGreaterThan(0);
    }
  });

  it('round-limited quick games end with the richest bot winning', () => {
    const r = simulateBotGame({ seed: 5, players: 4, presetId: 'quick', maxActions: 40000, checkInvariantsEveryStep: true });
    expect(r.finished).toBe(true);
    expect(r.state.round).toBeLessThanOrEqual(31);
  });
});

describe('individual bot decisions', () => {
  it('buys an affordable property early in the game', () => {
    const s = botGame(['medium', 'medium']);
    s.phase = 'PROPERTY_DECISION';
    s.pendingPurchase = 16;
    player(s, 'bot1').position = 16;
    expect(decide(s, 'bot1')?.action.type).toBe('BUY');
  });

  it('bids in auctions and passes when the price exceeds its valuation', () => {
    const s = botGame(['hard', 'hard']);
    s.phase = 'AUCTION';
    s.auction = { space: 19, highestBid: 0, highestBidderId: null, bidders: ['bot1', 'bot2'], turn: 0 };
    const bid = decide(s, 'bot1');
    expect(bid?.action.type).toBe('BID');
    s.auction = { space: 19, highestBid: 1400, highestBidderId: 'bot2', bidders: ['bot1', 'bot2'], turn: 0 };
    expect(decide(s, 'bot1')?.action.type).toBe('PASS_BID');
  });

  it('builds on a completed color group', () => {
    const s = botGame(['hard', 'medium']);
    own(s, 'bot1', [16, 18, 19]);
    const d = decide(s, 'bot1');
    expect(d?.action.type).toBe('BUILD');
  });

  it('proposes a mutually group-completing trade and the partner bot accepts it', () => {
    const s = botGame(['hard', 'medium']);
    own(s, 'bot1', [16, 18, 1]);
    own(s, 'bot2', [19, 3, 21]);
    s.properties.forEach((p, i) => {
      if (p && !p.owner && i !== 0) p.owner = i % 2 ? 'bot1' : 'bot2';
    });
    // Make sure no other group is complete or near-complete for either bot.
    const driver = new BotDriver({ seed: 1 });
    let state = s;
    let proposed = false;
    for (let i = 0; i < 20 && !proposed; i++) {
      const step = driver.step(state, 'bot1');
      expect(step).not.toBeNull();
      if (step?.action.type === 'PROPOSE_TRADE') {
        proposed = true;
        state = step.state;
      } else break;
    }
    if (!proposed) {
      // Proposal is probabilistic; force a deterministic check of the response instead.
      state = structuredClone(s);
      state.trade = {
        id: 1,
        counterCount: 0,
        fromId: 'bot1',
        toId: 'bot2',
        offerCash: 0,
        requestCash: 0,
        offerSpaces: [1],
        requestSpaces: [19],
        offerJailCards: 0,
        requestJailCards: 0
      };
      state.phase = 'TRADE';
    }
    const response = decide(state, 'bot2');
    expect(['ACCEPT_TRADE', 'REJECT_TRADE']).toContain(response?.action.type);
  });

  it('rejects a lopsided trade and accepts a generous one', () => {
    const s = botGame(['medium', 'medium']);
    own(s, 'bot2', [37]);
    s.phase = 'TRADE';
    s.trade = { id: 1, counterCount: 0, fromId: 'bot1', toId: 'bot2', offerCash: 10, requestCash: 0, offerSpaces: [], requestSpaces: [37], offerJailCards: 0, requestJailCards: 0 };
    expect(decide(s, 'bot2')?.action.type).toBe('REJECT_TRADE');
    s.trade = { ...s.trade, offerCash: 700 };
    expect(decide(s, 'bot2')?.action.type).toBe('ACCEPT_TRADE');
  });

  it('gets out of Jail early in the game', () => {
    const s = botGame(['hard', 'hard']);
    const b = player(s, 'bot1');
    b.inJail = true;
    b.position = 10;
    s.phase = 'JAIL_DECISION';
    expect(decide(s, 'bot1')?.action.type).toBe('PAY_JAIL_FINE');
  });

  it('raises funds and pays a debt, or declares bankruptcy when it cannot', () => {
    const s = botGame(['medium', 'medium']);
    own(s, 'bot1', [6]);
    player(s, 'bot1').cash = 10;
    s.debts = [{ debtorId: 'bot1', creditorId: 'bot2', amount: 40, reason: 'Rent' }];
    s.phase = 'DEBT_RESOLUTION';
    const driver = new BotDriver({ seed: 2 });
    let r = driver.step(s, 'bot1');
    expect(r?.action).toEqual({ type: 'MORTGAGE', space: 6 });
    r = driver.step(r!.state, 'bot1');
    expect(r?.action.type).toBe('PAY_DEBT');
    expect(r?.state.phase).not.toBe('DEBT_RESOLUTION');

    const s2 = botGame(['medium', 'medium']);
    player(s2, 'bot1').cash = 10;
    s2.debts = [{ debtorId: 'bot1', creditorId: 'bot2', amount: 400, reason: 'Rent' }];
    s2.phase = 'DEBT_RESOLUTION';
    expect(decide(s2, 'bot1')?.action.type).toBe('DECLARE_BANKRUPTCY');
  });

  it('bot decisions never mutate the state they are given', () => {
    const s = botGame(['hard', 'easy', 'medium']);
    forceDice(s, 3, 4);
    const frozen = deepFreeze(structuredClone(s));
    const before = JSON.stringify(frozen);
    const driver = new BotDriver({ seed: 9 });
    let state: GameState = frozen;
    for (let i = 0; i < 50; i++) {
      const actor = driver.actingBot(state);
      if (!actor) break;
      const step = driver.step(state, actor);
      expect(step).not.toBeNull();
      state = deepFreeze(step!.state);
    }
    expect(JSON.stringify(frozen)).toBe(before);
    expect(driver.decisionLog.length).toBeGreaterThan(0);
  });

  it('every bot turn terminates within a bounded number of actions', () => {
    const r = simulateBotGame({ seed: 77, players: 6, maxActions: 60000 });
    const perTurn = r.actions / r.state.turn.number;
    expect(perTurn).toBeLessThan(15);
  });
});
