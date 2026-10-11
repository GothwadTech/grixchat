# AGENTS.md — GrixChat

> **Start at [`docs/CONTEXT.md`](./docs/CONTEXT.md).** It has the 60-second
> orientation: what the app is, how to run it, and the three things that will
> bite you. This file is the rulebook that follows from it.

---

## 0. Before you touch anything

```bash
npm install
npm run dev:mock      # full app, no credentials → http://localhost:3000
                      # login: demo@grixchat.app / grixchat
npm test              # 99 tests, ~14s
npm run lint          # tsc --noEmit → 0 errors
npx wrangler pages dev dist   # optional: the API in the real Cloudflare runtime
```

`npm run dev:mock` runs the real app against an in-memory Supabase mock
(`dev/mock/`), seeded with 8 users and a full social graph. **Use it by
default.** Only use `npm run dev` when you specifically need RLS enforcement,
multi-device realtime, or real FCM.

**Definition of done:** `npm test` passes, and you can name the function or
code path your change exercised.

---

## 1. Architecture — non-negotiable

- **Backend, database, storage and sync: Supabase only.** Do not introduce a
  second server-side datastore or a polling endpoint.
- **Firebase is FCM-only.** No Firestore, no Firebase Auth, no Firebase
  Storage. (`firestore.rules` and `firebase-blueprint.json` at the repo root
  are historical leftovers — ignore them.)
- **Production is Cloudflare Pages.** The static site is `dist/`, the API is
  `functions/` (Pages Functions), and both deploy from this repo to
  <https://grixchat.gothwadtech.com>. There is no other deploy target to keep in
  sync.
- **The API holds no application data.** It exists only to keep secrets
  server-side: Gemini, FCM service account, LiveKit tokens, GitHub OAuth. All of
  it is `server/api.ts`, written against the Web `Request`/`Response` API so the
  exact same file runs on Cloudflare *and* under Express (`server.ts`, used for
  `npm run dev`). **Add a route there — never in an adapter.** Nothing in
  `server/api.ts` may import a Node built-in (`fs`, `path`, `crypto`, `Buffer`);
  Node-only abilities are injected as capabilities (`REPO_FS`).
- **Calling:** WebRTC, signalled over Supabase channels, state in
  `providers/CallProvider.tsx` so a call survives navigation.
- **Platform target:** PWA + an Android WebView (TWA) wrapper with an
  `AndroidJSInterface` bridge. The wrapper is **not in this repository**.
  Use `h-[100dvh]`, `pb-[safe]`, ≥44 px touch targets. Degrade hover events.

---

## 2. Cost rules (50k users on the free tier)

### A. Realtime subscriptions

**Never subscribe to a whole table.** Every `postgres_changes` listener must
carry a `filter` scoped to the current user's context.

```ts
// ❌ banned — streams the entire table to every client
.on('postgres_changes', { table: 'follows' }, cb)

// ✅ required
.on('postgres_changes', { table: 'follows', filter: `follower_id=eq.${userId}` }, cb)
```

### B. Transient state never touches the database

Typing indicators, read ticks, call signalling and presence go over
**Broadcast / Presence** channels — 0 bytes of database egress.

### C. Cache first

`services/LocalDataCache.ts` sits in front of `services/IndexedDBService.ts`.
Render from cache, then reconcile. `useConversations` implements delta sync
against a locally-cached `max(updated_at)` — keep that pattern when adding
list screens.

### D. Page everything

Initial loads are 20–30 rows. `ChatService.getMessages(id, limit = 50)`.

**Every list query gets a `limit`.** No exceptions — an unbounded `.select()`
is a full table download billed as egress.

### E. A Realtime event patches state — it never triggers a list-wide query

**A Realtime event may patch state. It may never trigger a list-wide query.**

The payload is the data. One incoming message updates one row in the
conversation list, in place, from the event itself:

```ts
// ❌ banned — every message re-downloads the whole conversation list
.on('postgres_changes', {event: 'INSERT', schema: 'public', table: 'messages'}, () => fetchConversations())

// ✅ required — the payload is enough (useConversations.patchConversationFromMessage)
.on('postgres_changes', {event: 'INSERT', ...}, (payload) => patchConversationFromMessage(payload.new))
```

Refetching a whole list on individual events is what burned 5 GB/month with
three active users. Mount, focus and *structural* changes (a chat added, a
participant changed) may refetch — traffic may not. Full analysis and the
measurements: **[EGRESS_AUDIT.md](./EGRESS_AUDIT.md)**. The two rules are
machine-checked by `src/__tests__/egressBudget.test.ts` (the list query stays
narrow and message-free) and `src/__tests__/egressRealtime.test.tsx` (an
incoming message causes zero `conversations` /
`conversation_participants` queries).

### F. Narrow selects, always

Never `select('*')` on a shared table, and never `users(*)` for other people —
the row carries `settings`, `lock` (passcode hash), `fcm_tokens` and six
private arrays. Name the columns: the conversation list needs six of them.
Response bytes are egress, whether or not you render them.

---

## 3. Code structure

### Import rules

1. **`features/` is a sandbox.** A feature must not import from a sibling
   feature. No `features/chat/` → `features/call/`.
2. **Cross-feature data goes through `services/` or a provider.** That is what
   the `services/` layer is for.
3. **Keep views declarative.** Side effects, queries and sync belong in
   `hooks/` or `services/`, not in JSX.
4. **Shared UI goes in `components/`** (`common/`, `layout/`, `chat-ui/`, `ui/`).
5. **Don't add a `features/*/index.ts` barrel unless something imports it.**
   The existing ones are unused and make dead modules look alive.

### Types

- Explicit interfaces in `src/types/`.
- **No loose `any`.** There are currently 470 of them — that is technical
  debt to burn down, not a licence to add more.
- `src/types/database.types.ts` **does not exist yet**. Generate it
  (`supabase gen types typescript --project-id <id>`) and prefer it over
  hand-written row shapes.
- Browser → `/api` calls go through `src/lib/apiClient.ts`; it attaches the
  Supabase access token the API verifies. Never call the API routes with a bare
  `fetch` — you will get a 401.
- Adding a server route? Put it in `server/api.ts` and make sure it bundles for
  the edge: `npx wrangler pages functions build`. The CI workflow does this on
  every push.
- Notifications: write through `services/db/notificationService.ts` only, and
  read the `content` column (`sql/01_schema.sql` has no `text`).

### File size

Extract. `features/github/GithubScreen.tsx` is 1,244 lines and
`providers/CallProvider.tsx` is 987 — both are examples of what *not* to
repeat.

### SQL

- **`sql/` is the only place for schema.** Numbered, sequential: `01_` … `08_`.
- The five stale `.sql` duplicates that used to sit at the repo root have been
  **deleted**. Do not recreate them.
- New table? New migration file **and** a seed entry in `dev/mock/seed.ts`
  **and** a row in `docs/DATA_MODEL.md`.

---

## 4. UI conventions

- **20% Telegram** — `motion/react` micro-animations, high velocity, typing
  feedback under the avatar.
- **20% WhatsApp** — ✓ sent · ✓✓ delivered · ✓✓ blue read. Selection uses a
  left colour border (`border-l-[4px] border-l-[var(--primary)]`) rather than
  checkboxes. Bulk actions live in `TabHeader`, never in the bottom bar.
- **60% GrixChat** — Dark Cosmic theme. Space Grotesk / Inter / JetBrains Mono.
  Colours come from CSS custom properties (`--bg-main`, `--bg-card`,
  `--text-primary`, `--border-color`, `--primary`), never hardcoded hex.

---

## 5. Testing

Stack: **Vitest + jsdom + Testing Library**, with `@supabase/supabase-js`
aliased to `dev/mock/` in `vitest.config.ts` so a test can never reach a real
project.

```bash
npm test             # 99 tests, 7 files
npm run test:watch
```

| Layer | Where | Purpose |
|---|---|---|
| Mock contract | `dev/mock/__tests__/` | pins PostgREST semantics so the mock cannot silently drift |
| Real services | `src/__tests__/chatService.test.ts` | the shipped `ChatService` against seeded data |
| Real API | `src/__tests__/apiRoutes.test.ts` | `handleApiRequest` — auth, CORS/origin guard, body caps, routing |
| Real UI | `src/__tests__/app.smoke.test.tsx` | renders `<App />`, drives the login form, asserts the chat list |

Rules:

- Use the `SEED` constants for IDs. Never hardcode a UUID.
- The database resets before every test — deliberately.
- Target controls, not labels (`LoginScreen` has two "Login" buttons).
- If you add a table, RPC or FK to the mock, add a test. See
  [`docs/TESTING.md`](./docs/TESTING.md#adding-to-the-mock).

---

## 6. Current state — read before assuming things work

| | Status |
|---|---|
| `npm run build` | ✅ passes |
| `npm run dev` / `dev:mock` | ✅ passes |
| `npm test` | ✅ 104/104 |
| `npm run lint` | ✅ 0 errors |
| Dead code | ✅ **0 files** — 189/189 reachable. See [`docs/DEAD_CODE.md`](./docs/DEAD_CODE.md) |
| SQL migrations | ✅ `01_schema.sql` + `02_functions_realtime_storage.sql`, both re-runnable (fresh install + re-run on live data verified), 600–1000 lines each, guarded by `src/__tests__/sqlMigrations.test.ts` |
| Tables queried but missing from `sql/` | ✅ 0 |
| RPCs called but missing from `sql/` | ✅ 0 |
| Cloudflare Pages deploy | ✅ `dist/` + `functions/` → <https://grixchat.gothwadtech.com> |
| Node self-host path | ✅ `npm run build:all && npm run start` |
| `/api/send-notification`, `/api/upload-file` | ✅ **authenticated** + rate limited + allowlisted (see `authenticate` in `server/api.ts`) |
| Notifications inbox | ✅ written by `services/db/notificationService.ts`, read from `content` |
| CI | ✅ typecheck + test + Functions bundle check + build (no deploy step) |
| Pages secrets | 🧑 **check they are set in the Cloudflare dashboard** — see KNOWN_ISSUES |
| Egress | ✅ list query patched from Realtime payloads, 0 bytes per message — see [`docs/EGRESS_AUDIT.md`](./docs/EGRESS_AUDIT.md) |
| Test coverage | ⚠️ only login→chat, the notification writer, the reset route and the two egress guards are exercised |

Full prioritised list: **[`docs/KNOWN_ISSUES.md`](./docs/KNOWN_ISSUES.md)**.

### Scope note

GrixChat is deliberately scoped to **five tabs** — Chats, Stories, Search,
Calls, Profile — plus Grix AI, the GitHub browser, app lock and settings.
Reels, Tube, Posts, Moments, Q&A, Vibe, Analytics, Camera, an in-app browser,
Ludo and a web IDE were built during exploration and have been **removed**.
Do not assume they exist, and do not add a file without wiring it in the same
change.

---

## 7. Doc map

| File | Purpose |
|---|---|
| [`docs/CONTEXT.md`](./docs/CONTEXT.md) | **start here** — orientation |
| [`docs/DEV_SETUP.md`](./docs/DEV_SETUP.md) | running the app, env vars, ports, deploy targets |
| [`docs/TESTING.md`](./docs/TESTING.md) | the harness and how to extend it |
| [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md) | every table and RPC, and what is missing |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | directory map, data flow, what is reachable |
| [`docs/KNOWN_ISSUES.md`](./docs/KNOWN_ISSUES.md) | prioritised bug/fix list |
| [`docs/EGRESS_AUDIT.md`](./docs/EGRESS_AUDIT.md) | Supabase egress, Realtime traffic, list-query rules |
| [`sql/00_master_instructions.md`](./sql/00_master_instructions.md) | database setup, schema updates, verification |
| [`docs/DEAD_CODE.md`](./docs/DEAD_CODE.md) | the deletion record — what was removed and why |
| [`docs/legacy/`](./docs/legacy/) | historical — **not current guidance** |
