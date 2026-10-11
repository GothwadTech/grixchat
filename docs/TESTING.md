# Testing

```bash
npm test            # one-shot run
npm run test:watch  # watch mode
```

**Current state: 125 tests across 12 files, all passing, ~21 s.**

| File | Tests | What it covers |
|---|---|---|
| `dev/mock/__tests__/query.test.ts` | 23 | The PostgREST-compatible query engine |
| `dev/mock/__tests__/auth-rpc.test.ts` | 17 | Mock auth, all 7 RPCs, realtime channels |
| `src/__tests__/chatService.test.ts` | 15 | **Real** `ChatService` against the mock |
| `src/__tests__/utils.test.ts` | 20 | `dateUtils`, `lastSeenFormatter`, `scheduleUtils` |
| `src/__tests__/notificationService.test.ts` | 6 | **Real** notification write path — column contract, de-duplication |
| `src/__tests__/apiRoutes.test.ts` | 14 | **Real** `server/api.ts` — routing, CORS/origin guard, body caps, auth (Node env) |
| `src/__tests__/app.smoke.test.tsx` | 4 | **Real** `<App />` — login form → chat list, `/forgot-password` reset mode |
| `src/__tests__/presenceTyping.test.ts` | 8 | Presence roster (join/leave/sync, fallback to `is_online`/`last_seen`, future timestamps) and typing (broadcast, explicit stop, idle timeout, ref-counted channels) |
| `src/__tests__/callSignaling.test.ts` | 5 | The call handshake against a stubbed WebRTC stack — offer/answer, `connected` only from the peer connection, `failed` on ICE failure, `closed` on the peer's hang-up, and *ringing is not a failure* (an unanswered call must not error while it is still ringing) |
| `src/__tests__/egressRealtime.test.tsx` | 1 | The regression test for the 5 GB/month bug: a realtime INSERT patches the chat-list row with **zero** queries. It also covers the mock Realtime `in.(…)` filter, which silently dropped every unmuted event before this pass |

---

## Stack

- **Vitest 3** — config in `vitest.config.ts`
- **jsdom** — DOM environment
- **@testing-library/react** + **@testing-library/user-event** + **jest-dom**
- **The mock Supabase** — `vitest.config.ts` aliases `@supabase/supabase-js` to
  `dev/mock/index.ts` unconditionally, so a test can never hit a real project.

`vitest.config.ts` also injects `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
placeholders, because `src/lib/supabase.ts` refuses to build a client without
them.

`dev/test/setup.ts` polyfills the browser APIs jsdom lacks (`matchMedia`,
`IntersectionObserver`, `ResizeObserver`, `scrollIntoView`, `HTMLMediaElement.play`,
`navigator.mediaDevices`) and **resets the mock database and localStorage
before every test**. Those shims are skipped when a test runs in the Node
environment (`hasDom`), so API tests can reuse the same setup file.

Timeouts are raised (`testTimeout: 25000`) because the smoke test drives a real
login through several async React round trips.

---

## The two layers, and why both exist

### 1. Mock-contract tests (`dev/mock/__tests__/`)

These pin **the mock's** behaviour against PostgREST semantics. If the mock
drifts, app tests would pass while the app breaks — so the contract is asserted
explicitly:

- `.insert().select()` returns an **array**; only `.single()` collapses it
- `.single()` on zero rows returns `{data: null, error: {code: 'PGRST116'}}`
- `.maybeSingle()` returns `{data: null, error: null}`
- Embedded resources: to-one joins, to-many reverse joins, and
  nested-to-nested (`participants:conversation_participants(user:users(*))`)
- `postgres_changes` filters (`sender_id=eq.<id>`) include *and exclude*
  correctly — both directions are tested, because a filter that matches
  everything looks identical to a working filter in a happy-path test

> **Testing the notification writer:** assert on the `content` column, not
> `text` — `sql/01_schema.sql` has no `text` column. The mock now mirrors
> the SQL default (`is_read boolean default false`) so an insert that forgets
> the flag fails a test instead of passing locally.

> **Testing the API:** `src/__tests__/apiRoutes.test.ts` calls
> `handleApiRequest(request, env)` directly — the exact function Cloudflare
> Pages Functions and the Express adapter both call. It runs with
> `// @vitest-environment node`, because jsdom does not implement
> `Request`/`Response`; `dev/test/setup.ts` guards its browser shims for that.
> The rate limiter is module-level state, so keep new cases well under the
> per-minute budget or use a distinct route.

### 2. App tests (`src/__tests__/`)

These import **real shipped code** — no stand-ins.

`chatService.test.ts` exercises `src/services/ChatService.ts` end to end,
including the multi-line embedded select it sends:

```sql
*, sender:users (id, username, full_name, photo_url),
   reply_to:reply_to (id, text, sender_id)
```

`app.smoke.test.tsx` renders the actual `<App />` inside `MemoryRouter` +
`AppProviders`, fills the real login form, clicks the real submit button, and
asserts a seeded conversation appears in the list. **This is the test that
catches "it compiles but the screen is blank."**

> Historical note: this test is what surfaced the nested reverse-join bug in
> the mock's query engine — `participants` came back `null`, so the chat list
> rendered "No messages yet" even though every unit test passed. Unit tests
> alone would not have found it.

---

## Writing a new test

### Testing a service or hook

```ts
import {describe, expect, it} from 'vitest';
import {chatService} from '../services/ChatService';
import {SEED} from '../../dev/mock/seed';

it('loads the seeded thread', async () => {
  const messages = await chatService.getMessages('c0000000-0000-4000-8000-000000000001');
  expect(messages.length).toBeGreaterThan(0);
});
```

Use the `SEED` constants for user IDs — never hardcode UUIDs, and never
hand-write a generated row's ID.

### Testing a component

```tsx
import {render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppProviders} from '../providers/AppProviders';

render(
  <MemoryRouter initialEntries={['/chats']}>
    <AppProviders><MyScreen /></AppProviders>
  </MemoryRouter>,
);
await waitFor(() => expect(screen.getByText(/something/i)).toBeInTheDocument());
```

Wrap in `AppProviders` whenever the component touches auth, theme, or calls.

### Gotchas

- **Duplicate accessible names.** `LoginScreen` renders both a "Login"
  tab-toggle and a "Login" submit button. Target the control, not the label:
  ```ts
  const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement;
  ```
- **Disabled buttons.** The login submit is `disabled` until
  `password.length >= 6`. `await waitFor(() => expect(submit).not.toBeDisabled())`.
- **The database resets per test.** Anything you insert in one test is gone in
  the next — that is deliberate.
- **Don't assert on console output.** `console.info`/`debug` are stubbed in
  `setup.ts`.

---

## Adding to the mock

If you add a table, an RPC, or a column the app now queries:

1. **Table** → add the name to `TABLES` in `dev/mock/store.ts` and seed rows in
   `dev/mock/seed.ts`.
2. **RPC** → add an implementation to `REGISTRY` in `dev/mock/rpc.ts`, using
   the exact argument names the call site sends. An unimplemented RPC logs a
   warning and returns a `42883` error — the app's `try/catch` fallback then
   kicks in, which can mask the gap. Watch the console.
3. **Foreign key** → add it to `FK_TARGET` in `dev/mock/query.ts`. Without it,
   embedded resources like `select('*, users:user_id(...)')` resolve to `null`.
4. **Schema drift** → if the table or RPC is missing from `sql/`, add the
   migration too, and record it in `docs/DATA_MODEL.md`.

Then add a test. `dev/mock/__tests__/query.test.ts` is the pattern to copy.

---

## What is not covered

Be honest about this when assessing risk:

- **WebRTC / calling.** No `RTCPeerConnection` in jsdom. `CallProvider` is
  untested.
- **Multi-device realtime.** The mock is single-process; two tabs do not see
  each other.
- **RLS.** The mock enforces no policies. A query that would be denied in
  production succeeds in tests.
- **Server (`server.ts`).** Zero tests on the Express layer — including the two
  unauthenticated endpoints flagged in `KNOWN_ISSUES.md`.
- **PWA / service worker.** Not tested.
- **~40 screens** have no component test. Only the login → chat-list path does.
