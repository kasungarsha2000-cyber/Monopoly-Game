/** Property card: full details of a board space, with optional actions. */
import { getSpace, groupSpaces, mortgageInterest, ownsWholeGroup, unmortgageCost, computeRent, type GameState, type RulesContext } from '@pe/game-core';
import { h } from './dom';
import { money, textOn } from './format';

const DESCRIPTIONS: Record<string, string> = {
  go: 'Collect $200 every time you pass or land on GO.',
  chance: 'Draw a Fortune card. It may move you, pay you or charge you.',
  community: 'Draw a Community Fund card.',
  jail: 'Just visiting, unless you were sent to Jail. Pay $50, use a card or roll doubles to get out.',
  free_parking: 'A free rest stop. With the Jackpot house rule, collect the tax pot here.',
  go_to_jail: 'Go directly to Jail. Do not pass GO, do not collect $200.'
};

export function groupColorOf(ctx: RulesContext, index: number): string {
  const s = getSpace(ctx, index);
  return ctx.board.groups.find((g) => g.id === s.group)?.color ?? '#5B6472';
}

export function propertyCard(ctx: RulesContext, state: GameState, index: number): HTMLElement {
  const s = getSpace(ctx, index);
  const prop = state.properties[index];
  const color = s.type === 'street' ? groupColorOf(ctx, index) : s.type === 'tax' ? '#E77979' : s.type === 'chance' ? '#A589CF' : s.type === 'community' ? '#55B98A' : '#5B6472';
  const owner = prop?.owner ? state.players.find((p) => p.id === prop.owner) : null;
  const groupName = ctx.board.groups.find((g) => g.id === s.group)?.name;
  const typeLabel =
    s.type === 'street' ? `${groupName} street` : s.type === 'transport' ? 'Transit' : s.type === 'utility' ? 'Utility' : s.type === 'tax' ? 'Tax' : s.type.replace(/_/g, ' ');
  const band = h('div', { class: `band ${textOn(color) === '#ffffff' ? '' : 'light'}`, style: `background:${color}` }, h('small', {}, typeLabel), s.name);
  const body = h('div', { class: 'body' });

  if (s.type === 'street' && s.rent) {
    const houses = prop?.houses ?? 0;
    const full = owner && s.group ? ownsWholeGroup(state, ctx, owner.id, s.group) : false;
    const rows: [string, number, boolean][] = [
      ['Rent', s.rent[0] ?? 0, !!owner && houses === 0 && !full],
      ['With full color group', (s.rent[0] ?? 0) * 2, !!owner && houses === 0 && full],
      ['With 1 house', s.rent[1] ?? 0, houses === 1],
      ['With 2 houses', s.rent[2] ?? 0, houses === 2],
      ['With 3 houses', s.rent[3] ?? 0, houses === 3],
      ['With 4 houses', s.rent[4] ?? 0, houses === 4],
      ['With a hotel', s.rent[5] ?? 0, houses === 5]
    ];
    body.append(h('table', {}, h('tbody', {}, ...rows.map(([label, v, cur]) => h('tr', { class: cur && !prop?.mortgaged ? 'current' : '' }, h('td', {}, label), h('td', {}, money(v)))))));
    body.append(h('div', { class: 'meta' }, h('span', {}, `Houses ${money(s.houseCost ?? 0)} each`), h('span', {}, `Hotel ${money(s.houseCost ?? 0)} + 4 houses`)));
  } else if (s.type === 'transport' && s.rent) {
    body.append(h('table', {}, h('tbody', {}, ...s.rent.map((r, i) => h('tr', {}, h('td', {}, `Rent with ${i + 1} transit stop${i ? 's' : ''}`), h('td', {}, money(r)))))));
  } else if (s.type === 'utility' && s.rent) {
    body.append(h('p', { style: 'margin:0 0 6px' }, `Owning one utility: rent is ${s.rent[0]}x the dice roll.`), h('p', { style: 'margin:0' }, `Owning both: ${s.rent[1]}x the dice roll.`));
  } else if (s.type === 'tax') {
    body.append(h('p', { style: 'margin:0' }, `Pay ${money(s.amount ?? 0)} to the Bank when you land here.`));
  } else {
    body.append(h('p', { style: 'margin:0' }, DESCRIPTIONS[s.type] ?? ''));
  }

  if (s.price) {
    const status: (HTMLElement | string)[] = [];
    if (owner) {
      status.push(h('span', {}, 'Owner: ', h('b', { style: `color:${owner.color}` }, owner.name)));
      if (prop?.mortgaged) status.push(h('span', { class: 'badge red' }, 'Mortgaged'));
      else if (prop) {
        const dice = state.turn.dice ? state.turn.dice[0] + state.turn.dice[1] : 7;
        const rentNow = computeRent(state, ctx, index, dice);
        if (rentNow) status.push(h('span', { class: 'badge blue' }, `Rent now ${money(rentNow)}${s.type === 'utility' ? ` (roll of ${dice})` : ''}`));
      }
    } else status.push(h('span', { class: 'badge green' }, 'Available'));
    body.append(
      h('div', { class: 'meta' }, h('span', {}, `Price ${money(s.price)}`), h('span', {}, `Mortgage ${money(s.mortgage ?? 0)}`)),
      h('div', { class: 'meta' }, ...status)
    );
    if (prop?.mortgaged) body.append(h('div', { class: 'small-text muted', style: 'margin-top:6px' }, `Lift mortgage for ${money(unmortgageCost(state, s))} (includes ${money(mortgageInterest(state, s))} interest).`));
    if (s.type === 'street' && s.group && owner) {
      const members = groupSpaces(ctx, s.group);
      const owned = members.filter((i) => state.properties[i]?.owner === owner.id).length;
      body.append(h('div', { class: 'small-text muted', style: 'margin-top:6px' }, `${owner.name} owns ${owned} of ${members.length} in this group.`));
    }
  }
  return h('div', { class: 'prop-card', 'data-testid': 'property-card', 'data-space': index }, band, body);
}
