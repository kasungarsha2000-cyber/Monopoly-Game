#!/usr/bin/env node
/**
 * Lightweight project lint (runs after the TypeScript typecheck):
 *  - no `debugger`, eval or `new Function`
 *  - no focused tests (.only)
 *  - innerHTML only in the allowlisted static-markup helper
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const dirs = ['packages/game-core/src', 'packages/game-core/tests', 'apps/server/src', 'apps/web/src', 'tests'];
const INNER_HTML_ALLOW = new Set(['apps/web/src/ui/format.ts']);
const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|mjs)$/.test(name)) check(p);
  }
}

function check(file) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (/\bdebugger\b/.test(line)) problems.push(`${at} debugger statement`);
    if (/\beval\(|new Function\(/.test(line)) problems.push(`${at} eval/new Function`);
    if (/\b(it|test|describe)\.only\(/.test(line)) problems.push(`${at} focused test`);
    if (/\.innerHTML\s*=/.test(line) && !INNER_HTML_ALLOW.has(rel)) problems.push(`${at} innerHTML assignment`);
  });
}

for (const d of dirs) walk(join(root, d));
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`lint: ok (${dirs.length} directories checked)`);
