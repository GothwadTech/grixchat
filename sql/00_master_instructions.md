# GrixChat — Supabase setup (read this first)

Everything the app needs in the database lives in this folder. There are two
supported ways to run it, and **both are safe to run on a project that already
has data** — nothing here drops a table, truncates a row, or overwrites a
column. Re-running the whole set is the supported way to pick up a schema
update.

| You are… | Run | Time |
|---|---|---|
| **starting fresh** (new fork, new Supabase project) | [`grixchat_full_setup.sql`](./grixchat_full_setup.sql) — everything in one paste | ~30 s |
| **updating an existing project** | the same file, again. Or `01` … `09` one by one if you prefer to see each step | ~30 s |
| **verifying after a deploy** | the checklist at the bottom of this file | ~2 min |

> Prefer the individual files? Run them **in numerical order**:
> `01_core_schema.sql` → `02_posts_and_interactions_schema.sql` → … →
> `09_egress_optimizations.sql`. The bundle is generated from exactly those
> files in that order, so the result is identical.
>
> `npm run sql:bundle` regenerates the bundle after you edit a numbered file.
> `src/__tests__/sqlMigrations.test.ts` fails if the bundle is stale — or if
> anyone reintroduces a `DROP TABLE` or a non-idempotent `CREATE`.

---

## 1. New project (fork → deploy)

1. Create the Supabase project, then **SQL Editor → New query**.
2. Paste **all** of [`grixchat_full_setup.sql`](./grixchat_full_setup.sql) and
   press **RUN**. It is one transaction-free script: every statement is
   idempotent, so a partial run just means "run it again".
3. Copy **Project URL** + **anon key** (Settings → API) into the frontend env:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. On Cloudflare Pages these are
   build-time variables — see [`../docs/DEV_SETUP.md`](../docs/DEV_SETUP.md).
4. Turn on **Authentication → Providers** (email, Google/GitHub if you use
   them) and add your site URL to **Authentication → URL configuration**.
5. Run the verification checklist below.

## 2. Existing project (schema update)

Paste the same file again. What it does on a live database:

* **creates** anything missing — tables, columns (`last_read_at`,
  `last_message_sender_id`, `chat_time_restrictions`, `stories.views`,
  `profile_type`, …), indexes, constraints, storage buckets;
* **re-creates** policies and functions, so an updated definition replaces the
  old one (that is how the SQL "update" reaches a project that was set up
  earlier);
* **never touches** existing rows, and never drops a table or a column.

Two deliberate exceptions, both about *message history*, and both parts of the
app's existing design — read them before you run:
`05_advanced_optimizations_and_realtime.sql` caps every chat at the newest
**40 messages** (sections 1 and 6). If you want history kept instead, skip
those two sections and use the time-based `prune_old_messages(days)` from `09`.

## 3. What each file does

| File | Creates | Notes |
|---|---|---|
| `01_core_schema.sql` | `users`, `follows`, `conversations`, `conversation_participants`, `messages`, `stories`, `calls`, `call_candidates`, `chat_settings`, `notifications` + RLS + indexes | column upgrades for older installs, constraints added only when missing |
| `02_posts_and_interactions_schema.sql` | `posts`, `post_likes`, `post_comments` + RLS + indexes | |
| `03_support_tickets_schema.sql` | `support_tickets` + RLS | |
| `04_triggers_functions_and_rpc.sql` | `get_direct_conversation_id()`, `handle_new_auth_user()` + the `auth.users` → `public.users` trigger | this is what creates a profile on signup/OAuth |
| `05_advanced_optimizations_and_realtime.sql` | realtime publication membership, preview triggers, replica identity, **40-message cap** | see the warning above |
| `06_storage_configurations.sql` | `chat-media` + `profiles` buckets and their storage policies | buckets are public-read on purpose |
| `07_chat_time_scheduling_migration.sql` | `conversations.chat_time_restrictions` | |
| `08_stories_expiration_and_views.sql` | `stories.views`, `view_story()`, `cleanup_expired_stories()` | |
| `09_egress_optimizations.sql` | `conversation_participants.last_read_at` **+ its RLS UPDATE policy**, the `last_message*` trigger, replica-identity fixes, indexes, `get_unread_counts()`, `prune_old_messages()` | ends with a self-check query — see below. Full reasoning: [`../docs/EGRESS_AUDIT.md`](../docs/EGRESS_AUDIT.md) |

## 4. Verification checklist

Run this in the SQL editor. Every line must read `OK` (it is also the self-check
at the end of `09`):

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
  FROM pg_trigger WHERE tgname = 'on_auth_user_created';
```

Then, in the dashboard:

* **Table Editor** — the 14 tables above exist.
* **Storage** — buckets `chat-media` (50 MB limit) and `profiles` (5 MB).
* **Database → Replication** — `supabase_realtime` is enabled for
  `messages`, `conversations`, `users`, `calls`, `conversation_participants`.
  (The SQL registers the tables; the dashboard toggle is what actually streams.)
* **Authentication → Policies** — no duplicate policy names from an older file.
  If you ever ran one of the files in [`legacy/`](./legacy/), read
  [`legacy/README.md`](./legacy/README.md) and drop the leftovers it lists.

### Prove it is re-runnable

```sql
SELECT (SELECT COUNT(*) FROM public.users) AS users,
       (SELECT COUNT(*) FROM public.messages) AS messages,
       (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public') AS policies;
```

Run the setup again, then run this again: `users` and `messages` must be
**identical**, `policies` must not grow (policies are replaced, never stacked).
That is exactly what `npm test` checks in `src/__tests__/sqlMigrations.test.ts`.

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `relation "public.users" does not exist` | files ran out of order — always `01` first |
| Foreign-key error while running `02`/`03` | same: `01` must be applied first |
| `permission denied for table storage.objects` | run `06` as the project owner (the SQL editor is fine); a non-owner role cannot create storage policies |
| Realtime updates never arrive | dashboard → Database → Replication → `supabase_realtime`; also check that the table is listed in `pg_publication_tables` (the checklist above) |
| Uploads fail with 403 | buckets exist but storage policies were not applied — re-run `06` |
| Chat history looks short | that is `05`'s 40-message cap, by design. Skip its sections 1 and 6 to keep history (see §2) |
| A policy name appears twice in the dashboard | an old file from [`legacy/`](./legacy/) was run; drop the duplicates as described there |
| `function public.get_unread_counts() does not exist` | `09` has not been applied yet |
| Everything works but egress is still high | check `last_read_at` exists (the client falls back to the old per-message read path without it) and re-read [`../docs/EGRESS_AUDIT.md`](../docs/EGRESS_AUDIT.md) |

## 6. Rules for changing this folder

1. **Never add a `DROP TABLE`.** Use `CREATE TABLE IF NOT EXISTS` plus
   `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for anything new.
2. **Never add a `CREATE` that is not idempotent** — `CREATE OR REPLACE` for
   functions, `DROP POLICY IF EXISTS` + `CREATE POLICY` for policies,
   `CREATE INDEX IF NOT EXISTS` for indexes, `DROP TRIGGER IF EXISTS` +
   `CREATE TRIGGER` for triggers.
3. **New migrations get the next number** (`10_…`) and are appended to the file
   list in `scripts/build-sql-bundle.mjs`; then run `npm run sql:bundle`.
4. **Test before committing.** The suite enforces rules 1–3; a real Postgres run
   (fresh + re-run on populated data) is how the 2026-10-11 review was done.
5. Superseded files go to [`legacy/`](./legacy/) — never leave two files that
   create the same table next to each other.
