/**
 * Host-side persistence of LAN rooms. Writes are atomic: data goes to a
 * temporary file that is fsynced and renamed over the target, and the
 * previous save is kept as a .bak backup.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateGameState, isValidRoomCode, type GameState, type LobbyConfig, type Difficulty, type TokenId } from '@pe/game-core';

export const ROOM_SAVE_VERSION = 1;

export interface SavedSeat {
  id: string;
  name: string;
  kind: 'human' | 'bot';
  difficulty: Difficulty | null;
  token: TokenId;
  color: string;
  isHost: boolean;
  /** Reconnect secret (never logged or sent to other clients). */
  sessionToken: string | null;
}

export interface RoomSave {
  version: number;
  room: string;
  savedAt: number;
  status: 'lobby' | 'playing' | 'finished';
  hostId: string;
  config: LobbyConfig;
  seats: SavedSeat[];
  state: GameState | null;
}

export async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.copyFile(path, `${path}.bak`);
  } catch {
    /* no previous save */
  }
  await fs.rename(tmp, path);
}

export class SaveStore {
  constructor(readonly dir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private file(room: string): string {
    if (!isValidRoomCode(room)) throw new Error('Invalid room code');
    return join(this.dir, `${room}.json`);
  }

  async save(data: RoomSave): Promise<void> {
    await writeAtomic(this.file(data.room), JSON.stringify(data));
  }

  /** Validate a parsed save; returns an error message or null. */
  static validate(data: unknown): string | null {
    if (typeof data !== 'object' || data === null) return 'not an object';
    const d = data as Partial<RoomSave>;
    if (d.version !== ROOM_SAVE_VERSION) return 'unsupported version';
    if (!isValidRoomCode(d.room)) return 'invalid room code';
    if (!Array.isArray(d.seats) || d.seats.length < 1 || d.seats.length > 8) return 'invalid seats';
    if (d.state) {
      const err = validateGameState(d.state);
      if (err) return err;
    }
    return null;
  }

  async load(room: string): Promise<RoomSave | null> {
    for (const candidate of [this.file(room), `${this.file(room)}.bak`]) {
      try {
        const data: unknown = JSON.parse(await fs.readFile(candidate, 'utf8'));
        if (!SaveStore.validate(data)) return data as RoomSave;
      } catch {
        /* try backup */
      }
    }
    return null;
  }

  async list(): Promise<string[]> {
    try {
      return (await fs.readdir(this.dir)).filter((f) => /^[A-Z0-9]{5}\.json$/.test(f)).map((f) => f.slice(0, 5));
    } catch {
      return [];
    }
  }

  async remove(room: string): Promise<void> {
    await fs.rm(this.file(room), { force: true });
  }
}
