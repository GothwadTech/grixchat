/**
 * GrixChat Mock Supabase — in-memory store with optional localStorage
 * persistence, so a page reload keeps your sent messages.
 *
 * Reset at any time from the browser console:
 *     __grixMock.reset()          // back to pristine seed
 *     __grixMock.dump('messages') // inspect a table
 */
import { buildSeed, type MockDatabase } from './seed';
import { clone, Row } from './utils';

const STORAGE_KEY = 'grixchat_mock_db_v1';

/** Every table the app queries. Unknown tables are created on demand. */
export const TABLES = [
  'users',
  'follows',
  'conversations',
  'conversation_participants',
  'messages',
  'stories',
  'calls',
  'call_candidates',
  'chat_settings',
  'notifications',
  'posts',
  'post_likes',
  'post_comments',
  'reels',
  'tube_videos',
  'tube_live_chat',
  'moments',
  'likes',
  'comments',
  'qna_questions',
  'support_tickets',
] as const;

export type TableName = string;

type Listener = (payload: { eventType: string; new: Row; old: Row; table: string }) => void;

function canPersist(): boolean {
  try {
    const k = '__grix_probe__';
    globalThis.localStorage.setItem(k, '1');
    globalThis.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

class MockStore {
  db: MockDatabase & Record<string, Row[]>;
  private listeners = new Set<Listener>();
  private persist: boolean;

  constructor() {
    this.db = buildSeed() as any;
    this.persist = canPersist();
    if (this.persist) this.load();
  }

  private load() {
    try {
      const raw = globalThis.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // Merge so newly-seeded tables in a code update still show up.
      this.db = { ...this.db, ...parsed };
    } catch {
      /* corrupted payload → just keep the fresh seed */
    }
  }

  save() {
    if (!this.persist) return;
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch {
      /* quota exceeded — mock keeps working in memory */
    }
  }

  reset() {
    this.db = buildSeed() as any;
    this.save();
  }

  table(name: TableName): Row[] {
    if (!this.db[name]) this.db[name] = [];
    return this.db[name];
  }

  setTable(name: TableName, rows: Row[]) {
    this.db[name] = rows;
    this.save();
  }

  /** Subscribe to all writes — the realtime layer uses this. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(eventType: 'INSERT' | 'UPDATE' | 'DELETE', table: string, row: Row, old: Row = {}) {
    const payload = { eventType, new: clone(row), old: clone(old), table };
    this.listeners.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        // A broken subscriber must never break a write.
        // eslint-disable-next-line no-console
        console.warn('[grixMock] realtime listener threw:', e);
      }
    });
  }

  dump(name?: TableName) {
    if (name) return clone(this.table(name));
    return Object.fromEntries(Object.entries(this.db).map(([k, v]) => [k, (v as Row[]).length]));
  }
}

/** Singleton — the whole mock shares one database, like a real Supabase project. */
export const store = new MockStore();

/** Console handle: `__grixMock.dump()`, `__grixMock.reset()` */
export function installDevHandle() {
  try {
    (globalThis as any).__grixMock = {
      store,
      reset: () => {
        store.reset();
        // eslint-disable-next-line no-console
        console.log('[grixMock] database reset to seed data');
      },
      dump: (t?: TableName) => store.dump(t),
      insert: (t: TableName, row: Row) => store.table(t).push(row),
    };
  } catch {
    /* non-browser context */
  }
}
