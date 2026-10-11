# GrixChat — Start Here

> **Read this file first.** Shortest path to a working mental model.
> Everything else in `docs/` is a drill-down from here.
>
> *Last verified: 2026-10-10. Every number here came from a command, not memory.*

---

## What this app is

GrixChat is a **PWA / Android-WebView messaging app**, deliberately scoped to
five tabs and the features behind them:

**Chats · Stories · Search · Calls · Profile**

plus Grix AI (in-app assistant), a GitHub file browser, app lock, and settings.

Earlier exploration built Reels, Tube, Posts, Moments, Q&A, Vibe, Analytics,
Camera, an in-app browser, Ludo and a web IDE. **All of that was deleted** — see
[DEAD_CODE.md](./DEAD_CODE.md). Do not assume those features exist.

- **Frontend:** React 19 · TypeScript · Vite 6 · Tailwind 4 · `motion/react`
- **Backend:** Supabase (Postgres + Realtime + Auth). **No custom app database.**
- **Server:** a thin Express layer (`server.ts`) for what a browser cannot do —
  FCM push, Gemini proxy, LiveKit tokens, GitHub OAuth.
- **Scale:** 186 TS/TSX files, **36,708 lines**, 13 feature domains.

---

## The 60-second version

```bash
npm install
npm run dev:mock     # ← the whole app, zero credentials, seeded data
# → http://localhost:3000
# → login: demo@grixchat.app  /  grixchat
```

That is the command you want 95% of the time. It swaps
`@supabase/supabase-js` for `dev/mock/` (an in-memory PostgREST-compatible
engine) via a Vite alias, so nothing touches the network and no `.env` is
needed. See **[DEV_SETUP.md](./DEV_SETUP.md)**.

```bash
npm test             # 99 tests, 7 files, ~14s — includes a real login→chat-list render
npm run lint         # tsc --noEmit → 0 errors
npm run build        # production bundle
```

All three currently pass.

---

## Health snapshot

| Check | Result |
|---|---|
| `npm run lint` | ✅ 0 errors |
| `npm test` | ✅ 99/99 |
| `npm run build` | ✅ exit 0 |
| Dead code | ✅ **0 files** (189/189 reachable) |
| Tables queried but missing from `sql/` | ✅ **0** |
| RPCs called but missing from `sql/` | ✅ **0** |
| Unauthenticated API routes | ✅ **0** — every `/api` route verifies a Supabase JWT (credential-free local mock excepted) |
| Notifications inbox | ✅ has a write path (`services/db/notificationService.ts`) |
| Cloudflare Pages deploy | ✅ `dist/` + `functions/` → <https://grixchat.gothwadtech.com> |
| Edge compatibility | ✅ the API bundles for workerd with no Node built-ins |
| CI | ✅ typecheck + test + Functions bundle check + build |

---

## The three things that will still bite you

### 1. Deploy secrets are not wired up yet

The `/api` routes verify a Supabase JWT. That means `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` (and the rest of `.env.example`) have to exist as
**environment variables on the Cloudflare Pages project** — without them the
Supabase SDK is compiled out of the bundle and the deployed app cannot sign in
(the build prints a warning).
→ **[KNOWN_ISSUES.md → the three things code cannot do](./KNOWN_ISSUES.md#-read-this-first--the-three-things-code-cannot-do)**

### 2. Rate limits are per-isolate on the edge

The limiter in `server/api.ts` counts in memory, so on Cloudflare the real quota
is spread across however many isolates are warm. Treat it as a speed bump; add a
native Cloudflare Rate Limiting Rule on `/api/*` for the real ceiling.

### 3. The GitHub Sync Tool is Node-only

`/api/github/list-files` and `/api/github/get-file-content` read the checked-out
repository, which Cloudflare has no filesystem for. They answer `501` on the
edge and work under `npm run dev`. Everything else runs identically on both.

### 4. Nothing else. Really.

The notification tables, the reset-password route, the bundle split and the open
endpoints were the outstanding items; each is fixed and covered in
**[KNOWN_ISSUES.md](./KNOWN_ISSUES.md)**.

---

## Where things live

```
src/
├── App.tsx                 # 581 lines — all 57 routes
├── lib/supabase.ts         # THE supabase client. getSupabase() → null if env missing
├── lib/firebase.ts         # FCM only (no Firestore, no Firebase Auth)
├── providers/              # AuthProvider, CallProvider, AppProviders
├── services/               # global singletons: ChatService, LocalDataCache, IndexedDBService, …
├── components/             # cross-feature UI: layout/, chat-ui/, common/
└── features/               # 13 domains — see below

server/
├── api.ts                  # THE API — runtime-neutral, Web Request/Response only
└── (server.ts at the root is its Node/Express adapter)

functions/
├── api/[[path]].ts         # Cloudflare Pages Function → server/api.ts
└── auth/[[path]].ts        # GitHub OAuth callback → the same router

dev/
├── mock/                   # the mock Supabase (query engine, auth, realtime, rpc, seed)
└── test/setup.ts           # jsdom polyfills + per-test DB reset

docs/                       # you are here
sql/                        # the ONLY authoritative place for schema
```

Feature domains, in the order they matter:

```
chat/  call/  profile/  settings/  stories/  search/  auth/
grixai/  github/  notifications/  console/  legal/  lock/
```

Full map: **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## Data model in one paragraph

13 tables, all defined in `sql/`: `users`, `follows`, `conversations`,
`conversation_participants`, `messages`, `stories`, `calls`, `chat_settings`,
`notifications`, `posts`, `post_likes`, `post_comments`, `support_tickets`.
(`call_candidates` is defined but unused — calling signals over Broadcast:
`call-rtc:<callId>` carries the SDP/ICE exchange for the peer-to-peer transport,
while a LiveKit room is used when `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` and
`VITE_LIVEKIT_URL` are configured. Presence and typing are handled by
`src/services/PresenceService.ts` (one Realtime Presence channel for the whole
app) and `src/services/TypingService.ts` (ref-counted per-conversation broadcast
topics) — both 0 database bytes. `users.is_online`/`last_seen` are only the
*durable fallback* (both for the first paint before the roster syncs and for
"last seen" text); the heartbeat in `AuthProvider` is the only writer, and no
other component opens a presence channel of its own.)

3 RPCs, all defined: `get_direct_conversation_id`, `view_story`,
`cleanup_expired_stories`.

The hot path: `conversations` ← `conversation_participants` → `users`, with
`messages` hanging off `conversation_id`.

Full detail: **[DATA_MODEL.md](./DATA_MODEL.md)**.

---

## Rules that actually matter

The long version is in **[../AGENTS.md](../AGENTS.md)**. Short version:

1. **Never listen to a whole table.** Every `postgres_changes` subscription
   must carry a `filter`. Unfiltered listeners are banned for egress reasons.
   And a Realtime event may **patch state, never trigger a list-wide query** —
   that one habit cost 5 GB/month; see [EGRESS_AUDIT.md](./EGRESS_AUDIT.md).
2. **Transient state goes over Broadcast/Presence, not the DB.** Typing, read
   ticks, call signalling, presence → `channel().send()`, 0 bytes of egress.
3. **Don't import across sibling features.** `features/chat/` must not reach
   into `features/call/`. Go through `services/` or a provider.
4. **SQL changes go in `/sql/`.** Write the `.md` first (here or in
   `EGRESS_AUDIT.md`), then the SQL. Append to the current file until it reaches
   **600–1000 lines**, then start the next number — no tiny files, no 2000-line
   files, and every file needs a short `COVERS:` header. Migrations must be
   re-runnable: no `DROP TABLE`, `CREATE … IF NOT EXISTS`, `CREATE OR REPLACE`,
   `DROP POLICY IF EXISTS` before every policy. Superseded files go to
   `sql/legacy/` — never recreate root-level duplicates. Runbook:
   [../sql/00_master_instructions.md](../sql/00_master_instructions.md).
5. **Don't reintroduce dead code.** If you add a file, wire it to a route or an
   importer in the same change. The scan procedure is in
   [DEAD_CODE.md](./DEAD_CODE.md#reproducing-the-scan).
6. **Run `npm test` before you say done.**

---

## Doc index

| File | Read it when |
|---|---|
| [CONTEXT.md](./CONTEXT.md) | always, first |
| [DEV_SETUP.md](./DEV_SETUP.md) | you need to run the app |
| [TESTING.md](./TESTING.md) | you are writing or fixing tests |
| [DATA_MODEL.md](./DATA_MODEL.md) | you touch the database |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | you need to find where something lives |
| [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | you want the prioritised bug/fix list |
| [EGRESS_AUDIT.md](./EGRESS_AUDIT.md) | egress is high, or you touch Realtime / list queries |
| [../sql/00_master_instructions.md](../sql/00_master_instructions.md) | you are setting up or updating the database |
| [DEAD_CODE.md](./DEAD_CODE.md) | the deletion record — what was removed and why |
| [legacy/](./legacy/) | historical docs — **not current guidance** |
