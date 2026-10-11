# Superseded SQL — **do not run these**

Everything in this folder was replaced by the numbered files in `sql/`
(`sql/01_schema.sql` + `sql/02_functions_realtime_storage.sql`). It is kept only
as a record of what the database used to look like.

| File | What it is | Why it is here |
|---|---|---|
| `grixchat_latest_db_updates.sql` | An older "run me" patch file with its own copies of the pruners, the `last_message` trigger and profiles policies | Its policies have different names from `01_schema.sql`; running both creates **duplicate, conflicting policies**. |
| `supabase_schema.sql` | The original all-in-one schema (create tables + RLS + indexes) | Byte-for-byte superseded by `01_schema.sql` + `02_functions_realtime_storage.sql`. |
| `supabase_posts_schema.sql` | Original posts/likes/comments schema | Superseded by `01_schema.sql`. |
| `supabase_support_tickets_schema.sql` | Original support-ticket schema | Superseded by `01_schema.sql`. |
| `superseded_complete_schema.sql` | `db/1_complete_schema.sql` — an early, divergent design (`users.email UNIQUE NOT NULL`, `users.status`, `group_call_participants`, `uuid-ossp`) | **Actively dangerous**: it defines `public.users` differently from `01_schema.sql`, so running it on a current project breaks the app. |
| `superseded_realtime_and_security.sql` | `db/2_realtime_and_security.sql` — the matching RLS/realtime pass for that early design | Same reason. |

Rules that came out of this cleanup:

1. **`sql/` has exactly one source of truth**: the numbered files, in order.
2. The numbered files are **re-runnable**: they never `DROP TABLE`, and every
   `CREATE` is `IF NOT EXISTS` or preceded by `DROP ... IF EXISTS`.
3. Superseded files get moved here, never left next to the live ones — a fork
   that runs the wrong file is how a project ends up with two conflicting
   schemas.
