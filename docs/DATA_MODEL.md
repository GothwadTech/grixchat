# Data Model

> `sql/` is the **only** authoritative schema. The five stale `.sql` files that
> used to sit at the repository root have been deleted.

---

## Status

```
Tables queried by the app      : 13
Tables defined in sql/         : 14
Queried but not defined        :  0   ✅
Defined but not queried        :  1   (call_candidates)

RPCs called by the app         :  3
RPCs defined in sql/           :  7
Called but not defined         :  0   ✅
```

Before the dead-code removal this was 21 tables / 7 missing / 5 missing RPCs.
The drift lived entirely in the deleted Reels, Tube, Posts, Moments, Q&A and
Vibe features.

---

## Tables

### `users` — `sql/01_core_schema.sql:30`
Profile row, 1:1 with `auth.users`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | → `auth.users.id`, `ON DELETE CASCADE` |
| `email`, `phone` | TEXT | |
| `full_name` | TEXT | |
| `username` | TEXT UNIQUE NOT NULL | `CHECK (char_length(username) <= 15)` |
| `photo_url` | TEXT | default flaticon placeholder |
| `bio` | TEXT | default `'Available'` |
| `is_verified` | BOOLEAN | |
| `profile_type` | TEXT | `'personal'` default |
| `is_online` | BOOLEAN | |
| `last_seen`, `updated_at` | TIMESTAMPTZ | |
| `settings` | JSONB | nested `notifications.*` toggles |
| `lock` | JSONB | passcode hash + config, nullable |
| `blocked_users`, `muted_users`, `favorites`, `hidden_chats`, `archived_chats` | TEXT[] | |
| `hidden_chat_settings` | JSONB | `{secretCode, showMenuEntry}` |
| `fcm_tokens` | TEXT[] | FCM registration tokens |

> 🔴 `services/db/userProfileService.ts:192` reads `saved_posts` — **not in the
> schema**. Add the column or drop the field.

### `follows` — `:56`
`id`, `follower_id`, `following_id`, `created_at`. `UNIQUE(follower_id, following_id)`.

### `conversations` — `:65`
`id`, `type` (`'direct'` \| `'group'`), `name`, `photo_url`, `admins UUID[]`,
`watch_video_url`, `watch_state JSONB`, `last_message`, `last_message_at`,
`created_at`, `updated_at`.

### `conversation_participants` — `:80`
`id`, `conversation_id`, `user_id`, `created_at`, `joined_at`.
`UNIQUE(conversation_id, user_id)`.

### `messages` — `:90`
`id`, `conversation_id`, `sender_id`, `text`, `media_url`, `media_type`,
`reply_to` (self-FK, `ON DELETE SET NULL`), `reactions JSONB`, `is_read`,
`is_edited`, `is_deleted`, `deleted_by UUID[]`, `created_at`.

> "Delete for me" is `deleted_by`; "delete for everyone" is `is_deleted`.

### `stories` — `:107`
`id`, `user_id`, `media_url`, `type` (`image`/`text`/`video`), `text_content`,
`bg_color`, `music_title`, `music_artist`, `music_url`, `filter_applied`,
`created_at`.

> The `view_story` RPC writes a `views` array — check the migration in
> `sql/08_stories_expiration_and_views.sql` for the actual column.

### `calls` — `:122`
`id`, `caller_id`, `receiver_id`, `type` (`audio`/`video`),
`status` (`ringing`/`accepted`/`rejected`/`ended`/`error`), `offer JSONB`,
`answer JSONB`, `is_missed`, `created_at`.

### `call_candidates` — `:135` ⚠️ defined, never queried
WebRTC ICE signalling. The live calling path (`providers/CallProvider.tsx`)
signals over Broadcast channels instead. Either adopt it or drop it.
`db/3_webrtc_signaling_architecture.md` describes the design that was not taken.

### `chat_settings` — `:145`
Per-user chat customisation. `id`, `user_id`, `receiver_id`, `nickname`,
`custom_photo_url`, `is_muted`, `created_at`. `UNIQUE(user_id, receiver_id)`.

### `notifications` — `:157`
`id`, `user_id`, `from_user_id`, `type`, `title`, `content`, `is_read`,
`post_id`, `created_at`.

> 🔴 **Two problems.**
> 1. **Nothing writes to it.** Every insert lived in the deleted
>    `features/home/components/`. All five remaining call sites are reads.
>    `grep -rn "from('notifications')" src | grep -c insert` → `0`.
> 2. **Column mismatch.** The schema defines `content`; the reader at
>    `NotificationsScreen.tsx:118` reads `notif.text`.

### `posts` — `sql/02_posts_and_interactions_schema.sql`
`id`, `user_id`, `image_url`, `caption`, `created_at`.

### `post_likes` — composite PK `(post_id, user_id)`, plus `created_at`.
### `post_comments` — `id`, `post_id`, `user_id`, `text`, `created_at`.
### `support_tickets` — `sql/03_support_tickets_schema.sql`.

---

## RPCs

All three called by the app are defined in `sql/`:

| Function | Signature | Call site |
|---|---|---|
| `get_direct_conversation_id` | `(u1 UUID, u2 UUID) → UUID` | `services/ChatService.ts`, `ChatSettingsScreen.tsx:105` |
| `view_story` | `(story_id_param, viewer_id_param, viewer_username_param, viewer_fullname_param)` | `StoryWatcherScreen.tsx:99` |
| `cleanup_expired_stories` | `() → …` | `StoriesTab.tsx:52` |

Defined but not called: `handle_new_auth_user` (a trigger — fires
automatically, so this is correct), `update_conversation_timestamp_and_last_message`,
`prune_past_calls`, `prune_past_messages`.

`ChatService.getOrCreateDirectConversation` calls `get_direct_conversation_id`
first and falls back to a two-query client-side lookup if the RPC errors. Keep
that fallback — it is what makes the function robust to a missing migration.

---

## Realtime subscription rules

From `AGENTS.md`, and enforced by cost, not taste:

```ts
// ❌ banned — streams the whole table to every client
.channel('x').on('postgres_changes', {table: 'follows'}, cb)

// ✅ required — always filtered to the current user's context
.channel('x').on('postgres_changes',
  {table: 'follows', filter: `follower_id=eq.${userId}`}, cb)
```

Transient state must use Broadcast/Presence, never a table write:
typing indicators, read ticks, call signalling, presence.

Channels in use (topic → purpose):

| Topic | Purpose |
|---|---|
| `typing:${chatId}` | typing indicator (broadcast) |
| `sync:${receiverId}` | message sync |
| `incoming-calls:${userId}` | call ringing |
| `notifications-${userId}` | notification feed |
| `muted:${userId}` | mute state |
| `group_settings_${chatId}` | group settings changes |

---

## The core query shapes

```ts
// 1. which conversations am I in
.from('conversation_participants').select('conversation_id').eq('user_id', myId)

// 2. conversation list, with nested participants → users
.from('conversations')
  .select('*, participants:conversation_participants ( user:users (*) )')
  .in('id', convIds)
  .order('updated_at', {ascending: false})
  .limit(limit + 1)

// 3. messages, with sender and reply self-joins
.from('messages')
  .select('*, sender:users (id, username, full_name, photo_url),
              reply_to:reply_to (id, text, sender_id)')
  .eq('conversation_id', conversationId)
  .order('created_at', {ascending: false})
  .limit(50)
```

Query 2 is a **nested reverse join** — `conversation_participants` points at
`conversations`, not the other way round. The mock had to learn this the hard
way: it silently returned `participants: null`, the chat list rendered "No
messages yet", and every unit test still passed. Only the app-level smoke test
caught it. If you touch `dev/mock/query.ts`, keep that test green.

---

## Where the mock fits in

`dev/mock/seed.ts` provides rows for all of the above **plus** eight tables the
app no longer queries (`reels`, `tube_videos`, `tube_live_chat`, `moments`,
`likes`, `comments`, `qna_questions`, `call_candidates`).

That extra seed data is **deliberately kept** — it is test fixture, not app
code, and it means any of those features can be reinstated and tested
immediately. Two mock tests depend on it (`reels` count, `increment_video_views`).
If you want it trimmed, say so; it is one edit.

If you add a table or an RPC, update `dev/mock/seed.ts` and
`dev/mock/rpc.ts`, add the migration to `sql/`, and update this file.
