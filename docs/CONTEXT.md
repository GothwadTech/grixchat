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
npm test             # 78 tests, 5 files, ~10s — includes a real login→chat-list render
npm run lint         # tsc --noEmit → 0 errors
npm run build        # production bundle
```

All three currently pass.

---

## Health snapshot

| Check | Result |
|---|---|
| `npm run lint` | ✅ 0 errors |
| `npm test` | ✅ 78/78 |
| `npm run build` | ✅ exit 0 |
| Dead code | ✅ **0 files** (189/189 reachable) |
| Tables queried but missing from `sql/` | ✅ **0** |
| RPCs called but missing from `sql/` | ✅ **0** |
| Unauthenticated server endpoints | 🔴 2 — see below |
| Vercel deploy | ✅ fixed (`vercel.json` → root `server.ts`) |
| GitHub Pages deploy | ⚠️ needs `VITE_BASE_URL=/grixchat/` |

---

## The two things that will still bite you

### 1. Two endpoints are wide open

`/api/send-notification` and `/api/upload-file` have **no auth, no origin
check, no rate limit**. The first lets anyone push a notification to any FCM
token; the second is a free 100 MB file host. Fix before any public deploy.
→ **[KNOWN_ISSUES.md](./KNOWN_ISSUES.md#-p0--security)**

### 2. Nothing writes to `notifications`

Every notification writer lived in the deleted `features/home/` components. The
notification screens still read the table, so they will always be empty.
Either restore a write path or remove the screens.
Also: `NotificationsScreen.tsx:118` reads `notif.text` but the schema column
is `content`.

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
(`call_candidates` is defined but unused — calling signals over Broadcast.)

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
2. **Transient state goes over Broadcast/Presence, not the DB.** Typing, read
   ticks, call signalling, presence → `channel().send()`, 0 bytes of egress.
3. **Don't import across sibling features.** `features/chat/` must not reach
   into `features/call/`. Go through `services/` or a provider.
4. **SQL changes go in `/sql/`, numbered.** The root-level `.sql` duplicates
   have been deleted — do not recreate them.
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
| [DEAD_CODE.md](./DEAD_CODE.md) | the deletion record — what was removed and why |
| [legacy/](./legacy/) | historical docs — **not current guidance** |
