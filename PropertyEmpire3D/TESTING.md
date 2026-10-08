# Testing Property Empire 3D

| Command | Runner | What it covers |
| --- | --- | --- |
| `npm test` | Vitest | rules engine, bots, simulations, WebSocket server integration |
| `npm run test:core` | Vitest | only `packages/game-core/tests` |
| `npm run test:network` | Vitest | only `tests/network` |
| `npm run test:e2e` | Playwright | builds, starts the production server, drives real Chromium (desktop and a Pixel 7 mobile profile) |
| `npm run typecheck` | tsc | strict TypeScript for game-core, server, web and tests |
| `npm run lint` | tsc + `scripts/lint.mjs` | no `debugger`/`eval`/focused tests/unsafe `innerHTML` |
| `npm run simulate -- <games> <players>` | tsx | bot-only matches with invariants checked after every action |

## Rules tests (`packages/game-core/tests/rules.test.ts`)

Starting cash and board shape; dice range; random seeded first player; movement wrap; GO salary (passing and landing); direct Jail transfer pays no salary; doubles extra roll; three doubles to Jail; purchases; insufficient funds; decline starts an auction including the decliner; auction winner pays the bid; unaffordable bidders are skipped; unsold auctions; unowned/own/mortgaged rent; full-group doubling; house and hotel rent; transit and utility rent; full-group, mortgage and turn requirements for building; even building and selling; hotel stock swap; Bank stock never negative; selling a whole group; mortgage and 10% unmortgage interest; Jail fine, card, doubles and forced third-attempt fine; jailed players still collect rent; card effects applied exactly once, held jail cards, move-back, collect-from-each, nearest-transit double rent, repairs, Free Parking jackpot; trades transfer exactly the agreed items including jail cards; invalid trades rejected; reject/cancel/counteroffer; mortgage interest on traded property; debt resolution by mortgaging; bankruptcy to a player; bankruptcy to the Bank with property auctions; eliminated players get no turns; last solvent player wins; round limit; strict action parsing (client dice rejected); turn ownership; save validation and corrupted saves; resumed games continue identically.

The `act()` helper runs `checkInvariants` after every action: no negative or non-integer cash, every cash change explained by a MONEY event, building stock conserved, jail cards conserved, phase consistent with pending obligations, revision +1.

## Bot tests (`packages/game-core/tests/bots.test.ts`)

Every difficulty plays complete matches with only legal actions and no fallbacks; 2–8 player mixed matches terminate; across games bots bid, win auctions, build, trade, leave Jail, mortgage, pay debts and go bankrupt; round-limited games finish; buy, bid/pass, build, mutual trade, trade accept/reject, Jail exit, debt payment and bankruptcy decisions; bots never mutate the (deep-frozen) state they are given; turns stay bounded.

## Network tests (`tests/network/server.test.ts`)

Health check; room creation and join by code; lobby updates for all clients; unknown rooms rejected; host-only controls; identical initial state for every client with RNG and card order redacted; legal commands applied and broadcast with identical dice/state; illegal commands, client-authored dice and replayed action ids rejected; only one of two simultaneous commands accepted; reconnect with the session token restores the seat while a wrong token is refused; cross-origin connections rejected while LAN and same-host origins are allowed; malformed and oversized messages rejected; server-side bots act alongside humans; two clients play a complete match and finish with identical state; atomic saves and restore after a server restart.

## Browser tests (`tests/e2e`)

- `app.spec.ts`: menu loads without console errors, WebGL canvas exists, canvas resizes with the viewport, settings persist, How to Play opens, security headers on the static build.
- `solo.spec.ts`: a solo match played with the real buttons with no WebSocket opened; HUD cash matches the engine; mouse clicks select tiles; keyboard shortcuts, properties, trade and log dialogs; autosave restores after reload.
- `lan.spec.ts`: two browser contexts host and join (invite link), add a bot, start, play several turns and converge on the same state; a guest reload rejoins the same seat; wrong codes are reported; a page from another origin cannot open a WebSocket.
- `mobile.spec.ts` (Pixel 7 profile): no horizontal overflow, bottom-bar buttons on screen and touch-sized, touch play, touch taps select tiles.

Browser tests use `?e2e=1`, which only makes animations instant, speeds up local bots and exposes a read-only `window.__pe` helper (plus `act`, which goes through the same validated `dispatch` path as the buttons) and `window.__pe3d` (the renderer, for graphics debugging). Neither is enabled without the query parameter.

## Not automated

Real phones, real Wi-Fi routers and phone hotspots, Windows/macOS firewall prompts, Safari and Firefox engines and GPU-specific rendering are not covered by automated tests. See `docs/TEST_RESULTS.md`.
