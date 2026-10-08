import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chooseBotAction,
  createBotMemory,
  createRandom,
  pendingActors,
  type GameState,
  type ServerMessage
} from '@pe/game-core';
import { createGameServer, type GameServer } from '../../apps/server/src/server';
import { TestClient } from './client';

const servers: GameServer[] = [];
const clients: TestClient[] = [];
const dirs: string[] = [];

async function startServer(opts: { saveDir?: string; botDelayMs?: number; fast?: boolean } = {}) {
  const server = await createGameServer({
    port: 0,
    host: '127.0.0.1',
    saveDir: opts.saveDir ?? null,
    botDelayMs: opts.botDelayMs ?? 0,
    ...(opts.fast ? { rateLimit: { burst: 10000, perSecond: 10000 } } : {}),
    log: () => undefined
  });
  servers.push(server);
  return server;
}

async function connect(server: GameServer, origin?: string): Promise<TestClient> {
  const c = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`, origin);
  clients.push(c);
  await c.next('HELLO');
  return c;
}

async function createRoom(server: GameServer, name = 'Host') {
  const host = await connect(server);
  host.send({ type: 'JOIN_REQUEST', create: true, name, token: 'pawn' });
  const accepted = await host.next('JOIN_ACCEPTED');
  return { host, room: accepted.room, hostId: accepted.playerId, token: accepted.sessionToken };
}

async function joinRoom(server: GameServer, room: string, name = 'Guest') {
  const c = await connect(server);
  c.send({ type: 'JOIN_REQUEST', create: false, room, name, token: 'gem' });
  const accepted = await c.next('JOIN_ACCEPTED');
  return { client: c, playerId: accepted.playerId, token: accepted.sessionToken };
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined);
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Start a 2-human game and return both clients with their initial state. */
async function startTwoHumanGame(server: GameServer, extraBots = 0) {
  const { host, room, hostId } = await createRoom(server);
  const guest = await joinRoom(server, room);
  for (let i = 0; i < extraBots; i++) host.send({ type: 'ADD_BOT', difficulty: 'medium' });
  if (extraBots) await host.next('LOBBY_UPDATE', (m) => m.lobby.seats.length === 2 + extraBots);
  guest.client.send({ type: 'PLAYER_READY', ready: true });
  await host.next('LOBBY_UPDATE', (m) => m.lobby.canStart);
  host.send({ type: 'START_GAME' });
  const s1 = await host.next('GAME_START');
  const s2 = await guest.client.next('GAME_START');
  return { host, guest: guest.client, hostId, guestId: guest.playerId, room, s1, s2, guestToken: guest.token };
}

describe('LAN server', () => {
  it('starts and answers the health check', async () => {
    const server = await startServer();
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; name: string };
    expect(body).toMatchObject({ ok: true, name: 'property-empire' });
  });

  it('creates a room, lets a second client join by code and updates the lobby for everyone', async () => {
    const server = await startServer();
    const { host, room } = await createRoom(server);
    expect(room).toMatch(/^[A-Z2-9]{5}$/);
    const guest = await joinRoom(server, room.toLowerCase());
    const lobbyHost = await host.next('LOBBY_UPDATE', (m) => m.lobby.seats.length === 2);
    const lobbyGuest = await guest.client.next('LOBBY_UPDATE', (m) => m.lobby.seats.length === 2);
    expect(lobbyHost.lobby.seats.map((s) => s.name)).toEqual(['Host', 'Guest']);
    expect(lobbyGuest.lobby.hostId).toBe(lobbyHost.lobby.hostId);
    expect(lobbyHost.lobby.inviteUrls[0]).toContain(`?room=${room}`);
    expect(JSON.stringify(lobbyHost)).not.toContain(guest.token);
  });

  it('rejects unknown rooms and lets only the host add bots or start', async () => {
    const server = await startServer();
    const stranger = await connect(server);
    stranger.send({ type: 'JOIN_REQUEST', create: false, room: 'ZZZZZ', name: 'X' });
    expect((await stranger.next('JOIN_REJECTED')).reason).toMatch(/not found/i);

    const { host, room } = await createRoom(server);
    const guest = await joinRoom(server, room);
    guest.client.send({ type: 'ADD_BOT', difficulty: 'hard' });
    expect((await guest.client.next('ERROR')).reason).toMatch(/host/);
    host.send({ type: 'START_GAME' });
    expect((await host.next('ERROR')).reason).toMatch(/ready/);
    host.send({ type: 'ADD_BOT', difficulty: 'hard' });
    const lobby = await host.next('LOBBY_UPDATE', (m) => m.lobby.seats.length === 3);
    expect(lobby.lobby.seats[2]).toMatchObject({ kind: 'bot', difficulty: 'hard' });
  });

  it('starts a game where every client receives the same canonical state', async () => {
    const server = await startServer();
    const { s1, s2, hostId, guestId } = await startTwoHumanGame(server);
    expect(s1.state).toEqual(s2.state);
    expect(s1.state.players.map((p) => p.id).sort()).toEqual([hostId, guestId].sort());
    expect(s1.state.rngState).toBe(0); // RNG is never revealed to clients
    expect(s1.state.decks.chance.every((c) => c === 'hidden')).toBe(true);
  });

  it('applies valid commands, rejects illegal ones and client-authored dice, and keeps clients in sync', async () => {
    const server = await startServer();
    const { host, guest, hostId, guestId, s1 } = await startTwoHumanGame(server);
    const current = s1.state.turn.playerId;
    const [active, idle] = current === hostId ? [host, guest] : [guest, host];
    const idleId = current === hostId ? guestId : hostId;

    // Not your turn.
    idle.send({ type: 'REQUEST_ACTION', id: 'x1', action: { type: 'ROLL' } });
    expect((await idle.next('ACTION_REJECTED')).reason).toMatch(/not your turn/i);

    // Client-authored dice are malformed and never reach the engine.
    active.send({ type: 'REQUEST_ACTION', id: 'x2', action: { type: 'ROLL', dice: [6, 6] } });
    expect((await active.next('ERROR')).reason).toMatch(/Malformed/);

    active.send({ type: 'REQUEST_ACTION', id: 'roll-1', action: { type: 'ROLL' } });
    const ack = await active.next('ACTION_ACCEPTED', (m) => m.id === 'roll-1');
    const e1 = await host.next('GAME_EVENT', (m) => m.rev === ack.rev);
    const e2 = await guest.next('GAME_EVENT', (m) => m.rev === ack.rev);
    expect(e1.state).toEqual(e2.state);
    const dice1 = e1.events.find((e) => e.type === 'DICE_ROLLED');
    const dice2 = e2.events.find((e) => e.type === 'DICE_ROLLED');
    expect(dice1).toEqual(dice2);
    expect(dice1).toBeTruthy();

    // A replayed action id is ignored.
    active.send({ type: 'REQUEST_ACTION', id: 'roll-1', action: { type: 'ROLL' } });
    expect((await active.next('ACTION_REJECTED', (m) => m.id === 'roll-1')).reason).toMatch(/Duplicate/);
    void idleId;
  });

  it('only one of two simultaneous commands is accepted', async () => {
    const server = await startServer();
    const { host, guest, s1 } = await startTwoHumanGame(server);
    host.send({ type: 'REQUEST_ACTION', id: 'h', action: { type: 'ROLL' } });
    guest.send({ type: 'REQUEST_ACTION', id: 'g', action: { type: 'ROLL' } });
    const results = await Promise.all([
      host.next('ACTION_ACCEPTED', () => true, 3000).catch(() => null),
      guest.next('ACTION_ACCEPTED', () => true, 3000).catch(() => null)
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const st = (await host.next('GAME_EVENT')).state;
    expect(st.revision).toBe(s1.state.revision + 1);
  });

  it('reconnecting with the session token restores the same player', async () => {
    const server = await startServer();
    const { host, guest, guestId, guestToken, room } = await startTwoHumanGame(server);
    await guest.close();
    expect((await host.next('PLAYER_DISCONNECTED')).playerId).toBe(guestId);
    const snap = await host.next('STATE_SNAPSHOT', (m) => m.state.players.some((p) => p.id === guestId && !p.connected));
    expect(snap.state.players.find((p) => p.id === guestId)?.connected).toBe(false);

    const again = await connect(server);
    again.send({ type: 'JOIN_REQUEST', create: false, room, name: 'Whoever', sessionToken: guestToken });
    const accepted = await again.next('JOIN_ACCEPTED');
    expect(accepted.playerId).toBe(guestId);
    const restored = await again.next('STATE_SNAPSHOT');
    expect(restored.state.players.find((p) => p.id === guestId)?.name).toBe('Guest');
    expect(restored.state.players.find((p) => p.id === guestId)?.connected).toBe(true);
    expect((await host.next('PLAYER_RECONNECTED')).playerId).toBe(guestId);

    // A wrong token cannot take over an in-progress game.
    const intruder = await connect(server);
    intruder.send({ type: 'JOIN_REQUEST', create: false, room, name: 'Mallory', sessionToken: 'not-a-real-token' });
    expect((await intruder.next('JOIN_REJECTED')).reason).toMatch(/seat could not be found/);
  });

  it('rejects cross-origin browser connections but allows LAN and same-host origins', async () => {
    const server = await startServer();
    await expect(TestClient.connect(`ws://127.0.0.1:${server.port}/ws`, 'https://evil.example.com')).rejects.toThrow(/403/);
    const lan = await connect(server, 'http://192.168.1.20:5173');
    expect(lan.closed).toBe(false);
    const local = await connect(server, `http://localhost:${server.port}`);
    expect(local.closed).toBe(false);
  });

  it('rejects malformed and oversized messages', async () => {
    const server = await startServer();
    const c = await connect(server);
    c.sendRaw('{not json');
    expect((await c.next('ERROR')).reason).toMatch(/Malformed/);
    c.send({ type: 'JOIN_REQUEST', create: true, name: 'A', evil: true });
    expect((await c.next('ERROR')).reason).toMatch(/Malformed/);
    c.send({ type: 'REQUEST_ACTION', id: 'z', action: { type: 'ROLL' } });
    expect((await c.next('ERROR')).reason).toMatch(/Join a room/);
    c.sendRaw('x'.repeat(64 * 1024));
    const code = await c.waitClosed();
    expect(code).toBe(1009);
  });

  it('runs bot turns on the server alongside humans', async () => {
    const server = await startServer({ botDelayMs: 0 });
    const { host, guest, hostId, guestId } = await startTwoHumanGame(server, 2);
    let state: GameState = (host.last('GAME_START') as Extract<ServerMessage, { type: 'GAME_START' }>).state;
    const botActions = new Set<string>();
    const mem = createBotMemory();
    const rand = createRandom(5);
    // Humans auto-play using the same heuristics until bots have acted several times.
    for (let i = 0; i < 400 && botActions.size < 2 && state.phase !== 'GAME_OVER'; i++) {
      const actor = pendingActors(state)[0];
      if (actor === hostId || actor === guestId) {
        const decision = chooseBotAction(state, (await import('@pe/game-core')).defaultContext(), actor, mem, rand);
        if (!decision) break;
        const c = actor === hostId ? host : guest;
        c.send({ type: 'REQUEST_ACTION', id: `a${i}`, action: decision.action });
      }
      const ev = await host.next('GAME_EVENT', (m) => m.rev > state.revision, 5000);
      state = ev.state;
      if (ev.actorId !== hostId && ev.actorId !== guestId) botActions.add(ev.actorId);
    }
    expect(botActions.size).toBe(2);
  });

  it('two human clients can complete a whole match with identical final state', async () => {
    const server = await startServer({ botDelayMs: 0, fast: true });
    const { host, guest, hostId, guestId, s1 } = await startTwoHumanGame(server);
    const ctx = (await import('@pe/game-core')).defaultContext();
    let hostState = s1.state;
    let guestState = s1.state;
    const memory = createBotMemory();
    const rand = createRandom(11);
    let n = 0;
    host.messages.length = 0;
    guest.messages.length = 0;
    const onEvent = (client: TestClient, set: (s: GameState) => void) =>
      client.ws.on('message', (d) => {
        const m = JSON.parse(d.toString()) as ServerMessage;
        if (m.type === 'GAME_EVENT' || m.type === 'STATE_SNAPSHOT') set(m.state);
      });
    onEvent(host, (s) => (hostState = s));
    onEvent(guest, (s) => (guestState = s));
    while (hostState.phase !== 'GAME_OVER' && n < 5000) {
      const actor = pendingActors(hostState)[0];
      const decision = actor ? chooseBotAction(hostState, ctx, actor, memory, rand) : null;
      if (!decision) break;
      const before = hostState.revision;
      (actor === hostId ? host : guest).send({ type: 'REQUEST_ACTION', id: `m${n++}`, action: decision.action });
      const deadline = Date.now() + 3000;
      while (hostState.revision === before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2));
      if (hostState.revision === before) {
        const c = actor === hostId ? host : guest;
        const rej = c.last('ACTION_REJECTED');
        throw new Error(`Action ${JSON.stringify(decision.action)} by ${actor} in ${hostState.phase} (turn ${hostState.turn.playerId}) was not applied: ${rej?.reason}`);
      }
    }
    expect(hostState.phase).toBe('GAME_OVER');
    await new Promise((r) => setTimeout(r, 50));
    expect(guestState).toEqual(hostState);
    expect([hostId, guestId]).toContain(hostState.winnerId);
    expect((await host.next('GAME_ENDED')).winnerId).toBe(hostState.winnerId);
  }, 120_000);

  it('saves the host game atomically and restores it after a server restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pe-saves-'));
    dirs.push(dir);
    const server = await startServer({ saveDir: dir });
    const { host, guestToken, guestId, room, s1 } = await startTwoHumanGame(server);
    host.send({ type: 'SAVE_GAME' });
    await host.next('SAVED');
    expect(readdirSync(dir)).toContain(`${room}.json`);
    expect(readdirSync(dir).some((f) => f.endsWith('.tmp'))).toBe(false);
    await server.close();
    servers.splice(servers.indexOf(server), 1);

    const server2 = await startServer({ saveDir: dir });
    const again = await connect(server2);
    again.send({ type: 'JOIN_REQUEST', create: false, room, name: 'Guest', sessionToken: guestToken });
    expect((await again.next('JOIN_ACCEPTED')).playerId).toBe(guestId);
    const snap = await again.next('STATE_SNAPSHOT');
    expect(snap.state.gameId).toBe(s1.state.gameId);
    expect(snap.state.players.map((p) => p.cash)).toEqual(s1.state.players.map((p) => p.cash));
  });
});
