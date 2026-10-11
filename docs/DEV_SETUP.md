# Dev Setup

Everything needed to get GrixChat running locally, with or without real
Supabase credentials.

---

## Prerequisites

- **Node ≥ 20** (`package.json` declares `"engines": { "node": ">=20.0.0" }`)
- npm 10+

```bash
npm install
```

---

## Mode 1 — Mock Supabase (recommended default)

**No `.env`, no credentials, no network.** This is the mode to use for UI
work, bug reproduction, and anything that does not specifically need a real
Postgres.

```bash
npm run dev:mock
```

→ <http://localhost:3000>

**Login:** `demo@grixchat.app` / `grixchat`

Every seeded user accepts the same password — this is a mock.

### How it works

`MOCK_SUPABASE=1` makes `vite.config.ts` add a resolve alias:

```
@supabase/supabase-js  →  dev/mock/index.ts
```

and injects placeholder values for `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
so `src/lib/supabase.ts` still constructs a client. **No source file in `src/`
knows the difference** — `createClient(url, key)` is the only entry point the
app uses.

Verified: the dev server serves
`import { createClient } from "/dev/mock/index.ts"` for `src/lib/supabase.ts`,
and a `npm run build:mock` bundle contains the mock marker and no real
Supabase client.

The mock lives in the **browser** bundle, so it also mocks `auth.getSession()`.
That is what lets `npm run dev:mock` exercise the JWT-protected API routes:
the client attaches its mock session token and the Node API skips verification
in this mode (see `isCredentialFreeMock` in `server/api.ts`). Cloudflare never
takes that path — an edge deployment always verifies.

### What is seeded

8 users · 5 direct chats · 2 groups · ~28 messages (one of them a real reply,
so the `reply_to` self-join is exercised) · 4 stories · 5 calls ·
4 notifications · 3 posts · 3 reels · 2 tube videos · 2 moments · 2 Q&A
questions · chat settings · follows.

The signed-in user is **Aryan Verma (`aryan_v`)**. Full list in
[`dev/mock/seed.ts`](../dev/mock/seed.ts), exported as `SEED` so tests can
reference stable IDs.

### Console handle

The mock installs `__grixMock` on `globalThis`:

```js
__grixMock.dump()              // row counts for every table
__grixMock.dump('messages')    // the whole messages table
__grixMock.reset()             // back to pristine seed data
```

State persists in `localStorage` under `grixchat_mock_db_v1`, so a reload
keeps the messages you sent. `__grixMock.reset()` clears it.

### Limitations — read before trusting a result

- **Single tab only.** Realtime channels are an in-process pub/sub, so two
  browser tabs do not see each other. Multi-device sync needs real Supabase.
- **No RLS.** The mock does not enforce row-level security. A query that
  would be rejected by a policy succeeds here.
- **No Postgres semantics.** No transactions, no triggers, no `gen_random_uuid`
  defaults beyond `id`/`created_at`/`updated_at`, no composite primary keys.
- **OAuth is faked.** `signInWithOAuth` signs you straight in as the demo user.
- **Storage returns data URLs.** Uploads are read as base64 so `<img src>`
  renders, but nothing is stored remotely.

---

## Mode 2 — Real Supabase

Required for: RLS verification, multi-device realtime, actual FCM push,
actual file storage.

**1. Prepare the database first.** Supabase → SQL Editor → run
[`sql/01_schema.sql`](../sql/01_schema.sql), then
[`sql/02_functions_realtime_storage.sql`](../sql/02_functions_realtime_storage.sql).
Two pastes create every table, policy, bucket, trigger and function, and both are
safe to run again later (nothing is dropped — see
[`sql/00_master_instructions.md`](../sql/00_master_instructions.md)). Without them
the app signs in and then shows nothing.

**2. Then run the app:**

```bash
cp .env.example .env
# fill in the values
npm run dev
```

`.env.example` lists every variable the codebase reads. The full list:

### Frontend (`VITE_*` — exposed to the browser bundle)

| Variable | Used by |
|---|---|
| `VITE_SUPABASE_URL` | `src/lib/supabase.ts` |
| `VITE_SUPABASE_ANON_KEY` | `src/lib/supabase.ts` |
| `VITE_FIREBASE_API_KEY` | `src/lib/firebase.ts`, `src/components/NotificationHandler.tsx` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `src/lib/firebase.ts` |
| `VITE_FIREBASE_PROJECT_ID` | `src/lib/firebase.ts`, `NotificationHandler.tsx` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `src/lib/firebase.ts`, `NotificationHandler.tsx` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `src/lib/firebase.ts`, `NotificationHandler.tsx` |
| `VITE_FIREBASE_APP_ID` | `src/lib/firebase.ts`, `NotificationHandler.tsx` |
| `VITE_FIREBASE_VAPID_KEY` | `NotificationHandler.tsx` |
| `VITE_FIREBASE_DATABASE_URL` | presence code |
| `VITE_LIVEKIT_URL` | `src/providers/CallProvider.tsx` |
| `VITE_BASE_URL` | build-time path prefix. Cloudflare serves from the domain root — leave empty. |

> ⚠️ Any `VITE_`-prefixed variable is inlined into the shipped bundle in
> plaintext. Only the Supabase anon key and the Firebase web config belong
> there. Secrets go through `server.ts`.

> ⚠️ `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` must be present at **build**
> time. `src/lib/supabase.ts` returns `null` without them, Rollup folds that to
> `null` and tree-shakes the whole SDK out of the bundle — the build succeeds
> and the app can never reach the backend. `vite.config.ts` now warns loudly
> when a production build is missing them.

### Server (`process.env` — never exposed)

| Variable | Used by |
|---|---|
| `GEMINI_API_KEY` | `/api/grix-ai` |
| `FIREBASE_SERVICE_ACCOUNT` | `/api/send-notification` (JSON, newlines may be escaped) |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | `/api/livekit-token` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | `/api/github/auth-url` |
| `SUPABASE_SERVICE_ROLE_KEY` | privileged reads/writes (FCM token cleanup). Falls back to the anon key + the caller's JWT. |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | **required server-side too** — every `/api` route verifies the caller's JWT against the project |
| `APP_URL` | OAuth redirect base and first CORS allowlist entry (`https://grixchat.gothwadtech.com`) |
| `ALLOWED_ORIGINS` | extra comma-separated browser origins allowed to call `/api/*` |
| `MOCK_SUPABASE` | Node dev server only: `1` skips JWT verification for the credential-free loop. Ignored on Cloudflare, which always verifies. |
| `NODE_ENV` | Node: `production` serves `dist/`. Also hides the `/api/github/debug` diagnostic route (already hidden on any Pages deployment). |
| `CF_PAGES` | Set to `1` automatically by Cloudflare. The API treats it as "never skip verification here". |
| `PORT` | Node dev server port (default `3000`) |

Every missing credential degrades gracefully — the server logs a warning and
returns a simulated response rather than crashing. That is deliberate, but it
also means **a misconfigured deploy looks like it is working.** The one
exception is authentication: without `VITE_SUPABASE_URL` +
`VITE_SUPABASE_ANON_KEY` the `/api` routes answer `503`, on purpose.

---

## Deploy — Cloudflare Pages

**Production lives on Cloudflare Pages: <https://grixchat.gothwadtech.com>**
(Cloudflare project name: **`gtwdchat`** — that is what the dashboard calls it,
and what `wrangler.toml` declares.)

A deployment is two halves that ship together from this one repository:

| Half | Source | What it serves |
|---|---|---|
| Static site | `dist/` (`npm run build`) | The React PWA — `index.html`, hashed assets, `sw.js`, `manifest.json` |
| API | `functions/` (Pages Functions) | Every `/api/*` route plus `/auth/github/callback` |

There is **one** API implementation: `server/api.ts` is written against the Web
`Request`/`Response` API, `functions/api/[[path]].ts` hands Cloudflare's request
straight to it, and `server.ts` does the same for the Node dev server. Nothing
needs porting between environments, and there is no second server to drift.

### Project settings

Cloudflare dashboard → **Workers & Pages → gtwdchat → Settings**:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` (repo root) |
| Framework preset | None / Vite |
| Node version | `NODE_VERSION=22` (environment variable — `wrangler@4` needs Node ≥ 22) |
| Production branch | your main branch |

`wrangler.toml` pins the same output directory and the compatibility date, so
`npx wrangler pages deploy dist` and `npx wrangler pages dev dist` behave the
same as the dashboard build. Only a **build** (`npm run build` → `dist/`)
triggers the Pages build; the Node server bundle is not part of it (see
"Commands" below).

### Repository files that make the deploy work

| File | Purpose |
|---|---|
| `wrangler.toml` | Pages project config — `name = "gtwdchat"`, output dir, compatibility date |
| `functions/api/[[path]].ts` | Every `/api/*` request → `server/api.ts` |
| `functions/auth/[[path]].ts` | `/auth/github/callback` → the same router |
| `public/_routes.json` | Scopes Functions to `/api/*` and `/auth/*` — everything else stays on the CDN and never spins up a Function |
| `public/_headers` | Security headers + cache policy for static assets |
| `public/.well-known/assetlinks.json` | Android TWA verification, served straight from the edge |
| `public/sitemap.xml`, `public/robots.txt` | SEO, pointing at the canonical domain |

> **No SPA redirect rule on purpose.** Cloudflare serves `index.html` for
> unknown paths natively, and a `/* → /index.html 200` rule is actually turned
> into a **308 permanent redirect** that browsers cache forever. Deep links
> (`/chats`, `/chat/:id`) are verified to return the shell with a `200`.

### Environment variables

Pages → **Settings → Environment variables**. Add each one to **Production**
*and* **Preview**; the `VITE_*` half is inlined at build time (a change needs a
redeploy), the rest is read per request by the Functions.

| Variable | Needed for |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | The client, **and** the API's JWT verification. Without them the Supabase SDK is tree-shaken out of the bundle — the build prints a loud warning. |
| `VITE_FIREBASE_*`, `VITE_LIVEKIT_URL` | Push registration and calling |
| `GEMINI_API_KEY` | `/api/grix-ai` |
| `FIREBASE_SERVICE_ACCOUNT` | `/api/send-notification` (whole JSON, escaped `\n` is healed) |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | `/api/livekit-token` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | The GitHub browser's OAuth popup |
| `SUPABASE_SERVICE_ROLE_KEY` | Push fan-out + FCM token cleanup |
| `APP_URL` | `https://grixchat.gothwadtech.com` — OAuth redirect base and the CORS allowlist |
| `ALLOWED_ORIGINS` | Optional extra origins |
| `NODE_VERSION` | `22` |
| `NODE_ENV` | Optional; set `production` to hide the diagnostic route (already hidden on Pages) |

Missing credentials degrade gracefully — the API logs a warning and returns a
simulated or explicit error rather than crashing. The exception is
authentication: without `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` on the
server side, `/api/*` answers `503` on purpose.

> **Secrets named `VITE_*` are still public.** They are baked into the browser
> bundle. The anon key is designed for that; nothing else belongs there.

### Custom domain

Pages (project `gtwdchat`) → **Custom domains** → `grixchat.gothwadtech.com` is
already attached. Cloudflare issues the certificate automatically; keep `APP_URL`
in sync with whatever you set there.

### Testing the edge build locally

```bash
npm run build                          # produces dist/
npx wrangler pages functions build     # type/bundle-check the Functions
npx wrangler pages dev dist            # real workerd runtime on :8788
```

`wrangler pages dev` runs the **same** `functions/` code Cloudflare runs, on the
real workerd runtime. A plain `.env` is only read by the Node dev server, so
edge secrets go in `.dev.vars` (gitignored):

```bash
cp .dev.vars.example .dev.vars   # MOCK_SUPABASE=1 works with zero credentials
npx wrangler pages dev dist --binding APP_URL=http://localhost:8788
```

### GitHub Actions

`.github/workflows/ci.yml` typechecks, tests and builds on every push. It does
**not** deploy — Cloudflare Pages builds from the repository itself. To deploy
from Actions instead, add `cloudflare/wrangler-action` with a
`CLOUDFLARE_API_TOKEN` secret and run `wrangler pages deploy dist`.

---

## Ports

| Port | What | Where it is set |
|---|---|---|
| **3000** | Node dev server (Express + Vite middleware) | `server.ts` — `PORT` env |
| **8788** | `wrangler pages dev` (local Cloudflare runtime) | `--port` flag |
| 24678 | Vite HMR websocket | Vite default |

Both servers bind `0.0.0.0`, so they are reachable from other interfaces and
preview proxies.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Node dev server, **real** Supabase |
| `npm run dev:mock` | Node dev server, **mock** Supabase (no credentials) |
| `npm run build` | `vite build` → `dist/`. **This is what Cloudflare Pages runs.** |
| `npm run build:server` | esbuild bundle of `server.ts` → `dist/server.cjs` (self-hosting / `npm run start`) |
| `npm run build:all` | both of the above |
| `npm run build:mock` | static bundle wired to the mock (demoing without a backend) |
| `npm run start` | serve `dist/` + the API from `dist/server.cjs` (needs `build:server`) |
| `npm run test` | `vitest run` — 99 tests |
| `npm run test:watch` | watch mode |
| `npm run lint` | `tsc --noEmit` — **0 errors** |
| `npm run preview` / `preview:mock` | `vite preview` — static files only, **no API** |

> `npm run build` deliberately does **not** emit `dist/server.cjs`. Pages
> uploads all of `dist/`, so a server bundle (and its sourcemap) would be
> publicly downloadable. Use `build:all` when you actually self-host.

---

## Deploy targets

### Cloudflare Pages — production

See the section above. This is the only place the site is served from.

### Node host — optional self-hosting

`npm run build:all && npm run start` serves `dist/` plus the same `/api` routes
from a single Node process, with the same endpoints and the same security
chain. Useful for running the API closer to a database, or for local
end-to-end testing with real Supabase credentials. Set the server-side
variables from the table above in the host's environment.

### Android (TWA / WebView)

### Android (TWA / WebView)

`AGENTS.md` describes the intended delivery target: a native Android WebView
wrapper with an `AndroidJSInterface` bridge, native splash, native FCM and
native permission prompts. That wrapper is **not in this repository**.
