import type { Action, GameEvent, GameState } from '@pe/game-core';

export interface GameUpdate {
  state: GameState;
  events: GameEvent[];
  /** Full resync without events (e.g. after reconnect). */
  snapshot?: boolean;
}

/**
 * GameSession: what the game screen talks to. A LocalSession runs the shared
 * rules engine and bots in the browser; a RemoteSession forwards intents to
 * the LAN server and receives authoritative updates.
 */
export interface GameSession {
  readonly kind: 'solo' | 'lan';
  readonly localPlayerId: string;
  readonly isHost: boolean;
  readonly state: GameState;
  dispatch(action: Action): void;
  onUpdate(cb: (u: GameUpdate) => void): () => void;
  onError(cb: (message: string) => void): () => void;
  /** The UI finished animating; local sessions may schedule the next bot move. */
  notifyIdle(): void;
  /** Pause bot moves while the player looks at the game menu (solo only; LAN games keep running). */
  setPaused(paused: boolean): void;
  /** Manual save. Resolves with a user-facing message. */
  save(): Promise<string>;
  dispose(): void;
}

export class Emitter<T> {
  private fns = new Set<(v: T) => void>();
  on(fn: (v: T) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(v: T): void {
    for (const f of [...this.fns]) f(v);
  }
}

/** Random id that also works on plain-http LAN pages (no secure-context APIs). */
export function randomId(): string {
  const a = new Uint32Array(3);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => n.toString(36)).join('');
}
