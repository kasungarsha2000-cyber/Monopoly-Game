/** Trade builder used for new offers and counteroffers. */
import {
  getSpace,
  groupSpaces,
  ownedSpaces,
  validateTradeOffer,
  type Action,
  type GameState,
  type PendingTrade,
  type RulesContext,
  type TradeOffer
} from '@pe/game-core';
import { button, clear, h, modal, select, type ModalHandle } from './dom';
import { money } from './format';
import { groupColorOf } from './deed';

export interface TradeDeps {
  ctx: RulesContext;
  me: string;
  getState: () => GameState;
  dispatch: (a: Action) => void;
}

function tradeable(state: GameState, ctx: RulesContext, i: number): boolean {
  const s = getSpace(ctx, i);
  if (s.type !== 'street' || !s.group) return true;
  return !groupSpaces(ctx, s.group).some((x) => (state.properties[x]?.houses ?? 0) > 0);
}

export function openTradeDialog(deps: TradeDeps, opts: { partnerId?: string; counter?: PendingTrade } = {}): ModalHandle {
  const { ctx, me } = deps;
  const state = deps.getState();
  const others = state.players.filter((p) => p.id !== me && !p.bankrupt);
  const counter = opts.counter;
  let partner = counter ? counter.fromId : opts.partnerId ?? others[0]?.id ?? '';
  const give = new Set<number>(counter ? counter.requestSpaces : []);
  const get = new Set<number>(counter ? counter.offerSpaces : []);
  let giveCash = counter ? counter.requestCash : 0;
  let getCash = counter ? counter.offerCash : 0;
  let giveJail = counter ? counter.requestJailCards : 0;
  let getJail = counter ? counter.offerJailCards : 0;

  const m = modal(counter ? 'Counteroffer' : 'Propose a trade', { wide: true, testid: 'trade-dialog' });
  const error = h('div', { class: 'error-text', role: 'alert' });
  const summary = h('div', { class: 'trade-summary' });
  const cols = h('div', { class: 'trade-cols' });
  const submit = button(counter ? 'Send counteroffer' : 'Send offer', () => send(), { variant: 'primary', testid: 'send-trade' });

  const offer = (): TradeOffer => ({
    fromId: me,
    toId: partner,
    offerCash: giveCash,
    requestCash: getCash,
    offerSpaces: [...give],
    requestSpaces: [...get],
    offerJailCards: giveJail,
    requestJailCards: getJail
  });

  const validate = (): string | null => {
    const st = deps.getState();
    if (!partner) return 'Choose a player to trade with';
    return validateTradeOffer(st, ctx, offer());
  };

  const refreshStatus = () => {
    const err = validate();
    error.textContent = err ?? '';
    submit.disabled = err !== null;
    clear(summary);
    const st = deps.getState();
    const pName = st.players.find((p) => p.id === partner)?.name ?? '';
    const list = (spaces: Set<number>, cash: number, jail: number) => {
      const items = [...spaces].map((i) => getSpace(ctx, i).name);
      if (cash) items.push(money(cash));
      if (jail) items.push(`${jail} jail card${jail > 1 ? 's' : ''}`);
      return items.length ? items.join(', ') : 'Nothing';
    };
    summary.append(h('div', {}, h('b', {}, 'You give'), list(give, giveCash, giveJail)), h('div', {}, h('b', {}, `${pName || 'They'} give${pName ? 's' : ''}`), list(get, getCash, getJail)));
  };

  const column = (title: string, ownerId: string, chosen: Set<number>, cash: number, setCash: (n: number) => void, jail: number, setJail: (n: number) => void) => {
    const st = deps.getState();
    const owner = st.players.find((p) => p.id === ownerId);
    const col = h('div', { class: 'trade-col' }, h('h4', {}, title));
    const spaces = ownerId ? ownedSpaces(st, ownerId) : [];
    if (!spaces.length) col.append(h('p', { class: 'muted small-text' }, 'No properties.'));
    for (const i of spaces) {
      const s = getSpace(ctx, i);
      const ok = tradeable(st, ctx, i);
      const cb = h('input', { type: 'checkbox', disabled: !ok, 'aria-label': s.name, 'data-space': i });
      cb.checked = chosen.has(i);
      cb.addEventListener('change', () => {
        if (cb.checked) chosen.add(i);
        else chosen.delete(i);
        refreshStatus();
      });
      const mortgaged = st.properties[i]?.mortgaged;
      col.append(
        h(
          'label',
          { class: `check-row ${ok ? '' : 'disabled'}`, title: ok ? '' : 'Sell the buildings in this group first' },
          cb,
          h('span', { class: 'swatch', style: `background:${groupColorOf(ctx, i)}` }),
          h('span', { class: 'grow' }, s.name),
          mortgaged ? h('span', { class: 'badge red' }, 'M') : null
        )
      );
    }
    const cashInput = h('input', { class: 'input', type: 'number', min: 0, max: owner?.cash ?? 0, step: 10, value: cash, inputmode: 'numeric', 'aria-label': `${title} cash` });
    cashInput.addEventListener('input', () => {
      const n = Math.max(0, Math.floor(Number(cashInput.value) || 0));
      setCash(n);
      refreshStatus();
    });
    col.append(h('div', { class: 'field', style: 'margin-top:10px' }, h('label', {}, `Cash (has ${money(owner?.cash ?? 0)})`), cashInput));
    if ((owner?.jailCards.length ?? 0) > 0) {
      const jailSel = select(
        Array.from({ length: (owner?.jailCards.length ?? 0) + 1 }, (_, n) => ({ value: String(n), label: n === 0 ? 'None' : `${n} card${n > 1 ? 's' : ''}` })),
        String(jail),
        (v) => {
          setJail(Number(v));
          refreshStatus();
        },
        'Get Out of Jail Free cards'
      );
      col.append(h('div', { class: 'field' }, h('label', {}, 'Get Out of Jail Free cards'), jailSel));
    }
    return col;
  };

  const renderCols = () => {
    clear(cols);
    const st = deps.getState();
    const pName = st.players.find((p) => p.id === partner)?.name ?? 'Partner';
    cols.append(
      column('You give', me, give, giveCash, (n) => (giveCash = n), giveJail, (n) => (giveJail = n)),
      column(`${pName} gives`, partner, get, getCash, (n) => (getCash = n), getJail, (n) => (getJail = n))
    );
    refreshStatus();
  };

  if (!counter) {
    const partnerSel = select(
      others.map((p) => ({ value: p.id, label: `${p.name}${p.kind === 'bot' ? ' (bot)' : ''}` })),
      partner,
      (v) => {
        partner = v;
        get.clear();
        getCash = 0;
        getJail = 0;
        renderCols();
      },
      'Trade partner'
    );
    partnerSel.setAttribute('data-testid', 'trade-partner');
    m.body.append(h('div', { class: 'field' }, h('label', {}, 'Trade with'), partnerSel));
  } else {
    const p = state.players.find((x) => x.id === counter.fromId);
    m.body.append(h('p', { class: 'muted' }, `Adjust the offer and send it back to ${p?.name ?? 'them'}.`));
  }
  m.body.append(
    h('p', { class: 'muted small-text', style: 'margin-top:0' }, 'Only one side can add cash. Properties in a group with buildings cannot be traded. Mortgaged property costs the receiver 10% interest.'),
    cols,
    summary,
    error
  );
  m.foot.append(button('Cancel', () => m.close(), { variant: 'ghost' }), submit);

  function send() {
    const err = validate();
    if (err) {
      error.textContent = err;
      return;
    }
    deps.dispatch(counter ? { type: 'COUNTER_TRADE', offer: offer() } : { type: 'PROPOSE_TRADE', offer: offer() });
    m.close();
  }

  renderCols();
  return m;
}
