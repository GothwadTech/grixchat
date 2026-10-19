/**
 * GrixChat API — runtime-neutral core.
 *
 * Every route lives here exactly once, written against the **Fetch API** so the
 * same code runs on both deployment targets:
 *
 *   - Cloudflare Pages Functions (`functions/api/[[path]].ts`) — production,
 *     served from grixchat.gothwadtech.com.
 *   - Express (`server.ts`) — `npm run dev` and self-hosting.
 *
 * Hard rule: nothing in this file may touch Node built-ins (`fs`, `path`,
 * `crypto`, `Buffer`, `process`, `multer`, `axios`, …). If a route genuinely
 * needs a Node capability, it is declared as an optional capability in
 * `ApiEnv` and the adapter that can provide it does — see `REPO_FS`.
 *
 * The Supabase SDK, `jose` and the platform `fetch` are all available on both
 * runtimes (Workers + Node 20), so those are fair game.
 */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { SignJWT, importPKCS8 } from 'jose';
import type { ErrorLike } from '../src/utils/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Environment & capabilities
// ─────────────────────────────────────────────────────────────────────────────

/** Everything the API can read configuration from. Both adapters supply this. */
export interface ApiEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GEMINI_API_KEY?: string;
  FIREBASE_SERVICE_ACCOUNT?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Canonical origin, e.g. `https://grixchat.gothwadtech.com`. */
  APP_URL?: string;
  /** Extra comma-separated origins allowed to call the API. */
  ALLOWED_ORIGINS?: string;
  /** `1` in `npm run dev:mock` — skips JWT verification (never in production). */
  MOCK_SUPABASE?: string;
  NODE_ENV?: string;
  /** Set to `1` by Cloudflare on every Pages deployment (production + preview). */
  CF_PAGES?: string;

  /**
   * Node-only capability: reading the checked-out repository, used by the
   * GitHub "Sync Tool" (`/api/github/list-files`, `/api/github/get-file-content`).
   * Cloudflare Workers have no filesystem, so those two routes answer `501`
   * there instead of pretending to work.
   */
  REPO_FS?: RepoFsCapability;

  /** Cloudflare Pages asset binding, if the adapter wants to expose it. */
  ASSETS?: { fetch: (input: Request) => Promise<Response> };
}

export interface RepoFsCapability {
  /** Absolute path of the repository root the API was started from. */
  root: string;
  /** Relative paths of every trackable source file. */
  listFiles: () => string[];
  /** Base64 content, or `null` when the path is missing/outside the root. */
  readFileBase64: (relativePath: string) => string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Security headers for API responses. Mirrors what `public/_headers` applies to
 * the static assets, so API and page responses are covered the same way.
 *
 * There is deliberately no `X-Frame-Options`: the Android WebView (TWA) wrapper
 * embeds the app in a frame.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extra },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Origin handling (CORS + CSRF guard)
// ─────────────────────────────────────────────────────────────────────────────

const hostOf = (value: string): string => {
  if (!value) return '';
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return '';
  }
};

/** True when the request arrived on a loopback / bind-all address. */
function isLocalRequestHost(host: string): boolean {
  const hostname = host.split(':')[0].replace(/^\[|\]$/g, '');
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal'].includes(hostname);
}

/**
 * True when `origin` may call the API: same-origin with the request,
 * `APP_URL`, anything in `ALLOWED_ORIGINS`, or a local dev origin.
 */
function isAllowedOrigin(request: Request, env: ApiEnv, origin: string): boolean {
  const originHost = hostOf(origin);
  if (!originHost) return false;

  const requestHosts = [request.headers.get('x-forwarded-host'), request.headers.get('host'), new URL(request.url).host]
    .flatMap((h) => (h ? h.split(',') : []))
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  if (requestHosts.includes(originHost)) return true;

  // Behind a tunnel / container preview the process only sees its own bind
  // address (`0.0.0.0:3000`) while the browser reports the public hostname, so
  // the two can never be compared. Those deployments hold no production data;
  // `ALLOWED_ORIGINS` restores strictness where it matters.
  if (requestHosts.length > 0 && requestHosts.every(isLocalRequestHost)) return true;

  const allowlist = new Set(
    [
      hostOf(env.APP_URL || ''),
      ...(env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => hostOf(o.trim())),
      'localhost:3000',
      '127.0.0.1:3000',
      'localhost:5173',
      '127.0.0.1:5173',
    ].filter(Boolean)
  );

  return allowlist.has(originHost);
}

function corsHeaders(request: Request, env: ApiEnv): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !isAllowedOrigin(request, env, origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-File-Name',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Best-effort in-memory limiter, keyed by client IP + bucket.
 *
 * On Cloudflare this counts per isolate, which spreads the real limit across
 * however many instances are warm — treat it as a speed bump and turn on a
 * native Rate Limiting Rule in the dashboard for the real quota. Pooling it in
 * KV/Durable Objects would add a dependency and latency to every API call, so
 * it is deliberately not done here.
 */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function takeRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();

  // Cheap opportunistic cleanup keeps the map from growing without bound.
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k);
  }

  const entry = rateBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  entry.count += 1;
  if (entry.count > limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfter: 0 };
}

/** Real client IP across Cloudflare, preview proxies and Express. */
function clientIp(request: Request): string {
  const direct = request.headers.get('cf-connecting-ip');
  if (direct) return direct.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

/** Client that talks to Postgres as the caller (RLS enforced). */
function userScopedClient(env: ApiEnv, accessToken: string): SupabaseClient | null {
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) return null;
  return createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Client that bypasses RLS. Falls back to the anon key + the caller's JWT. */
function serviceClient(env: ApiEnv): SupabaseClient | null {
  if (!env.VITE_SUPABASE_URL) return null;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!key) return null;
  return createClient(env.VITE_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const isMockMode = (env: ApiEnv) => env.MOCK_SUPABASE === '1' || env.MOCK_SUPABASE === 'true';

/** True on any Cloudflare Pages deployment (production and preview). */
const isEdgeDeployment = (env: ApiEnv) => env.CF_PAGES === '1';

/**
 * The credential-free dev loop (`npm run dev:mock`) is the only situation where
 * a request may skip JWT verification. It needs the in-memory Supabase mock,
 * which only exists in the local Node dev server — so an edge deployment or a
 * production build can never take this path, whatever the environment says.
 */
const isCredentialFreeMock = (env: ApiEnv) =>
  isMockMode(env) && env.NODE_ENV !== 'production' && !isEdgeDeployment(env);

/**
 * Verifies `Authorization: Bearer <supabase access token>` and hands back the
 * user plus an RLS-scoped client.
 *
 * In `npm run dev:mock` there is no Supabase project to verify against, so the
 * check is skipped loudly rather than breaking the credential-free dev loop.
 * Never possible in production: `MOCK_SUPABASE` plus `NODE_ENV=production`
 * still verifies.
 */
async function authenticate(
  request: Request,
  env: ApiEnv
): Promise<{ user: User; db: SupabaseClient | null } | { error: Response }> {
  if (isCredentialFreeMock(env)) {
    console.warn(`[Auth] MOCK mode — skipping JWT verification for ${request.method} ${new URL(request.url).pathname}`);
    return { user: { id: 'mock-user' } as User, db: null };
  }

  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { error: json({ error: 'Authentication required' }, 401, corsHeaders(request, env)) };

  const client = userScopedClient(env, token);
  if (!client) {
    console.error('[Auth] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not configured.');
    return { error: json({ error: 'Server authentication is not configured' }, 503, corsHeaders(request, env)) };
  }

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) {
      return { error: json({ error: 'Invalid or expired session' }, 401, corsHeaders(request, env)) };
    }
    return { user: data.user, db: client };
  } catch (err) {
    console.error('[Auth] Token verification failed:', err);
    return { error: json({ error: 'Invalid or expired session' }, 401, corsHeaders(request, env)) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Body parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `{ value, error }` rather than a discriminated union: `tsconfig.json` runs
 * without `strictNullChecks`, and property-based narrowing does not work there.
 */
interface BodyResult<T> {
  value: T | null;
  error: Response | null;
}

const bodyError = (response: Response): BodyResult<any> => ({ value: null, error: response });

/**
 * Reads and parses a JSON body, refusing anything over `maxBytes`.
 *
 * The declared `Content-Length` is checked first so a huge payload is rejected
 * before it is buffered; the decoded length is checked as well for chunked
 * requests that never declare one.
 */
async function readJson<T = any>(request: Request, maxBytes: number): Promise<BodyResult<T>> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) {
    return bodyError(json({ error: 'Request body too large' }, 413));
  }

  const text = await request.text();
  if (text.length > maxBytes) {
    return bodyError(json({ error: 'Request body too large' }, 413));
  }
  if (!text) return { value: null, error: null };

  try {
    return { value: JSON.parse(text) as T, error: null };
  } catch {
    return bodyError(json({ error: 'Malformed JSON request body' }, 400));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Uploads
// ─────────────────────────────────────────────────────────────────────────────

/** Hard ceiling for a single upload. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** No `image/svg+xml`: an SVG is a script container, not a picture. */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/bmp', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/3gpp', 'video/mpeg',
  'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/flac',
  'application/pdf', 'text/plain', 'text/csv', 'application/json',
  'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/** Per-media-type byte cap: images are cheap, video is not. */
function sizeLimitFor(mimeType: string): number {
  if (mimeType.startsWith('image/')) return 15 * 1024 * 1024;
  if (mimeType.startsWith('video/')) return 50 * 1024 * 1024;
  if (mimeType.startsWith('audio/')) return 25 * 1024 * 1024;
  return 25 * 1024 * 1024;
}

interface UploadedFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/**
 * Accepts both shapes so nothing breaks in the switch to the edge:
 *   - `multipart/form-data` with a `file` field (the original contract), or
 *   - a raw body with the MIME type in `Content-Type` and the name in
 *     `X-File-Name` (cheaper, and the only thing that works from a WebView).
 */
async function extractUpload(request: Request): Promise<BodyResult<UploadedFile>> {
  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  const declared = Number(request.headers.get('content-length') || 0);

  if (declared && declared > MAX_UPLOAD_BYTES) {
    return bodyError(json({ status: 'error', message: 'File exceeds the 50MB ceiling' }, 413));
  }

  if (contentType.startsWith('multipart/form-data')) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return bodyError(json({ status: 'error', message: 'Malformed multipart body' }, 400));
    }
    const entry = form.get('file');
    if (!(entry instanceof File)) {
      return bodyError(json({ status: 'error', message: 'No file uploaded' }, 400));
    }
    return {
      value: { name: entry.name || 'upload', type: entry.type, bytes: new Uint8Array(await entry.arrayBuffer()) },
      error: null,
    };
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) {
    return bodyError(json({ status: 'error', message: 'No file uploaded' }, 400));
  }
  const rawName = request.headers.get('x-file-name') || 'upload';
  let name = rawName;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    /* keep the raw value if it is not URI-encoded */
  }
  return { value: { name, type: contentType || 'application/octet-stream', bytes }, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Push notifications (FCM HTTP v1)
// ─────────────────────────────────────────────────────────────────────────────

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    let parsed = JSON.parse(raw);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    if (!parsed?.project_id || !parsed?.client_email || !parsed?.private_key) return null;
    // Secret stores love escaping the newlines in PEM keys.
    parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
    return parsed as ServiceAccount;
  } catch {
    return null;
  }
}

/**
 * Google OAuth2 access token from a service account.
 *
 * This replaces `google-auth-library`, which is Node-only. Same JWT-bearer
 * grant, ~15 lines, and it runs on Workers where the library cannot.
 */
async function googleAccessToken(account: ServiceAccount, scopes: string[]): Promise<string> {
  const key = await importPKCS8(account.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);

  const assertion = await new SignJWT({ scope: scopes.join(' ') })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const payload: any = await res.json().catch(() => null);
  if (!res.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || 'Failed to obtain a Google access token');
  }
  return payload.access_token as string;
}

/** Removes a dead FCM token from whatever profile still holds it. */
async function removeInvalidFcmToken(env: ApiEnv, badToken: string): Promise<void> {
  const db = serviceClient(env);
  if (!db) return;

  try {
    const { data: users, error } = await db
      .from('users')
      .select('id, fcm_tokens')
      .contains('fcm_tokens', [badToken]);

    if (error || !users) {
      console.warn('FCM cleanup: could not look up owners of a stale token:', error);
      return;
    }

    for (const user of users) {
      if (!Array.isArray(user.fcm_tokens) || !user.fcm_tokens.includes(badToken)) continue;
      const filtered = user.fcm_tokens.filter((t: string) => t !== badToken);
      const { error: updateError } = await db.from('users').update({ fcm_tokens: filtered }).eq('id', user.id);
      if (updateError) console.warn(`FCM cleanup: failed to update user ${user.id}:`, updateError);
      else console.log(`FCM cleanup: dropped a stale token from user ${user.id}`);
    }
  } catch (err) {
    console.warn('FCM cleanup threw:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub helpers
// ─────────────────────────────────────────────────────────────────────────────

/** `git hash-object` for a base64 blob — SHA-1 over `blob <len>\0<content>`. */
async function calculateGitHubSha(contentBase64: string): Promise<string> {
  const content = base64ToBytes(contentBase64);
  const header = new TextEncoder().encode(`blob ${content.length}\0`);
  const store = new Uint8Array(header.length + content.length);
  store.set(header, 0);
  store.set(content, header.length);

  const digest = await crypto.subtle.digest('SHA-1', store);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Base64 → bytes without `Buffer` (Workers have no Buffer). */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const GITHUB_API = 'https://api.github.com';

async function githubFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'GrixChat',
      ...(init.headers || {}),
    },
  });
}

/** Turns a GitHub API failure into the same JSON shape the old proxy returned. */
async function relayGitHubError(response: Response): Promise<Response> {
  const payload: any = await response.json().catch(() => null);
  return json(payload || { message: `GitHub responded ${response.status}` }, response.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

interface Ctx {
  request: Request;
  env: ApiEnv;
  url: URL;
  path: string;
  cors: Record<string, string>;
}

/** `{ limit, windowMs }` per route family. */
const LIMITS = {
  api: { limit: 60, windowMs: 60_000 },
  notifications: { limit: 20, windowMs: 60_000 },
  upload: { limit: 8, windowMs: 60_000 },
  ai: { limit: 20, windowMs: 60_000 },
} as const;

function rateLimited(ctx: Ctx, bucket: keyof typeof LIMITS): Response | null {
  const { limit, windowMs } = LIMITS[bucket];
  const verdict = takeRateLimit(`${bucket}:${clientIp(ctx.request)}`, limit, windowMs);
  if (verdict.allowed) return null;
  return json({ error: 'Too many requests. Please slow down and try again shortly.' }, 429, {
    'Retry-After': String(verdict.retryAfter),
  });
}

/**
 * Entry point for both adapters.
 *
 * Handles CORS preflight, the cross-origin write guard, rate limiting, the
 * route table, and a last-resort error handler — so a route handler only ever
 * has to deal with its own logic.
 */
export async function handleApiRequest(request: Request, env: ApiEnv): Promise<Response> {
  const url = new URL(request.url);
  const ctx: Ctx = { request, env, url, path: url.pathname, cors: corsHeaders(request, env) };
  // One id per request: it goes on the response (X-Request-Id) and in server logs,
  // so a user's report can be matched to the exact log line.
  const requestId = crypto.randomUUID();

  const finish = (response: Response): Response => {
    const headers = new Headers(response.headers);
    headers.set('X-Request-Id', requestId);
    for (const [key, value] of Object.entries(ctx.cors)) headers.set(key, value);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      if (!headers.has(key)) headers.set(key, value);
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };

  try {
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('origin');
      if (origin && !isAllowedOrigin(request, env, origin)) {
        return finish(json({ error: 'Origin not allowed' }, 403));
      }
      return finish(new Response(null, { status: 204 }));
    }

    // CSRF belt-and-braces: a browser that sends an Origin we do not recognise
    // is rejected outright. Requests without an Origin (native clients) pass.
    const origin = request.headers.get('origin');
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (isWrite && origin && !isAllowedOrigin(request, env, origin)) {
      console.warn(`[${requestId}] Blocked cross-origin ${request.method} ${ctx.path} from ${origin}`);
      return finish(json({ error: 'Origin not allowed' }, 403));
    }

    return finish(await route(ctx));
  } catch (err: unknown) {
    console.error(`[${requestId}] Unhandled API error on ${ctx.path}:`, err);
    return finish(json({ error: (err as ErrorLike)?.message || 'Internal server error', requestId }, 500));
  }
}

async function route(ctx: Ctx): Promise<Response> {
  const { request, path } = ctx;
  const method = request.method;

  // ── Health ───────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/api/health') {
    return json({ status: 'ok', message: 'GrixChat API is running', runtime: ctx.env.REPO_FS ? 'node' : 'edge' });
  }

  // ── LiveKit token ────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/api/livekit-token') return livekitToken(ctx);

  // ── Push notifications ───────────────────────────────────────────────────
  if (method === 'POST' && path === '/api/send-notification') return sendNotification(ctx);

  // ── Grix AI (Gemini proxy) ───────────────────────────────────────────────
  if (method === 'POST' && path === '/api/grix-ai') return grixAi(ctx);

  // ── Uploads ──────────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/api/upload-file') return uploadFile(ctx);

  // ── GitHub ───────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/api/github/debug') return githubDebug(ctx);
  if (method === 'GET' && path === '/api/github/auth-url') return githubAuthUrl(ctx);
  if (method === 'GET' && (path === '/auth/github/callback' || path === '/auth/github/callback/')) {
    return githubCallback(ctx);
  }
  if (method === 'POST' && path === '/api/github/push') return githubPush(ctx);
  if (method === 'POST' && path === '/api/github/push-batch') return githubPushBatch(ctx);
  if (method === 'GET' && path === '/api/github/list-files') return githubListFiles(ctx);
  if (method === 'GET' && path === '/api/github/get-file-content') return githubGetFileContent(ctx);

  if (path.startsWith('/api/')) {
    return json({ error: `Unknown API route: ${method} ${path}` }, 404);
  }

  return json({ error: 'Not found' }, 404);
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `iss`/`sub`/`nbf`/`exp` + the `video` grant — byte-for-byte the token
 * `livekit-server-sdk`'s `AccessToken` produces, signed with WebCrypto via
 * `jose` instead of the Node-oriented SDK so the same code runs on Workers.
 */
async function livekitToken(ctx: Ctx): Promise<Response> {
  const limited = rateLimited(ctx, 'api');
  if (limited) return limited;

  const { value: body, error: bodyErrorResponse } = await readJson(ctx.request, 256 * 1024);
  if (bodyErrorResponse) return bodyErrorResponse;

  const { roomName, participantIdentity } = body || {};
  if (!roomName || !participantIdentity) {
    return json({ error: 'Missing roomName or participantIdentity parameters' }, 400);
  }

  // The caller may only be issued a token for a room they are actually part of:
  // either a call they participate in, or a conversation they belong to.
  const auth = await authenticate(ctx.request, ctx.env);
  if ('error' in auth) return auth.error;

  const db = serviceClient(ctx.env) || auth.db;
  const isMock = isCredentialFreeMock(ctx.env);
  if (db && !isMock) {
    const [{ data: call }, { data: participant }] = await Promise.all([
      db.from('calls').select('id').eq('id', roomName)
        .or(`caller_id.eq.${auth.user.id},receiver_id.eq.${auth.user.id}`)
        .maybeSingle(),
      db.from('conversation_participants').select('user_id')
        .eq('conversation_id', roomName).eq('user_id', auth.user.id).maybeSingle(),
    ]);

    if (!call && !participant) {
      console.warn(`[LiveKit] Refusing a token for room ${roomName} — ${auth.user.id} is not a participant.`);
      return json({ error: 'You are not a participant in this call' }, 403);
    }
  }

  // Never trust a client-supplied identity over the verified session.
  const identity = isMock ? participantIdentity : auth.user.id;

  const apiKey = ctx.env.LIVEKIT_API_KEY;
  const apiSecret = ctx.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.warn('LiveKit: LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not configured — returning a sandbox token.');
    return json({
      success: false,
      error:
        'LiveKit server credentials are not configured. Please define LIVEKIT_API_KEY and LIVEKIT_API_SECRET in the Pages project settings.',
      token: 'mock-livekit-token-sandbox',
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    video: { roomJoin: true, room: roomName, canPublish: true, canSubscribe: true },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(apiKey)
    .setSubject(identity)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 6 * 3600)
    .sign(new TextEncoder().encode(apiSecret));

  return json({ success: true, token });
}

async function sendNotification(ctx: Ctx): Promise<Response> {
  const limited = rateLimited(ctx, 'notifications');
  if (limited) return limited;

  const { value: parsed, error: parseError } = await readJson(ctx.request, 256 * 1024);
  if (parseError) return parseError;
  if (!parsed) return json({ error: 'Missing request body' }, 400);

  const { conversationId, tokens: requestedTokens, body, data } = parsed;
  const env = ctx.env;

  const auth = await authenticate(ctx.request, env);
  if ('error' in auth) return auth.error;

  const db = serviceClient(env) || auth.db;
  const isMock = isCredentialFreeMock(env);
  const canResolveRecipients = Boolean(db) && !isMock;

  // Without a database there is nothing to derive recipients from. The only
  // acceptable case is the credential-free dev loop.
  if (!canResolveRecipients) {
    if (!isMock) return json({ error: 'Server database is not configured' }, 503);
    const devTokens = Array.isArray(requestedTokens)
      ? [...new Set<string>(requestedTokens.filter((t: any) => typeof t === 'string' && t.trim()))]
      : [];
    console.warn(`[FCM] MOCK mode — simulating a dispatch to ${devTokens.length} client-supplied token(s).`);
    return json({
      success: true,
      simulated: true,
      total: devTokens.length,
      sentCount: 0,
      message: 'Mock mode: push dispatch simulated, no device was contacted.',
    });
  }

  let validTokens: string[] = [];
  let title = 'GrixChat';

  if (conversationId) {
    const callerId = auth.user.id;

    const { data: participants, error } = await db!
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId);

    if (error) {
      console.error('FCM: failed to read conversation participants:', error);
      return json({ error: 'Failed to read conversation participants' }, 500);
    }

    const participantIds: string[] = (participants || []).map((p: any) => p.user_id);
    if (!participantIds.includes(callerId)) {
      return json({ error: 'You are not a participant in this conversation' }, 403);
    }

    // Recipients come from the database; the request only says *which* thread.
    const recipientIds = participantIds.filter((id) => id !== callerId);
    if (recipientIds.length > 0) {
      const { data: profiles, error: profileError } = await db!
        .from('users')
        .select('id, fcm_tokens, muted_users')
        .in('id', recipientIds);

      if (profileError) console.warn('FCM: failed to read recipient profiles:', profileError);

      const collected = new Set<string>();
      for (const profile of profiles || []) {
        if (Array.isArray(profile.muted_users) && profile.muted_users.includes(callerId)) continue;
        if (Array.isArray(profile.fcm_tokens)) {
          profile.fcm_tokens.forEach((t: string) => {
            if (typeof t === 'string' && t.trim()) collected.add(t);
          });
        }
      }
      validTokens = [...collected];
    }

    // The title is read from the sender's row, never taken from the request, so
    // it cannot be spoofed into a phishing message.
    const { data: sender } = await db!.from('users').select('full_name, username').eq('id', callerId).maybeSingle();
    title = sender?.full_name || sender?.username || 'New message';
  } else {
    // Self-send mode: the notification-settings test button. Anything that is
    // not registered on the caller's own profile is dropped.
    if (!Array.isArray(requestedTokens) || requestedTokens.length === 0) {
      return json({ error: 'Missing recipient registration tokens' }, 400);
    }

    const { data: self } = await db!.from('users').select('fcm_tokens').eq('id', auth.user.id).maybeSingle();
    const own = new Set<string>(
      Array.isArray(self?.fcm_tokens) ? self!.fcm_tokens.filter((t: any) => typeof t === 'string') : []
    );

    const requested = requestedTokens.filter((t: any) => typeof t === 'string' && t.trim().length > 0);
    validTokens = [...new Set<string>(requested)].filter((t) => own.has(t));

    if (validTokens.length === 0) {
      return json({ error: 'None of those tokens belong to the authenticated user' }, 403);
    }
    title = typeof parsed.title === 'string' ? parsed.title.slice(0, 120) : 'GrixChat';
  }

  if (validTokens.length === 0) {
    return json({ success: true, total: 0, sentCount: 0, results: [], message: 'No registered devices to notify' });
  }

  // Cap the body so this endpoint cannot be used to push essays.
  const bodyText = (typeof body === 'string' ? body : '').slice(0, 200);

  const rawAccount = env.FIREBASE_SERVICE_ACCOUNT;
  if (!rawAccount) {
    console.warn('FCM: FIREBASE_SERVICE_ACCOUNT is not set — simulating the dispatch.');
    console.log(`[PUSH NOTIFICATION SIMULATION] title=${title} tokens=${validTokens.length}`);
    return json({
      success: true,
      simulated: true,
      message: 'Push simulated. Configure FIREBASE_SERVICE_ACCOUNT to enable real FCM sending.',
    });
  }

  const account = parseServiceAccount(rawAccount);
  if (!account) return json({ error: 'FIREBASE_SERVICE_ACCOUNT is not valid JSON with a private key' }, 500);

  const accessToken = await googleAccessToken(account, ['https://www.googleapis.com/auth/firebase.messaging']);

  const results = await Promise.all(
    validTokens.map(async (token) => {
      try {
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: {
                token,
                notification: { title, body: bodyText },
                data: {
                  click_action: data?.click_action || '/chats',
                  conversationId: data?.conversationId || '',
                  senderId: data?.senderId || '',
                  ...(data || {}),
                },
              },
            }),
          }
        );

        if (!response.ok) {
          const failure: any = await response.json().catch(() => null);
          const status = failure?.error?.status;
          const message = failure?.error?.message || '';
          const isInvalidToken =
            response.status === 400 ||
            response.status === 404 ||
            status === 'INVALID_ARGUMENT' ||
            status === 'NOT_FOUND' ||
            status === 'UNREGISTERED' ||
            message.includes('not a valid FCM registration token') ||
            message.includes('Requested entity was not found');

          if (isInvalidToken) await removeInvalidFcmToken(env, token);
          return { token: `${token.slice(0, 10)}…`, success: false, error: failure || response.status };
        }

        const payload: any = await response.json().catch(() => null);
        return { token: `${token.slice(0, 10)}…`, success: true, messageId: payload?.name };
      } catch (err: unknown) {
        console.error('FCM: send failed:', (err as ErrorLike)?.message || err);
        return { token: `${token.slice(0, 10)}…`, success: false, error: (err as ErrorLike)?.message || 'send failed' };
      }
    })
  );

  return json({
    success: true,
    total: validTokens.length,
    sentCount: results.filter((r) => r.success).length,
    results,
  });
}

/** Server-side Gemini proxy — the API key never reaches the browser. */
async function grixAi(ctx: Ctx): Promise<Response> {
  const limited = rateLimited(ctx, 'ai');
  if (limited) return limited;

  const auth = await authenticate(ctx.request, ctx.env);
  if ('error' in auth) return auth.error;

  const { value: parsed, error: parseError } = await readJson(ctx.request, 256 * 1024);
  if (parseError) return parseError;

  const apiKey = ctx.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GrixAI: GEMINI_API_KEY is not configured.');
    return json({ error: 'Gemini API key is not configured on the server. Please register GEMINI_API_KEY in the Pages project settings.' }, 400);
  }

  const { messages, model, modelType } = parsed || {};
  const formatted = Array.isArray(messages) ? messages : [];

  const systemMessage = formatted.find((m: any) => m.role === 'system');
  const systemInstruction =
    systemMessage?.content || systemMessage?.text || 'You are Grix AI, a helpful and friendly assistant for GrixChat.';

  const contents = formatted
    .filter((m: any) => m.role !== 'system')
    .map((m: any) => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
      parts: [{ text: m.content || m.text || '' }],
    }));

  const variant = model || modelType || 'grix-ai';
  const modelId = 'gemini-3.5-flash';

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: { temperature: variant === 'grix-ai-pro' ? 1.0 : 0.7 },
    }),
  });

  const payload: any = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('GrixAI: Gemini responded with an error:', payload);
    return json({ error: payload?.error?.message || 'An error occurred while communicating with Gemini.' }, 502);
  }

  const reply =
    payload?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') || '';

  return json({ success: true, reply: reply || "I'm sorry, I couldn't process that." });
}

/**
 * Upload proxy (Catbox for media, Gofile for everything else).
 *
 * Signed-in callers only, MIME allowlist, per-media-type size caps — this used
 * to be an anonymous 100MB-per-file host.
 */
async function uploadFile(ctx: Ctx): Promise<Response> {
  const limited = rateLimited(ctx, 'upload');
  if (limited) return limited;

  const auth = await authenticate(ctx.request, ctx.env);
  if ('error' in auth) return auth.error;

  const { value: file, error: uploadError } = await extractUpload(ctx.request);
  if (uploadError) return uploadError;
  if (!file) return json({ status: 'error', message: 'No file uploaded' }, 400);
  const mime = (file.type || 'application/octet-stream').split(';')[0].trim().toLowerCase();

  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return json({ status: 'error', message: `Unsupported file type: ${mime}` }, 415);
  }

  const maxBytes = sizeLimitFor(mime);
  if (file.bytes.byteLength > maxBytes) {
    return json(
      { status: 'error', message: `${mime} uploads are capped at ${Math.round(maxBytes / (1024 * 1024))}MB` },
      413
    );
  }

  const blob = new Blob([file.bytes as unknown as BlobPart], { type: mime });
  const isMedia = mime.startsWith('image/') || mime.startsWith('video/');

  try {
    if (isMedia) {
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('fileToUpload', blob, file.name);

      console.log('Uploading media to Catbox…');
      const response = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const text = (await response.text()).trim();

      if (response.ok && text.startsWith('http')) {
        return json({ status: 'ok', downloadUrl: text, provider: 'catbox' });
      }
      throw new Error(`Catbox error: ${text || response.status}`);
    }

    console.log('Resolving a Gofile server…');
    const serverResponse = await fetch('https://api.gofile.io/servers');
    const serverPayload: any = await serverResponse.json().catch(() => null);
    // The API has shipped both `data.server` and `data.servers[]` shapes.
    const server =
      serverPayload?.data?.server ||
      serverPayload?.data?.servers?.[0]?.name ||
      (await fetch('https://api.gofile.io/getServer').then((r) => r.json()).then((j: any) => j?.data?.server).catch(() => null));

    if (!server) throw new Error('Gofile did not return an upload server');

    const form = new FormData();
    form.append('file', blob, file.name);

    const response = await fetch(`https://${server}.gofile.io/contents/uploadfile`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    const payload: any = await response.json().catch(() => null);

    if (response.ok && payload?.status === 'ok') {
      return json({
        status: 'ok',
        downloadUrl: payload.data.downloadPage,
        fileId: payload.data.fileId,
        provider: 'gofile',
      });
    }
    throw new Error(`Gofile error: ${JSON.stringify(payload)}`);
  } catch (err: unknown) {
    console.error('Upload failed:', (err as ErrorLike)?.message || err);
    return json({ status: 'error', message: `Upload failed: ${(err as ErrorLike)?.message || err}` }, 502);
  }
}

/**
 * Reports which secrets exist. Development only.
 *
 * Cloudflare deployments never serve it: `CF_PAGES` is set on production *and*
 * preview, and `NODE_ENV` is not automatically present on Workers, so relying
 * on `NODE_ENV` alone would leave it exposed. `/api/github/auth-url` answers
 * "GITHUB_CLIENT_ID is not set" when you need the same diagnostic in production.
 */
async function githubDebug(ctx: Ctx): Promise<Response> {
  if (ctx.env.NODE_ENV === 'production' || isEdgeDeployment(ctx.env)) {
    return json({ error: 'Not found' }, 404);
  }
  return json({
    hasClientId: !!ctx.env.GITHUB_CLIENT_ID,
    hasClientSecret: !!ctx.env.GITHUB_CLIENT_SECRET,
    appUrl: ctx.env.APP_URL || 'Not Set',
    runtime: ctx.env.REPO_FS ? 'node' : 'cloudflare-pages',
    env: ctx.env.NODE_ENV,
  });
}

/** Canonical origin for OAuth redirects: APP_URL, else derived from the request. */
function resolveAppUrl(ctx: Ctx): string {
  const configured = ctx.env.APP_URL;
  if (configured && configured.startsWith('http')) return configured.replace(/\/$/, '');

  const forwardedHost = ctx.request.headers.get('x-forwarded-host') || ctx.request.headers.get('host');
  const protocol = ctx.request.headers.get('x-forwarded-proto') || ctx.url.protocol.replace(':', '') || 'https';
  return `${protocol}://${forwardedHost || ctx.url.host}`.replace(/\/$/, '');
}

async function githubAuthUrl(ctx: Ctx): Promise<Response> {
  const clientId = ctx.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    console.error('GITHUB_CLIENT_ID is missing from the environment.');
    return json({ error: 'GITHUB_CLIENT_ID is not set' }, 500);
  }

  const redirectUri = `${resolveAppUrl(ctx)}/auth/github/callback`;
  const state = crypto.randomUUID();
  const url =
    `https://github.com/login/oauth/authorize?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,user,workflow&state=${state}`;

  return json({ url, redirectUri });
}

/**
 * OAuth callback. Returns a tiny page that hands the token to the opener window
 * — the popup flow the GitHub screen expects.
 */
async function githubCallback(ctx: Ctx): Promise<Response> {
  const code = ctx.url.searchParams.get('code');
  const clientId = ctx.env.GITHUB_CLIENT_ID;
  const clientSecret = ctx.env.GITHUB_CLIENT_SECRET;

  if (!code) return html('<p>Missing OAuth code.</p>', 400);
  if (!clientId || !clientSecret) return html('<p>GitHub OAuth is not configured on the server.</p>', 500);

  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });

    const payload: any = await response.json().catch(() => null);
    const accessToken = payload?.access_token;
    if (!accessToken) throw new Error('No access token returned');

    // `window.opener` survives because COOP is off (see public/_headers and the
    // Express adapter) — it is what makes the popup flow work.
    return html(`<!doctype html>
<html>
  <head>
    <title>Authenticating…</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body style="margin:0; background:#f4f4f5;">
    <script>
      var token = ${JSON.stringify(accessToken)};
      try { localStorage.setItem('github_token', token); } catch (e) { console.error('Local storage error:', e); }

      var message = { type: 'GITHUB_AUTH_SUCCESS', token: token };
      if (window.opener) {
        window.opener.postMessage(message, '*');
        setTimeout(function () {
          window.close();
          var status = document.getElementById('status');
          if (status) status.innerText = 'Authenticated! You can close this window.';
        }, 500);
      } else {
        var status = document.getElementById('status');
        var loader = document.getElementById('loader');
        var icon = document.getElementById('success-icon');
        if (status) status.innerText = 'Authenticated! Please return to GrixChat.';
        if (loader) loader.style.display = 'none';
        if (icon) icon.style.display = 'flex';
      }
    </script>
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:20px;text-align:center;">
      <div id="loader" style="width:48px;height:48px;border:4px solid #e4e4e7;border-top-color:#0494f4;border-radius:50%;animation:spin 1s linear infinite;"></div>
      <div id="success-icon" style="display:none;width:60px;height:60px;background:#0494f4;border-radius:50%;color:white;align-items:center;justify-content:center;font-size:30px;margin-bottom:20px;">✓</div>
      <p id="status" style="margin-top:24px;font-weight:600;color:#18181b;font-size:16px;">Authenticating with GitHub…</p>
      <p style="margin-top:8px;color:#71717a;font-size:14px;">Securely connecting your accounts</p>
    </div>
    <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
  </body>
</html>`);
  } catch (err: unknown) {
    console.error('GitHub callback failed:', (err as ErrorLike)?.message || err);
    return html('<p>Auth failed</p>', 500);
  }
}

/**
 * Single-file push. Relays the caller's *own* GitHub token, so this route is
 * rate limited but needs no extra authorisation of its own — the server holds
 * no GitHub secret here.
 */
async function githubPush(ctx: Ctx): Promise<Response> {
  const limited = rateLimited(ctx, 'api');
  if (limited) return limited;

  const { value: parsed, error: parseError } = await readJson(ctx.request, 32 * 1024 * 1024);
  if (parseError) return parseError;

  const { token, owner, repo, path: filePath, content, message, branch = 'main' } = parsed || {};
  if (!token || !owner || !repo || !filePath || !content) {
    return json({ message: 'token, owner, repo, path and content are required' }, 400);
  }

  try {
    let sha: string | undefined;
    const existing = await githubFetch(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`,
      token
    );
    if (existing.ok) {
      const meta: any = await existing.json().catch(() => null);
      sha = meta?.sha;
    }

    const pushResponse = await githubFetch(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content, sha, branch }),
    });

    if (!pushResponse.ok) return relayGitHubError(pushResponse);
    return json(await pushResponse.json());
  } catch (err: unknown) {
    console.error('GitHub push failed:', (err as ErrorLike)?.message || err);
    return json({ message: (err as ErrorLike)?.message || 'Push failed' }, 502);
  }
}

/**
 * Smart batch push: diffs against the remote tree, creates blobs in batches,
 * then one tree + commit + ref update.
 */
async function githubPushBatch(ctx: Ctx): Promise<Response> {
  const limited = rateLimited(ctx, 'api');
  if (limited) return limited;

  const { value: parsed, error: parseError } = await readJson(ctx.request, 32 * 1024 * 1024);
  if (parseError) return parseError;

  const { token, owner, repo, files, message, branch = 'main', isSequential = false } = parsed || {};
  if (!token || !owner || !repo || !Array.isArray(files) || files.length === 0) {
    return json({ message: 'token, owner, repo and a non-empty files[] are required' }, 400);
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    // 1. Current branch head
    const branchResponse = await githubFetch(`/repos/${owner}/${repo}/branches/${branch}`, token);
    if (!branchResponse.ok) return relayGitHubError(branchResponse);
    const branchData: any = await branchResponse.json();
    const parentSha = branchData.commit.sha;
    const baseTreeSha = branchData.commit.commit.tree.sha;

    // 2. Existing tree, to skip files that did not change
    const treeResponse = await githubFetch(`/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`, token);
    const treeData: any = treeResponse.ok ? await treeResponse.json().catch(() => null) : null;
    const existingFiles = new Map<string, string>();
    (treeData?.tree || []).forEach((node: any) => {
      if (node.type === 'blob') existingFiles.set(node.path, node.sha);
    });

    // 3. Keep only what actually changed
    const modified: Array<{ path: string; content: string }> = [];
    for (const file of files) {
      const localSha = await calculateGitHubSha(file.content);
      if (localSha !== existingFiles.get(file.path)) modified.push(file);
    }
    console.log(`Smart Sync: ${modified.length} of ${files.length} files changed.`);

    if (modified.length === 0) {
      return json({ message: 'No changes detected. Repository is already up to date.', noChanges: true });
    }

    // 3b. Sequential mode — one commit per file, for safe incremented pushes
    if (isSequential) {
      let uploaded = 0;
      try {
        for (const file of modified) {
          const sha = existingFiles.get(file.path);
          const response = await githubFetch(`/repos/${owner}/${repo}/contents/${file.path}`, token, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: `${message} - update ${file.path}`,
              content: file.content,
              sha: sha || undefined,
              branch,
            }),
          });
          if (!response.ok) {
            const failure: any = await response.json().catch(() => null);
            throw new Error(failure?.message || `GitHub responded ${response.status}`);
          }
          uploaded++;
          await sleep(150); // stay clear of GitHub's abuse detection
        }

        return json({
          message: `Successfully uploaded all ${uploaded} files sequentially.`,
          sequential: true,
          uploadedCount: uploaded,
          html_url: `https://github.com/${owner}/${repo}/commits/${branch}`,
        });
      } catch (err: unknown) {
        if (uploaded > 0) {
          return json({
            message: `Uploaded ${uploaded} files successfully, but stopped because of a GitHub limit.`,
            sequential: true,
            uploadedCount: uploaded,
            error: (err as ErrorLike)?.message,
            html_url: `https://github.com/${owner}/${repo}/commits/${branch}`,
          });
        }
        throw err;
      }
    }

    // 4. Create blobs, 5 at a time
    const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    const BATCH_SIZE = 5;
    for (let i = 0; i < modified.length; i += BATCH_SIZE) {
      const batch = modified.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (file) => {
          const response = await githubFetch(`/repos/${owner}/${repo}/git/blobs`, token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: file.content, encoding: 'base64' }),
          });
          if (!response.ok) {
            const failure: any = await response.json().catch(() => null);
            throw new Error(`Failed to upload ${file.path}: ${failure?.message || response.status}`);
          }
          const blob: any = await response.json();
          return { path: file.path, mode: '100644', type: 'blob', sha: blob.sha };
        })
      );
      treeItems.push(...results);
      if (i + BATCH_SIZE < modified.length) await sleep(400);
    }

    // 5. New tree on top of the existing one
    const newTreeResponse = await githubFetch(`/repos/${owner}/${repo}/git/trees`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    });
    if (!newTreeResponse.ok) return relayGitHubError(newTreeResponse);
    const newTree: any = await newTreeResponse.json();

    // 6. Commit
    const commitResponse = await githubFetch(`/repos/${owner}/${repo}/git/commits`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, tree: newTree.sha, parents: [parentSha] }),
    });
    if (!commitResponse.ok) return relayGitHubError(commitResponse);
    const commit: any = await commitResponse.json();

    // 7. Move the branch
    const refResponse = await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    if (!refResponse.ok) return relayGitHubError(refResponse);

    console.log(`Smart Sync: branch ${branch} updated.`);
    return json(await refResponse.json());
  } catch (err: unknown) {
    console.error('Smart batch push failed:', (err as ErrorLike)?.message || err);
    return json({ message: (err as ErrorLike)?.message || 'Batch push failed' }, 502);
  }
}

/**
 * Repository Sync Tool: enumerate the checked-out source tree.
 *
 * Node-only by nature — Cloudflare Workers have no filesystem, so the edge
 * answers 501 and the screen degrades instead of hanging.
 */
async function githubListFiles(ctx: Ctx): Promise<Response> {
  const limited = rateLimited(ctx, 'api');
  if (limited) return limited;

  const auth = await authenticate(ctx.request, ctx.env);
  if ('error' in auth) return auth.error;

  const repoFs = ctx.env.REPO_FS;
  if (!repoFs) {
    return json(
      {
        error: 'The repository sync tool needs a Node host with the source tree. Cloudflare Pages has no filesystem.',
        files: [],
      },
      501
    );
  }

  try {
    return json({ files: repoFs.listFiles() });
  } catch (err: unknown) {
    return json({ error: (err as ErrorLike)?.message || 'Failed to list files' }, 500);
  }
}

/** Repository Sync Tool: base64 of one source file (path-traversal guarded). */
async function githubGetFileContent(ctx: Ctx): Promise<Response> {
  const limited = rateLimited(ctx, 'api');
  if (limited) return limited;

  const auth = await authenticate(ctx.request, ctx.env);
  if ('error' in auth) return auth.error;

  const repoFs = ctx.env.REPO_FS;
  if (!repoFs) {
    return json(
      { error: 'The repository sync tool needs a Node host with the source tree. Cloudflare Pages has no filesystem.' },
      501
    );
  }

  const requested = ctx.url.searchParams.get('path');
  if (!requested) return json({ error: 'Path is required' }, 400);

  try {
    const content = repoFs.readFileBase64(requested);
    if (content === null) return json({ error: 'File not found' }, 404);
    return json({ content });
  } catch (err: unknown) {
    return json({ error: (err as ErrorLike)?.message || 'Failed to read file' }, 500);
  }
}
