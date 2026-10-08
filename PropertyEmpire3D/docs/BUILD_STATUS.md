# Build status

Last verified: 2026-10-08, Linux container, Node v22.22.0, npm 10.9.4.

| Step | Command | Result |
| --- | --- | --- |
| Install | `npm install` | OK (0 vulnerabilities reported by `npm audit`). `.npmrc` sets `legacy-peer-deps=true` because npm 10.9 crashes (`edgesOut`) resolving vitest 4's optional peers. |
| Typecheck | `npm run typecheck` | OK: game-core, server, web and tests compile under strict TypeScript. |
| Lint | `npm run lint` | OK |
| Web build | `npm run build:web` | OK: `apps/web/dist` with `index.html`, CSS 20.8 KB (5.2 KB gzip), game JS 180 KB (58.8 KB gzip), three.js chunk 513 KB (131 KB gzip). |
| Server build | `npm run build:server` | OK: `apps/server/dist/index.js` 148 KB (single ESM file; `ws` external). |
| Production start | `npm run start:lan` | OK: serves the web build and `/ws` on port 3001, prints LAN URLs, `/health` answers. |
| Dev start | `npm run dev:lan` | OK: Vite on 5173 proxies `/ws` and `/health` to the room server on 3001 (verified with curl and a WebSocket client). |

## Dependency versions

Pinned exactly: three 0.180.0, ws 8.21.3, vite 7.3.6, vitest 4.1.11, typescript 5.9.3, esbuild 0.25.10, tsx 4.20.6, @playwright/test 1.56.1 (matching the preinstalled Chromium 1194), @types/three 0.180.0, @types/ws 8.18.1, @types/node 22.18.0.

Versions were first chosen a year back for stability; vite, vitest and ws were then moved to the oldest releases that fix the advisories `npm audit` reported (Vite dev-server file read, ws memory issues, tinypool via vitest).
