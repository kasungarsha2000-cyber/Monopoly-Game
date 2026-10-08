#!/usr/bin/env node
/**
 * Build Property Empire 3D as ONE self-contained HTML page (solo play only),
 * suitable for publishing as a claude.ai artifact or any static host:
 *   node scripts/build-artifact.mjs [output.html]
 * CSS and JS are inlined; no external files or network access are needed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');
const out = resolve(process.argv[2] ?? join(root, 'artifact', 'property-empire-3d.html'));
const vite = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');

execFileSync(vite, ['build', '--mode', 'standalone'], { cwd: web, stdio: 'inherit', shell: process.platform === 'win32' });

const dist = join(web, 'dist-standalone');
const assets = readdirSync(join(dist, 'assets'));
const jsFiles = assets.filter((f) => f.endsWith('.js'));
const cssFiles = assets.filter((f) => f.endsWith('.css'));
if (jsFiles.length !== 1) throw new Error(`Expected one JS bundle, found ${jsFiles.join(', ')}`);
const js = readFileSync(join(dist, 'assets', jsFiles[0]), 'utf8')
  // Keep the inline script from closing early or entering a comment state.
  .replace(/<\/script/gi, '<\\/script')
  .replace(/<!--/g, '<\\!--');
const css = cssFiles.map((f) => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n').replace(/<\/style/gi, '<\\/style');

const html = `<title>Property Empire 3D</title>
<meta name="description" content="An original 3D property trading board game. Play solo against Easy, Medium and Hard bots.">
<style>
${css}
</style>
<div id="stage" aria-hidden="true"></div>
<div id="app" role="application" aria-label="Property Empire 3D"></div>
<noscript>Property Empire 3D needs JavaScript and WebGL to run.</noscript>
<script type="module">
${js}
</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
