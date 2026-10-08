import type { App } from '../app';
import { h } from '../ui/dom';
import { backHeader } from './common';
import { menuScreen } from './menu';

/** Rules summary. Exported separately so the in-game menu can show it in a dialog. */
export function howToContent(): HTMLElement {
  const p = (t: string) => h('p', {}, t);
  const li = (t: string) => h('li', {}, t);
  return h(
    'div',
    { class: 'prose' },
    h('h3', {}, 'Goal'),
    p('Be the last player who is not bankrupt. In a Quick Game, the richest player after the round limit wins.'),
    h('h3', {}, 'Your turn'),
    h(
      'ul',
      {},
      li('Roll two dice and move. Passing or landing on GO pays $200.'),
      li('Doubles let you roll again. Three doubles in a row send you to Jail.'),
      li('Land on an unowned property to buy it, or send it to auction where everyone (including you) can bid in turn.'),
      li('Land on someone else’s property and you pay rent automatically. Mortgaged properties charge no rent.'),
      li('Fortune and Community Fund cards move you, pay you or charge you. Get Out of Jail Free cards can be kept or traded.')
    ),
    h('h3', {}, 'Building'),
    h(
      'ul',
      {},
      li('Own a whole color group to build houses. Rent on an undeveloped complete group is doubled.'),
      li('Build evenly: a street can only get another house when it has no more houses than the others in its group.'),
      li('Four houses on every street of the group let you upgrade to a hotel. The Bank has 32 houses and 12 hotels.'),
      li('Buildings sell back to the Bank for half price, evenly.')
    ),
    h('h3', {}, 'Money trouble'),
    h(
      'ul',
      {},
      li('Mortgage a property for its mortgage value (sell buildings in its group first). Lifting a mortgage costs the value plus 10%.'),
      li('If you cannot pay a debt, sell buildings, mortgage or trade to raise the money. If you still cannot, you are bankrupt: your assets go to the player you owe, or back to the Bank for auction.')
    ),
    h('h3', {}, 'Jail'),
    p('In Jail you can pay $50, use a Get Out of Jail Free card, or try to roll doubles (up to three turns). After the third failed roll you pay $50 and move. You still collect rent while in Jail.'),
    h('h3', {}, 'Trading'),
    p('Trade properties, cash and jail cards with any player. Both sides must agree, and properties in a group with buildings cannot be traded.'),
    h('h3', {}, 'Controls'),
    h(
      'ul',
      {},
      li('Drag to rotate the board, scroll or pinch to zoom, right-drag or two fingers to pan. Tap a space to inspect it.'),
      h('li', {}, h('kbd', {}, 'Space'), ' roll · ', h('kbd', {}, 'E'), ' end turn · ', h('kbd', {}, 'B'), ' buy · ', h('kbd', {}, 'A'), ' auction · ', h('kbd', {}, 'P'), ' properties · ', h('kbd', {}, 'T'), ' trade · ', h('kbd', {}, '+'), h('kbd', {}, '-'), ' zoom · ', h('kbd', {}, '0'), ' reset camera · ', h('kbd', {}, 'Esc'), ' menu')
    ),
    h('h3', {}, 'Playing with friends (LAN)'),
    p('One computer runs the host server (npm run start:lan). Everyone on the same Wi-Fi or phone hotspot opens the address it prints, then creates or joins a room with the 5-letter code. Browsers cannot discover games automatically, so share the code or the invite link.')
  );
}

export function howToScreen(app: App): void {
  app.root.append(h('div', { class: 'screen top' }, h('div', { class: 'card wide' }, backHeader('How to Play', () => app.show(menuScreen)), howToContent())));
}
