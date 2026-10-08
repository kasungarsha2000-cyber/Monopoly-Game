# Building and deploying Property Empire 3D

## Toolchain

| Tool | Version used | Notes |
| --- | --- | --- |
| Node.js | 22 LTS (20.19+ supported) | `engines` in package.json |
| npm | 10 | `.npmrc` sets `legacy-peer-deps=true` to avoid an npm 10 crash resolving vitest's optional peers |
| TypeScript | 5.9.3 (strict) | `npm run typecheck` checks every package |
| Vite | 7.3.6 | web bundle |
| esbuild | 0.25.10 | bundles the server and game-core into one file |
| three | 0.180.0 | the only runtime dependency of the web client |
| ws | 8.21.3 | the only runtime dependency of the server |

All versions are pinned exactly in the `package.json` files and `package-lock.json`; `npm audit` reports 0 vulnerabilities at the time of writing.

## Commands

```bash
npm install
npm run build          # = build:web + build:server
npm run build:web      # tsc + vite build  -> apps/web/dist/
npm run build:server   # esbuild           -> apps/server/dist/index.js
```

Outputs:

- `apps/web/dist/` – static site (`index.html`, hashed JS/CSS in `assets/`, `sw.js`, manifest, icon). About 60 KB gzip of game code plus 131 KB gzip for three.js.
- `apps/server/dist/index.js` – a single ESM file (game-core bundled in; `ws` loaded from `node_modules`).

## Running

| Command | What it does |
| --- | --- |
| `npm start` / `npm run start:server` | Production server on `127.0.0.1:3001`, serving the web build and `/ws`. |
| `npm run start:lan` | Same, bound to `0.0.0.0` so phones on the LAN can join. Prints LAN URLs. |
| `npm run dev` | Vite dev server on 5173 + room server (tsx watch) on 3001, local only. Vite proxies `/ws`, `/health`, `/api`. |
| `npm run dev:lan` | Dev mode reachable from the LAN. |

Server options (CLI flag or environment variable; a `.env` file in the project root is read too):

| Option | Default | Meaning |
| --- | --- | --- |
| `--port` / `PE_PORT` | 3001 | HTTP + WebSocket port |
| `--host` / `PE_HOST` | 127.0.0.1 (0.0.0.0 with `--lan`) | bind address |
| `PE_ALLOWED_ORIGINS` | empty | extra browser origins allowed to open WebSockets (comma separated) |
| `PE_SAVE_DIR` | apps/server/data/saves | where room saves are written |
| `PE_BOT_DELAY_MS` | 700 | pause before each server-side bot move so clients can follow |
| `PE_WEB_PORT` | 5173 | Vite dev port |

Endpoints: `GET /health` (JSON status), `GET /api/info` (LAN addresses), `GET /ws` (WebSocket upgrade), everything else serves the web build.

## Network model

- The browser never hosts a game. The Node process is authoritative: it owns the RNG, validates every command against the shared rules engine, runs bots, saves state and broadcasts redacted snapshots (no RNG state, no card order).
- Clients send intents (`REQUEST_ACTION`) with a unique id; duplicates and malformed or oversized messages are rejected; each connection is rate limited.
- WebSocket upgrades are accepted only from loopback, private-LAN or `.local` origins, the server's own host, or `PE_ALLOWED_ORIGINS`. Non-browser clients without an Origin header are allowed (used by tests and tools).
- Session tokens are 192-bit random values, only sent in the JOIN messages, stored in the player's `localStorage`, never placed in URLs or logs.

## Optional HTTPS / WSS deployment

Not required for LAN play. If you want to serve the game over HTTPS (for example on a home server with a certificate), terminate TLS in a reverse proxy and forward everything, including WebSocket upgrades, to the Node server. The client always connects to `wss://<same host>/ws` when the page is HTTPS.

Example Caddy config:

```
game.example.lan {
    reverse_proxy 127.0.0.1:3001
}
```

Example nginx location:

```
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

Then start the server with `PE_ALLOWED_ORIGINS=https://game.example.lan npm start`. Keep it on a trusted network: the server has no accounts, and a random room code is not authentication.

## Static-only solo hosting

`apps/web/dist` can be copied to any static web host. Solo play works there; LAN features need the Node server reachable from the players' devices.
