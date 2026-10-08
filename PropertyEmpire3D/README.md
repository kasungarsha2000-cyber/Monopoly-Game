# Property Empire 3D

A friendly, Monopoly-inspired 3D property trading board game that runs in any modern browser on desktop or phone. Play solo against offline bots, or host a game on your home Wi-Fi or phone hotspot so friends can join from their own browsers. No accounts, no cloud services, no installs for players.

Everything here is original: board names, card texts, artwork (drawn procedurally at runtime), tokens and branding. The rules are classic-inspired and configurable.

## Features

- **3D board in the browser** (Three.js/WebGL): a wooden tabletop and walnut board frame, 40 labeled spaces painted procedurally at up to 4096 px, glossy turned tokens, houses and hotels with roofs and windows, rounded dice, soft shadows and image-based reflections, ownership strips, mortgage dimming, selection and build highlights. Everything is generated in code, with no image or model downloads.
- **Complete rules**: dice and doubles, three-doubles-to-Jail, GO salary, purchases and round-robin auctions, rent (color-group doubling, buildings, transit and utilities), even building with a limited Bank stock (32 houses / 12 hotels), selling buildings, mortgages with 10% interest, two 16-card decks, Get Out of Jail Free cards, trading with counteroffers, debt resolution, bankruptcy to players or the Bank (with auctions), winner detection, optional round limit and Free Parking jackpot.
- **Bots**: Easy, Medium and Hard heuristic bots that buy, bid, build, mortgage, trade, manage debt and get out of Jail. Fully offline, deterministic in tests, always legal (with a safe fallback).
- **LAN multiplayer**: an authoritative Node.js WebSocket room server. Join by 5-letter room code, invite link or manual server address. Mixed humans and bots, reconnect with a session token, autopilot for disconnected players, host-side saves.
- **Save and resume**: solo games autosave to IndexedDB (with a backup); LAN games are saved atomically on the host and restored after a server restart.
- **Responsive UI**: desktop mouse and keyboard, phone touch controls, portrait and landscape, reduced motion, graphics quality, volume and camera settings.
- **Sound**: all effects and the soft background music are synthesized with Web Audio (no audio files).

## Game rules (summary)

| Rule | Default |
| --- | --- |
| Players | 2 to 8 (humans and/or bots) |
| Starting cash | $1,500 (configurable) |
| Passing or landing on GO | +$200 |
| Doubles | roll again; three in a row sends you to Jail |
| Unowned property | buy it, or it goes to auction (everyone may bid, including you) |
| Rent | doubled on undeveloped streets when the owner has the whole color group; no rent on mortgaged property |
| Building | whole color group, no mortgages in the group, build and sell evenly, hotel after 4 houses everywhere |
| Mortgage | receive the mortgage value; lifting it costs value + 10% |
| Jail | pay $50, use a card, or roll doubles (3 tries; after the 3rd failure you pay $50 and move) |
| Bankruptcy | assets go to the creditor player, or back to the Bank and are auctioned |
| Winning | last solvent player (Quick Game preset: richest after 30 rounds) |

Presets: **Classic**, **Quick Game** ($2,000 start, 30-round limit) and **Jackpot House Rules** (taxes and fees build a Free Parking jackpot). All numbers live in `packages/game-core/data/*.json`.

## Controls

- **Mouse**: drag to rotate, scroll to zoom, right-drag (or Shift+drag) to pan, click a space to inspect it.
- **Touch**: drag to rotate, pinch to zoom, two-finger drag to pan, tap a space to inspect it.
- **Keyboard**: `Space`/`R` roll, `E` end turn, `B` buy, `A` send to auction, `P` properties, `T` trade, `L` log, `+`/`-` zoom, arrow keys rotate, `0` reset camera, `Esc` menu or close dialog.
- On-screen `+`, `−` and reset buttons are always available.

## Requirements

- Node.js 20.19+ (tested with Node 22 LTS) and npm 10.
- A WebGL-capable browser: recent Chrome, Edge, Firefox or Safari (desktop or mobile).

## Quick start

```bash
cd PropertyEmpire3D
npm install          # .npmrc sets legacy-peer-deps (works around an npm 10 peer-resolution bug)
npm run build        # builds apps/web/dist and apps/server/dist
npm start            # serves the game at http://localhost:3001/
```

## How to play solo entirely in the browser

1. Start any server that serves the build (`npm start`, `npm run dev`, or copy `apps/web/dist` to any static host).
2. Open the page and choose **Play Solo**.
3. Pick your name and token, add 1 to 7 bots with Easy/Medium/Hard difficulty, choose a preset and starting cash, and press **Start Game**.

Solo games run the shared rules engine and bots inside your browser; no WebSocket or game server is involved after the page has loaded.

To get the solo game as **one self-contained HTML file** (for example to host it as a single page), run `npm run build:artifact -- path/to/output.html`. That page has LAN play turned off because there is no host server behind it. On `localhost` or HTTPS the app also installs a small service worker so solo play keeps working offline after the first visit.

## How to host a Wi-Fi browser game with Node

On the host computer (Windows, macOS, Linux or a Raspberry Pi):

```bash
npm run build
npm run start:lan
```

The server prints addresses like:

```
  Play here:      http://localhost:3001/
  On your LAN:    http://192.168.1.20:3001/
```

1. Open the **On your LAN** address on the host computer, choose **Create LAN Game**, and you get a 5-letter room code plus invite links.
2. Add bots if you like, choose the rules, and press **Start Game** when everyone is ready.

The server binds to `0.0.0.0` only when started with `--lan`; plain `npm start` listens on this computer only. It never port-forwards or exposes itself to the internet.

## How to join via LAN/hotspot IP and room link

- **Invite link**: open the link the host shares (e.g. `http://192.168.1.20:3001/?room=ABCDE`). The code is filled in; enter your name and press **Join**.
- **Room code**: open the host's LAN address (e.g. `http://192.168.1.20:3001/`), choose **Join LAN Game**, type the code.
- **Manual server address**: if you opened the page from somewhere else, type the host's address (e.g. `192.168.1.20:3001`) in *Host server address*.

Browsers are not allowed to scan the network (no UDP broadcast or mDNS from web pages), so the host must share the code or link. If you reload or lose Wi-Fi, choose **Continue → Rejoin** to get your seat back.

## How to add bots

- Solo: on the setup screen use **Add bot**, set each bot's name and difficulty, or remove bots.
- LAN: the host uses **+ Easy / + Medium / + Hard bot** in the lobby and can change difficulty or remove bots before starting. Bots run on the host server.
- Disconnected humans: the host can choose *Bot plays after 30/60/180 s* in the lobby, or wait for them.

## How to run the development and production builds

```bash
npm run dev          # Vite (5173) + room server (3001), this computer only
npm run dev:lan      # same, reachable from phones on the same network
npm run build        # production web bundle + bundled Node server
npm run start:lan    # production: one port (3001) serves the page and the WebSocket
```

Environment options are documented in `.env.example` (port, bind address, extra allowed origins, save directory, bot delay). See [BUILD.md](BUILD.md) for details and an optional HTTPS/WSS reverse-proxy setup.

## How to run tests

```bash
npm test             # Vitest: rules, bots and WebSocket server integration tests
npm run test:e2e     # builds, then Playwright browser tests (desktop + mobile viewport)
npm run typecheck    # strict TypeScript for every package
npm run lint         # typecheck + project lint rules
npm run simulate -- 20 4   # 20 bot-only games with 4 bots, invariants checked every step
```

See [TESTING.md](TESTING.md) and [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Phone shows "Could not reach the host" | Use the host's **LAN address**, not `localhost` (on a phone, `localhost` is the phone). Check both devices are on the same Wi-Fi/hotspot. |
| Works on the host but not on phones | Allow Node.js through the firewall for private networks. On Windows: accept the prompt, or *Windows Defender Firewall → Allow an app → Node.js → Private*. On macOS: *System Settings → Network → Firewall → Options*, allow `node`. |
| Guest/hotel/office Wi-Fi | These often isolate devices from each other ("client isolation"). Use a phone hotspot or a home router instead. |
| Laptop is the hotspot | Connect the phones to the laptop's hotspot and use the laptop's hotspot IP (often `192.168.137.1` on Windows). Some hotspots block client-to-host traffic; then try a normal router. |
| `npm install` fails with `edgesOut` | Use the provided `.npmrc` (`legacy-peer-deps=true`) or run `npm install --legacy-peer-deps`. |
| Black or missing board | Enable hardware acceleration / WebGL in the browser, or set *Graphics quality* to Low. |
| Page served over HTTPS cannot connect | HTTPS pages must use `wss://`. Put the server behind a TLS reverse proxy (see BUILD.md) and allow its origin with `PE_ALLOWED_ORIGINS`. |
| Graphics look blurry or jagged | Settings → Graphics quality High (desktop) or Medium (phone), Render pixel density Auto or 2x. Make sure the browser has hardware acceleration turned on. |
| Game feels slow on an old phone | Settings → Graphics quality Low, Render pixel density 1x, Animation speed Fast or Reduced motion. |
| Port already in use | `PE_PORT=4000 npm run start:lan` (and use that port in the address). |

## Project layout

```
packages/game-core   Pure TypeScript rules engine, data (board/cards/rules JSON), bots, protocol
apps/server          Node.js + ws authoritative LAN room server (bundled to dist/index.js)
apps/web             Vite + TypeScript + Three.js browser client
tests/network        WebSocket integration tests (Vitest)
tests/e2e            Playwright browser tests
docs/                Progress, build status, test results, blockers, next steps
```

Architecture notes for contributors and coding agents are in [AGENTS.md](AGENTS.md).
