/** "Properties" dialog: build, sell, mortgage and unmortgage the player's assets. */
import {
  buildingSaleValue,
  explainAction,
  getLegalActions,
  getSpace,
  groupSpaces,
  netWorth,
  ownedSpaces,
  unmortgageCost,
  type Action,
  type GameState,
  type RulesContext
} from '@pe/game-core';
import { button, clear, confirmDialog, h, modal, type ModalHandle } from './dom';
import { money } from './format';
import { settings } from '../settings';

export interface ManageDeps {
  ctx: RulesContext;
  me: string;
  /** Read-only view of another player when not me. */
  viewing?: string;
  dispatch: (a: Action) => void;
  focusTile: (index: number) => void;
  highlight: (spaces: number[]) => void;
  isBusy: () => boolean;
}

function housePips(n: number): HTMLElement {
  const wrap = h('span', { class: 'house-pips', 'aria-label': n === 5 ? 'hotel' : `${n} houses` });
  if (n === 5) wrap.append(h('i', { class: 'hotel' }));
  else for (let i = 0; i < n; i++) wrap.append(h('i'));
  return wrap;
}

export class ManageDialog {
  private handle: ModalHandle;

  constructor(
    private readonly deps: ManageDeps,
    state: GameState,
    onClose: () => void
  ) {
    const owner = state.players.find((p) => p.id === (deps.viewing ?? deps.me));
    const title = deps.viewing && deps.viewing !== deps.me ? `${owner?.name ?? 'Player'}’s properties` : 'Your properties';
    this.handle = modal(title, {
      wide: true,
      testid: 'manage-dialog',
      onClose: () => {
        deps.highlight([]);
        onClose();
      }
    });
    this.render(state);
  }

  close(): void {
    this.handle.close();
  }

  update(state: GameState): void {
    this.render(state);
  }

  private render(state: GameState): void {
    const { ctx, me } = this.deps;
    const who = this.deps.viewing ?? me;
    const mine = who === me;
    const body = this.handle.body;
    const scrollTop = body.scrollTop;
    clear(body);
    const player = state.players.find((p) => p.id === who);
    if (!player) return;
    const legal = mine ? getLegalActions(state, me, ctx) : null;
    const busy = this.deps.isBusy();
    if (legal) this.deps.highlight(legal.buildable);
    body.append(
      h(
        'div',
        { class: 'row between', style: 'margin-bottom:12px' },
        h('div', {}, h('b', {}, `Cash ${money(player.cash)}`), h('span', { class: 'muted' }, ` · net worth ${money(netWorth(state, ctx, who))}`)),
        player.jailCards.length ? h('span', { class: 'badge orange' }, `${player.jailCards.length} Get Out of Jail Free card${player.jailCards.length > 1 ? 's' : ''}`) : null
      )
    );
    const owned = ownedSpaces(state, who);
    if (!owned.length) {
      body.append(h('p', { class: 'muted' }, mine ? 'You do not own any property yet. Land on an available space to buy it.' : 'No properties.'));
      body.scrollTop = scrollTop;
      return;
    }
    if (mine && legal && !legal.buildable.length && !legal.sellable.length && !legal.mortgageable.length && !legal.unmortgageable.length) {
      body.append(h('div', { class: 'callout' }, state.turn.playerId === me ? 'No property actions are available right now.' : 'You can build and lift mortgages during your own turn. You can always look around.'));
    }
    for (const g of ctx.board.groups) {
      const members = groupSpaces(ctx, g.id);
      const mineHere = members.filter((i) => owned.includes(i));
      if (!mineHere.length) continue;
      const block = h('div', { class: 'group-block' }, h('div', { class: 'group-head' }, h('span', { class: 'swatch', style: `background:${g.color}` }), `${g.name}`, h('span', { class: 'muted small-text' }, `${mineHere.length}/${members.length}`)));
      for (const i of mineHere) {
        const s = getSpace(ctx, i);
        const prop = state.properties[i];
        if (!prop) continue;
        const status = prop.mortgaged ? h('span', { class: 'badge red' }, 'Mortgaged') : s.type === 'street' ? housePips(prop.houses) : null;
        const btns = h('div', { class: 'abtns' });
        if (mine && legal) {
          const act = (label: string, a: Action, ok: boolean, variant: '' | 'success' | 'warn' | 'danger' = '', confirmText?: string) => {
            const why = ok ? undefined : explainAction(state, me, a, ctx) ?? undefined;
            btns.append(
              button(
                label,
                () => {
                  if (confirmText && settings.get().confirmDestructive) {
                    void confirmDialog('Are you sure?', confirmText, label, true).then((yes) => yes && this.deps.dispatch(a));
                  } else this.deps.dispatch(a);
                },
                { small: true, variant, disabled: !ok || busy, title: why, testid: `${a.type.toLowerCase()}-${i}` }
              )
            );
          };
          if (s.type === 'street') {
            act(prop.houses === 4 ? `Hotel ${money(s.houseCost ?? 0)}` : `Build ${money(s.houseCost ?? 0)}`, { type: 'BUILD', space: i }, legal.buildable.includes(i), 'success');
            if (prop.houses > 0) act(`Sell +${money(buildingSaleValue(s))}`, { type: 'SELL_BUILDING', space: i }, legal.sellable.includes(i), 'warn');
          }
          if (prop.mortgaged) act(`Unmortgage ${money(unmortgageCost(state, s))}`, { type: 'UNMORTGAGE', space: i }, legal.unmortgageable.includes(i));
          else act(`Mortgage +${money(s.mortgage ?? 0)}`, { type: 'MORTGAGE', space: i }, legal.mortgageable.includes(i));
        }
        block.append(
          h(
            'div',
            { class: 'asset-row' },
            h('div', {}, h('div', { class: 'aname', role: 'button', tabindex: 0, onclick: () => this.deps.focusTile(i) }, s.name), h('div', { class: 'astatus' }, status)),
            btns
          )
        );
      }
      if (mine && legal) {
        const sellAll = mineHere.find((i) => legal.sellGroup.includes(i));
        if (sellAll !== undefined) {
          const total = members.reduce((sum, i) => sum + (state.properties[i]?.houses ?? 0) * buildingSaleValue(getSpace(ctx, i)), 0);
          block.append(
            h(
              'div',
              { class: 'asset-row' },
              h('span', { class: 'muted small-text' }, 'Sell every building in this group at once'),
              h(
                'div',
                { class: 'abtns' },
                button(
                  `Sell all +${money(total)}`,
                  () => {
                    const a: Action = { type: 'SELL_GROUP_BUILDINGS', space: sellAll };
                    if (settings.get().confirmDestructive) void confirmDialog('Sell all buildings?', `Sell every building in ${g.name} for ${money(total)}?`, 'Sell all', true).then((y) => y && this.deps.dispatch(a));
                    else this.deps.dispatch(a);
                  },
                  { small: true, variant: 'danger', disabled: busy }
                )
              )
            )
          );
        }
      }
      body.append(block);
    }
    body.scrollTop = scrollTop;
  }
}
