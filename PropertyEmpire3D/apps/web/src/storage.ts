/**
 * SaveManager (browser side): versioned solo saves in IndexedDB. Writes use a
 * single transaction (atomic), the previous autosave is kept as a backup, and
 * every load is validated with the shared schema checks.
 */
import { validateGameState, type GameState } from '@pe/game-core';

const DB_NAME = 'property-empire-saves';
const STORE = 'saves';
const DB_VERSION = 1;

export interface SaveRecord {
  id: string;
  kind: 'autosave' | 'manual' | 'backup';
  name: string;
  savedAt: number;
  humanId: string;
  botSeed: number;
  summary: { players: string[]; round: number; turn: number };
  state: GameState;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open save database'));
    req.onblocked = () => reject(new Error('Save database is blocked by another tab'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result: T | undefined;
        const req = fn(store);
        if (req) req.onsuccess = () => (result = req.result);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error ?? new Error('Save failed'));
        t.onabort = () => reject(t.error ?? new Error('Save aborted'));
      })
  );
}

export function summarize(state: GameState): SaveRecord['summary'] {
  return { players: state.players.map((p) => p.name), round: state.round, turn: state.turn.number };
}

/** Save a game. Autosaves keep the previous autosave as a backup in the same transaction. */
export async function saveGame(kind: 'autosave' | 'manual', state: GameState, humanId: string, botSeed: number, name?: string): Promise<SaveRecord> {
  const now = Date.now();
  const record: SaveRecord = {
    id: kind === 'autosave' ? 'autosave' : `manual-${now}`,
    kind,
    name: name ?? (kind === 'autosave' ? 'Autosave' : `Saved game`),
    savedAt: now,
    humanId,
    botSeed,
    summary: summarize(state),
    state: structuredClone(state)
  };
  await openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const store = t.objectStore(STORE);
        if (kind === 'autosave') {
          const prev = store.get('autosave');
          prev.onsuccess = () => {
            const old = prev.result as SaveRecord | undefined;
            if (old && old.state.gameId === state.gameId) store.put({ ...old, id: 'autosave-backup', kind: 'backup', name: 'Autosave backup' });
            store.put(record);
          };
        } else {
          store.put(record);
        }
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error ?? new Error('Save failed'));
        t.onabort = () => reject(t.error ?? new Error('Save aborted (storage full?)'));
      })
  );
  return record;
}

export async function listSaves(): Promise<SaveRecord[]> {
  const all = ((await tx<SaveRecord[]>('readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>)) ?? []) as SaveRecord[];
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

/** Load and validate a save. Throws a friendly error for corrupted or incompatible data. */
export async function loadSave(id: string): Promise<SaveRecord> {
  const rec = (await tx<SaveRecord>('readonly', (s) => s.get(id) as IDBRequest<SaveRecord>)) as SaveRecord | undefined;
  if (!rec) throw new Error('Save not found');
  const err = validateGameState(rec.state);
  if (err) throw new Error(`This save cannot be loaded: ${err}`);
  if (!rec.state.players.some((p) => p.id === rec.humanId)) throw new Error('This save is missing its human player');
  return rec;
}

export async function deleteSave(id: string): Promise<void> {
  await tx('readwrite', (s) => {
    s.delete(id);
  });
}

export async function hasSaves(): Promise<boolean> {
  try {
    return (await listSaves()).some((s) => s.state.phase !== 'GAME_OVER');
  } catch {
    return false;
  }
}
