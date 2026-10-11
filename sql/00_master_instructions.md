# GrixChat — Supabase setup (read this first)

Everything the app needs in the database is in this folder, in **two files**.
Run them in order and, from then on, **run them again whenever the app is
updated** — that is the supported way to pick up a schema change.

| # | File | What it holds | Runs |
|---|---|---|---|
| 1 | [`01_schema.sql`](./01_schema.sql) | every table, column, constraint, RLS policy and index | ~10 s |
| 2 | [`02_functions_realtime_storage.sql`](./02_functions_realtime_storage.sql) | functions, triggers, realtime publication, storage buckets, the read marker / egress work | ~15 s |

Both are **safe to run at any time, on a brand-new project or on one that is
already live**: nothing is dropped or truncated, missing tables/columns/indexes/
buckets/constraints are created, and policies and functions are re-created so an
updated definition replaces the old one. Existing rows are never modified.
`02` ends with a self-check query — every row must read `OK`.

> **Adding to this folder later?** Two rules, both enforced by
> `src/__tests__/sqlMigrations.test.ts`:
> 1. **Documentation first.** Describe the change in this file (or in
>    [`../docs/EGRESS_AUDIT.md`](../docs/EGRESS_AUDIT.md) for egress work)
>    *before* writing SQL. Detail belongs in the `.md`, never in the `.sql`.
> 2. **Keep files between 600 and 1000 lines.** Append to the current file until
>    it is full, *then* start the next number (`03_…`). Do not create a new file
>    for a small change, and do not let a file grow past 1000 lines.
> Every file starts with a short `COVERS:` comment — one line per area, no detail.

---

## 1. New project (fork → deploy)

1. Create the Supabase project, then **SQL Editor → New query**.
2. Paste **all** of [`01_schema.sql`](./01_schema.sql) → **RUN**.
3. New query → paste **all** of
   [`02_functions_realtime_storage.sql`](./02_functions_realtime_storage.sql) →
   **RUN**. Read the output: the last result set is the self-check.
4. Copy **Project URL** + **anon key** (Settings → API) into the frontend env:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. On Cloudflare Pages these are
   build-time variables — see [`../docs/DEV_SETUP.md`](../docs/DEV_SETUP.md).
5. Turn on **Authentication → Providers** (email, Google/GitHub if you use them)
   and add your site URL to **Authentication → URL configuration**.
6. Run the verification checklist in §4.

## 2. Existing project (schema update)

Run the same two files again, in the same order. On a live database they:

* **create** anything missing — tables, columns (`last_read_at`,
  `last_message_sender_id`, `chat_time_restrictions`, `stories.views`,
  `profile_type`, …), indexes, constraints, storage buckets;
* **re-create** policies and functions, so an updated definition replaces the
  old one — that is how a SQL "update" reaches a project that was set up earlier;
* **never** touch existing rows and never drop a table or a column.

Two deliberate exceptions, both about *message history*, both part of the app's
existing design — read them before you run `02`:
the history cap in `02` keeps only the newest **40 messages per chat**. If you
want history kept instead, skip that section (it is marked) and use the
time-based `prune_old_messages(days)` instead.

## 3. What is inside

### `01_schema.sql`

| Section | Creates |
|---|---|
| Core tables | `users`, `follows`, `conversations`, `conversation_participants`, `messages`, `stories`, `calls`, `call_candidates`, `chat_settings`, `notifications` |
| Later columns | `conversations.chat_time_restrictions`, `stories.views` |
| Column upgrades | every column of every table, via `ADD COLUMN IF NOT EXISTS` (for projects created by an older version of this file) |
| Constraints | unique pairs, username length, `post_likes` primary key — added only when absent |
| RLS | row-level security enabled + every policy for the tables above (`DROP POLICY IF EXISTS` first, so edits apply) |
| Posts & tickets | `posts`, `post_likes`, `post_comments`, `support_tickets` with their policies and indexes |
| Indexes | all search and join indexes |

### `02_functions_realtime_storage.sql`

| Section | Creates |
|---|---|
| Auth → profile | `handle_new_auth_user()` + the `auth.users` trigger (creates the profile on signup/OAuth), `get_direct_conversation_id()` |
| Stories | `view_story()`, `cleanup_expired_stories()` |
| Read marker | `conversation_participants.last_read_at` **+ its RLS UPDATE policy** + index — unread becomes a comparison instead of a per-message scan |
| Chat-list preview | one `last_message*` trigger (insert, edit, delete, soft delete) — supersedes the older duplicate trigger, which is dropped |
| History cap | `prune_past_messages`, `prune_past_calls` + a one-time sweep (⚠️ deletes history, see §2) |
| Counts & retention | `get_unread_counts()`, `prune_old_messages(days)`, optional RLS hardening block |
| Realtime | replica identity per table, `supabase_realtime` publication membership |
| Storage | `chat-media` + `profiles` buckets and their storage policies |
| Self-check | one query at the end; every row must read `OK` |

## 4. Verification checklist

After running both files, this must return a row of `OK`s (it is the same check
`02` prints at the end, plus a few):

```sql
SELECT 'tables' AS what,
       CASE WHEN COUNT(*) >= 14 THEN 'OK (' || COUNT(*) || ')' ELSE 'MISSING ' || COUNT(*) END AS state
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
   AND table_name IN ('users','follows','conversations','conversation_participants','messages',
                      'stories','calls','call_candidates','chat_settings','notifications',
                      'posts','post_likes','post_comments','support_tickets')
UNION ALL
SELECT 'columns added by later migrations',
       CASE WHEN COUNT(*) = 4 THEN 'OK' ELSE 'MISSING ' || COUNT(*) END
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (table_name, column_name) IN (
        ('conversation_participants','last_read_at'),
        ('conversations','last_message_sender_id'),
        ('conversations','chat_time_restrictions'),
        ('stories','views'))
UNION ALL
SELECT 'RLS policies (expect 43+)',
       CASE WHEN COUNT(*) >= 43 THEN 'OK (' || COUNT(*) || ')' ELSE 'LOW ' || COUNT(*) END
  FROM pg_policies WHERE schemaname = 'public'
UNION ALL
SELECT 'UPDATE policy on conversation_participants',
       CASE WHEN COUNT(*) > 0 THEN 'OK' ELSE 'MISSING' END
  FROM pg_policies WHERE schemaname='public' AND tablename='conversation_participants' AND cmd='UPDATE'
UNION ALL
SELECT 'storage buckets',
       CASE WHEN COUNT(*) = 2 THEN 'OK' ELSE 'MISSING ' || COUNT(*) END
  FROM storage.buckets WHERE id IN ('chat-media','profiles')
UNION ALL
SELECT 'realtime publication',
       CASE WHEN COUNT(*) >= 5 THEN 'OK (' || COUNT(*) || ')' ELSE 'LOW ' || COUNT(*) END
  FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
UNION ALL
SELECT 'replica identity (messages must be FULL)',
       COALESCE((SELECT CASE WHEN relreplident = 'f' THEN 'OK' ELSE 'WRONG' END
                   FROM pg_class WHERE oid = 'public.messages'::regclass), 'MISSING')
UNION ALL
SELECT 'signup trigger',
       CASE WHEN COUNT(*) > 0 THEN 'OK' ELSE 'MISSING' END
  FROM pg_trigger WHERE tgname = 'on_auth_user_created'
UNION ALL
SELECT 'no duplicate last_message trigger',
       CASE WHEN COUNT(*) <= 1 THEN 'OK' ELSE 'DUPLICATE ' || COUNT(*) END
  FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'public.messages'::regclass
   AND tgname LIKE 'trg_%last_message%';
```

Then, in the dashboard:

* **Table Editor** — the 14 tables above exist.
* **Storage** — buckets `chat-media` (50 MB limit) and `profiles` (5 MB).
* **Database → Replication** — `supabase_realtime` is enabled for `messages`,
  `conversations`, `users`, `calls`, `conversation_participants`.
  (The SQL registers the tables; the dashboard toggle is what actually streams.)
* **Authentication → Policies** — no duplicate policy names from an older file.
  If you ever ran one of the files in [`legacy/`](./legacy/), read
  [`legacy/README.md`](./legacy/README.md).

### Prove it is re-runnable

```sql
SELECT (SELECT COUNT(*) FROM public.users) AS users,
       (SELECT COUNT(*) FROM public.messages) AS messages,
       (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public') AS policies;
```

Run both setup files again, then run this again: `users` and `messages` must be
**identical** and `policies` must not grow (policies are replaced, never
stacked). `src/__tests__/sqlMigrations.test.ts` enforces the same rules.

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `relation "public.users" does not exist` | files ran out of order — always `01` first |
| Foreign-key error while running `02` | same: `01_schema.sql` must be applied first |
| `permission denied for table storage.objects` | run `02` as the project owner (the SQL editor is fine); a non-owner role cannot create storage policies |
| Realtime updates never arrive | dashboard → Database → Replication → `supabase_realtime`; also check the table is listed in `pg_publication_tables` (checklist above) |
| Uploads fail with 403 | buckets exist but storage policies were not applied — re-run `02` |
| Chat history looks short | the history cap in `02` (40 messages/chat), by design — see §2 |
| A policy name appears twice in the dashboard | an old file from [`legacy/`](./legacy/) was run; drop the duplicates as described there |
| `function public.get_unread_counts() does not exist` | `02` has not been run yet |
| Two `last_message` triggers on `messages` | an older install; re-running `02` drops the superseded one (checklist row above) |
| Everything works but egress is high | check `last_read_at` exists (the client falls back to the old per-message read path without it) and re-read [`../docs/EGRESS_AUDIT.md`](../docs/EGRESS_AUDIT.md) |

## 6. Rules for changing these files

1. **Never add a `DROP TABLE`.** Use `CREATE TABLE IF NOT EXISTS` plus
   `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for anything new.
2. **Every `CREATE` must be idempotent** — `CREATE OR REPLACE` for functions,
   `DROP POLICY IF EXISTS` + `CREATE POLICY` for policies,
   `CREATE INDEX IF NOT EXISTS` for indexes, `DROP TRIGGER IF EXISTS` +
   `CREATE TRIGGER` for triggers.
3. **Write the `.md` first.** What the change does and why goes here or in
   [`../docs/EGRESS_AUDIT.md`](../docs/EGRESS_AUDIT.md); the SQL keeps a short
   `COVERS:` header only.
4. **600–1000 lines per file.** Append to `02_…` until it is full, then start
   `03_…`. Small standalone files and 2000-line files are both wrong.
5. **Test before committing:** the suite enforces rules 1–4. Also run the two
   files against a real Postgres twice — fresh, then again on data — the way the
   2026-10-11 review did.
6. Superseded files go to [`legacy/`](./legacy/) — never leave two files that
   create the same table next to each other.
