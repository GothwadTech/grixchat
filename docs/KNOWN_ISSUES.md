# Known Issues

Prioritised. Originally verified against the code on 2026-10-10; **re-verified
and largely fixed on 2026-10-11** (see the status on each item).

**Severity:** 🔴 blocks a safe deploy · 🟠 breaks a feature or misleads a
developer · 🟡 quality / performance · 🟢 nice to have

**Legend:** ✅ fixed in code · ⚠️ partly fixed · ❌ still open · 🧑 needs a
human step (SQL run, secret, or a product decision)

---

## 🧑 Read this first — what code cannot do

The app is deployed on **Cloudflare Pages** (<https://grixchat.gothwadtech.com>):
`dist/` is the static PWA, `functions/` is the API. Everything that could be
fixed from the repository alone **has been**; these tasks need the Cloudflare
dashboard, Supabase, or a decision.

| # | Task | Where | Why it matters |
|---|---|---|---|
| A | Add the **build-time** variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_FIREBASE_*`, `VITE_LIVEKIT_URL`, `NODE_VERSION=22` | Cloudflare → Workers & Pages → gtwdchat → Settings → Environment variables (Production **and** Preview) | They are inlined into the bundle. **Without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` the Supabase SDK is compiled out and the deployed app cannot sign in** — the build prints a loud warning. Changing one requires a redeploy. |
| B | Add the **runtime secrets** for the API: `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL=https://grixchat.gothwadtech.com` — and *optionally* `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | same screen as above | The API verifies JWTs against `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, so those two must be present **server-side as well**. Without any of these the matching feature returns a clear "not configured" error instead of crashing. `LIVEKIT_*` is **no longer required for calling**: without it calls run peer-to-peer over WebRTC with Supabase Realtime as the signalling channel (issue 15). Step-by-step: [DEV_SETUP.md](./DEV_SETUP.md#deploy--cloudflare-pages). |
| C | Confirm the Pages build settings: build command `npm run build`, output `dist`, root `/`; production branch = your main branch; custom domain `grixchat.gothwadtech.com` attached | Cloudflare → the project's Settings / Custom domains | `wrangler.toml` pins the output dir and compatibility date, but the dashboard values win. |
| D | Decide the fate of `call_candidates` (issue 7) | Supabase SQL editor | It is defined but unused — and it stays unused: calling signals over a Broadcast topic (`call-rtc:<callId>`, see `src/features/call/services/WebRtcCallService.ts`), which costs nothing and needs no schema. Drop it with:<br>`DROP TABLE IF EXISTS public.call_candidates CASCADE;` |
| E | Add a **Cloudflare Rate Limiting Rule** on `/api/*` (optional, but recommended before scaling) | Cloudflare → Security → WAF | The limiter in `server/api.ts` counts in memory, i.e. per isolate — a speed bump, not a hard global quota. |
| F | Run **`sql/01_schema.sql`** then **`sql/02_functions_realtime_storage.sql`** (2 minutes, idempotent, `02` ends with a self-check) | Supabase → SQL Editor | Creates anything missing and updates every policy/function. For the egress work specifically: read receipts become one row instead of one per unread message, the chat-list preview is maintained by a trigger, `REPLICA IDENTITY` stops shipping whole rows + the passcode hash, and the missing RLS UPDATE policy on `conversation_participants` gets created. Runbook: [`../sql/00_master_instructions.md`](../sql/00_master_instructions.md). Full analysis: [EGRESS_AUDIT.md](./EGRESS_AUDIT.md). |
| G | Decide whether to enable the **RLS hardening** block at the end of that same file (commented out) | Supabase → SQL Editor | Today `users` and `conversation_participants` are readable by every authenticated account: `email`, `phone`, `lock` (passcode hash), `fcm_tokens`, and the whole follow/participant graph. |

Optional: set `ALLOWED_ORIGINS=https://your-domain.tld,https://your-other.tld`
(comma-separated) to extend the CORS/origin allowlist beyond same-origin +
`APP_URL`.

---

## ✅ P0 — Security (all fixed)

### 1. `/api/send-notification` was an open push relay — ✅ FIXED

It is no longer a token relay at all:

- **Auth:** requires `Authorization: Bearer <supabase access token>`, verified
  with `supabase.auth.getUser()` (`server/api.ts` → `authenticate`).
- **Recipients are derived server-side.** The client now sends only
  `{ conversationId, body }`; the server checks the caller is a participant and
  reads the other participants' `fcm_tokens` itself. Client-supplied token
  lists are ignored for conversations.
- **Self-test mode** (the diagnostics button in notification settings) accepts
  tokens only if they are already registered on the caller's own profile.
- **Title can no longer be spoofed** — it is read from the sender's row.
- **Limits:** 200-char body, 20 requests/min/IP (`notificationLimiter`).
- **Bonus:** `removeInvalidFcmToken()` no longer scans the whole `users` table
  — it uses `contains('fcm_tokens', [...])`.

Client side: `pushNotificationService.ts` and `NotificationsSettingsScreen.tsx`
go through the new `src/lib/apiClient.ts`, which attaches the session token.

### 2. `/api/upload-file` was an open 100 MB file host — ✅ FIXED

- Auth required (`authenticate`).
- **MIME allowlist** (`ALLOWED_MIME_TYPES`) — no more anonymous `.exe`, and
  `image/svg+xml` is deliberately excluded (script container).
- **Size caps by media type:** images 15 MB, audio 25 MB, documents 25 MB,
  video 50 MB (hard ceiling), 1 file per request, temp file always unlinked.
- Rate limited to 8 uploads/min/IP (`uploadLimiter`).

> No caller in this repository uses this route. It is kept for the Android
> WebView wrapper, but now requires a signed-in session.

### 3. No server hardening at all — ✅ FIXED

`server.ts` now runs:

| Layer | What |
|---|---|
| Security headers | Applied by the API itself (they are part of the `Response`), and by `public/_headers` for static files: nosniff, referrer policy, CORP `cross-origin`. There is deliberately no `X-Frame-Options`/CSP — the Android WebView (TWA) wrapper embeds the app and the popup flow needs `window.opener`. |
| CORS | An origin is reflected only when it is same-origin with the request or allowlisted (`APP_URL` + `ALLOWED_ORIGINS` + localhost). Unknown origins get no CORS headers at all. |
| Origin guard | Cross-origin writes to `/api/*` are refused with **403** (CSRF belt-and-braces). Loopback/bind-all hosts are exempt so tunnel/preview deployments keep working. |
| Rate limiting | API 60/min · notifications 20/min · uploads 8/min · AI 20/min, per IP (`server/api.ts`). The counter is in-memory, so on Cloudflare the effective ceiling is per isolate — add a native Cloudflare Rate Limiting Rule on `/api/*` if you need a hard global quota. The client IP is read from `cf-connecting-ip` / `x-forwarded-for`, so it is the real caller behind the proxy. |
| Body limits | `express.json` is opt-in per route: **256 kB** by default, 32 MB only for the GitHub push routes. The blanket 50 MB parser is gone. |
| Error handling | Unknown `/api/*` → JSON 404; malformed JSON → 400; oversized body → 413. |

Also hardened while in there: `/api/livekit-token` requires auth **and** checks
the caller actually participates in that call/conversation (the token identity
comes from the verified session, not the request body); `/api/grix-ai` requires
auth (upstream quota); `/api/github/debug` returns 404 in production.

---

## 🟠 P1 — Correctness

### 4. Nothing wrote to `notifications` — ✅ FIXED

New `src/services/db/notificationService.ts` is the single write path
(`create`, `notifyFollow`, `notifySystem`). It is wired into every place a
connection is created:

- `features/profile/UserProfileScreen.tsx` — send request, and accept request
- `features/chat/MessageRequestsScreen.tsx` — accept
- `services/db/transactionQueueService.ts` — the offline follow worker

Re-following updates the existing row (bumped to unread) instead of stacking
duplicates. Failures are swallowed with a warning so they can never abort the
follow itself. Covered by `src/__tests__/notificationService.test.ts` (6 tests).

### 5. `notifications` column mismatch — ✅ FIXED

`sql/01_schema.sql` is right: the column is `content`. Both readers now
map `content` (with a `text` fallback kept only for rows written by older
builds), and the new writer only ever writes `content`. The mock seeds both and
the mock now applies the `is_read DEFAULT FALSE` the SQL declares.

### 6. `users.saved_posts` was not in the schema — ✅ FIXED

The column never existed; the only consumers were a read in
`userProfileService.ts` and a field on `UserProfile`, both leftovers from the
deleted Posts/Reels features. Removed from the code **and** from `dev/mock/`, so
the mock keeps mirroring `sql/`.

### 7. `call_candidates` is defined but never used — ❌ STILL OPEN (needs SQL)

The live calling path signals over a Realtime Broadcast topic
(`call-rtc:<callId>`, see `src/features/call/services/WebRtcCallService.ts`), so
the table is dead weight. Dropping it is a one-line migration the repo cannot
run for you — see task **D** at the top. No code change is pending on either
side of the decision.

### 15. Calling only worked when LiveKit was configured — ✅ FIXED

Two separate problems, both fixed:

- **Silent fake calls.** Without `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` (and
  `VITE_LIVEKIT_URL`), `connectToLiveKitSession()` fell back to a *simulator*
  that put both phones into a "connected" state after 1.8 s — an outgoing call
  looked answered while the other device was still ringing, and no media ever
  moved. The fallback is now a real WebRTC peer-to-peer session: only the caller
  offers, the receiver answers, ICE candidates are buffered until the remote
  description lands, and `connected` is only ever reported by the actual
  `RTCPeerConnection` (see `src/__tests__/callSignaling.test.ts`). LiveKit is
  still used, unchanged, whenever it *is* configured.
- **A duplicated incoming-call card.** `App.tsx` mounted
  `IncomingCallNotification`, and `CallProvider` rendered its own card for the
  same event: two ringtones, two cards, and the App-level one wrote the status
  `denied`, which the `calls.status` CHECK constraint rejects — so "decline"
  from that card never reached the database. The duplicate is deleted; the
  provider's card is the single source, and declines write `rejected`.

**Remaining human step (only if calls must work on strict corporate/mobile
networks):** the P2P transport uses public STUN servers and no TURN relay. Most
home/mobile networks connect directly; symmetric-NAT or locked-down networks
need a TURN server. Add one to `ICE_SERVERS` in
`src/features/call/services/WebRtcCallService.ts` (e.g. Cloudflare Calls TURN or
a self-hosted coturn) — it is a one-line change with no other moving parts.

### 8. Password reset had no path — ✅ FIXED

`/forgot-password` now renders `LoginScreen` in its reset mode instead of
redirecting to `/login`. The screen derives the mode from the route and keeps
`/login` ↔ `/forgot-password` in sync (including browser back/forward), so the
existing working `auth.resetPasswordForEmail` flow is finally reachable from a
URL. Covered by a new case in `src/__tests__/app.smoke.test.tsx`.

---

## 🟡 P2 — Deploy & CI (all fixed)

### 9. Deploy target could not serve the app — ✅ FIXED (now Cloudflare Pages)

The site is served by **Cloudflare Pages** at
<https://grixchat.gothwadtech.com>: `dist/` is the static PWA and `functions/`
is the API (Pages Functions). What that changed:

- `vercel.json` is gone — it described a Node host nothing deploys to any more.
  The old GitHub Pages workflow is gone too: it could never have worked, because
  `functions/` (the API) exists only on Cloudflare, so a `github.io` build would
  have shipped a dead backend. CI (`.github/workflows/ci.yml`) now verifies only;
  Cloudflare builds from the repository.
- **No SPA rewrite rule.** Cloudflare serves `index.html` for unknown paths
  natively. A `/* → /index.html 200` rule is turned into a **308 permanent
  redirect** (browsers cache it forever), so it is deliberately absent —
  `public/` ships `_headers` and `_routes.json` instead. Deep links (`/chats`,
  `/chat/:id`) were verified against workerd to return the shell with a `200`.
- `public/_routes.json` scopes Functions to `/api/*` and `/auth/*`, so static
  traffic never spins up a Function.

### 10. The API had to run somewhere Cloudflare can too — ✅ FIXED

The old `server.ts` was Express + `axios` + `google-auth-library` + `multer` +
`livekit-server-sdk`: none of that runs on Workers. Rather than maintain two
implementations, the routes moved to **`server/api.ts`**, written against the Web
`Request`/`Response` API, and two thin adapters reach it:

| Adapter | Used by |
|---|---|
| `functions/api/[[path]].ts`, `functions/auth/[[path]].ts` | Cloudflare Pages (production) |
| `server.ts` | `npm run dev` / `dev:mock`, optional self-hosting |

That removed five Node-only dependencies (`axios` server-side,
`google-auth-library`, `multer`, `form-data`, `livekit-server-sdk`) plus
`helmet`/`cors`/`express-rate-limit` — FCM signing, LiveKit tokens, multipart
parsing, security headers, CORS and rate limiting are all Web-platform code now,
so the behaviour cannot drift between the two runtimes. `npx wrangler pages
functions build` (run in CI) proves the bundle has **zero Node built-ins**.

The one genuinely Node-only feature — the GitHub Sync Tool reading the source
tree — is injected as a capability (`REPO_FS`) and answers `501` on the edge
instead of pretending to work.

### 11. CI did not typecheck or test — ✅ FIXED

`.github/workflows/ci.yml` runs `npm run lint`, `npm test`, a Functions bundle
check and `npm run build` on every push and PR. No deploy step: Cloudflare Pages
builds the repository itself, and deploying from two places is how you ship a
stale bundle.

`npm run build` also stopped emitting `dist/server.cjs`: Pages uploads all of
`dist/`, so a server bundle (and its sourcemap) would have been publicly
downloadable. `npm run build:server` / `build:all` do that for self-hosting.

---

## 🟡 P2 — Performance (all fixed)

### 12. Main bundle was 1.14 MB — ✅ FIXED

`build.rollupOptions.output.manualChunks` splits the heavyweights. With
credentials configured, the build now emits:

```
before                              after
index-*.js        1,148 kB     →    index-*.js          170 kB  (gzip 43 kB)
MessageList-*.js    416 kB     →    MessageList-*.js     97 kB
GithubScreen-*.js   195 kB     →    GithubScreen-*.js   190 kB
                               →    vendor-react        232 kB
                               →    vendor-supabase     207 kB
                               →    vendor-emoji        309 kB  (lazy)
                               →    vendor-livekit      527 kB  (calls only)
```

### 13. `emoji-picker-react` statically imported twice — ✅ FIXED

Both call sites (`components/chat-ui/ChatMessageMenu.tsx` and
`EmojiPickerMenu.tsx`) now render `LazyEmojiPicker`, which wraps the package in
`React.lazy` + `Suspense`. The `Theme` enum is no longer imported statically
(that alone would have defeated the split), so the picker lives in its own chunk
and is fetched on first tap.

### 14. ~350 `console.*` calls shipped to production — ✅ FIXED

`vite.config.ts` sets `esbuild.drop: ['console', 'debugger']` for production
builds only; dev keeps its logging. The built client went from 350+ calls to 20
references, and those 20 are load-bearing: `ConsoleLoggerService` patching
`console` itself, and pre-existing `.catch(console.error)` — a *reference*, not
a call, so `drop` rightly leaves it alone.

---

## 🔴 P0 — The SQL setup used to delete your data on a re-run — ✅ FIXED

### 20. `01`–`03` began with `DROP TABLE … CASCADE`, so "just run it again" wiped the database

The setup opened with `DROP TABLE IF EXISTS public.users CASCADE;` and the same
line for every other core table (posts and tickets too). The documented setup flow is "run these files in order", so re-running
it on a project with users — the normal way to apply a schema update — silently
deleted every user, message, conversation, post and ticket, **while reporting
zero errors**, which is exactly why nobody noticed.

- **Fixed:** the drops are gone. Every table is `CREATE TABLE IF NOT EXISTS`, and
  each file now also adds anything an older install is missing: columns
  (`ADD COLUMN IF NOT EXISTS`), indexes, constraints, buckets, plus
  `DROP POLICY IF EXISTS` + `CREATE POLICY` so an updated policy definition
  actually replaces the old one. Existing rows are never touched.
- **Same two files for everyone:** `sql/01_schema.sql` then
  `sql/02_functions_realtime_storage.sql` — fresh project or existing one, no
  separate "upgrade" path.
- **Docs:** [`../sql/00_master_instructions.md`](../sql/00_master_instructions.md)
  (runbook + verification queries + troubleshooting).
- **Superseded files moved out of the way** to `sql/legacy/` — including
  `db/1_complete_schema.sql`, which defined `public.users` differently and would
  have broken a current project if anyone had run it.
- **Guarded by tests:** `src/__tests__/sqlMigrations.test.ts` fails on any
  `DROP TABLE`/`TRUNCATE`, a non-idempotent `CREATE`, a policy without a
  `DROP POLICY IF EXISTS`, or a stale bundle.
- **Verified for real:** the whole set was executed against PostgreSQL twice —
  fresh install, then a re-run on seeded data (users 2→2, messages 2→2, policies,
  triggers, buckets and publication membership unchanged), then again after
  deliberately dropping a column, an index, a policy and a trigger (all
  restored).

---

## 🟠 P0 — Egress (fixed in code; SQL is a 2-minute step)

### 19. 5 GB of Supabase egress in a month with 2–3 users — ✅ FIXED in code, 🧑 needs one SQL run

Every realtime event (each message *and* each individual read receipt) made each
open client re-download its **entire conversation list**: 6 queries, ~127 KB
measured, no debounce, `users(*)` per participant, plus a separate query for the
newest message rows in all chats. ~178 MB/day ≈ 5.3 GB/month, which is exactly
what the dashboard showed.

- **In code:** the list is patched from the Realtime payload (0 bytes per
  message), one channel instead of one per chat, one round trip, narrow
  columns, cached follows, read-receipt writes collapsed into one row, and
  photos are downscaled + cached for a year. Regression tests:
  `src/__tests__/egressBudget.test.ts`, `src/__tests__/egressRealtime.test.tsx`.
- **Needs you:** run `sql/02_functions_realtime_storage.sql` (row F above).
- **Analysis, measurements, database-foundation mistakes, caching plan:**
  [EGRESS_AUDIT.md](./EGRESS_AUDIT.md).

---

## 🟢 P3 — Quality

### 15. 470 `any` usages — ❌ STILL OPEN

Now 478: this pass added exactly one in app code (`apiClient.ts`'s
`{ auth?: any }` cast, because the exported client is already `any`) and the
rest are in the new test file, which follows the existing `(row: any)`
convention. Everything else added by this pass is typed. The remaining burn-down
is mechanical, file-by-file work, not something to do blind.

### 16. `src/types/database.types.ts` does not exist — ❌ STILL OPEN (needs project id)

Generating it requires the Supabase project:

```bash
npx supabase gen types typescript --project-id <id> > src/types/database.types.ts
```

Then prefer those row types over hand-written shapes.

### 17. Giant files — ❌ STILL OPEN

Unchanged:

```
1244  features/github/GithubScreen.tsx
 987  providers/CallProvider.tsx
 844  features/chat/components/MessageBubble.tsx
```

Pure extraction work with real regression risk — worth doing deliberately, per
file, with tests, not as a drive-by.

### 18. Stale reference in a live file — ✅ FIXED

`features/chat/SearchUserScreen.tsx` lost its dead `VideoGridItem` /
`ReelGridItem` components, the `SearchTab = 'users' | 'videos' | 'reels'` union
and the leftover `reel.likes_count` read (30 lines). Two related dead ends went
with it:

- the `/search-user` route redirected to `/profile`, which made the “Discover
  People” button in the notifications empty state a no-op. It now renders the
  screen it already lazy-imported.
- the sitemap advertised `/reels` and `/tools`, two features that no longer
  exist. It now lists real routes.

---

## 🔵 Task 6 — calls, presence & typing (2026-10-11)

Everything below is fixed in code; the only remaining item is the optional TURN
note under issue 15.

### 21. The call screen re-dialled the peer after a call ended — ✅ FIXED

`CallScreen` started a call whenever `activeCall` was `null`. The moment a call
ended, `handleEndCallLocally()` sets exactly that — so hanging up (or being hung
up on) immediately placed a **new** call to the same person, which looked like
"the call keeps coming back". Ringing is now guarded by a `ringStartedRef`: one
ring per visit to the screen, and an already-running call is adopted rather than
re-dialled. Pinned by *ringing is not a failure* in
`src/__tests__/callSignaling.test.ts`.

### 22. Timeouts disagreed, so calls died at the wrong moment — ✅ FIXED

| Was | Now |
|---|---|
| Zombie sweep force-closed a `ringing` row after **40 s** while the caller's own give-up was **45 s** | one constant: `RING_TIMEOUT_MS = 45_000`, sweep threshold = ring timeout + 8 s |
| The P2P caller's connect clock started at ring time, so an unanswered call showed an error at 30 s with the phone still ringing | the clock starts with the offer (i.e. when the receiver actually picked up); an unanswered call is handled by the ring timeout |
| The receiver's stale-ring check was 30 s | the ringing window: a call that reconnects inside it still rings |
| An answered call whose media never arrived rang forever (`accepted` disabled the ring timeout) | `CONNECT_WATCHDOG_MS = 20 s` — then the call ends honestly and the row is finalised |

### 23. A call could stay `accepted` forever, and declines were invisible — ✅ FIXED

- `webRtcCallService`'s `bye`/ICE-failure path only cleared local state; the
  `calls` row stayed `accepted`, so the history showed a call that never ended.
  Every transport-driven teardown now finalises the row through one **idempotent**
  helper (`closeCallRow`, guarded by `.in('status', ['ringing','accepted'])`),
  which also decides who writes the single "call ended" chat log — both sides
  notice a hang-up at the same instant.
- The call history fetched `.eq('status','ended')` only, so a **declined** call
  (stored as `rejected`) and an interrupted one (`error`) never appeared.
  `useCalls` and `CallSyncService` now use `.in('status', ['ended','rejected','error'])`.
- A receiver whose accept failed (no camera permission, dead tab) left the row
  `accepted`; it is now closed as `error`.

### 24. Chat list lost every realtime event in the mock — ✅ FIXED

Not app code: `dev/mock/realtime.ts` parsed `filter: conversation_id=in.(a,b)`
with a regex that stripped *backslashes* instead of parentheses, so the parsed
list was `["(a", "b)"]` and no event ever matched. The list-row patch (the whole
point of the egress fix) could therefore never fire in tests or `dev:mock` — it
is what made `src/__tests__/egressRealtime.test.tsx` fail. Fixed, and that test
is now the regression guard.

### 25. Presence and typing, one source of truth — ✅ FIXED

- Live roster: `src/services/PresenceService.ts` owns **one** Realtime Presence
  channel (`grix-presence`) for the whole app; `PresenceProvider` exposes it
  (`useIsUserOnline`, `useLivePresence`). The legacy `online-users` channel
  `AuthProvider` opened (which only watched *yourself* and wrote `is_online`)
  is gone — `AuthProvider` now only runs the durable heartbeat.
- Every online dot reads the roster first and falls back to
  `users.is_online`/`last_seen` through the single helper `isUserOnline`:
  chat list, chat header, search results, discover, message requests, forward
  sheet, profile, read receipts. When the roster is authoritative, a user who
  closes their tab goes offline **instantly** instead of after the 6-minute
  fallback window.
- Typing: one ref-counted broadcast topic per conversation
  (`src/services/TypingService.ts`) shared by the chat header and the chat-list
  row, `typing…` in the header, explicit `false` on send/blur/unmount/tab-hidden,
  and a 6 s receiver-side TTL as the safety net.

### 26. Stories — the only content feature left, reviewed end to end — ✅ FIXED

With the post system deleted, stories carry the whole "look what I did" surface,
so they were walked through as a feature rather than as a screen:

| Step | What was wrong | Now |
|---|---|---|
| Ring list | `select('*')` with no time bound and no audience bound: every story ever posted by everybody, every time the tab was focused | bounded column list, 24 h cutoff, audience = you + the people you follow + your chat partners (≤ 200 ids), 120-row cap, cache-first paint, one `cleanup_expired_stories()` per session, unseen-first ordering with Telegram-style rings |
| Watching | progress ran on a fixed timer regardless of the video length, a view could be recorded twice, the mute button did nothing for the music track, the exit went to a route that no longer exists | duration-aware progress that resumes correctly, a duplicate `view_story` is skipped, mute drives the `<audio>` element and the `<video>` element, swipe/tap zones, exit to `/stories`, and the owner's view count refreshes |
| Viewers | `view_story` trusted the caller's `viewer_id_param`, so anybody could record a view as somebody else | the SQL function records `auth.uid()`; an anonymous caller is a no-op and a spoofed parameter is ignored (verified on a scratch Postgres) |
| Music | picking a track previewed it, then the sheet's audio could keep playing over the story | audited: preview stops on unmount, the chosen track is stored on the story row (`music_title`/`music_artist`/`music_url`) and played by the watcher with the mute state applied |
| Creation | returned to the (deleted) feed | returns to `/stories` |

An index (`idx_stories_created`) backs the 24 h query. No third-party service is
involved: tracks are static URLs in `src/features/stories/utils/musicData.ts`.

## ✅ Fixed

| Issue | Resolution |
|---|---|
| No way to run the app without credentials | `npm run dev:mock` + `dev/mock/` |
| No test infrastructure | Vitest + jsdom + Testing Library, **99 tests** |
| No agent context docs | `docs/` (7 files) + rewritten `AGENTS.md` |
| `npm run lint` failed with 11 errors | dead code deleted → **0 errors** |
| 13,103+ lines of unreachable code | **146 files deleted, 0 remaining** |
| 7 tables queried but never migrated | their only callers were dead code → **0** |
| 5 RPCs called but never defined | same → **0** |
| Two divergent Express servers | `src/server/server.ts` deleted; deploy config repointed |
| A deploy target missing `/api/grix-ai` + `/api/livekit-token` | fixed by the above; the API is now one file (`server/api.ts`) shared by Cloudflare and Node |
| Dead deploy config for hosts nothing ships to | `vercel.json` and the GitHub Pages workflow deleted; **Cloudflare Pages** is the only target |
| `vite.config.ts` hardcoded `base: '/'` | now `process.env.VITE_BASE_URL \|\| '/'`. Cloudflare serves from the root, so the default is what production uses. |
| `.env.example` listed 6 of 21 vars | all documented; missing server vars added |
| 7 unused npm dependencies | removed (103 packages) |
| 5 stale root `.sql` duplicates | deleted; `sql/` is the only source |
| ~2.3 MB of unreferenced binaries | deleted |
| `dist/` not gitignored | added to `.gitignore` |
| `firestore.rules`, `firebase-blueprint.json`, `metadata.json` | deleted (AI Studio / Firestore leftovers) |
| Open push relay, open file host, no hardening | **#1, #2, #3 — this pass** |
| Notification screens had no write path | **#4, #5 — this pass** |
| Dead password-reset route | **#8 — this pass** |
| Pages base path, no CI typecheck/test, env not wired | **#9, #10, #11 — this pass** |
| 1.14 MB entry chunk, eager emoji picker, console in prod | **#12, #13, #14 — this pass** |
| Stale Reels leftovers in a live screen | **#18 — this pass** |
| 5 GB/month of egress from per-event list refetches | **#19 — this pass; SQL hand-off in row F** |
| Calls re-dialled the peer, never ended in the DB, and the history hid declines | **#21–#23 — this pass** |
| Realtime `in.(…)` filters matched nothing in the mock, hiding the egress fix | **#24 — this pass** |
| Presence/typing had two competing implementations | **#25 — this pass** |
| Stories were unbounded, double-counted views and leaked audio | **#26 — this pass** |
| Re-running the setup deleted every table, with no error | **#20 — this pass; re-runnable SQL + guard tests** |
