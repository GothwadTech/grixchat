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

`.env.example` is **incomplete** — it lists 6 variables and the codebase reads
21. The full list:

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
| `VITE_IMGBB_API_KEY` | `features/reels/grixtube/TubeUploadScreen.tsx` — ⚠️ see note |

> ⚠️ **`VITE_IMGBB_API_KEY` is a secret exposed to the browser.** Any
> `VITE_`-prefixed variable is inlined into the shipped bundle in plaintext.
> That file is currently dead code, so the key is not live — but the pattern
> must not be copied. Proxy uploads through the server instead.

### Server (`process.env` — never exposed)

| Variable | Used by |
|---|---|
| `GEMINI_API_KEY` | `/api/grix-ai` |
| `FIREBASE_SERVICE_ACCOUNT` | `/api/send-notification` (JSON, newlines may be escaped) |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | `/api/livekit-token` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | `/api/github/auth-url` |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side Supabase client |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | server-side Supabase client |
| `APP_URL` | OAuth redirect base |
| `NODE_ENV` | `production` disables the Vite middleware and serves `dist/` |

Every missing credential degrades gracefully — the server logs a warning and
returns a simulated response rather than crashing. That is deliberate, but it
also means **a misconfigured deploy looks like it is working.**

> **`VITE_GROQ_API_KEY`** appears in `.env.example` but is read nowhere in the
> codebase. `groq-sdk` is installed and unused. Both are dead.

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
| `npm run test` | `vitest run` — 78 tests |
| `npm run test:watch` | watch mode |
| `npm run lint` | `tsc --noEmit` — **currently fails, see KNOWN_ISSUES** |
| `npm run preview` / `preview:mock` | serve the built bundle |

---

## Deploy targets

### Vercel (`vercel.json`)

⚠️ **Broken for two features.** `vercel.json` builds `src/server/server.ts`,
which lacks `/api/grix-ai` and `/api/livekit-token`. Either point Vercel at the
root `server.ts`, or port those two routes across. Until then, GrixAI and
calling 404 in production while working locally.

### GitHub Pages (`.github/workflows/deploy.yml`)

⚠️ **Likely broken.** The workflow deploys `dist/` to Pages, but
`vite.config.ts` sets `base: '/'` (now overridable via `VITE_BASE_URL`) and the
repo has no `CNAME`. A `GothwadTech/grixchat` Pages URL is served from
`/grixchat/`, so every absolute `/assets/…` path 404s and the app renders
blank.

Fix: set `VITE_BASE_URL=/grixchat/` in the workflow, or add a `CNAME` for a
custom domain.

> This is static analysis — an actual Pages deploy was not run.

### Android (TWA / WebView)

`AGENTS.md` describes the intended delivery target: a native Android WebView
wrapper with an `AndroidJSInterface` bridge, native splash, native FCM and
native permission prompts. That wrapper is **not in this repository**.
