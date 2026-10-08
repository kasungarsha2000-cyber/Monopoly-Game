// Bundle the server (including the shared game-core) into dist/index.js.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [resolve(here, 'src/index.ts')],
  outfile: resolve(here, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external: ['ws', 'bufferutil', 'utf-8-validate'],
  banner: { js: '// Property Empire 3D LAN server (bundled)' },
  logLevel: 'info'
});
