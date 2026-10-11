# Egress Audit — why 2–3 users burned 5 GB in a month

**Status:** the dominant cause is **found, measured and fixed in code**; the
database half needs one SQL file run by hand
([`sql/09_egress_optimizations.sql`](../sql/09_egress_optimizations.sql)).

**Symptom:** 5 GB of Supabase egress in under a month. 2–3 active users,
2–3 hours of chatting a day, almost no files shared. 70–80 % of the bill with
almost nothing but text messages.

**Verdict:** it was never the messages. It was the *reaction* to them.

---

## 1. The one-line answer

Every realtime event — every message, **and every row of every read receipt** —
made each open client re-download its entire conversation list: **6 round-trips,
25–130 KB per event, per client.** Read receipts are one event *per unread
message*, so opening a chat with 30 unread messages fired 30 of those refetches
at the other device.

Measured, not estimated (see §3). One message ≈ **250 KB**, two clients ≈
**500 KB**. At ~350 messages/day that is **~170 MB/day ≈ 5 GB/month** — the
number on the dashboard.

---

## 2. Where the bytes actually went

Ranked by impact. Line references are to the code *before* this audit's fix.

| # | What | Where | Cost |
|---|---|---|---|
| 1 | **Full conversation-list refetch per realtime event.** `useConversations` subscribed to `messages` (`event: '*'`) and `conversations` for **every** conversation, and each handler called `fetchConversations()` — 6 queries, no debounce, no in-flight guard. | `src/features/chat/hooks/useConversations.ts` | **~250 KB per message per client** |
| 2 | **Read receipts were one UPDATE per unread message.** `markAsRead` ran `UPDATE messages SET is_read = true WHERE … is_read = false`; Postgres emits one WAL row-change per row, and Realtime broadcasts each one. | `src/features/chat/hooks/useChatMessages.ts` | **30 unread → 30 events → 30 × 127 KB** in the other client |
| 3 | **The newest-messages query.** Every refetch pulled `.limit(max(50, conversations × 5))` full message rows ordered across *all* chats — to draw a one-line preview that the `conversations.last_message` column already had. | same as #1 | 30 rows = 6.5 KB → 135 rows = **36.7 KB** |
| 4 | **`select('*')` with a nested `users(*)`.** Every participant came back as the *entire* user row — `settings` jsonb, `lock` (the passcode hash), `fcm_tokens`, six arrays. The list renders six columns. | same as #1 | **0.83 KB per participant row** vs ~0.15 KB needed |
| 5 | **`REPLICA IDENTITY FULL`** on `users`, `messages`, `conversations`, `calls`. Every UPDATE broadcasts the complete OLD row *and* the complete NEW row to every subscriber. | `sql/05_advanced_optimizations_and_realtime.sql:120-124` (5 tables, incl. `call_candidates`) | 2× payload on every update, and ships the passcode hash |
| 6 | **Unread counted by downloading messages.** `.select('conversation_id').eq('is_read', false)` — one row per unread message, uncapped, on **every** refetch, in **two** components (`useConversations` *and* `TabBottom`). | `useConversations.ts`, `src/components/layout/TabBottom.tsx` | 84 rows = 4.8 KB, unbounded with backlog |
| 7 | **Follows re-fetched every time.** The full follow graph in both directions, on every refetch, though it changes only when someone follows. | `useConversations.ts` | 60 rows = **6.4 KB per refetch** |
| 8 | **A channel per conversation.** 20 chats = 20 Realtime channels × 2 table bindings, re-created whenever the list identity changed (which the refetch itself caused). | `useConversations.ts` | connection churn, 40+ bindings |
| 9 | **Re-render → refetch loop.** `fetchConversations` depended on the `userData` *object*, and the 60 s presence heartbeat replaced that object — refetching the list and tearing down every channel once a minute. | `useConversations.ts` + `src/providers/AuthProvider.tsx` | ~24 KB/min/client ≈ 35 MB/month/client |
| 10 | **Storage with a 1-hour cache.** `cacheControl: '3600'` on upload, plus originals 3–8 MB, un-resized — a 4 MB photo rendered in a 300 px bubble, re-downloaded after every hour. | `src/services/SupabaseStorageService.ts`, `src/services/ImageService.ts` | scales with every reopen, every device |

Two multipliers on top: **every open tab is another client**, and `markAsRead`
ran with `force` on mount, on focus and on visibility change — so the receipt
storm repeated all day long.

---

## 3. The measurements

A probe (kept as `src/__tests__/egressBudget.test.ts`) drives the mock Supabase
with a realistic account — **20 chats, 60 follow edges, 400 messages** — and
measures the exact JSON the client pulls:

```
fetchConversations() with 20 chats / 60 follows / 400 messages
  participations                                1.6 KB
  conversations + participants + users(*)      77.7 KB   ← users(*) 0.83 KB/row
  follows (both directions)                     6.4 KB
  unread message rows (1 per unread msg)        4.8 KB
  latest message rows (limit N*5)              36.7 KB   ← 135 rows
  chat_settings                                 0.2 KB
  TOTAL                                       127.4 KB   (6 round-trips)
```

And the same account answered by the **fixed** code path — one round trip,
narrow columns, no message rows:

```
conversation list, fixed path
  TOTAL                                         41 KB    (1 round-trip, 0 message rows)
```

**3× smaller per call — and it is no longer called per message.** The remaining
41 KB is the data the list genuinely renders (27 chat rows + 54 participant
rows), and it runs on mount, on focus and on structural changes only. The same
fixture is asserted in `src/__tests__/egressBudget.test.ts`, which fails if
whole user rows or message rows creep back in.

### The arithmetic that reproduces the bill

```
350 messages/day                  (2–3 h of chatting)
× 2 refetches/message             (messages INSERT + conversations UPDATE)
× ~127 KB                         (measured)
× 2 clients                       (both devices download it)
= ~178 MB/day ≈ 5.3 GB/month      ← matches the dashboard
```

After the fix the per-message cost is **0 bytes**: the list row is patched from
the realtime payload. The 41 KB fetch now happens on mount, on focus and on
structural changes — call it 10–20 times a day, ≈ 0.6 MB/day.

Read receipts sat on top of that, unbounded by the unread backlog.

---

## 4. What is fixed in code (this commit)

> Anchors below are **function/constant names**, not line numbers — grep the
> symbol; line numbers drift with every edit.

| Fix | File |
|---|---|
| **No network call on message traffic.** A message INSERT patches the list row (preview, time, order, unread) straight from the realtime payload. | `useConversations.ts` → `patchConversationFromMessage()` |
| **`conversations` UPDATE also patches in place** — `last_message*` is already in the payload. | `useConversations.ts` → `patchConversationFromRow()` |
| **One channel instead of N**, with `conversation_id=in.(…)` / `id=in.(…)` filters. | `useConversations.ts` → `chat-list-live-*` effect |
| **Structural events are debounced** (1.2 s) and can never overlap — one refresh in flight, bursts collapse. | `useConversations.ts` → `scheduleStructuralRefresh()` (`STRUCTURAL_DEBOUNCE_MS`) |
| **Narrow columns**: `users(id, username, full_name, photo_url, is_online, last_seen)` instead of `users(*)` — no more `settings`/`lock`/`fcm_tokens` per participant. | `useConversations.ts` → `CONVERSATION_LIST_SELECT` |
| **The newest-messages query is gone**; the list uses the denormalized `conversations.last_message*`. | `useConversations.ts` → `fetchConversations()` |
| **Follows cached for 5 minutes**, invalidated by follow events. | `useConversations.ts` → `FOLLOWS_TTL_MS` / `followsCacheKey` |
| **One round trip** for the whole list (participations → conversations → participants → users in a single embedded select). | `useConversations.ts` → `fetchConversations()` |
| **Read receipts are one row**: `conversation_participants.last_read_at`. Falls back to the old per-message update (bounded by the last marker) until the SQL is applied. | `useChatMessages.ts` → `executeUpdate` in `markAsRead` |
| **Unread is a comparison**, not a scan — exact count from messages already cached on the device. | `useConversations.ts` → the `unreadMap` builder in `fetchConversations()` |
| **Focus/visibility re-sync** replaces the "refetch on every event" habit. | `useConversations.ts` → structural effect |
| **No more re-render refetch loop**: deps use stable values; the presence heartbeat is 5 min (was 60 s) and the write throttle 4 min (was 45 s). | `AuthProvider.tsx` → `PRESENCE_HEARTBEAT_MS`, `userProfileService.ts` → `STATUS_WRITE_THROTTLE_MS` |
| **Photos are downscaled to 1600 px / JPEG 0.82 before upload**, and stored with a 1-year immutable cache (objects are already uniquely named). | `ImageService.ts` → `compressImage()`, `SupabaseStorageService.ts` → `cacheControl` |
| **Tab-bar unread scan capped** at 500 rows. | `TabBottom.tsx` → legacy unread scan |

The app works **before and after** the SQL is applied: every read-marker call is
feature-detected once per session and falls back to the old behaviour.

---

## 5. What only you can run (2 minutes)

Supabase dashboard → **SQL Editor** → paste
[`sql/09_egress_optimizations.sql`](../sql/09_egress_optimizations.sql) → Run.
It is idempotent, and it ends with a self-check query.

What it does:

1. **`conversation_participants.last_read_at`** (+ index **+ a missing RLS
   UPDATE policy**) — the read marker. The policy matters: RLS is enabled on
   that table and `01_core_schema.sql` defines SELECT/INSERT/DELETE only, so an
   UPDATE matches no policy, changes **0 rows and reports no error** — the
   marker would silently never move.
2. **A trigger that maintains `conversations.last_message*`** (including
   `last_message_sender_id` for ticks), so the client never re-reads messages
   for a preview.
3. **`REPLICA IDENTITY DEFAULT`** on `users`, `conversations` and `calls` —
   UPDATE payloads shrink to the new row + primary key, and the passcode hash /
   FCM tokens stop travelling over Realtime. `FULL` **stays** on
   `conversation_participants` (tiny rows, and the client must see a participant
   being removed) and on `messages` (`useChatMessages` filters DELETE events by
   `conversation_id`, and that column only exists in `old` under `FULL` — drop
   it and "delete for everyone" silently stops propagating; the read-marker
   change is what kills message UPDATE volume).
4. **Indexes** for the hot paths: `messages(conversation_id, created_at DESC)`,
   `conversations(last_message_at DESC)`, a partial index for unread, and
   `conversation_participants(user_id, last_read_at)`.
5. An optional **`get_unread_counts()`** RPC — exact badges without scanning.
6. An optional **`prune_old_messages(days)`** retention function (trigger
   disabled for the bulk delete, affected conversations re-previewed in one
   statement).

Verified end to end against a real Postgres before shipping: the file applies
cleanly, re-applying it is a no-op, the trigger's fast and slow paths behave,
RLS lets a user move their own marker and nobody else's, `get_unread_counts()`
returns the right badges, and the self-check reports 7 × OK.

> ⚠️ Point 3 is the one to not skip. With `REPLICA IDENTITY FULL`, Supabase
> broadcasts the whole row on both sides of every UPDATE — on `users` that
> includes the **app-lock passcode hash** and the FCM token list.

Then, in the dashboard: **Reports → Egress** has a breakdown by Postgres /
Realtime / Storage / Functions. Re-run it a day later; the drop should be
visible per-category.

---

## 6. Database foundation — the mistakes, in order

You asked whether the schema itself is wrong. Partly yes:

1. **Read state was modelled per message, not per participant.** `messages.is_read`
   means "who read this" is answered by writing N rows, and every row is a
   Realtime event. The normal model is one `last_read_at` per participant —
   which also makes unread a comparison, not a scan. **This is the single
   biggest design fix** and it is in `09_egress_optimizations.sql`.
2. **`REPLICA IDENTITY FULL` on hot, wide, private tables.** It was added so
   DELETE/UPDATE filters would work, but it doubles every UPDATE payload and
   leaks private columns. The right split is: `FULL` only where a *filtered
   DELETE* must reach the client (`conversation_participants`, `messages`),
   `DEFAULT` everywhere else. Advanced: `REPLICA IDENTITY USING INDEX` on a
   unique `(id, conversation_id)` index gives `old` just those columns — worth
   testing if message UPDATE payloads ever matter again.
3. **The chat list's data was not denormalized.** `conversations.last_message`
   existed but was written only by the client's send path, so the read path
   re-derived it from `messages` — 135 rows on every refresh. A trigger makes
   the column authoritative.
4. **`users` mixes public profile data with private state** (`settings`,
   `lock`, `fcm_tokens`, `blocked_users`…). Every "fetch a user" query therefore
   drags secrets and bloat. Splitting private state into `user_private` (or at
   minimum never selecting `*` for other users) is the structural fix; the code
   fix applied here is to select explicit columns, always.
5. **No composite index for the actual access pattern**
   (`conversation_id` + `created_at DESC`) and no partial index for unread
   scans.
6. **Unbounded queries with no pagination ceiling** — the unread scan, the
   newest-messages window and `users.select('*')` all grow with data volume.
   Every list query now has a `limit`.

7. **A missing RLS UPDATE policy on `conversation_participants`.** With RLS on
   and no UPDATE policy, writes succeed "silently" by affecting zero rows — the
   most expensive kind of bug to find. Any table the client writes to needs a
   policy per verb; this one only ever had SELECT/INSERT/DELETE. Fixed in
   `09_egress_optimizations.sql`.
8. **`FOR SELECT USING (true)` on `users` and `conversation_participants`.**
   Every authenticated account can read every other account's `email`, `phone`,
   `lock` (passcode hash), `fcm_tokens`, *and* the whole who-talks-to-whom graph.
   The code fix here (never select secrets, name the columns) stops the
   *egress*, not the *exposure* — hardening SQL is included as a commented block
   at the end of `09_egress_optimizations.sql` because it needs a
   `SECURITY DEFINER` helper before it can be switched on.

Nothing here requires a rewrite. Items 1–3 are the ones worth doing now, while
there are 2–3 real users; item 8 is the one to read with a security hat on.

---

## 7. Caching strategy — changed and recommended

You said the cache can change freely. Current model, after this commit:

| Layer | What it holds | Lifetime | Notes |
|---|---|---|---|
| `LocalDataCache` (memory + localStorage) | conversation list, per-chat messages, profile per user, follows | session, follows 5 min | the single source for the first paint — no spinner, no network |
| Browser HTTP cache | Storage objects (`photo_url`) | **1 year, immutable** | object names are unique, so a re-download is pure waste |
| Realtime | live patches only | — | patches state, never triggers a fetch |
| Full refetch | reconciliation | mount, focus, structural change, 1.2 s debounce | 1 round trip, 41 KB measured, never per message |

Recommended next (not in this commit):

- **Image transformations** (`/render/image/...?width=300&quality=75`) for
  avatars and thumbnails, so the device downloads a 12 KB image instead of the
  full-size original. Note: billed as Storage egress only on paid plans —
  check before relying on it.
- **A `unread_count` column** maintained by trigger if you want exact badges
  without the client counting from cache.
- **`get_unread_counts()`** (in the SQL file) if you prefer exact server counts.
- **Message pagination is already 20/page** — keep it that way; never "load all".

---

## 8. How to keep it fixed

1. **The rule:** a Realtime event may patch state. It may **never** trigger a
   list-wide query. (Recorded in `AGENTS.md`.)
2. **Watch the ratio**, not the bytes: Supabase → Reports → Egress, and
   Database → Query Performance. A jump means someone reintroduced a refetch.
3. **The regression tests** — both are in the suite and both fail if the old
   shape returns:
   - `src/__tests__/egressBudget.test.ts` — the conversation list query stays
     under budget, selects six user columns, and carries **zero** message rows.
   - `src/__tests__/egressRealtime.test.tsx` — an incoming Realtime message
     patches the visible list with **zero** `conversations` /
     `conversation_participants` queries.
4. **Every list query gets a `limit`.** No exceptions.
5. **No `select('*')`** outside your own profile — and never `users(*)` for
   other people.
6. **Cardinality check before adding a listener:** does this event fire once per
   user action, or once per *row*? Read receipts were the latter.
