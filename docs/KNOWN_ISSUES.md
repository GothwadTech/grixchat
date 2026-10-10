# Known Issues

Prioritised. Verified against the code on 2026-10-10, after the dead-code
removal. The command that proved each item is noted where useful.

**Severity:** 🔴 blocks a safe deploy · 🟠 breaks a feature or misleads a
developer · 🟡 quality / performance · 🟢 nice to have

---

## 🔴 P0 — Security

### 1. `/api/send-notification` is an open push relay

`server.ts:153`. No authentication, no origin check, no rate limit.

```bash
curl -X POST https://<host>/api/send-notification \
  -H 'Content-Type: application/json' \
  -d '{"tokens":["<any FCM token>"],"title":"Alert","body":"Tap here"}'
```

FCM tokens live client-side (`users.fcm_tokens`), so a leaked token plus this
endpoint is a spam/phishing channel to the whole user base.

**Fix:** verify a Supabase JWT (`Authorization: Bearer`) and confirm the caller
participates in the conversation; add a per-IP rate limit.

### 2. `/api/upload-file` is an open file host

`server.ts:346`. Multer limit **100 MB per file**, `express.json` limit 50 MB.
No auth, no rate limit, no MIME allowlist. Re-uploads to `catbox.moe` /
`gofile.io`, so the server is a free anonymous file host on your bandwidth.

**Fix:** require auth; cap size per media type; rate limit; preferably upload
straight to Supabase Storage with a signed URL.

### 3. No server hardening at all

```
grep -n "cors\|helmet\|rate" server.ts   →  0 results
```

No CORS policy, no security headers, no rate limiting on any route.

**Fix:** `helmet()` + an explicit `cors({origin})` allowlist + `express-rate-limit`.

---

## 🟠 P1 — Correctness

### 4. Nothing writes to `notifications`

Every insert into `notifications` lived in `features/home/components/`
(`PostCard.tsx`, `VideoPostCard.tsx`), which was dead code and has been deleted.
The remaining five call sites are all **reads**:

```
src/components/layout/TabHeader.tsx:82                       select
src/features/notifications/NotificationsScreen.tsx           select
src/features/notifications/LikeNotificationsScreen.tsx:29    select
src/features/notifications/LikeNotificationsScreen.tsx:52    update(is_read)
```

`grep -rn "from('notifications')" src | grep -c insert` → **0**

So the notification screens will always be empty.

**Fix:** either add a write path (e.g. on new messages / follows) or remove the
screens. Decide deliberately — right now the UI advertises a feature the
backend never feeds.

### 5. `notifications` column mismatch

`sql/01_core_schema.sql:157` defines `title` and **`content`**.
`NotificationsScreen.tsx:118` reads **`notif.text`**.

```tsx
<span className="…">{notif.text}</span>
```

Whatever write path you add must agree with the reader and the schema. Pick
`content` (matches the migration) and change the reader.

### 6. `users.saved_posts` is not in the schema

`services/db/userProfileService.ts:192` reads and writes it; `sql/` does not
define it. Either add the column or drop the field.

### 7. `call_candidates` is defined but never used

`sql/01_core_schema.sql:135` creates it for WebRTC ICE signalling, but the live
calling path (`providers/CallProvider.tsx`) signals over Broadcast channels.
Either use it or drop it. `db/3_webrtc_signaling_architecture.md` describes the
table-based design that was not adopted.

### 8. Password reset has no path

```tsx
// App.tsx
<Route path="/forgot-password" element={<Navigate to="/login" replace />} />
```

`ForgotPasswordScreen.tsx` was deleted as dead code. `LoginScreen` still has a
working `isForgotPassword` mode that calls `auth.resetPasswordForEmail`, so
users can reset from the login screen — but the dedicated route is a dead end.
Either wire the route to that mode or remove it.

---

## 🟡 P2 — Deploy & CI

### 9. GitHub Pages base path

`vite.config.ts` now reads `base: process.env.VITE_BASE_URL || '/'`. The
workflow deploys `dist/` to Pages for `GothwadTech/grixchat`, which serves from
`/grixchat/`, and there is no `CNAME`. Every absolute `/assets/…` URL would 404
→ blank page.

**Fix:** add to the workflow's Build step:

```yaml
env:
  VITE_BASE_URL: /grixchat/
```

or add a `CNAME` for a custom domain.

> *Static analysis — an actual Pages deploy was not executed.*

### 10. CI does not typecheck or test

`.github/workflows/deploy.yml` runs only `npm run build`. Vite does not
typecheck, so type errors ship silently.

**Fix:**

```yaml
- name: Lint
  run: npm run lint
- name: Test
  run: npm test
```

Both currently pass, so this is free.

### 11. `.env.example` and CI env are not connected

`.env.example` now lists all 22 variables, but the workflow sets none. The
GitHub Pages build works because it is client-only, but any server-side deploy
target needs them wired up.

---

## 🟡 P2 — Performance

### 12. Main bundle is 1.14 MB (317 KB gzip)

```
dist/assets/index-*.js        1,148.43 kB │ gzip: 316.76 kB
dist/assets/MessageList-*.js    415.67 kB │ gzip: 100.87 kB
dist/assets/GithubScreen-*.js   194.51 kB │ gzip:  59.89 kB
```

`vite.config.ts` has **no `manualChunks`**, so firebase + livekit + supabase
all land in one chunk. Vite emits its own >500 kB warning.

**Fix:** split vendors with `build.rollupOptions.output.manualChunks`.
Deleting the dead features did not shrink this — the weight is in the vendor
libraries, not the app code.

### 13. `emoji-picker-react` is statically imported twice

`ChatMessageMenu.tsx:18` and `EmojiPickerMenu.tsx:3`. A heavy dependency pulled
into the chat chunk.

**Fix:** `React.lazy`.

### 14. 350 `console.*` statements ship to production

`grep -rn "console\.\(log\|warn\|error\)" src | wc -l` → **350** (was 499).

**Fix:** `esbuild.drop: ['console']` for the client build, or a logger that
no-ops in production.

---

## 🟢 P3 — Quality

### 15. 470 `any` usages

`grep -rno ": any\|as any\|<any>" src | wc -l` → **470** (was 624).
`AGENTS.md` forbids this.

### 16. `src/types/database.types.ts` does not exist

`AGENTS.md` mandates strictly-typed Supabase schema definitions.

**Fix:** `npx supabase gen types typescript --project-id <id> > src/types/database.types.ts`

### 17. Giant files

```
1244  features/github/GithubScreen.tsx
 987  providers/CallProvider.tsx
 844  features/chat/components/MessageBubble.tsx
 746  features/chat/ImagePreviewScreen.tsx
 739  features/chat/ChatSettingsScreen.tsx
 649  features/chat/components/ChatUserList.tsx
 603  features/auth/SignupScreen.tsx
 602  features/chat/ChatScreen.tsx
 581  App.tsx
```

`AGENTS.md`: *"Do not bloat files like `App.tsx` or `ChatScreen.tsx`."*

### 18. Stale reference in a live file

`features/chat/SearchUserScreen.tsx:73` renders `reel.likes_count` but the
screen only queries `users` — a leftover variable from the Reels feature.

---

## ✅ Fixed

| Issue | Resolution |
|---|---|
| No way to run the app without credentials | `npm run dev:mock` + `dev/mock/` |
| No test infrastructure | Vitest + jsdom + Testing Library, **78 tests** |
| No agent context docs | `docs/` (7 files) + rewritten `AGENTS.md` |
| `npm run lint` failed with 11 errors | dead code deleted → **0 errors** |
| 13,103+ lines of unreachable code | **146 files deleted, 0 remaining** |
| 7 tables queried but never migrated | their only callers were dead code → **0** |
| 5 RPCs called but never defined | same → **0** |
| Two divergent Express servers | `src/server/server.ts` deleted; `vercel.json` → `server.ts` |
| Vercel missing `/api/grix-ai` + `/api/livekit-token` | fixed by the above |
| `vite.config.ts` hardcoded `base: '/'` | now `process.env.VITE_BASE_URL \|\| '/'` |
| `.env.example` listed 6 of 21 vars | all 22 documented; `VITE_GROQ_API_KEY` dropped |
| 7 unused npm dependencies | removed (103 packages) |
| 5 stale root `.sql` duplicates | deleted; `sql/` is the only source |
| ~2.3 MB of unreferenced binaries | deleted |
| `dist/` not gitignored | added to `.gitignore` |
| `firestore.rules`, `firebase-blueprint.json`, `metadata.json` | deleted (AI Studio / Firestore leftovers) |
