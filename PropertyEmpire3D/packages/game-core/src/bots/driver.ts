/**
 * BotManager: picks the bot (or autopiloted human) that must act, asks the
 * strategy for a decision, and applies it through the engine with a safe
 * fallback so a bot turn always terminates with legal commands.
 */
import type { Action, Difficulty, GameEvent, GameState, RulesContext } from '../types';
import { defaultContext } from '../board';
import { applyAction, pendingActors } from '../engine';
import { createRandom } from '../rng';
import { findPlayer } from '../rules/helpers';
import { chooseBotAction, createBotMemory, fallbackActions, type BotMemory } from './strategy';

export interface BotStepResult {
  playerId: string;
  action: Action;
  reason: string;
  state: GameState;
  events: GameEvent[];
  usedFallback: boolean;
}

export interface BotDriverOptions {
  seed?: number;
  ctx?: RulesContext;
  /** Keep the last N decisions for debugging. */
  logLimit?: number;
  /** Print decisions to the console. */
  debug?: boolean;
}

export class BotDriver {
  readonly memory: BotMemory = createBotMemory();
  readonly decisionLog: string[] = [];
  private readonly rand: () => number;
  private readonly ctx: RulesContext;
  private readonly logLimit: number;
  private readonly debug: boolean;

  constructor(opts: BotDriverOptions = {}) {
    this.rand = createRandom(opts.seed ?? 0x5eed);
    this.ctx = opts.ctx ?? defaultContext();
    this.logLimit = opts.logLimit ?? 200;
    this.debug = opts.debug ?? false;
  }

  /**
   * The player a bot should act for right now, if any.
   * @param autopilot ids of humans that bots temporarily play for (e.g. disconnected).
   */
  actingBot(state: GameState, autopilot: ReadonlySet<string> = new Set()): string | null {
    for (const id of pendingActors(state)) {
      const p = findPlayer(state, id);
      if (p && !p.bankrupt && (p.kind === 'bot' || autopilot.has(id))) return id;
    }
    return null;
  }

  /** Decide and apply one action for the given player. Returns null if nothing applies. */
  step(state: GameState, playerId: string, difficultyOverride?: Difficulty): BotStepResult | null {
    let view = state;
    if (difficultyOverride) {
      const p = findPlayer(state, playerId);
      if (p && p.difficulty !== difficultyOverride) {
        view = structuredClone(state);
        const vp = findPlayer(view, playerId);
        if (vp) vp.difficulty = difficultyOverride;
      }
    }
    const decision = chooseBotAction(view, this.ctx, playerId, this.memory, this.rand);
    const candidates: { action: Action; reason: string; fallback: boolean }[] = [];
    if (decision) candidates.push({ ...decision, fallback: false });
    for (const a of fallbackActions(state, this.ctx, playerId)) candidates.push({ action: a, reason: 'fallback', fallback: true });
    for (const c of candidates) {
      const result = applyAction(state, playerId, c.action, this.ctx);
      if (result.ok) {
        this.record(state, playerId, c.action, c.reason, c.fallback);
        return { playerId, action: c.action, reason: c.reason, state: result.state, events: result.events, usedFallback: c.fallback };
      }
      if (!c.fallback) this.record(state, playerId, c.action, `rejected: ${result.error}`, false);
    }
    return null;
  }

  private record(state: GameState, playerId: string, action: Action, reason: string, fallback: boolean): void {
    const name = findPlayer(state, playerId)?.name ?? playerId;
    const line = `[t${state.turn.number} ${state.phase}] ${name}: ${action.type}${'space' in action ? ` #${action.space}` : ''}${
      action.type === 'BID' ? ` $${action.amount}` : ''
    } - ${reason}${fallback ? ' (fallback)' : ''}`;
    this.decisionLog.push(line);
    if (this.decisionLog.length > this.logLimit) this.decisionLog.splice(0, this.decisionLog.length - this.logLimit);
    if (this.debug) console.debug('[bot]', line);
  }
}
