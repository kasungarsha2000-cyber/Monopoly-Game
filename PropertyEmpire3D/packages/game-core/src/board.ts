/**
 * BoardData: loads, validates and queries board space definitions.
 */
import type { BoardDef, CardsDef, RulesData, SpaceDef, RulesContext, CardDef, DeckId } from './types';
import boardJson from '../data/board.json';
import cardsJson from '../data/cards.json';
import rulesJson from '../data/rules.json';

export const BOARD_SIZE = 40;

const OWNABLE: ReadonlySet<string> = new Set(['street', 'transport', 'utility']);

export function isOwnable(space: SpaceDef): boolean {
  return OWNABLE.has(space.type);
}

/** Validate a board definition. Returns a list of problems (empty when valid). */
export function validateBoard(board: BoardDef): string[] {
  const problems: string[] = [];
  if (!Array.isArray(board.spaces) || board.spaces.length !== BOARD_SIZE) {
    problems.push(`Board must have exactly ${BOARD_SIZE} spaces`);
    return problems;
  }
  const ids = new Set<string>();
  const groups = new Set(board.groups.map((g) => g.id));
  let jails = 0;
  let gos = 0;
  board.spaces.forEach((s, i) => {
    if (s.index !== i) problems.push(`Space ${s.id} has index ${s.index}, expected ${i}`);
    if (!s.id || ids.has(s.id)) problems.push(`Duplicate or missing id at ${i}`);
    ids.add(s.id);
    if (!s.name) problems.push(`Space ${i} missing name`);
    if (s.type === 'jail') jails++;
    if (s.type === 'go') gos++;
    if (isOwnable(s)) {
      if (!s.group || !groups.has(s.group)) problems.push(`Space ${s.id} has unknown group ${String(s.group)}`);
      if (!Number.isInteger(s.price) || (s.price ?? 0) <= 0) problems.push(`Space ${s.id} needs a positive integer price`);
      if (!Number.isInteger(s.mortgage) || (s.mortgage ?? 0) <= 0) problems.push(`Space ${s.id} needs a mortgage value`);
      if (!Array.isArray(s.rent) || s.rent.some((r) => !Number.isInteger(r) || r < 0)) problems.push(`Space ${s.id} needs a rent table`);
      if (s.type === 'street') {
        if (s.rent?.length !== 6) problems.push(`Street ${s.id} needs 6 rent values`);
        if (!Number.isInteger(s.houseCost) || (s.houseCost ?? 0) <= 0) problems.push(`Street ${s.id} needs houseCost`);
      }
    }
    if (s.type === 'tax' && (!Number.isInteger(s.amount) || (s.amount ?? 0) <= 0)) problems.push(`Tax ${s.id} needs amount`);
  });
  if (jails !== 1) problems.push('Board needs exactly one jail');
  if (gos !== 1 || board.spaces[0]?.type !== 'go') problems.push('Space 0 must be GO');
  if (!board.spaces.some((s) => s.type === 'go_to_jail')) problems.push('Board needs a Go To Jail space');
  return problems;
}

export function validateCards(cards: CardsDef, board: BoardDef): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const deck of ['chance', 'community'] as const) {
    if (!Array.isArray(cards[deck]) || cards[deck].length === 0) problems.push(`Deck ${deck} is empty`);
    for (const c of cards[deck] ?? []) {
      if (ids.has(c.id)) problems.push(`Duplicate card id ${c.id}`);
      ids.add(c.id);
      if (c.effect.kind === 'advance' && !board.spaces[c.effect.to]) problems.push(`Card ${c.id} targets invalid space`);
    }
  }
  return problems;
}

/** Build the default context from the bundled JSON data, validating it once. */
export function createDefaultContext(): RulesContext {
  const board = boardJson as unknown as BoardDef;
  const cards = cardsJson as unknown as CardsDef;
  const rules = rulesJson as unknown as RulesData;
  const problems = [...validateBoard(board), ...validateCards(cards, board)];
  if (problems.length) throw new Error('Invalid game data: ' + problems.join('; '));
  return { board, cards, rules };
}

let defaultCtx: RulesContext | null = null;
/** Lazily created shared default context. */
export function defaultContext(): RulesContext {
  if (!defaultCtx) defaultCtx = createDefaultContext();
  return defaultCtx;
}

export function getSpace(ctx: RulesContext, index: number): SpaceDef {
  const s = ctx.board.spaces[index];
  if (!s) throw new Error(`No space ${index}`);
  return s;
}

/** Indices of all spaces in a group, in board order. */
export function groupSpaces(ctx: RulesContext, group: string): number[] {
  return ctx.board.spaces.filter((s) => s.group === group).map((s) => s.index);
}

export function groupColor(ctx: RulesContext, group: string | undefined): string {
  return ctx.board.groups.find((g) => g.id === group)?.color ?? '#999999';
}

export function groupName(ctx: RulesContext, group: string | undefined): string {
  return ctx.board.groups.find((g) => g.id === group)?.name ?? '';
}

export function jailIndex(ctx: RulesContext): number {
  return ctx.board.spaces.findIndex((s) => s.type === 'jail');
}

export function findCard(ctx: RulesContext, cardId: string): { deck: DeckId; card: CardDef } | null {
  for (const deck of ['chance', 'community'] as const) {
    const card = ctx.cards[deck].find((c) => c.id === cardId);
    if (card) return { deck, card };
  }
  return null;
}

export function deckName(deck: DeckId): string {
  return deck === 'chance' ? 'Fortune' : 'Community Fund';
}
