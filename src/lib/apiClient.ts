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
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = await resolveAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
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
