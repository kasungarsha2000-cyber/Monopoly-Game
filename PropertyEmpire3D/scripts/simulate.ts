/**
 * Run bot-only matches headlessly and print a summary.
 *   npm run simulate -- [games=20] [players=4]
 */
import { simulateBotGame, netWorth, defaultContext } from '@pe/game-core';

const games = Number(process.argv[2] ?? 20);
const players = Number(process.argv[3] ?? 4);
const ctx = defaultContext();
let finished = 0;
let totalActions = 0;
let totalTurns = 0;
const wins: Record<string, number> = {};
const failures: string[] = [];
const started = Date.now();
for (let seed = 1; seed <= games; seed++) {
  const r = simulateBotGame({ seed, players, maxActions: 40000, checkInvariantsEveryStep: true, ctx });
  totalActions += r.actions;
  totalTurns += r.state.turn.number;
  if (r.finished) finished++;
  if (r.invariantErrors.length) failures.push(`seed ${seed}: ${r.invariantErrors.slice(0, 3).join(' | ')}`);
  const w = r.state.players.find((p) => p.id === r.state.winnerId);
  if (w) wins[`${w.difficulty}`] = (wins[`${w.difficulty}`] ?? 0) + 1;
  const summary = r.state.players.map((p) => `${p.name}(${p.difficulty})=${p.bankrupt ? 'X' : netWorth(r.state, ctx, p.id)}`).join(' ');
  console.log(`seed ${seed}: ${r.finished ? 'finished' : 'UNFINISHED'} turns=${r.state.turn.number} actions=${r.actions} fallbacks=${r.fallbacks} winner=${w?.name ?? '-'} ${summary}`);
}
console.log(`\n${finished}/${games} finished, avg turns ${(totalTurns / games).toFixed(0)}, avg actions ${(totalActions / games).toFixed(0)}, ${Date.now() - started}ms`);
console.log('wins by difficulty:', wins);
if (failures.length) {
  console.log('INVARIANT FAILURES:\n' + failures.join('\n'));
  process.exit(1);
}
