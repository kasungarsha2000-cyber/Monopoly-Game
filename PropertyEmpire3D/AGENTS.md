# Notes for contributors and coding agents

## Principles

- **Rules are pure and shared.** `packages/game-core` has no runtime dependencies and no DOM/Node APIs beyond `structuredClone`. The browser (solo) and the server (LAN) run the same `applyAction`.
- **One source of truth.** `GameState` is plain JSON. The phase is derived by `settle()` from pending obligations (trade → debts → auction → auction queue → pending purchase → turn), so there are no ad-hoc transitions.
- **Validate, then execute on a clone.** `applyAction(state, playerId, action)` validates with `validateAction`, clones, executes, settles and bumps `revision`. The input state is never mutated.
- **Bots only choose actions.** `chooseBotAction` returns an `Action`; `BotDriver.step` applies it through the engine and falls back to safe actions if it is rejected.
- **Configuration is data.** Board, cards and rule presets are JSON in `packages/game-core/data`. `resolveConfig` clamps untrusted overrides.
- **The client never decides outcomes.** Over the network clients send intents only. `parseAction`/`parseClientMessage` reject unknown fields (e.g. client dice).

## Where things live

| Module (spec name) | File |
| --- | --- |
| GameState, types | `packages/game-core/src/types.ts` |
| RulesEngine | `packages/game-core/src/engine.ts` |
| TurnManager | `packages/game-core/src/rules/turn.ts`, `rules/movement.ts` |
| BoardData | `packages/game-core/src/board.ts`, `data/board.json` |
| PropertyManager | `packages/game-core/src/rules/property.ts`, `rules/helpers.ts` |
| AuctionManager | `packages/game-core/src/rules/auction.ts` |
| TradeManager | `packages/game-core/src/rules/trade.ts` |
| CardManager | `packages/game-core/src/rules/movement.ts` (`drawCard`), `data/cards.json` |
| BankruptcyManager | `packages/game-core/src/rules/bankruptcy.ts` |
| BotManager / BotStrategy | `packages/game-core/src/bots/driver.ts`, `bots/strategy.ts` |
| Legal actions | `packages/game-core/src/legal.ts` |
| Save validation, action parsing | `packages/game-core/src/validation.ts` |
| Network protocol | `packages/game-core/src/protocol.ts` |
| NetworkManager (server) | `apps/server/src/server.ts`, `rooms/Room.ts`, `rooms/RoomManager.ts`, `network/*` |
| SaveManager | `apps/web/src/storage.ts` (IndexedDB), `apps/server/src/saves.ts` (atomic files) |
| GameSession | `apps/web/src/session/LocalSession.ts`, `session/LanClient.ts` |
| BoardRenderer3D, TokenAnimator, DiceAnimator | `apps/web/src/three/BoardRenderer.ts`, `dice.ts`, `camera.ts`, `layout.ts`, `boardTexture.ts`, `meshes.ts` |
| UIManager | `apps/web/src/screens/*`, `apps/web/src/ui/*` |
| AudioManager | `apps/web/src/audio.ts` |
| SettingsManager | `apps/web/src/settings.ts` |

## Conventions

- Strict TypeScript, no implicit `any`. Run `npm run typecheck && npm test` before committing; run `npm run test:e2e` after UI changes.
- UI text is set with `textContent` (the `h()` helper). Never put player-controlled strings into `innerHTML`.
- The renderer draws on demand; call `invalidate()` after changing the scene and use `Tweens` for animation so frames stop when idle.
- Animations are derived from engine events after the fact; never let rendering decide game results.
- Adding a rule: implement validation in `validateAction`, execution in `execute`, cover it in `rules.test.ts`, and make sure bots have a fallback for any new phase.
