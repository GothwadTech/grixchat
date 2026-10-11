# Known Issues

Prioritised. Originally verified against the code on 2026-10-10; **re-verified
and largely fixed on 2026-10-11** (see the status on each item).

**Severity:** 🔴 blocks a safe deploy · 🟠 breaks a feature or misleads a
developer · 🟡 quality / performance · 🟢 nice to have

**Legend:** ✅ fixed in code · ⚠️ partly fixed · ❌ still open · 🧑 needs a
human step (SQL run, secret, or a product decision)

---

## 🧑 Read this first — the three things code cannot do

Everything that could be fixed from the repository alone **has been**. These
tasks need Supabase, GitHub settings or a decision:

| # | Task | Where | Why it matters |
|---|---|---|---|
| A | Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (+ the `VITE_FIREBASE_*` and `VITE_LIVEKIT_URL` values) as **Actions secrets** | GitHub → Settings → Secrets and variables → Actions | The Pages workflow now passes them to the build. **Without them the Supabase SDK is compiled out and the deployed app cannot sign in** — the build warns loudly in the log. |
| B | Set the server secrets on whichever host runs `server.ts` (Vercel/Cloudflare): `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL` | host dashboard | The new auth layer verifies JWTs against `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, so those two must be set **server-side** as well. |
| C | Decide the fate of `call_candidates` (issue 7) | Supabase SQL editor | It is defined but unused. Drop it with:<br>`DROP TABLE IF EXISTS public.call_candidates CASCADE;`<br>or keep it and adopt the table-based signalling in `db/3_webrtc_signaling_architecture.md`. |

Optional: set `ALLOWED_ORIGINS=https://your-domain.tld,https://your-other.tld`
(comma-separated) on the server to extend the CORS/origin allowlist beyond
same-origin + `APP_URL`.

---

## ✅ P0 — Security (all fixed)

### 1. `/api/send-notification` was an open push relay — ✅ FIXED

It is no longer a token relay at all:

- **Auth:** requires `Authorization: Bearer <supabase access token>`, verified
  with `supabase.auth.getUser()` (`server.ts` → `requireAuth`).
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

- Auth required (`requireAuth`).
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
| `helmet()` | nosniff, referrer policy, `X-Powered-By` off, CORP `cross-origin`. CSP/COOP/COEP/frameguard are deliberately relaxed so the Vite dev server, the GitHub OAuth popup and the WebView/TWA wrapper keep working (documented inline). |
| `cors()` | Reflects an origin only when it is same-origin or allowlisted (`APP_URL` + `ALLOWED_ORIGINS` + localhost). |
| Origin guard | Cross-origin writes to `/api/*` are refused with **403** (CSRF belt-and-braces). Loopback/bind-all hosts are exempt so tunnel/preview deployments keep working. |
| `express-rate-limit` | global 300/min · API 60/min · notifications 20/min · uploads 8/min · AI 20/min, per IP. `trust proxy` is set so the real client IP is used behind Vercel/preview proxies. |
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

`sql/01_core_schema.sql` is right: the column is `content`. Both readers now
map `content` (with a `text` fallback kept only for rows written by older
builds), and the new writer only ever writes `content`. The mock seeds both and
the mock now applies the `is_read DEFAULT FALSE` the SQL declares.

### 6. `users.saved_posts` was not in the schema — ✅ FIXED

The column never existed; the only consumers were a read in
`userProfileService.ts` and a field on `UserProfile`, both leftovers from the
deleted Posts/Reels features. Removed from the code **and** from `dev/mock/`, so
the mock keeps mirroring `sql/`.

### 7. `call_candidates` is defined but never used — ❌ STILL OPEN (needs SQL)

The live calling path (`providers/CallProvider.tsx`) signals over Broadcast
channels, so the table is dead weight. Dropping it is a one-line migration the
repo cannot run for you — see task **C** at the top. No code change is pending
on either side of the decision.

### 8. Password reset had no path — ✅ FIXED

`/forgot-password` now renders `LoginScreen` in its reset mode instead of
redirecting to `/login`. The screen derives the mode from the route and keeps
`/login` ↔ `/forgot-password` in sync (including browser back/forward), so the
existing working `auth.resetPasswordForEmail` flow is finally reachable from a
URL. Covered by a new case in `src/__tests__/app.smoke.test.tsx`.

---

## 🟡 P2 — Deploy & CI (all fixed)

### 9. GitHub Pages base path — ✅ FIXED

`.github/workflows/deploy.yml` builds with `VITE_BASE_URL: /grixchat/`, so
`dist/assets/…` is emitted under the sub-path Pages serves from.

### 10. CI did not typecheck or test — ✅ FIXED

The workflow now runs `npm run lint` (tsc) and `npm test` before `npm run
build`. Both pass.

### 11. `.env.example` and CI env were not connected — ✅ FIXED

The Pages build receives every `VITE_*` value from Actions secrets (add them —
task **A**). Two extra safeguards came out of this:

- `vite.config.ts` prints a loud build-time warning when a production build has
  no `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- That warning exists because of a nastier trap found while fixing this:
  `src/lib/supabase.ts` returns `null` without those two values, Rollup
  constant-folds that into `null`, and then **tree-shakes the entire Supabase
  SDK out of the bundle**. The build "succeeds", the app just can never reach
  the backend. With the credentials present the SDK is bundled normally
  (`vendor-supabase`, 207 kB).

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

## ✅ Fixed

| Issue | Resolution |
|---|---|
| No way to run the app without credentials | `npm run dev:mock` + `dev/mock/` |
| No test infrastructure | Vitest + jsdom + Testing Library, **85 tests** |
| No agent context docs | `docs/` (7 files) + rewritten `AGENTS.md` |
| `npm run lint` failed with 11 errors | dead code deleted → **0 errors** |
| 13,103+ lines of unreachable code | **146 files deleted, 0 remaining** |
| 7 tables queried but never migrated | their only callers were dead code → **0** |
| 5 RPCs called but never defined | same → **0** |
| Two divergent Express servers | `src/server/server.ts` deleted; `vercel.json` → `server.ts` |
| Vercel missing `/api/grix-ai` + `/api/livekit-token` | fixed by the above |
| `vite.config.ts` hardcoded `base: '/'` | now `process.env.VITE_BASE_URL \|\| '/'`, wired in CI |
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
