/**
 * RoomManager: creates rooms with short random codes, routes joins, restores
 * saved rooms after a server restart and cleans up idle rooms.
 */
import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, isValidRoomCode, normalizeRoomCode, type ClientMessage } from '@pe/game-core';
import { Room, type ClientLink, type RoomOptions } from './Room';
import { SaveStore } from '../saves';

export interface RoomManagerOptions extends Omit<RoomOptions, 'save'> {
  store: SaveStore | null;
  maxRooms: number;
  /** Idle time before an empty room is unloaded from memory (it stays saved). */
  idleMs: number;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly linkRoom = new Map<ClientLink, Room>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(private readonly opts: RoomManagerOptions) {}

  private roomOptions(): RoomOptions {
    const store = this.opts.store;
    return {
      botDelayMs: this.opts.botDelayMs,
      inviteBases: this.opts.inviteBases,
      log: this.opts.log,
      save: store ? (data) => store.save(data) : async () => undefined
    };
  }

  newCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(0, ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Could not allocate a room code');
  }

  /** Restore rooms with unfinished games from disk so players can rejoin after a restart. */
  async restore(): Promise<number> {
    const store = this.opts.store;
    if (!store) return 0;
    let restored = 0;
    for (const code of await store.list()) {
      const data = await store.load(code);
      if (!data || data.status !== 'playing' || !data.state) continue;
      if (Date.now() - data.savedAt > 7 * 24 * 3600 * 1000) continue;
      this.rooms.set(code, Room.fromSave(data, this.roomOptions()));
      restored++;
    }
    return restored;
  }

  async join(link: ClientLink, msg: Extract<ClientMessage, { type: 'JOIN_REQUEST' }>): Promise<string | null> {
    const previous = this.linkRoom.get(link);
    if (previous) return 'Already in a room';
    let room: Room | undefined;
    if (msg.create) {
      if (this.rooms.size >= this.opts.maxRooms) this.sweep(true);
      if (this.rooms.size >= this.opts.maxRooms) return 'The server has too many rooms open';
      room = new Room(this.newCode(), this.roomOptions());
      this.rooms.set(room.code, room);
    } else {
      const code = normalizeRoomCode(msg.room ?? '');
      if (!isValidRoomCode(code)) return 'Enter a valid 5-character room code';
      room = this.rooms.get(code);
      if (!room && this.opts.store) {
        const data = await this.opts.store.load(code);
        if (data && data.status === 'playing' && data.state) {
          room = Room.fromSave(data, this.roomOptions());
          this.rooms.set(code, room);
        }
      }
      if (!room || room.isClosed) return 'Room not found. Check the code and that you are on the same network.';
    }
    const err = room.join(link, msg);
    if (err) {
      if (msg.create) this.rooms.delete(room.code);
      return err;
    }
    this.linkRoom.set(link, room);
    return null;
  }

  roomOf(link: ClientLink): Room | undefined {
    return this.linkRoom.get(link);
  }

  disconnect(link: ClientLink): void {
    const room = this.linkRoom.get(link);
    this.linkRoom.delete(link);
    room?.detach(link);
  }

  /** Unload idle rooms (saving them first). */
  sweep(force = false): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const idle = now - room.lastActivity;
      const limit = room.status === 'playing' ? this.opts.idleMs : Math.min(this.opts.idleMs, 10 * 60 * 1000);
      if (room.isClosed || (room.isEmpty() && (force || idle > limit))) {
        if (room.status === 'playing') void room.save();
        room.close('Room closed after being idle');
        this.rooms.delete(code);
      }
    }
  }

  startSweeper(intervalMs = 60_000): void {
    this.sweeper = setInterval(() => this.sweep(), intervalMs);
    this.sweeper.unref?.();
  }

  async shutdown(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    const saves: Promise<void>[] = [];
    for (const room of this.rooms.values()) {
      if (room.status === 'playing') saves.push(room.save());
      room.close('The host server is shutting down. Your game was saved.');
    }
    await Promise.all(saves);
    this.rooms.clear();
  }
}
