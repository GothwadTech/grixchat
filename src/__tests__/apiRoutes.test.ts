/**
 * @vitest-environment node
 *
 * Contract tests for the shared API (`server/api.ts`).
 *
 * The same file runs on Cloudflare Pages Functions and under Express, so these
 * assertions are the safety net for the security behaviour that used to be
 * missing: nothing reaches a route without either a verified session or the
 * credential-free local mock, cross-origin writes are refused, and oversized or
 * malformed bodies are rejected before a handler sees them.
 *
 * Node environment on purpose: jsdom does not implement `Request`/`Response`.
 */
import {beforeEach, describe, expect, it} from 'vitest';
import {handleApiRequest, type ApiEnv} from '../../server/api';

/** `npm run dev:mock` shaped env: no Supabase project, no network. */
const MOCK_ENV: ApiEnv = {MOCK_SUPABASE: '1', NODE_ENV: 'development'};
/** Cloudflare-shaped env: always verifies, whatever else is set. */
const EDGE_ENV: ApiEnv = {MOCK_SUPABASE: '1', CF_PAGES: '1'};

const call = (path: string, init: RequestInit = {}, env: ApiEnv = MOCK_ENV) =>
  handleApiRequest(new Request(`http://localhost:3000${path}`, init), env);

const postJson = (
  path: string,
  body: unknown,
  env: ApiEnv = MOCK_ENV,
  headers: Record<string, string> = {}
) =>
  call(
    path,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', ...headers},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    env
  );

beforeEach(() => {
  // The limiter is module-level state; keep tests from tripping over each other.
  // (Each test uses a distinct path or well under the per-minute budget.)
});

describe('routing', () => {
  it('answers /api/health without credentials', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.status).toBe('ok');
  });

  it('reports whether the filesystem capability was injected', async () => {
    // The Express adapter injects REPO_FS; Cloudflare cannot, so the same
    // handler reports which one it is running under.
    const nodeAdapter: ApiEnv = {
      ...MOCK_ENV,
      REPO_FS: {root: '/repo', listFiles: () => [], readFileBase64: () => null},
    };
    expect((await (await call('/api/health', {}, nodeAdapter)).json() as any).runtime).toBe('node');
    expect((await (await call('/api/health', {}, EDGE_ENV)).json() as any).runtime).toBe('edge');
  });

  it('404s unknown API paths with JSON, not the SPA shell', async () => {
    const response = await call('/api/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body: any = await response.json();
    expect(body.error).toContain('Unknown API route');
  });

  it('hides the diagnostic route on Cloudflare', async () => {
    expect((await call('/api/github/debug')).status).toBe(200);
    expect((await call('/api/github/debug', {}, EDGE_ENV)).status).toBe(404);
  });
});

describe('security headers and CORS', () => {
  it('marks responses nosniff and no-referrer', async () => {
    const response = await call('/api/health');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('answers a preflight from an allowed origin with CORS headers', async () => {
    const response = await call('/api/grix-ai', {
      method: 'OPTIONS',
      headers: {'Origin': 'http://localhost:3000', 'Access-Control-Request-Method': 'POST'},
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('grants no CORS headers to an unknown origin', async () => {
    const response = await call('/api/grix-ai', {
      method: 'OPTIONS',
      headers: {'Origin': 'https://evil.example.com', 'Access-Control-Request-Method': 'POST', 'Host': 'grixchat.gothwadtech.com'},
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses a cross-origin write outright', async () => {
    const response = await handleApiRequest(
      new Request('http://localhost:3000/api/send-notification', {
        method: 'POST',
        headers: {
          'Origin': 'https://evil.example.com',
          'Host': 'grixchat.gothwadtech.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({tokens: ['x']}),
      }),
      MOCK_ENV
    );
    expect(response.status).toBe(403);
  });
});

describe('body handling', () => {
  it('rejects malformed JSON with 400', async () => {
    const response = await postJson('/api/send-notification', '{not json');
    expect(response.status).toBe(400);
    expect((await response.json() as any).error).toMatch(/Malformed/i);
  });

  it('rejects a body over the route cap with 413', async () => {
    const huge = JSON.stringify({tokens: ['a'.repeat(300 * 1024)]});
    const response = await postJson('/api/send-notification', huge);
    expect(response.status).toBe(413);
  });

  it('rejects an empty body where one is required', async () => {
    const response = await call('/api/send-notification', {method: 'POST'});
    expect(response.status).toBe(400);
  });
});

describe('authentication', () => {
  it('lets the credential-free local mock through', async () => {
    const response = await postJson('/api/send-notification', {tokens: ['demo-token']});
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.simulated).toBe(true);
  });

  it('never lets a Cloudflare deployment skip verification', async () => {
    const response = await call(
      '/api/send-notification',
      {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({tokens: ['t']})},
      EDGE_ENV
    );
    expect(response.status).toBe(401);
  });

  it('rejects a request with no Authorization header on a configured server', async () => {
    // `{}` is a real, configured deployment: no mock flag, so no bypass.
    const response = await postJson('/api/grix-ai', {messages: []}, {});
    expect(response.status).toBe(401);
    expect((await response.json() as any).error).toMatch(/Authentication required/i);
  });
});
