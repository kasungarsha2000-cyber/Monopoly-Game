/**
 * Title deed view: the large property card shown in the right-hand panel on
 * wide screens and in a dialog on phones.
 */
import {
  computeRent,
  countOwnedInGroup,
  getSpace,
  groupSpaces,
  mortgageInterest,
  ownsWholeGroup,
  unmortgageCost,
  type Action,
  type GameState,
  type LegalActions,
  type RulesContext,
  type SpaceDef
} from '@pe/game-core';
import { button, h } from './dom';
import { money, plural } from './format';
import { icon } from './icons';
import { deedArt } from './art';

const DESCRIPTIONS: Record<string, string> = {
  go: 'Collect $200 every time you pass or land on GO.',
  chance: 'Draw a Fortune card. It may move you, pay you or charge you.',
  community: 'Draw a Community Fund card.',
  jail: 'Just visiting, unless you were sent to Jail. Pay $50, use a card or roll doubles to get out.',
  free_parking: 'A free rest stop. With the Jackpot house rule, collect the tax pot here.',
  go_to_jail: 'Go directly to Jail. Do not pass GO, do not collect $200.'
};

const SPACE_COLORS: Record<string, string> = {
  go: '#3A936A',
  chance: '#8E6CC0',
  community: '#3A936A',
  tax: '#D9534F',
  jail: '#E08A2E',
  free_parking: '#4B91D1',
  go_to_jail: '#C94F4F'
};

export function spaceColor(ctx: RulesContext, space: SpaceDef): string {
  if (space.group) return ctx.board.groups.find((g) => g.id === space.group)?.color ?? '#5B6472';
  return SPACE_COLORS[space.type] ?? '#5B6472';
}

export function districtName(ctx: RulesContext, space: SpaceDef): string {
  if (space.group) return ctx.board.groups.find((g) => g.id === space.group)?.name ?? '';
  if (space.type === 'tax') return 'Tax';
  if (space.type === 'chance') return 'Fortune card';
  if (space.type === 'community') return 'Community card';
  return 'Corner';
}

export function buildingLabel(houses: number): string {
  if (houses === 5) return 'Hotel';
  return plural(houses, 'house');
}

export interface DeedOptions {
  ctx: RulesContext;
  state: GameState;
  index: number;
  me: string;
  /** Null while animations play: actions are hidden. */
  legal: LegalActions | null;
  act: (a: Action) => void;
  nameOf: (id: string) => string;
}

export function deedView(o: DeedOptions): HTMLElement {
  const { ctx, state, index } = o;
  const s = getSpace(ctx, index);
  const prop = state.properties[index];
  const color = spaceColor(ctx, s);
  const owner = prop?.owner ? state.players.find((p) => p.id === prop.owner) : undefined;
  const houses = prop?.houses ?? 0;
  const ownable = !!s.price;

  const root = h('article', { class: 'deed', 'data-testid': 'deed', 'data-space': index, style: `--deed:${color}`, 'aria-label': `Title deed: ${s.name}` });

  root.append(
    h(
      'header',
      { class: 'deed-head' },
      h('div', { class: 'deed-eyebrow' }, h('span', {}, ownable ? 'Title deed' : 'Board space'), h('span', {}, districtName(ctx, s))),
      h('h2', { class: 'deed-name' }, s.name)
    )
  );

  const art = h('div', { class: 'deed-art-wrap' }, deedArt(s, color, houses));
  if (houses > 0) art.append(h('span', { class: 'deed-art-chip' }, buildingLabel(houses)));
  root.append(art);

  if (!ownable) {
    const text = s.type === 'tax' ? `Pay ${money(s.amount ?? 0)} to the Bank when you land here.` : (DESCRIPTIONS[s.type] ?? '');
    root.append(h('p', { class: 'deed-desc' }, text));
    const here = state.players.filter((p) => !p.bankrupt && p.position === index);
    if (here.length) root.append(h('p', { class: 'deed-desc muted' }, `Here now: ${here.map((p) => o.nameOf(p.id)).join(', ')}`));
    return root;
  }

  // Ownership status.
  const status = h('div', { class: 'deed-status' });
  if (!owner) status.append(h('span', { class: 'pill pill-free' }, h('i', { class: 'dot' }), 'For sale'));
  else if (owner.id === o.me) status.append(h('span', { class: 'pill pill-mine' }, h('i', { class: 'dot' }), icon('check', 14), 'Your property'));
  else status.append(h('span', { class: 'pill', style: `--pill:${owner.color}` }, h('i', { class: 'dot' }), `Owned by ${owner.name}`));
  if (prop?.mortgaged) status.append(h('span', { class: 'chip chip-red' }, 'Mortgaged'));
  else if (houses > 0) status.append(h('span', { class: 'chip' }, buildingLabel(houses)));
  root.append(status);

  // Headline figures.
  const dice = state.turn.dice ? state.turn.dice[0] + state.turn.dice[1] : 7;
  let rentLabel = owner ? 'Current rent' : 'Base rent';
  let rentValue: string;
  if (s.type === 'utility') {
    const n = owner ? countOwnedInGroup(state, ctx, owner.id, s.group ?? '') : 1;
    rentValue = `${s.rent?.[Math.max(0, n - 1)] ?? 0}× dice`;
    if (owner && !prop?.mortgaged) rentLabel = `Rent (roll of ${dice})`;
    if (owner && !prop?.mortgaged) rentValue = money(computeRent(state, ctx, index, dice));
  } else if (owner) {
    rentValue = prop?.mortgaged ? '$0' : money(computeRent(state, ctx, index, dice));
  } else rentValue = money(s.rent?.[0] ?? 0);
  root.append(
    h(
      'div',
      { class: 'deed-figures' },
      h('div', {}, h('span', { class: 'label' }, 'Purchase price'), h('span', { class: 'big' }, money(s.price ?? 0))),
      h('div', {}, h('span', { class: 'label' }, rentLabel), h('span', { class: 'big' }, rentValue))
    )
  );

  // Color group ownership.
  if (s.group) {
    const members = groupSpaces(ctx, s.group);
    const byOwner = owner ? members.filter((i) => state.properties[i]?.owner === owner.id).length : 0;
    const icons = h('div', { class: 'deed-group-icons' });
    for (const i of members) {
      const p = state.properties[i];
      const mine = !!owner && p?.owner === owner.id;
      const tile = h('span', { class: `gtile ${mine ? 'on' : ''} ${i === index ? 'this' : ''}`, title: getSpace(ctx, i).name }, icon(s.type === 'street' ? 'house' : s.type === 'transport' ? 'trade' : 'cash', 14));
      icons.append(tile);
    }
    const label = owner ? `${byOwner} of ${members.length} in ${s.type === 'street' ? 'color group' : 'this set'}` : `${members.length} in ${s.type === 'street' ? 'color group' : 'this set'}`;
    root.append(h('div', { class: 'deed-group' }, icons, h('span', {}, label)));
  }

  // Rent table.
  const rows: { label: string; value: string; current: boolean }[] = [];
  if (s.type === 'street' && s.rent) {
    const full = owner && s.group ? ownsWholeGroup(state, ctx, owner.id, s.group) : false;
    const live = !!owner && !prop?.mortgaged;
    rows.push(
      { label: 'Base rent', value: money(s.rent[0] ?? 0), current: live && houses === 0 && !full },
      { label: 'Full color group', value: money((s.rent[0] ?? 0) * 2), current: live && houses === 0 && full }
    );
    for (let n = 1; n <= 4; n++) rows.push({ label: plural(n, 'house'), value: money(s.rent[n] ?? 0), current: live && houses === n });
    rows.push({ label: 'Hotel', value: money(s.rent[5] ?? 0), current: live && houses === 5 });
  } else if (s.type === 'transport' && s.rent) {
    const n = owner && !prop?.mortgaged ? countOwnedInGroup(state, ctx, owner.id, s.group ?? '') : 0;
    s.rent.forEach((r, i) => rows.push({ label: `${i + 1} ${i ? 'stops' : 'stop'} owned`, value: money(r), current: n === i + 1 }));
  } else if (s.type === 'utility' && s.rent) {
    const n = owner && !prop?.mortgaged ? countOwnedInGroup(state, ctx, owner.id, s.group ?? '') : 0;
    rows.push({ label: 'One utility', value: `${s.rent[0]}× dice`, current: n === 1 }, { label: 'Both utilities', value: `${s.rent[1]}× dice`, current: n === 2 });
  }
  const table = h('table', { class: 'deed-rent' });
  const tbody = h('tbody');
  for (const r of rows) tbody.append(h('tr', { class: r.current ? 'current' : '' }, h('td', {}, r.label), h('td', {}, r.value)));
  table.append(tbody);
  root.append(table);

  const notes = h('dl', { class: 'deed-notes' });
  if (s.houseCost) notes.append(h('div', {}, h('dt', {}, 'House cost'), h('dd', {}, `${money(s.houseCost)} each`)));
  notes.append(h('div', {}, h('dt', {}, 'Mortgage value'), h('dd', {}, money(s.mortgage ?? 0))));
  if (prop?.mortgaged) notes.append(h('div', {}, h('dt', {}, 'Lift mortgage'), h('dd', {}, `${money(unmortgageCost(state, s))} (incl. ${money(mortgageInterest(state, s))})`)));
  root.append(notes);

  // Actions available to the local player on this space.
  const acts = h('div', { class: 'deed-actions' });
  const L = o.legal;
  if (L) {
    if (L.canBuy && state.pendingPurchase === index) acts.append(button(`Buy for ${money(s.price ?? 0)}`, () => o.act({ type: 'BUY' }), { variant: 'primary', small: true, testid: 'deed-buy' }));
    if (prop?.owner === o.me) {
      if (L.buildable.includes(index)) acts.append(button(houses === 4 ? 'Build hotel' : `Build house · ${money(s.houseCost ?? 0)}`, () => o.act({ type: 'BUILD', space: index }), { variant: 'primary', small: true, testid: 'deed-build' }));
      if (L.sellable.includes(index)) acts.append(button('Sell building', () => o.act({ type: 'SELL_BUILDING', space: index }), { small: true }));
      if (L.mortgageable.includes(index)) acts.append(button(`Mortgage +${money(s.mortgage ?? 0)}`, () => o.act({ type: 'MORTGAGE', space: index }), { small: true }));
      if (L.unmortgageable.includes(index)) acts.append(button('Lift mortgage', () => o.act({ type: 'UNMORTGAGE', space: index }), { small: true }));
    }
  }
  if (acts.childElementCount) root.append(acts);
  return root;
}

export function groupColorOf(ctx: RulesContext, index: number): string {
  return spaceColor(ctx, getSpace(ctx, index));
}
