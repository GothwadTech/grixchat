import { supabase } from './supabase';

/**
 * Server routes under `/api` verify a Supabase JWT (`Authorization: Bearer …`).
 * Plain `fetch` therefore fails with 401 — this wrapper attaches the current
 * session's access token, and refreshes it first if it has expired.
 *
 * The dev mock (`dev/mock/`) answers `getSession()` with a fake session, and
 * `server.ts` skips verification when `MOCK_SUPABASE=1`, so `npm run dev:mock`
 * keeps working with no credentials at all.
 */
export async function resolveAccessToken(): Promise<string | null> {
  try {
    const client = supabase as { auth?: any };
    if (!client?.auth?.getSession) return null;

    const { data, error } = await client.auth.getSession();
    if (error) return null;

    let session = data?.session;
    if (session?.expires_at && session.expires_at * 1000 < Date.now() + 30_000) {
      const refreshed = await client.auth.refreshSession();
      session = refreshed?.data?.session ?? session;
    }
    return session?.access_token ?? null;
  } catch (err) {
    console.warn('[apiClient] Could not resolve a Supabase access token:', err);
    return null;
  }
}

/**
 * `fetch` with the Supabase access token attached. Drop-in replacement for the
 * call sites that hit the Express API.
 */
export interface ApiFetchOptions {
  /** Abort the request after this many ms. Default 20 s. */
  timeoutMs?: number;
  /**
   * Extra attempts for IDEMPOTENT requests (GET/HEAD) that fail with a network
   * error or a 502/503/504. Non-idempotent calls are never retried, so a retry
   * can never send a message, follow a user or upload a file twice.
   */
  retries?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` with the Supabase access token attached, a hard timeout, and safe
 * retries. Drop-in replacement for the call sites that hit the Express API.
 */
export async function apiFetch(
  input: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const idempotent = method === 'GET' || method === 'HEAD';
  const retries = idempotent ? (options.retries ?? 2) : 0;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const token = await resolveAccessToken();

  let attempt = 0;
  for (;;) {
    const headers = new Headers(init.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Honour a caller-supplied signal too (e.g. component unmount).
    const onCallerAbort = () => controller.abort();
    init.signal?.addEventListener('abort', onCallerAbort);

    try {
      const response = await fetch(input, { ...init, headers, signal: controller.signal });
      if (attempt < retries && RETRYABLE_STATUS.has(response.status)) {
        attempt += 1;
        await sleep(300 * 3 ** (attempt - 1));
        continue;
      }
      return response;
    } catch (err) {
      // Caller cancelled: never retry.
      if (init.signal?.aborted) throw err;
      if (attempt < retries) {
        attempt += 1;
        await sleep(300 * 3 ** (attempt - 1));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onCallerAbort);
    }
  }
}

/** JSON POST helper returning the parsed body plus the raw response. */
export async function apiPostJson<T = any>(
  url: string,
  payload: unknown
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const response = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new Error(`Unexpected non-JSON response (${response.status}): ${text.slice(0, 150)}`);
    }
  }
  return { ok: response.ok, status: response.status, data };
}
