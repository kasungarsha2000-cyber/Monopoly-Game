/**
 * LAN screens: create a room, join by code / invite link / manual address,
 * and the lobby where the host configures the match.
 */
import { normalizeRoomCode, TOKENS, type Difficulty, type LobbyView, type TokenId } from '@pe/game-core';
import type { App } from '../app';
import { settings } from '../settings';
import { button, clear, field, h, select, toast } from '../ui/dom';
import { tokenIcon } from '../ui/format';
import { backHeader } from './common';
import { menuScreen } from './menu';
import { tokenPicker } from './soloSetup';
import { gameScreen } from './game';
import { buildWsUrl, LanClient, RemoteSession, type ConnStatus, type StoredLanSession } from '../session/LanClient';

function healthUrl(serverInput: string): string {
  const ws = buildWsUrl(serverInput);
  return ws.replace(/^ws/, 'http').replace(/\/ws$/, '/health');
}

async function checkServer(serverInput: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(healthUrl(serverInput), { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    const body = (await res.json()) as { name?: string; version?: string };
    return body.name === 'property-empire' ? `Host server found (v${body.version ?? '?'})` : null;
  } catch {
    return null;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back */
  }
  const ta = h('textarea', { style: 'position:fixed;opacity:0' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function statusLine(): { el: HTMLElement; set: (kind: 'ok' | 'warn' | 'bad' | '', text: string, spinning?: boolean) => void } {
  const el = h('div', { class: 'status-line', role: 'status', 'aria-live': 'polite', 'data-testid': 'conn-status' });
  return {
    el,
    set(kind, text, spinning = false) {
      clear(el);
      el.append(spinning ? h('div', { class: 'spinner small' }) : h('span', { class: `dot ${kind}` }), h('span', {}, text));
    }
  };
}

/** Route a connected client to the lobby or the running game. */
function routeClient(app: App, client: LanClient): void {
  const offStart = client.gameStarted.on(() => {
    cleanup();
    openGame(app, client);
  });
  const offLobby = client.lobbyChanged.on((lobby) => {
    if (lobby.status === 'lobby') {
      cleanup();
      app.show((a) => lobbyScreen(a, client));
    }
  });
  const cleanup = () => {
    offStart();
    offLobby();
  };
  if (client.state) {
    cleanup();
    openGame(app, client);
  } else if (client.lobby?.status === 'lobby') {
    cleanup();
    app.show((a) => lobbyScreen(a, client));
  }
}

function openGame(app: App, client: LanClient): void {
  const session = new RemoteSession(client);
  app.show((a) =>
    gameScreen(a, session, {
      lan: client,
      onPlayAgain: () => {
        client.leave();
        app.show(lanCreateScreen);
      }
    })
  );
}

function connectFlow(app: App, client: LanClient, status: ReturnType<typeof statusLine>, onFail: () => void): void {
  status.set('', 'Connecting to the host...', true);
  const offs: (() => void)[] = [];
  const done = () => offs.forEach((o) => o());
  offs.push(
    client.rejected.on((reason) => {
      done();
      status.set('bad', reason);
      onFail();
    }),
    client.joined.on(() => {
      done();
      status.set('ok', 'Connected');
      routeClient(app, client);
    })
  );
}

export function lanCreateScreen(app: App): void {
  const s = settings.get();
  let token: TokenId = (TOKENS as readonly string[]).includes(s.playerToken) ? (s.playerToken as TokenId) : 'pawn';
  const nameInput = h('input', { class: 'input', value: s.playerName || '', maxlength: 20, placeholder: 'Your name', 'data-testid': 'lan-name' });
  const serverInput = h('input', { class: 'input', placeholder: 'Leave blank to use this page’s server', 'data-testid': 'lan-server' });
  const status = statusLine();
  const probe = () => {
    status.set('', 'Looking for the host server...', true);
    void checkServer(serverInput.value).then((msg) =>
      msg ? status.set('ok', msg) : status.set('warn', 'No host server answered at this address. Start it on the host computer with "npm run start:lan" (or "npm run dev:lan").')
    );
  };
  serverInput.addEventListener('change', probe);
  probe();
  const createBtn = button(
    'Create Room',
    () => {
      const name = nameInput.value.trim() || 'Host';
      settings.update({ playerName: name, playerToken: token });
      createBtn.disabled = true;
      const client = new LanClient(buildWsUrl(serverInput.value));
      connectFlow(app, client, status, () => (createBtn.disabled = false));
      client.connect({ create: true, name, token });
    },
    { variant: 'success', block: true, testid: 'create-room' }
  );
  app.root.append(
    h(
      'div',
      { class: 'screen top' },
      h(
        'div',
        { class: 'card wide', 'data-testid': 'lan-create' },
        backHeader('Create LAN Game', () => app.show(menuScreen)),
        h(
          'div',
          { class: 'callout' },
          'The room lives on the host computer running the Property Empire server. Everyone must be on the same Wi-Fi or phone hotspot. After creating the room, share its 5-letter code or invite link.'
        ),
        h(
          'div',
          { class: 'two-col' },
          h('div', {}, field('Your name', nameInput), h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Your token'), tokenPicker(token, (t) => (token = t)))),
          h('div', {}, field('Host server address (optional)', serverInput, 'Only needed if this page was not opened from the host server, e.g. 192.168.1.20:3001.'), status.el)
        ),
        createBtn
      )
    )
  );
}

export function joinScreen(app: App): void {
  const s = settings.get();
  let token: TokenId = (TOKENS as readonly string[]).includes(s.playerToken) ? (s.playerToken as TokenId) : 'gem';
  const params = new URLSearchParams(location.search);
  const codeInput = h('input', {
    class: 'input',
    value: params.get('room') ?? '',
    maxlength: 8,
    placeholder: 'ABCDE',
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: 'false',
    style: 'font-size:22px;letter-spacing:4px;text-transform:uppercase;font-weight:700',
    'data-testid': 'join-code'
  });
  const nameInput = h('input', { class: 'input', value: s.playerName || '', maxlength: 20, placeholder: 'Your name', 'data-testid': 'join-name' });
  const serverInput = h('input', { class: 'input', placeholder: 'Leave blank to use this page’s server', 'data-testid': 'join-server' });
  const status = statusLine();
  status.set('', 'Enter the code shown on the host’s screen.');
  const joinBtn = button(
    'Join',
    () => {
      const code = normalizeRoomCode(codeInput.value);
      if (code.length !== 5) {
        status.set('bad', 'Room codes have 5 characters.');
        return;
      }
      const name = nameInput.value.trim() || 'Guest';
      settings.update({ playerName: name, playerToken: token });
      joinBtn.disabled = true;
      const client = new LanClient(buildWsUrl(serverInput.value));
      connectFlow(app, client, status, () => (joinBtn.disabled = false));
      client.connect({ create: false, room: code, name, token });
    },
    { variant: 'primary', block: true, testid: 'join-room' }
  );
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
  });
  app.root.append(
    h(
      'div',
      { class: 'screen top' },
      h(
        'div',
        { class: 'card wide', 'data-testid': 'join-screen' },
        backHeader('Join LAN Game', () => app.show(menuScreen)),
        h(
          'div',
          { class: 'two-col' },
          h('div', {}, field('Room code', codeInput), field('Your name', nameInput), h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Your token'), tokenPicker(token, (t) => (token = t), '#3E7CB1'))),
          h(
            'div',
            {},
            field('Host server address (optional)', serverInput, 'Type the address the host’s server printed (e.g. 192.168.1.20:3001) if you did not open this page from it.'),
            h(
              'details',
              { class: 'callout' },
              h('summary', {}, 'Why can’t my browser find games automatically?'),
              h(
                'p',
                {},
                'Web pages are not allowed to scan the local network (no UDP broadcast or mDNS), so the host must share the room code or invite link. Phones must be on the same Wi-Fi or hotspot as the host computer. "localhost" on a phone means the phone itself, so always use the host’s network address. Guest or "client isolation" Wi-Fi networks can block connections.'
              )
            ),
            status.el
          )
        ),
        joinBtn
      )
    )
  );
  if (!codeInput.value) codeInput.focus();
}

export function rejoinLan(app: App, stored: StoredLanSession): void {
  const client = new LanClient(stored.wsUrl);
  const status = statusLine();
  app.show((a) => {
    a.root.append(h('div', { class: 'screen' }, h('div', { class: 'card' }, h('h2', {}, `Rejoining ${stored.room}`), status.el, button('Cancel', () => {
      client.leave();
      a.show(menuScreen);
    }, { variant: 'ghost' }))));
  });
  connectFlow(app, client, status, () => undefined);
  client.connect({ create: false, room: stored.room, name: stored.name || 'Player', token: 'pawn', sessionToken: stored.sessionToken });
}

/* ------------------------------------------------------------------ */
/* Lobby                                                               */
/* ------------------------------------------------------------------ */

function statusText(s: ConnStatus): [string, 'ok' | 'warn' | 'bad'] {
  switch (s) {
    case 'open':
      return ['Connected to host', 'ok'];
    case 'reconnecting':
      return ['Connection lost, reconnecting...', 'warn'];
    case 'connecting':
      return ['Connecting...', 'warn'];
    default:
      return ['Disconnected', 'bad'];
  }
}

export function lobbyScreen(app: App, client: LanClient): () => void {
  const status = statusLine();
  const body = h('div', {});
  const card = h('div', { class: 'card wide', 'data-testid': 'lobby' });
  let ready = false;
  const offs: (() => void)[] = [];

  const leave = () => {
    client.leave();
    app.show(menuScreen);
  };

  const render = (lobby: LobbyView) => {
    clear(body);
    const me = lobby.seats.find((s) => s.id === client.playerId);
    const isHost = lobby.hostId === client.playerId;
    ready = me?.ready ?? false;
    const codeBox = h(
      'div',
      { class: 'code-box' },
      h('div', { class: 'small-text muted' }, `${lobby.config.gameName} · room code`),
      h('div', { class: 'room-code', 'data-testid': 'room-code' }, lobby.room),
      ...lobby.inviteUrls.slice(0, 3).map((u) =>
        h(
          'div',
          { class: 'url-line' },
          h('code', { title: u }, u),
          button('Copy', () => void copyText(u).then((ok) => toast(ok ? 'Invite link copied' : 'Copy failed: select the link manually', ok ? 'good' : 'bad')), { small: true })
        )
      )
    );
    const seats = h('div', { class: 'list', 'data-testid': 'lobby-seats' });
    for (const s of lobby.seats) {
      const tags = [
        s.isHost ? h('span', { class: 'badge blue' }, 'Host') : null,
        s.kind === 'bot' ? h('span', { class: 'badge' }, `Bot · ${s.difficulty}`) : null,
        s.kind === 'human' && !s.isHost ? h('span', { class: `badge ${s.ready ? 'green' : 'orange'}` }, s.ready ? 'Ready' : 'Not ready') : null,
        s.kind === 'human' && !s.connected ? h('span', { class: 'badge red' }, 'Offline') : null,
        s.id === client.playerId ? h('span', { class: 'badge' }, 'You') : null
      ];
      const controls: HTMLElement[] = [];
      if (isHost && s.kind === 'bot') {
        const sel = select<Difficulty>(
          [
            { value: 'easy', label: 'Easy' },
            { value: 'medium', label: 'Medium' },
            { value: 'hard', label: 'Hard' }
          ],
          s.difficulty ?? 'medium',
          (v) => client.send({ type: 'SET_BOT_DIFFICULTY', seatId: s.id, difficulty: v }),
          `${s.name} difficulty`
        );
        sel.style.maxWidth = '120px';
        controls.push(sel);
      }
      if (isHost && s.id !== client.playerId) controls.push(button('Remove', () => client.send({ type: 'REMOVE_SEAT', seatId: s.id }), { small: true, variant: 'ghost' }));
      seats.append(h('div', { class: 'list-item' }, tokenIcon(s.token, s.color), h('div', { class: 'grow' }, h('div', { class: 'name' }, s.name), h('div', { class: 'row' }, ...tags)), ...controls));
    }

    const hostControls = isHost
      ? h(
          'div',
          {},
          h(
            'div',
            { class: 'row', style: 'margin:10px 0 14px' },
            ...(['easy', 'medium', 'hard'] as Difficulty[]).map((d) =>
              button(`+ ${d[0]?.toUpperCase()}${d.slice(1)} bot`, () => client.send({ type: 'ADD_BOT', difficulty: d }), { small: true, disabled: lobby.seats.length >= lobby.maxPlayers, testid: `add-bot-${d}` })
            )
          ),
          h(
            'div',
            { class: 'two-col' },
            field(
              'Game name',
              (() => {
                const input = h('input', { class: 'input', value: lobby.config.gameName, maxlength: 20 });
                input.addEventListener('change', () => client.send({ type: 'LOBBY_CONFIG', config: { gameName: input.value } }));
                return input;
              })()
            ),
            field(
              'Rules preset',
              select(app.ctx.rules.presets.map((p) => ({ value: p.id, label: p.name })), lobby.config.presetId, (v) => client.send({ type: 'LOBBY_CONFIG', config: { presetId: v } }))
            ),
            field(
              'Starting cash',
              select(['1000', '1500', '2000', '2500', '3000'].map((v) => ({ value: v, label: `$${Number(v).toLocaleString()}` })), String(lobby.config.startingCash), (v) => client.send({ type: 'LOBBY_CONFIG', config: { startingCash: Number(v) } }))
            ),
            field(
              'Round limit',
              select(['0', '20', '30', '50'].map((v) => ({ value: v, label: v === '0' ? 'None (play to the end)' : `${v} rounds` })), String(lobby.config.maxRounds), (v) => client.send({ type: 'LOBBY_CONFIG', config: { maxRounds: Number(v) } }))
            ),
            field(
              'If a player disconnects',
              select(['0', '30', '60', '180'].map((v) => ({ value: v, label: v === '0' ? 'Wait for them' : `Bot plays after ${v}s` })), String(lobby.config.autopilotSeconds), (v) => client.send({ type: 'LOBBY_CONFIG', config: { autopilotSeconds: Number(v) } }))
            )
          )
        )
      : h('p', { class: 'muted small-text' }, 'The host chooses the rules and starts the game.');

    const actions = h('div', { class: 'row', style: 'margin-top:14px' });
    if (isHost) {
      actions.append(button('Start Game', () => client.send({ type: 'START_GAME' }), { variant: 'primary', disabled: !lobby.canStart, testid: 'start-lan' }));
      if (lobby.startBlocker) actions.append(h('span', { class: 'muted small-text' }, lobby.startBlocker));
    } else {
      actions.append(
        button(ready ? 'I’m not ready' : 'I’m ready', () => client.send({ type: 'PLAYER_READY', ready: !ready }), { variant: ready ? '' : 'success', testid: 'ready-toggle' })
      );
    }
    actions.append(h('div', { class: 'grow' }), button('Leave', leave, { variant: 'ghost' }));
    body.append(codeBox, h('div', { class: 'field-label', style: 'margin-bottom:8px' }, `Players (${lobby.seats.length}/${lobby.maxPlayers})`), seats, hostControls, actions);
  };

  const [txt, kind] = statusText(client.status);
  status.set(kind, txt);
  card.append(backHeader('Lobby', leave), status.el, body);
  app.root.append(h('div', { class: 'screen top' }, card));
  if (client.lobby) render(client.lobby);
  offs.push(
    client.lobbyChanged.on(render),
    client.statusChanged.on((s) => {
      const [t, k] = statusText(s);
      status.set(k, t, s === 'reconnecting');
    }),
    client.errors.on((m) => toast(m, 'bad')),
    client.rejected.on((m) => {
      toast(m, 'bad', 4000);
      app.show(menuScreen);
    }),
    client.gameStarted.on(() => openGame(app, client))
  );
  return () => offs.forEach((o) => o());
}
