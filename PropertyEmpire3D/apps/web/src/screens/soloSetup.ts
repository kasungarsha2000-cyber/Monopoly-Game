import { createGame, PLAYER_COLORS, TOKENS, randomSeed, type Difficulty, type PlayerSetup, type TokenId } from '@pe/game-core';
import type { App } from '../app';
import { settings } from '../settings';
import { button, field, h, select, clear, toast } from '../ui/dom';
import { TOKEN_LABELS, tokenIcon } from '../ui/format';
import { backHeader } from './common';
import { menuScreen } from './menu';
import { gameScreen } from './game';
import { LocalSession } from '../session/LocalSession';

const BOT_NAMES = ['Ada', 'Bruno', 'Cleo', 'Dexter', 'Elsa', 'Felix', 'Gigi', 'Hugo', 'Iris', 'Jules', 'Kai', 'Luna'];

interface BotRow {
  name: string;
  difficulty: Difficulty;
}

export interface SoloSetup {
  name: string;
  token: TokenId;
  bots: BotRow[];
  startingCash: number;
  presetId: string;
}

let lastSetup: SoloSetup | null = null;

export function tokenPicker(current: TokenId, onPick: (t: TokenId) => void, color = '#4B91D1', taken: TokenId[] = []): HTMLElement {
  const wrap = h('div', { class: 'token-picker', role: 'group', 'aria-label': 'Choose your token' });
  const render = (sel: TokenId) => {
    clear(wrap);
    for (const t of TOKENS as readonly TokenId[]) {
      const b = h('button', { type: 'button', class: 'token-chip', 'aria-pressed': String(t === sel), disabled: taken.includes(t) && t !== sel, 'data-token': t });
      b.append(tokenIcon(t, color), h('span', {}, TOKEN_LABELS[t]));
      b.addEventListener('click', () => {
        render(t);
        onPick(t);
      });
      wrap.append(b);
    }
  };
  render(current);
  return wrap;
}

/** Start a solo game from a setup (also used by "Play again"). */
export function startSolo(app: App, setup: SoloSetup): void {
  lastSetup = setup;
  const players: PlayerSetup[] = [
    { id: 'you', name: setup.name || 'Player', kind: 'human', token: setup.token, color: PLAYER_COLORS[0] as string }
  ];
  const usedTokens = new Set<TokenId>([setup.token]);
  setup.bots.forEach((b, i) => {
    const token = (TOKENS as readonly TokenId[]).find((t) => !usedTokens.has(t)) as TokenId;
    usedTokens.add(token);
    players.push({ id: `bot${i + 1}`, name: b.name || `Bot ${i + 1}`, kind: 'bot', difficulty: b.difficulty, token, color: PLAYER_COLORS[(i + 1) % PLAYER_COLORS.length] as string });
  });
  const seed = randomSeed();
  const { state } = createGame({ players, presetId: setup.presetId, config: { startingCash: setup.startingCash }, seed }, app.ctx);
  const session = new LocalSession(state, 'you', randomSeed(), app.e2e);
  app.show((a) => gameScreen(a, session, { onPlayAgain: () => startSolo(app, setup) }));
}

export function soloSetupScreen(app: App): void {
  const s = settings.get();
  const setup: SoloSetup = lastSetup
    ? structuredClone(lastSetup)
    : {
        name: s.playerName || 'Player',
        token: (TOKENS as readonly string[]).includes(s.playerToken) ? (s.playerToken as TokenId) : 'pawn',
        bots: [
          { name: 'Ada', difficulty: 'easy' },
          { name: 'Bruno', difficulty: 'medium' },
          { name: 'Cleo', difficulty: 'hard' }
        ],
        startingCash: 1500,
        presetId: 'classic'
      };

  const nameInput = h('input', { class: 'input', value: setup.name, maxlength: 20, autocomplete: 'nickname', 'data-testid': 'solo-name' });
  nameInput.addEventListener('input', () => (setup.name = nameInput.value));

  const botList = h('div', { class: 'list', 'data-testid': 'bot-list' });
  const addBtn = button('Add bot', () => {
    if (setup.bots.length >= 7) return;
    const used = new Set(setup.bots.map((b) => b.name));
    setup.bots.push({ name: BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${setup.bots.length + 1}`, difficulty: 'medium' });
    renderBots();
  }, { small: true, testid: 'add-bot' });
  const renderBots = () => {
    clear(botList);
    setup.bots.forEach((b, i) => {
      const input = h('input', { class: 'input', value: b.name, maxlength: 20, 'aria-label': `Bot ${i + 1} name` });
      input.addEventListener('input', () => (b.name = input.value));
      const diff = select<Difficulty>(
        [
          { value: 'easy', label: 'Easy' },
          { value: 'medium', label: 'Medium' },
          { value: 'hard', label: 'Hard' }
        ],
        b.difficulty,
        (v) => (b.difficulty = v),
        `Bot ${i + 1} difficulty`
      );
      diff.style.maxWidth = '130px';
      const remove = button('Remove', () => {
        setup.bots.splice(i, 1);
        renderBots();
      }, { small: true, variant: 'ghost', disabled: setup.bots.length <= 1, ariaLabel: `Remove ${b.name}` });
      const color = PLAYER_COLORS[(i + 1) % PLAYER_COLORS.length] as string;
      botList.append(h('div', { class: 'list-item' }, h('span', { class: 'swatch', style: `background:${color}` }), h('div', { class: 'grow' }, input), diff, remove));
    });
    addBtn.disabled = setup.bots.length >= 7;
  };
  renderBots();

  const presets = app.ctx.rules.presets;
  const presetHint = h('div', { class: 'hint' }, presets.find((p) => p.id === setup.presetId)?.description ?? '');
  const presetSel = select(
    presets.map((p) => ({ value: p.id, label: p.name })),
    setup.presetId,
    (v) => {
      setup.presetId = v;
      const preset = presets.find((p) => p.id === v);
      presetHint.textContent = preset?.description ?? '';
      const cash = preset?.overrides.startingCash ?? app.ctx.rules.defaults.startingCash;
      setup.startingCash = cash;
      cashSel.value = String(cash);
    },
    'Rules preset'
  );
  presetSel.setAttribute('data-testid', 'solo-preset');
  const cashSel = select(
    ['1000', '1500', '2000', '2500', '3000'].map((v) => ({ value: v, label: `$${Number(v).toLocaleString()}` })),
    String(setup.startingCash),
    (v) => (setup.startingCash = Number(v)),
    'Starting cash'
  );

  const start = button(
    'Start Game',
    () => {
      if (setup.bots.length < 1) {
        toast('Add at least one bot', 'bad');
        return;
      }
      settings.update({ playerName: setup.name.trim(), playerToken: setup.token });
      startSolo(app, setup);
    },
    { variant: 'primary', block: true, testid: 'start-solo' }
  );

  const card = h(
    'div',
    { class: 'card wide', 'data-testid': 'solo-setup' },
    backHeader('Play Solo', () => app.show(menuScreen)),
    h(
      'div',
      { class: 'two-col' },
      h(
        'div',
        {},
        field('Your name', nameInput),
        h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Your token'), tokenPicker(setup.token, (t) => (setup.token = t), PLAYER_COLORS[0]))
      ),
      h(
        'div',
        {},
        h('div', { class: 'field' }, h('div', { class: 'row between' }, h('div', { class: 'field-label' }, 'Bots (1-7)'), addBtn), botList),
        field('Rules preset', presetSel),
        presetHint,
        field('Starting cash', cashSel)
      )
    ),
    start
  );
  app.root.append(h('div', { class: 'screen top' }, card));
  nameInput.focus();
}
