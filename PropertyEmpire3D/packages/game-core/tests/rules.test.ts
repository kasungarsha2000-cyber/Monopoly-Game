import { describe, expect, it } from 'vitest';
import { createGame, nextInt, parseAction, rollDice, validateGameState, parseSavedGame } from '../src/index';
import { act, ctx, forceDice, humans, moneyFor, newGame, own, player, reject, roll } from './helpers';

describe('setup', () => {
  it('players start with correct cash, position and no property', () => {
    const s = newGame(4);
    for (const p of s.players) {
      expect(p.cash).toBe(1500);
      expect(p.position).toBe(0);
      expect(p.inJail).toBe(false);
    }
    expect(s.properties.filter((p) => p && p.owner).length).toBe(0);
    expect(s.phase).toBe('AWAIT_ROLL');
    expect(s.bank).toEqual({ houses: 32, hotels: 12 });
  });

  it('board has 40 correctly indexed spaces and 28 ownable properties', () => {
    expect(ctx.board.spaces).toHaveLength(40);
    ctx.board.spaces.forEach((sp, i) => expect(sp.index).toBe(i));
    expect(ctx.board.spaces.filter((sp) => ['street', 'transport', 'utility'].includes(sp.type))).toHaveLength(28);
  });

  it('rejects too few or too many players', () => {
    expect(() => createGame({ players: humans(1), seed: 1 }, ctx)).toThrow();
    const nine = [...humans(8), { ...humans(1)[0]!, id: 'p9' }];
    expect(() => createGame({ players: nine, seed: 1 }, ctx)).toThrow();
  });

  it('chooses the first player randomly with the seeded RNG', () => {
    const firsts = new Set<string>();
    for (let seed = 1; seed < 40; seed++) firsts.add(createGame({ players: humans(4), seed }, ctx).state.turn.playerId);
    expect(firsts.size).toBe(4);
    const a = createGame({ players: humans(4), seed: 7 }, ctx).state;
    const b = createGame({ players: humans(4), seed: 7 }, ctx).state;
    expect(a.turn.playerId).toBe(b.turn.playerId);
    expect(a.decks).toEqual(b.decks);
  });
});

describe('dice and movement', () => {
  it('dice always produce values 1-6 with every face appearing', () => {
    const holder = { rngState: 12345 } as Parameters<typeof rollDice>[0];
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      for (const d of rollDice(holder)) {
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(6);
        seen.add(d);
      }
    }
    expect(seen.size).toBe(6);
    const h = { rngState: 1 };
    for (let i = 0; i < 1000; i++) expect(Number.isInteger(nextInt(h, 1, 6))).toBe(true);
  });

  it('movement wraps around 40 spaces and passing GO pays $200 once', () => {
    const s = newGame();
    player(s, 'p1').position = 38;
    const { state, events } = roll(s, 2, 3);
    expect(player(state, 'p1').position).toBe(3);
    expect(events.filter((e) => e.type === 'MONEY' && e.reason === 'Passed GO')).toHaveLength(1);
    expect(player(state, 'p1').cash).toBe(1700);
    expect(state.phase).toBe('PROPERTY_DECISION');
  });

  it('landing exactly on GO pays the salary', () => {
    const s = newGame();
    player(s, 'p1').position = 35;
    const { state } = roll(s, 1, 4);
    expect(player(state, 'p1').position).toBe(0);
    expect(player(state, 'p1').cash).toBe(1700);
  });

  it('Go To Jail sends the player directly to Jail without GO money', () => {
    const s = newGame();
    player(s, 'p1').position = 25;
    const { state, events } = roll(s, 2, 3);
    const p = player(state, 'p1');
    expect(p.position).toBe(10);
    expect(p.inJail).toBe(true);
    expect(p.cash).toBe(1500);
    expect(events.some((e) => e.type === 'MONEY' && e.reason === 'Passed GO')).toBe(false);
    expect(state.phase).toBe('TURN_END');
  });

  it('doubles give another roll and END_TURN is refused until it is taken', () => {
    const s = newGame();
    s.decks.community = ['c-sandcastle', ...s.decks.community.filter((c) => c !== 'c-sandcastle')];
    const { state } = roll(s, 1, 1);
    expect(state.phase).toBe('AWAIT_ROLL');
    expect(state.turn.extraRoll).toBe(true);
    expect(reject(state, 'p1', { type: 'END_TURN' })).toMatch(/doubles/);
  });

  it('three consecutive doubles send the player to Jail', () => {
    let s = newGame();
    s = roll(s, 2, 2).state; // City Tax
    s = roll(s, 3, 3).state; // Just visiting
    const { state, events } = roll(s, 5, 5);
    const p = player(state, 'p1');
    expect(p.inJail).toBe(true);
    expect(p.position).toBe(10);
    expect(events.some((e) => e.type === 'SENT_TO_JAIL')).toBe(true);
    expect(state.phase).toBe('TURN_END');
  });
});

describe('purchases and auctions', () => {
  it('buying a property transfers the exact price and ownership', () => {
    const s = newGame();
    let r = roll(s, 1, 2);
    expect(r.state.phase).toBe('PROPERTY_DECISION');
    expect(r.state.pendingPurchase).toBe(3);
    r = act(r.state, 'p1', { type: 'BUY' });
    expect(player(r.state, 'p1').cash).toBe(1440);
    expect(r.state.properties[3]?.owner).toBe('p1');
    expect(r.state.phase).toBe('TURN_END');
    r = act(r.state, 'p1', { type: 'END_TURN' });
    expect(r.state.turn.playerId).toBe('p2');
  });

  it('cannot buy without enough cash', () => {
    const s = newGame();
    player(s, 'p1').cash = 50;
    const r = roll(s, 1, 2);
    expect(reject(r.state, 'p1', { type: 'BUY' })).toMatch(/need/);
  });

  it('declining starts an auction including the declining player; winner pays the bid', () => {
    const s = newGame(3);
    let r = roll(s, 1, 2);
    r = act(r.state, 'p1', { type: 'DECLINE' });
    expect(r.state.phase).toBe('AUCTION');
    expect(r.state.auction?.bidders).toEqual(['p1', 'p2', 'p3']);
    expect(reject(r.state, 'p2', { type: 'BID', amount: 5 })).toMatch(/turn/);
    r = act(r.state, 'p1', { type: 'BID', amount: 10 });
    expect(reject(r.state, 'p2', { type: 'BID', amount: 10 })).toMatch(/minimum/);
    expect(reject(r.state, 'p2', { type: 'BID', amount: 99999 })).toMatch(/more cash/);
    r = act(r.state, 'p2', { type: 'BID', amount: 25 });
    r = act(r.state, 'p3', { type: 'PASS_BID' });
    r = act(r.state, 'p1', { type: 'PASS_BID' });
    expect(r.state.auction).toBeNull();
    expect(r.state.properties[3]?.owner).toBe('p2');
    expect(player(r.state, 'p2').cash).toBe(1475);
    expect(player(r.state, 'p1').cash).toBe(1500);
    expect(r.state.phase).toBe('TURN_END');
    expect(r.state.turn.playerId).toBe('p1');
  });

  it('property stays with the Bank if everyone passes', () => {
    const s = newGame(2);
    let r = roll(s, 1, 2);
    r = act(r.state, 'p1', { type: 'DECLINE' });
    r = act(r.state, 'p1', { type: 'PASS_BID' });
    r = act(r.state, 'p2', { type: 'PASS_BID' });
    expect(r.state.properties[3]?.owner).toBeNull();
    expect(r.events.some((e) => e.type === 'AUCTION_UNSOLD')).toBe(true);
  });

  it('players who cannot afford the next bid are skipped', () => {
    const s = newGame(3);
    player(s, 'p2').cash = 5;
    let r = roll(s, 1, 2);
    r = act(r.state, 'p1', { type: 'DECLINE' });
    r = act(r.state, 'p1', { type: 'BID', amount: 10 });
    expect(r.state.auction?.bidders).toEqual(['p1', 'p3']);
    r = act(r.state, 'p3', { type: 'PASS_BID' });
    expect(r.state.properties[3]?.owner).toBe('p1');
  });
});

describe('rent', () => {
  it('unowned properties charge no rent (they are offered instead)', () => {
    const r = roll(newGame(), 1, 2);
    expect(r.events.some((e) => e.type === 'RENT_PAID')).toBe(false);
  });

  it('charges base rent, double with a full color group, and building rent', () => {
    let s = newGame();
    own(s, 'p2', [1]);
    player(s, 'p1').position = 38;
    let r = roll(s, 1, 2);
    expect(moneyFor(r.events, 'p2')).toBe(2);

    s = newGame();
    own(s, 'p2', [1, 3]);
    player(s, 'p1').position = 38;
    r = roll(s, 1, 2);
    expect(moneyFor(r.events, 'p2')).toBe(4);

    s = newGame();
    own(s, 'p2', [1, 3], 2);
    player(s, 'p1').position = 38;
    r = roll(s, 1, 2);
    expect(moneyFor(r.events, 'p2')).toBe(30);

    s = newGame();
    own(s, 'p2', [1, 3], 5);
    player(s, 'p1').position = 38;
    r = roll(s, 1, 2);
    expect(moneyFor(r.events, 'p2')).toBe(250);
  });

  it('mortgaged property charges no rent', () => {
    const s = newGame();
    own(s, 'p2', [1]);
    s.properties[1]!.mortgaged = true;
    player(s, 'p1').position = 38;
    const r = roll(s, 1, 2);
    expect(moneyFor(r.events, 'p2')).toBe(0);
  });

  it('transport rent depends on the number owned', () => {
    const s = newGame();
    own(s, 'p2', [5, 15, 25]);
    player(s, 'p1').position = 2;
    const r = roll(s, 1, 2);
    expect(moneyFor(r.events, 'p2')).toBe(100);
  });

  it('utility rent depends on dice and ownership count', () => {
    let s = newGame();
    own(s, 'p2', [12]);
    player(s, 'p1').position = 9;
    let r = roll(s, 1, 2);
    expect(moneyFor(r.events, 'p2')).toBe(12);
    s = newGame();
    own(s, 'p2', [12, 28]);
    player(s, 'p1').position = 9;
    r = roll(s, 1, 2);
    expect(moneyFor(r.events, 'p2')).toBe(30);
  });

  it('no rent is paid on your own property', () => {
    const s = newGame();
    own(s, 'p1', [3]);
    const r = roll(s, 1, 2);
    expect(r.events.some((e) => e.type === 'RENT_PAID')).toBe(false);
    expect(r.state.phase).toBe('TURN_END');
  });
});

describe('buildings', () => {
  it('requires the full group and builds evenly', () => {
    let s = newGame();
    own(s, 'p1', [1]);
    expect(reject(s, 'p1', { type: 'BUILD', space: 1 })).toMatch(/whole color group/);
    s = newGame();
    own(s, 'p1', [1, 3]);
    let r = act(s, 'p1', { type: 'BUILD', space: 1 });
    expect(r.state.properties[1]?.houses).toBe(1);
    expect(r.state.bank.houses).toBe(31);
    expect(player(r.state, 'p1').cash).toBe(1450);
    expect(reject(r.state, 'p1', { type: 'BUILD', space: 1 })).toMatch(/evenly/);
    r = act(r.state, 'p1', { type: 'BUILD', space: 3 });
    r = act(r.state, 'p1', { type: 'BUILD', space: 3 });
    expect(reject(r.state, 'p1', { type: 'SELL_BUILDING', space: 1 })).toMatch(/evenly/);
    r = act(r.state, 'p1', { type: 'SELL_BUILDING', space: 3 });
    expect(r.state.properties[3]?.houses).toBe(1);
    expect(moneyFor(r.events, 'p1')).toBe(25);
  });

  it('cannot build when the group has a mortgage or on another turn', () => {
    const s = newGame();
    own(s, 'p1', [1, 3]);
    s.properties[3]!.mortgaged = true;
    expect(reject(s, 'p1', { type: 'BUILD', space: 1 })).toMatch(/Unmortgage/);
    const s2 = newGame();
    own(s2, 'p2', [1, 3]);
    expect(reject(s2, 'p2', { type: 'BUILD', space: 1 })).toMatch(/during your turn/);
  });

  it('hotels need four houses everywhere and swap houses back to the Bank', () => {
    const s = newGame();
    own(s, 'p1', [1, 3], 4);
    expect(s.bank.houses).toBe(24);
    const r = act(s, 'p1', { type: 'BUILD', space: 1 });
    expect(r.state.properties[1]?.houses).toBe(5);
    expect(r.state.bank.houses).toBe(28);
    expect(r.state.bank.hotels).toBe(11);
    expect(reject(r.state, 'p1', { type: 'BUILD', space: 1 })).toMatch(/hotel/);
  });

  it('building inventory can never go negative', () => {
    const s = newGame(2, { bankHouses: 1 });
    own(s, 'p1', [1, 3]);
    const r = act(s, 'p1', { type: 'BUILD', space: 1 });
    expect(r.state.bank.houses).toBe(0);
    expect(reject(r.state, 'p1', { type: 'BUILD', space: 3 })).toMatch(/no houses/);
  });

  it('selling a whole group returns every building at half price', () => {
    const s = newGame();
    own(s, 'p1', [1, 3], 5);
    const r = act(s, 'p1', { type: 'SELL_GROUP_BUILDINGS', space: 1 });
    expect(r.state.properties[1]?.houses).toBe(0);
    expect(r.state.properties[3]?.houses).toBe(0);
    expect(r.state.bank.hotels).toBe(12);
    expect(moneyFor(r.events, 'p1')).toBe(2 * 5 * 25);
  });
});

describe('mortgages', () => {
  it('mortgages for the configured value and lifts with 10% interest', () => {
    const s = newGame();
    own(s, 'p1', [6]);
    let r = act(s, 'p1', { type: 'MORTGAGE', space: 6 });
    expect(player(r.state, 'p1').cash).toBe(1550);
    expect(r.state.properties[6]?.mortgaged).toBe(true);
    r = act(r.state, 'p1', { type: 'UNMORTGAGE', space: 6 });
    expect(player(r.state, 'p1').cash).toBe(1495);
    expect(r.state.properties[6]?.mortgaged).toBe(false);
  });

  it('must sell the group buildings before mortgaging', () => {
    const s = newGame();
    own(s, 'p1', [1, 3], 1);
    expect(reject(s, 'p1', { type: 'MORTGAGE', space: 1 })).toMatch(/Sell all buildings/);
  });
});

describe('jail', () => {
  function jailed(cash = 1500) {
    const s = newGame();
    const p = player(s, 'p1');
    p.position = 10;
    p.inJail = true;
    p.cash = cash;
    s.phase = 'JAIL_DECISION';
    return s;
  }

  it('pay $50 to leave and then roll normally', () => {
    const r = act(jailed(), 'p1', { type: 'PAY_JAIL_FINE' });
    expect(player(r.state, 'p1').inJail).toBe(false);
    expect(player(r.state, 'p1').cash).toBe(1450);
    expect(r.state.phase).toBe('AWAIT_ROLL');
  });

  it('use a Get Out of Jail Free card, which returns to its deck', () => {
    const s = jailed();
    s.decks.chance = s.decks.chance.filter((c) => c !== 'f-jail-free');
    player(s, 'p1').jailCards = ['chance'];
    const r = act(s, 'p1', { type: 'USE_JAIL_CARD' });
    expect(player(r.state, 'p1').inJail).toBe(false);
    expect(player(r.state, 'p1').jailCards).toEqual([]);
    expect(r.state.decks.chance.at(-1)).toBe('f-jail-free');
  });

  it('rolling doubles escapes and moves without an extra roll', () => {
    const r = roll(jailed(), 2, 2);
    expect(player(r.state, 'p1').inJail).toBe(false);
    expect(player(r.state, 'p1').position).toBe(14);
    expect(r.state.turn.extraRoll).toBe(false);
    const after = act(r.state, 'p1', { type: 'BUY' });
    expect(after.state.phase).toBe('TURN_END');
  });

  it('a failed roll keeps the player in Jail; the third failure forces the fine and moves', () => {
    let r = roll(jailed(), 1, 2);
    expect(player(r.state, 'p1').inJail).toBe(true);
    expect(player(r.state, 'p1').jailTurns).toBe(1);
    expect(r.state.phase).toBe('TURN_END');

    const s = jailed();
    player(s, 'p1').jailTurns = 2;
    r = roll(s, 1, 2);
    expect(player(r.state, 'p1').inJail).toBe(false);
    expect(player(r.state, 'p1').position).toBe(13);
    expect(player(r.state, 'p1').cash).toBe(1450);
  });

  it('jailed players still collect rent', () => {
    const s = newGame();
    own(s, 'p1', [3]);
    player(s, 'p1').inJail = true;
    player(s, 'p1').position = 10;
    s.turn.playerId = 'p2';
    s.phase = 'AWAIT_ROLL';
    const r = roll(s, 1, 2);
    expect(moneyFor(r.events, 'p1')).toBe(4);
  });
});

describe('cards', () => {
  it('card effects apply exactly once and the card goes to the bottom', () => {
    const s = newGame();
    s.decks.chance = ['f-dividend', ...s.decks.chance.filter((c) => c !== 'f-dividend')];
    const r = roll(s, 3, 4);
    expect(player(r.state, 'p1').cash).toBe(1550);
    expect(r.events.filter((e) => e.type === 'CARD_DRAWN')).toHaveLength(1);
    expect(r.state.decks.chance.at(-1)).toBe('f-dividend');
  });

  it('go back 3 spaces resolves the new space', () => {
    const s = newGame();
    s.decks.chance = ['f-back-3', ...s.decks.chance.filter((c) => c !== 'f-back-3')];
    const r = roll(s, 3, 4);
    expect(player(r.state, 'p1').position).toBe(4);
    expect(player(r.state, 'p1').cash).toBe(1300);
  });

  it('jail card from a deck is held by the player', () => {
    const s = newGame();
    s.decks.chance = ['f-jail-free', ...s.decks.chance.filter((c) => c !== 'f-jail-free')];
    const r = roll(s, 3, 4);
    expect(player(r.state, 'p1').jailCards).toEqual(['chance']);
    expect(r.state.decks.chance).not.toContain('f-jail-free');
  });

  it('collect from each player and nearest-transit double rent work', () => {
    let s = newGame(3);
    s.decks.community = ['c-birthday', ...s.decks.community.filter((c) => c !== 'c-birthday')];
    let r = roll(s, 1, 1);
    expect(player(r.state, 'p1').cash).toBe(1520);
    expect(player(r.state, 'p2').cash).toBe(1490);

    s = newGame();
    own(s, 'p2', [15]);
    s.decks.chance = ['f-transit-1', ...s.decks.chance.filter((c) => c !== 'f-transit-1')];
    r = roll(s, 3, 4);
    expect(player(r.state, 'p1').position).toBe(15);
    expect(moneyFor(r.events, 'p2')).toBe(50);
  });

  it('repairs charge per house and per hotel', () => {
    const s = newGame();
    own(s, 'p1', [1, 3], 2);
    s.decks.chance = ['f-repairs', ...s.decks.chance.filter((c) => c !== 'f-repairs')];
    const r = roll(s, 3, 4);
    expect(moneyFor(r.events, 'p1')).toBe(-100);
  });

  it('Free Parking jackpot collects taxes when enabled', () => {
    let s = newGame(2, { freeParkingJackpot: true });
    let r = roll(s, 1, 3);
    expect(r.state.freeParkingPot).toBe(200);
    s = r.state;
    s.turn.playerId = 'p1';
    s.turn.rolled = false;
    s.phase = 'AWAIT_ROLL';
    player(s, 'p1').position = 15;
    r = roll(s, 2, 3);
    expect(r.state.freeParkingPot).toBe(0);
    expect(r.events.some((e) => e.type === 'JACKPOT' && e.amount === 200)).toBe(true);
  });
});

describe('trading', () => {
  it('transfers exactly the agreed items after both parties accept', () => {
    const s = newGame();
    own(s, 'p1', [1]);
    own(s, 'p2', [3]);
    s.decks.chance = s.decks.chance.filter((c) => c !== 'f-jail-free');
    player(s, 'p2').jailCards = ['chance'];
    const offer = {
      fromId: 'p1',
      toId: 'p2',
      offerCash: 100,
      requestCash: 0,
      offerSpaces: [1],
      requestSpaces: [3],
      offerJailCards: 0,
      requestJailCards: 1
    };
    let r = act(s, 'p1', { type: 'PROPOSE_TRADE', offer });
    expect(r.state.phase).toBe('TRADE');
    expect(reject(r.state, 'p1', { type: 'ROLL' })).toBeTruthy();
    r = act(r.state, 'p2', { type: 'ACCEPT_TRADE' });
    expect(r.state.properties[1]?.owner).toBe('p2');
    expect(r.state.properties[3]?.owner).toBe('p1');
    expect(player(r.state, 'p1').cash).toBe(1400);
    expect(player(r.state, 'p2').cash).toBe(1600);
    expect(player(r.state, 'p1').jailCards).toEqual(['chance']);
    expect(r.state.phase).toBe('AWAIT_ROLL');
  });

  it('rejects invalid trades', () => {
    const s = newGame();
    own(s, 'p1', [1, 3], 1);
    own(s, 'p2', [6]);
    const base = { fromId: 'p1', toId: 'p2', offerCash: 0, requestCash: 0, offerSpaces: [] as number[], requestSpaces: [] as number[], offerJailCards: 0, requestJailCards: 0 };
    expect(reject(s, 'p1', { type: 'PROPOSE_TRADE', offer: { ...base, requestSpaces: [8] } })).toMatch(/does not own/);
    expect(reject(s, 'p1', { type: 'PROPOSE_TRADE', offer: { ...base, offerCash: 99999, requestSpaces: [6] } })).toMatch(/does not have/);
    expect(reject(s, 'p1', { type: 'PROPOSE_TRADE', offer: { ...base, offerSpaces: [1], requestSpaces: [6] } })).toMatch(/buildings/);
    expect(reject(s, 'p1', { type: 'PROPOSE_TRADE', offer: { ...base, toId: 'p1' } })).toBeTruthy();
    expect(reject(s, 'p1', { type: 'PROPOSE_TRADE', offer: base })).toMatch(/include something/);
    expect(reject(s, 'p2', { type: 'PROPOSE_TRADE', offer: { ...base, requestSpaces: [6] } })).toMatch(/yourself/);
  });

  it('reject, cancel and counteroffer flows', () => {
    const s = newGame();
    own(s, 'p1', [1]);
    own(s, 'p2', [3]);
    const offer = { fromId: 'p1', toId: 'p2', offerCash: 50, requestCash: 0, offerSpaces: [], requestSpaces: [3], offerJailCards: 0, requestJailCards: 0 };
    let r = act(s, 'p1', { type: 'PROPOSE_TRADE', offer });
    r = act(r.state, 'p2', {
      type: 'COUNTER_TRADE',
      offer: { fromId: 'p2', toId: 'p1', offerCash: 0, requestCash: 120, offerSpaces: [3], requestSpaces: [], offerJailCards: 0, requestJailCards: 0 }
    });
    expect(r.state.trade?.fromId).toBe('p2');
    r = act(r.state, 'p1', { type: 'ACCEPT_TRADE' });
    expect(r.state.properties[3]?.owner).toBe('p1');
    expect(player(r.state, 'p1').cash).toBe(1380);

    let r2 = act(s, 'p1', { type: 'PROPOSE_TRADE', offer });
    r2 = act(r2.state, 'p2', { type: 'REJECT_TRADE' });
    expect(r2.state.trade).toBeNull();
    r2 = act(r2.state, 'p1', { type: 'PROPOSE_TRADE', offer });
    r2 = act(r2.state, 'p1', { type: 'CANCEL_TRADE' });
    expect(r2.state.trade).toBeNull();
  });

  it('receiver of a mortgaged property pays 10% interest', () => {
    const s = newGame();
    own(s, 'p2', [6]);
    s.properties[6]!.mortgaged = true;
    const offer = { fromId: 'p1', toId: 'p2', offerCash: 10, requestCash: 0, offerSpaces: [], requestSpaces: [6], offerJailCards: 0, requestJailCards: 0 };
    let r = act(s, 'p1', { type: 'PROPOSE_TRADE', offer });
    r = act(r.state, 'p2', { type: 'ACCEPT_TRADE' });
    expect(player(r.state, 'p1').cash).toBe(1500 - 10 - 5);
    expect(r.state.properties[6]?.mortgaged).toBe(true);
  });
});

describe('debt and bankruptcy', () => {
  it('a player who cannot pay enters debt resolution and can raise funds', () => {
    const s = newGame();
    own(s, 'p2', [1, 3], 5);
    own(s, 'p1', [6]);
    player(s, 'p1').cash = 10;
    player(s, 'p1').position = 38;
    let r = roll(s, 1, 2); // passes GO (+200), owes 250 on a hotel
    expect(r.state.phase).toBe('DEBT_RESOLUTION');
    expect(r.state.debts[0]).toMatchObject({ debtorId: 'p1', creditorId: 'p2', amount: 250 });
    expect(reject(r.state, 'p1', { type: 'PAY_DEBT' })).toMatch(/Raise/);
    expect(reject(r.state, 'p1', { type: 'END_TURN' })).toBeTruthy();
    r = act(r.state, 'p1', { type: 'MORTGAGE', space: 6 });
    r = act(r.state, 'p1', { type: 'PAY_DEBT' });
    expect(player(r.state, 'p1').cash).toBe(10);
    expect(player(r.state, 'p2').cash).toBe(1750);
    expect(r.state.phase).toBe('TURN_END');
  });

  it('bankruptcy to a player transfers assets; last solvent player wins', () => {
    const s = newGame();
    own(s, 'p2', [1, 3], 5);
    own(s, 'p1', [6]);
    s.properties[6]!.mortgaged = true;
    player(s, 'p1').cash = 0;
    player(s, 'p1').position = 38;
    let r = roll(s, 1, 2);
    expect(reject(r.state, 'p2', { type: 'DECLARE_BANKRUPTCY' })).toBeTruthy();
    r = act(r.state, 'p1', { type: 'DECLARE_BANKRUPTCY' });
    expect(player(r.state, 'p1').bankrupt).toBe(true);
    expect(r.state.properties[6]?.owner).toBe('p2');
    expect(r.state.phase).toBe('GAME_OVER');
    expect(r.state.winnerId).toBe('p2');
    expect(reject(r.state, 'p2', { type: 'ROLL' })).toMatch(/over/);
  });

  it('eliminated players receive no further turns; Bank debts send property to auction', () => {
    const s = newGame(3);
    own(s, 'p1', [1, 3]);
    player(s, 'p1').cash = 0;
    player(s, 'p1').position = 1;
    let r = roll(s, 1, 2); // City Tax $200, can only raise $60
    expect(r.state.phase).toBe('DEBT_RESOLUTION');
    r = act(r.state, 'p1', { type: 'DECLARE_BANKRUPTCY' });
    expect(player(r.state, 'p1').bankrupt).toBe(true);
    expect(r.state.phase).toBe('AUCTION');
    expect(r.state.auction?.space).toBe(1);
    expect(r.state.auction?.bidders).toEqual(['p2', 'p3']);
    r = act(r.state, 'p2', { type: 'PASS_BID' });
    r = act(r.state, 'p3', { type: 'BID', amount: 5 });
    expect(r.state.properties[1]?.owner).toBe('p3');
    expect(r.state.auction?.space).toBe(3);
    r = act(r.state, 'p2', { type: 'PASS_BID' });
    r = act(r.state, 'p3', { type: 'PASS_BID' });
    expect(r.state.turn.playerId).toBe('p2');
    expect(r.state.phase).toBe('AWAIT_ROLL');
    let st = r.state;
    for (let i = 0; i < 6; i++) {
      expect(st.turn.playerId).not.toBe('p1');
      st = roll(st, 1, 2).state;
      if (st.phase === 'PROPERTY_DECISION') st = act(st, st.turn.playerId, { type: 'DECLINE' }).state;
      while (st.phase === 'AUCTION') st = act(st, st.auction!.bidders[st.auction!.turn]!, { type: 'PASS_BID' }).state;
      if (st.phase === 'TURN_END') st = act(st, st.turn.playerId, { type: 'END_TURN' }).state;
    }
  });

  it('round limit ends the game and the richest player wins', () => {
    const s = newGame(2, { maxRounds: 1 });
    own(s, 'p2', [39]);
    let r = roll(s, 1, 2);
    r = act(r.state, 'p1', { type: 'DECLINE' });
    r = act(r.state, 'p1', { type: 'PASS_BID' });
    r = act(r.state, 'p2', { type: 'PASS_BID' });
    r = act(r.state, 'p1', { type: 'END_TURN' });
    expect(r.state.turn.playerId).toBe('p2');
    r = roll(r.state, 1, 2);
    r = act(r.state, 'p2', { type: 'DECLINE' });
    r = act(r.state, 'p2', { type: 'PASS_BID' });
    r = act(r.state, 'p1', { type: 'PASS_BID' });
    r = act(r.state, 'p2', { type: 'END_TURN' });
    expect(r.state.phase).toBe('GAME_OVER');
    expect(r.state.winnerId).toBe('p2');
  });
});

describe('validation and saves', () => {
  it('rejects malformed actions and client-authored dice or cash', () => {
    expect(parseAction({ type: 'ROLL' })).toEqual({ type: 'ROLL' });
    expect(parseAction({ type: 'ROLL', dice: [6, 6] })).toBeNull();
    expect(parseAction({ type: 'BID', amount: 10, cash: 99999 })).toBeNull();
    expect(parseAction({ type: 'BID', amount: 1.5 })).toBeNull();
    expect(parseAction({ type: 'BUILD', space: 41 })).toBeNull();
    expect(parseAction({ type: 'HACK' })).toBeNull();
    expect(parseAction('ROLL')).toBeNull();
  });

  it('non-current players cannot act', () => {
    const s = newGame();
    expect(reject(s, 'p2', { type: 'ROLL' })).toMatch(/not your turn/);
    expect(reject(s, 'nobody', { type: 'ROLL' })).toMatch(/Unknown/);
  });

  it('save round trip validates; corrupted saves are rejected', () => {
    const s = roll(newGame(), 1, 2).state;
    const json = JSON.stringify(s);
    const parsed = parseSavedGame(json, ctx);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state).toEqual(s);
    expect(parseSavedGame('{not json', ctx).ok).toBe(false);
    const bad = JSON.parse(json);
    bad.players[0].cash = -5;
    expect(validateGameState(bad, ctx)).toMatch(/cash/);
    const bad2 = JSON.parse(json);
    bad2.schemaVersion = 99;
    expect(validateGameState(bad2, ctx)).toMatch(/version/);
    const bad3 = JSON.parse(json);
    bad3.properties[1] = { owner: 'p1', houses: 3, mortgaged: false };
    expect(validateGameState(bad3, ctx)).toMatch(/House count/);
  });

  it('a resumed game continues identically to the original', () => {
    let a = newGame(3);
    forceDice(a, 3, 4);
    const restored = JSON.parse(JSON.stringify(a));
    const r1 = act(a, 'p1', { type: 'ROLL' });
    const r2 = act(restored, 'p1', { type: 'ROLL' });
    expect(r2.state).toEqual(r1.state);
    a = r1.state;
    expect(a.revision).toBe(1);
  });
});
