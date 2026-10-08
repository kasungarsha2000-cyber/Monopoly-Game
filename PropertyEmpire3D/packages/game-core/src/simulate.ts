/**
 * Headless bot-only match simulation, used by tests and `npm run simulate`.
 */
import type { Difficulty, GameEvent, GameState, PlayerSetup, RulesConfig, RulesContext } from './types';
import { defaultContext } from './board';
import { createGame, PLAYER_COLORS, TOKENS } from './engine';
import { BotDriver } from './bots/driver';
import { checkInvariants } from './invariants';

export interface SimulationOptions {
  players?: number;
  difficulties?: Difficulty[];
  seed?: number;
  maxActions?: number;
  config?: Partial<RulesConfig>;
  presetId?: string;
  checkInvariantsEveryStep?: boolean;
  ctx?: RulesContext;
  onStep?: (state: GameState, events: GameEvent[]) => void;
}

export interface SimulationResult {
  state: GameState;
  actions: number;
  finished: boolean;
  fallbacks: number;
  invariantErrors: string[];
  eventCounts: Record<string, number>;
}

export function botPlayers(count: number, difficulties: Difficulty[] = ['easy', 'medium', 'hard']): PlayerSetup[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `bot${i + 1}`,
    name: `Bot ${i + 1}`,
    kind: 'bot' as const,
    difficulty: difficulties[i % difficulties.length] as Difficulty,
    token: TOKENS[i % TOKENS.length] as PlayerSetup['token'],
    color: PLAYER_COLORS[i % PLAYER_COLORS.length] as string
  }));
}

export function simulateBotGame(opts: SimulationOptions = {}): SimulationResult {
  const ctx = opts.ctx ?? defaultContext();
  const seed = opts.seed ?? 1;
  const createOpts: Parameters<typeof createGame>[0] = { players: botPlayers(opts.players ?? 4, opts.difficulties), seed };
  if (opts.config) createOpts.config = opts.config;
  if (opts.presetId) createOpts.presetId = opts.presetId;
  let { state } = createGame(createOpts, ctx);
  const driver = new BotDriver({ seed: seed ^ 0x9e3779b9, ctx });
  const maxActions = opts.maxActions ?? 20000;
  const eventCounts: Record<string, number> = {};
  const invariantErrors: string[] = [];
  let actions = 0;
  let fallbacks = 0;
  while (state.phase !== 'GAME_OVER' && actions < maxActions) {
    const actor = driver.actingBot(state);
    if (!actor) {
      invariantErrors.push(`No bot can act in phase ${state.phase}`);
      break;
    }
    const step = driver.step(state, actor);
    if (!step) {
      invariantErrors.push(`Bot ${actor} found no legal action in ${state.phase}`);
      break;
    }
    if (step.usedFallback) fallbacks++;
    for (const e of step.events) eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;
    if (opts.checkInvariantsEveryStep) {
      const errs = checkInvariants(step.state, ctx, state, step.events);
      for (const e of errs) invariantErrors.push(`action ${actions} ${step.action.type}: ${e}`);
      if (errs.length) {
        state = step.state;
        break;
      }
    }
    opts.onStep?.(step.state, step.events);
    state = step.state;
    actions++;
  }
  return { state, actions, finished: state.phase === 'GAME_OVER', fallbacks, invariantErrors, eventCounts };
}
