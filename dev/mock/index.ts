/**
 * GrixChat Mock Supabase — entry point.
 *
 * This file *replaces* `@supabase/supabase-js` at build time when
 * `MOCK_SUPABASE=1` (see the alias in vite.config.ts). Nothing else in the
 * app changes: `src/lib/supabase.ts` still calls `createClient(url, key)`.
 *
 * Usage
 *   npm run dev:mock        → http://localhost:3000  (login demo@grixchat.app / grixchat)
 *   npm run build:mock      → static bundle wired to the mock
 *
 * Browser console handle: `__grixMock.dump()` / `__grixMock.reset()`
 */
import { mockAuth, type MockUser } from './auth';
import { MockChannel } from './realtime';
import { callRpc } from './rpc';
import { installDevHandle, store } from './store';
import { MockQueryBuilder } from './query';
import { nowISO, uuid } from './utils';

export type { MockUser as User };
export type { MockChannel as RealtimeChannel };

// --- Storage ---------------------------------------------------------------
const mockBucketStore = new Map<string, Map<string, string>>();

function bucket(name: string) {
  if (!mockBucketStore.has(name)) mockBucketStore.set(name, new Map());
  return mockBucketStore.get(name)!;
}

const mockStorage = {
  from(name: string) {
    return {
      async upload(path: string, file: any, _opts?: any) {
        let dataUrl = `mock://storage/${name}/${path}`;
        // Read real File/Blob content so <img src> actually renders in dev.
        try {
          if (typeof FileReader !== 'undefined' && (file instanceof Blob)) {
            dataUrl = await new Promise<string>((resolve, reject) => {
              const fr = new FileReader();
              fr.onload = () => resolve(String(fr.result));
              fr.onerror = () => reject(fr.error);
              fr.readAsDataURL(file as Blob);
            });
          }
        } catch { /* keep the mock:// placeholder */ }
        bucket(name).set(path, dataUrl);
        return { data: { path, fullPath: `${name}/${path}` }, error: null };
      },
      getPublicUrl(path: string) {
        const found = bucket(name).get(path);
        return { data: { publicUrl: found || `mock://storage/${name}/${path}` } };
      },
      async remove(paths: string[]) {
        paths.forEach((p) => bucket(name).delete(p));
        return { data: null, error: null };
      },
      async list(prefix?: string) {
        const rows = [...bucket(name).keys()]
          .filter((k) => !prefix || k.startsWith(prefix))
          .map((k) => ({ name: k, id: uuid(), created_at: nowISO() }));
        return { data: rows, error: null };
      },
      createSignedUrl(path: string, expiresIn = 3600) {
        const found = bucket(name).get(path);
        return {
          data: { signedUrl: found || `mock://storage/${name}/${path}?exp=${expiresIn}`, expiresIn },
          error: null,
        };
      },
    };
  },
};

// --- Client ----------------------------------------------------------------
class MockSupabaseClient {
  readonly isMockSupabase = true;
  auth = mockAuth;
  storage = mockStorage;
  realtime = { setAuth: () => {}, removeAllChannels: async () => 'ok' };
  private channels = new Set<MockChannel>();

  constructor(public url: string, public key: string) {
    installDevHandle();
    // eslint-disable-next-line no-console
    console.info(
      '%c GrixChat %c mock Supabase active — no network calls will be made ',
      'background:#4f46e5;color:#fff;font-weight:700;padding:2px 6px;border-radius:3px 0 0 3px',
      'background:#1e293b;color:#a5b4fc;padding:2px 6px;border-radius:0 3px 3px 0',
    );
    // eslint-disable-next-line no-console
    console.info('[grixMock] login: demo@grixchat.app / grixchat · console: __grixMock.dump()');
  }

  from(table: string) {
    return new MockQueryBuilder(table);
  }

  rpc(fn: string, args?: any) {
    return callRpc(fn, args);
  }

  channel(topic: string, _opts?: any) {
    const ch = new MockChannel(topic);
    this.channels.add(ch);
    return ch as any;
  }

  async removeChannel(ch: any) {
    if (ch?.unsubscribe) await ch.unsubscribe();
    this.channels.delete(ch);
    return 'ok' as const;
  }

  async removeAllChannels() {
    await Promise.all([...this.channels].map((c) => this.removeChannel(c)));
    return 'ok' as const;
  }
}

export function createClient(url: string, key: string, _options?: any) {
  return new MockSupabaseClient(url, key) as any;
}

export { store, mockAuth, MockQueryBuilder, MockChannel };
export default { createClient };
