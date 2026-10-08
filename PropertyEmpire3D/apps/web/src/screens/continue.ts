import type { App } from '../app';
import { button, h, clear, toast, confirmDialog } from '../ui/dom';
import { timeAgo } from '../ui/format';
import { deleteSave, listSaves, loadSave, type SaveRecord } from '../storage';
import { backHeader } from './common';
import { menuScreen } from './menu';
import { gameScreen } from './game';
import { LocalSession } from '../session/LocalSession';
import { loadLanSession } from '../session/LanClient';
import { rejoinLan } from './lan';

function resume(app: App, rec: SaveRecord): void {
  const session = new LocalSession(rec.state, rec.humanId, rec.botSeed, app.e2e);
  app.show((a) =>
    gameScreen(a, session, {
      onPlayAgain: () => app.show(menuScreen)
    })
  );
}

export function continueScreen(app: App): void {
  const list = h('div', { class: 'list', 'data-testid': 'save-list' }, h('div', { class: 'row' }, h('div', { class: 'spinner small' }), 'Loading saves...'));
  const lan = loadLanSession();
  const lanBox = lan
    ? h(
        'div',
        { class: 'callout' },
        h('div', { class: 'row between' }, h('div', {}, h('b', {}, `LAN game ${lan.room}`), h('div', { class: 'small-text muted' }, `As ${lan.name || 'you'} · ${timeAgo(lan.at)}`)), button('Rejoin', () => rejoinLan(app, lan), { variant: 'success', small: true, testid: 'rejoin-lan' }))
      )
    : null;
  const render = async () => {
    let saves: SaveRecord[] = [];
    try {
      saves = await listSaves();
    } catch (e) {
      clear(list);
      list.append(h('div', { class: 'callout warn' }, `Saved games are unavailable: ${(e as Error).message}`));
      return;
    }
    clear(list);
    if (!saves.length) list.append(h('p', { class: 'muted' }, 'No saved solo games yet. Games autosave after every turn.'));
    for (const rec of saves) {
      const over = rec.state.phase === 'GAME_OVER';
      list.append(
        h(
          'div',
          { class: 'list-item' },
          h(
            'div',
            { class: 'grow' },
            h('div', { class: 'name' }, rec.name, ' ', rec.kind === 'backup' ? h('span', { class: 'badge' }, 'backup') : null, over ? h('span', { class: 'badge' }, 'finished') : null),
            h('div', { class: 'small-text muted' }, `${rec.summary.players.join(', ')} · round ${rec.summary.round} · ${timeAgo(rec.savedAt)}`)
          ),
          button(
            'Load',
            () => {
              loadSave(rec.id)
                .then((r) => resume(app, r))
                .catch((e: Error) => toast(e.message, 'bad', 4000));
            },
            { variant: 'primary', small: true, disabled: over, testid: `load-${rec.id}` }
          ),
          button(
            'Delete',
            () => {
              void confirmDialog('Delete save?', `Delete "${rec.name}"? This cannot be undone.`, 'Delete', true).then((ok) => {
                if (ok) void deleteSave(rec.id).then(render);
              });
            },
            { variant: 'ghost', small: true }
          )
        )
      );
    }
  };
  void render();
  app.root.append(h('div', { class: 'screen top' }, h('div', { class: 'card wide', 'data-testid': 'continue-screen' }, backHeader('Continue', () => app.show(menuScreen)), lanBox, list)));
}
