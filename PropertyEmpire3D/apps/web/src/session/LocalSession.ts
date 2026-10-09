/**
 * Solo games: the exact shared rules engine and bots run in the browser, no
 * server required. Bots act only after the UI has finished animating the
 * previous move, so players can follow what happened.
 */
import { applyAction, BotDriver, type Action, type GameEvent, type GameState } from '@pe/game-core';
import { saveGame } from '../storage';
import { settings } from '../settings';
import { Emitter, type GameSession, type GameUpdate } from './types';
import { APP_PAUSE } from '../platform';

const AUTOSAVE_EVENTS = new Set(['TURN_ENDED', 'PROPERTY_BOUGHT', 'AUCTION_WON', 'TRADE_ACCEPTED', 'BANKRUPT', 'GAME_OVER', 'BUILT', 'MORTGAGED', 'UNMORTGAGED']);

export class LocalSession implements GameSession {
  readonly kind = 'solo' as const;
  readonly isHost = true;
  private current: GameState;
  private readonly driver: BotDriver;
  private readonly updates = new Emitter<GameUpdate>();
  private readonly errors = new Emitter<string>();
  private botTimer: number | null = null;
  private disposed = false;
  private paused = false;
  private saveTimer: number | null = null;
  private visibilityHandler = () => {
    if (document.visibilityState === 'hidden') this.autosaveNow();
  };
  private appPauseHandler = () => this.autosaveNow();

  constructor(
    state: GameState,
    readonly localPlayerId: string,
    private readonly botSeed: number,
    private readonly fastBots = false
  ) {
    this.current = state;
    this.driver = new BotDriver({ seed: botSeed, debug: new URLSearchParams(location.search).has('botdebug') });
    document.addEventListener('visibilitychange', this.visibilityHandler);
    window.addEventListener(APP_PAUSE, this.appPauseHandler);
    this.autosaveNow();
  }

  get state(): GameState {
    return this.current;
  }

  /** Recent bot decisions (for debugging via the console). */
  get botLog(): readonly string[] {
    return this.driver.decisionLog;
  }

  dispatch(action: Action): void {
    this.apply(this.localPlayerId, action);
  }

  private apply(playerId: string, action: Action): boolean {
    if (this.disposed) return false;
    const r = applyAction(this.current, playerId, action);
    if (!r.ok) {
      this.errors.emit(r.error);
      return false;
    }
    this.commit(r.state, r.events);
    return true;
  }

  private commit(state: GameState, events: GameEvent[]): void {
    this.current = state;
    this.updates.emit({ state, events });
    if (events.some((e) => AUTOSAVE_EVENTS.has(e.type))) this.scheduleAutosave();
  }

  onUpdate(cb: (u: GameUpdate) => void): () => void {
    return this.updates.on(cb);
  }

  onError(cb: (message: string) => void): () => void {
    return this.errors.on(cb);
  }

  private botDelay(): number {
    if (this.fastBots) return 20;
    const speed = settings.get().animationSpeed;
    const [min, max] = speed === 'normal' ? [450, 900] : speed === 'fast' ? [150, 350] : [100, 200];
    return min + Math.random() * (max - min);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused && this.botTimer !== null) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
  }

  notifyIdle(): void {
    if (this.disposed || this.paused || this.botTimer !== null || this.current.phase === 'GAME_OVER') return;
    const bot = this.driver.actingBot(this.current);
    if (!bot) return;
    this.botTimer = window.setTimeout(() => {
      this.botTimer = null;
      if (this.disposed) return;
      const actor = this.driver.actingBot(this.current);
      if (!actor) return;
      const step = this.driver.step(this.current, actor);
      if (!step) {
        this.errors.emit('A bot could not find a legal move.');
        return;
      }
      this.commit(step.state, step.events);
    }, this.botDelay());
  }

  private scheduleAutosave(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.autosaveNow();
    }, 800);
  }

  private autosaveNow(): void {
    saveGame('autosave', this.current, this.localPlayerId, this.botSeed).catch(() => {
      /* storage may be unavailable (private mode); the game keeps running */
    });
  }

  async save(): Promise<string> {
    try {
      await saveGame('manual', this.current, this.localPlayerId, this.botSeed, `Round ${this.current.round} - ${new Date().toLocaleString()}`);
      return 'Game saved';
    } catch (e) {
      return `Could not save: ${(e as Error).message}`;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.botTimer !== null) clearTimeout(this.botTimer);
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.autosaveNow();
    }
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    window.removeEventListener(APP_PAUSE, this.appPauseHandler);
  }
}
