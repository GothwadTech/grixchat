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
| `VITE_BASE_URL` | build-time path prefix (`/grixchat/` on GitHub Pages) |

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
| `APP_URL` | OAuth redirect base, sitemap origin, first CORS allowlist entry |
| `ALLOWED_ORIGINS` | extra comma-separated browser origins allowed to call `/api/*` |
| `MOCK_SUPABASE` | `1` skips JWT verification for the credential-free dev loop (never in production) |
| `NODE_ENV` | `production` disables the Vite middleware, serves `dist/`, hides `/api/github/debug` |

Every missing credential degrades gracefully — the server logs a warning and
returns a simulated response rather than crashing. That is deliberate, but it
also means **a misconfigured deploy looks like it is working.** The one
exception is authentication: without `VITE_SUPABASE_URL` +
`VITE_SUPABASE_ANON_KEY` the `/api` routes answer `503`, on purpose.

---

## GitHub Actions secrets

The Pages workflow builds the client, so it needs the `VITE_*` values from the
table above. Add them under **Settings → Secrets and variables → Actions**
(`.github/workflows/deploy.yml` already references them). Undefined secrets
resolve to empty strings, so the build still succeeds — you just get a client
with no backend attached, and the build log says so.

**Server secrets are not needed for the Pages deploy** (it is a static build);
they belong on whichever host runs `server.ts`.

---

## Ports

| Port | What | Where it is set |
|---|---|---|
| **3000** | Express + Vite middleware (the app) | `server.ts:797` — hardcoded |
| 24678 | Vite HMR websocket | Vite default |

The server binds `0.0.0.0`, so it is reachable from other interfaces / preview
proxies.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Express + Vite, **real** Supabase |
| `npm run dev:mock` | Express + Vite, **mock** Supabase |
| `npm run build` | `vite build` + esbuild bundle of `server.ts` → `dist/server.cjs` |
| `npm run build:mock` | static bundle wired to the mock (for demoing without a backend) |
| `npm run start` | serve the built `dist/` via `dist/server.cjs` |
| `npm run test` | `vitest run` — 85 tests |
| `npm run test:watch` | watch mode |
| `npm run lint` | `tsc --noEmit` — **currently fails, see KNOWN_ISSUES** |
| `npm run preview` / `preview:mock` | serve the built bundle |

---

## Deploy targets

### Vercel (`vercel.json`)

✅ `vercel.json` points at the root `server.ts` (the duplicate
`src/server/server.ts` was deleted), so `/api/grix-ai` and
`/api/livekit-token` exist there. Set the server-side variables listed above —
including `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, which the auth layer
needs — or every `/api` call answers `503`.

### GitHub Pages (`.github/workflows/deploy.yml`)

✅ The workflow builds with `VITE_BASE_URL=/grixchat/`, so assets resolve under
the sub-path Pages serves from. Add the `VITE_*` Actions secrets (above) for the
deployed client to reach a backend; add a `CNAME` file if you move to a custom
domain at the domain root, and drop `VITE_BASE_URL` at the same time.

### Android (TWA / WebView)

`AGENTS.md` describes the intended delivery target: a native Android WebView
wrapper with an `AndroidJSInterface` bridge, native splash, native FCM and
native permission prompts. That wrapper is **not in this repository**.
