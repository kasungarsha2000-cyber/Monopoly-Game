# Test results

Recorded 2026-10-08 in a headless Linux container (Node v22.22.0, Chromium 1194 headless with SwiftShader software WebGL). All numbers below come from runs in this session.

## Summary

| Suite | Command | Result |
| --- | --- | --- |
| Typecheck + lint | `npm run lint` | Pass |
| Rules tests | `npx vitest run packages/game-core/tests/rules.test.ts` | 51 / 51 pass |
| Bot tests | `npx vitest run packages/game-core/tests/bots.test.ts` | 15 / 15 pass |
| Network integration tests | `npx vitest run tests/network` | 12 / 12 pass |
| All Vitest | `npm test` | 78 / 78 pass (about 6 s) |
| Browser tests | `npm run test:e2e` | 12 / 12 pass; then `--repeat-each=2`: 24 / 24 pass |
| Bot-only stress run | `npm run simulate -- 30 <n>` for n = 2, 3, 4, 6, 8 | 150 / 150 matches finished, 0 invariant violations, 0 fallback actions |

## Bot stress run detail

Invariants (non-negative integer cash, money conservation against MONEY events, building and card stock conservation, phase consistency) were checked after every single action.

| Players | Finished | Avg turns | Avg actions | Wins by difficulty |
| --- | --- | --- | --- | --- |
| 2 | 30/30 | 112 | 407 | easy 12, medium 18 |
| 3 | 30/30 | 131 | 493 | hard 13, medium 13, easy 4 |
| 4 | 30/30 | 169 | 642 | hard 13, medium 10, easy 7 |
| 6 | 30/30 | 192 | 711 | medium 16, hard 14 |
| 8 | 30/30 | 283 | 908 | hard 15, medium 11, easy 4 |

Head-to-head (60 two-player games per pairing, both seat orders): medium beats easy about 57%, hard beats easy about 60%, hard and medium are even (two-player games are luck-heavy).

## Defects found and fixed during testing

| Defect | Found by | Fix |
| --- | --- | --- |
| Bot-only games between cautious bots could run 600+ turns (nobody traded to complete a group) | bot matchup simulation | Shared trade valuation with self/other group weighting so bots agree on mutual group-completing swaps |
| Hard bots stopped building once opponents had hotels (reserve tied to the board's single worst rent) | bot matchup diagnostics | Reserve based on rent risk within reach of the next roll; spare properties mortgaged to fund houses |
| Invariant check flagged the brief state where a bankrupt player's assets are being auctioned | stress simulation | Invariant narrowed to turn phases only |
| Server dropped commands from a fast client (rate limiter) during an automated full match | network test | Rate limit made configurable; default unchanged for real players |
| Disconnect notice arrived after the presence snapshot | network test | Notice is now sent first |
| HUD layer intercepted all pointer events, so board tiles could not be clicked or dragged | browser smoke test | `pointer-events` scoped so only HUD panels capture input |
| Dice could land on the wrong face when a random yaw was added | code review while writing the renderer | Euler order YXZ so yaw never changes the top face |
| Phone bottom sheet (with a full property card) covered the bottom row of the board | mobile browser test | Compact card in the bottom sheet, height cap and matching camera framing |
| Reduced-motion card popups swallowed taps on the board | mobile browser test | Non-blocking popups are click-through |
| A player removed from a lobby automatically rejoined as a new seat | code review | Server close codes 4000-4099 stop client auto-reconnect |
| Results dialog showed "Round 31 / 30" and stale overlays | screenshot review | Round display capped; overlays cleared when results open |
| Graphics looked poor, especially on phones (Low preset forced: 1x pixels, no anti-aliasing, 1024 px board) | user report | New presets and defaults (see BUILD_STATUS), settings migration, 4096 px board art, wood table/frame, glossy lathe tokens, detailed buildings, rounded dice, image-based lighting, visible soft shadows, tighter phone framing |
| Directional shadows were invisible (washed out by ambient light) | debugging with ambient light disabled | Rebalanced key, fill, hemisphere and environment light |

## Verified behaviors (automated)

- The web app loads without uncaught errors; the WebGL canvas initializes and resizes.
- A full solo match is playable in the browser with no WebSocket connection; HUD balances match the engine.
- Mouse clicks and touch taps select board tiles and open property cards.
- Desktop (1366x820) and mobile (Pixel 7, 412x839) layouts: no horizontal overflow, touch-sized controls.
- Autosave restores a solo game after a reload.
- Two independent browser contexts join a LAN room by invite link, play with a server-side bot, and converge on identical state; a guest reload rejoins the same seat.
- The server rejects client-authored dice, illegal and duplicate commands, malformed and oversized messages, unknown rooms, and WebSocket connections from foreign origins (both from Node clients and from a browser page on another origin).
- Two WebSocket clients complete an entire match and finish with identical state.
- Host saves are atomic and a restarted server restores the room so players rejoin with their session tokens.

## Not tested (no hardware or engines available)

Real phones, Wi-Fi routers, phone hotspots, firewalls, Safari/Firefox/WebKit, real GPUs and frame rate, service-worker offline mode, HTTPS/WSS reverse proxy. See `BLOCKERS.md`.
