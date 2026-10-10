# Dead Code Removal — Completed

**Status: ✅ done. The codebase now has zero unreachable files.**

```
146 files deleted   ·   35 empty directories pruned   ·   18,826 lines removed

  before:  316 source files  ·  55,534 lines  ·  ~26 feature domains
  after:   186 source files  ·  36,708 lines  ·  13 feature domains
                                          (−33.9% lines, −41% files)
```

Verification after the deletion:

| Check | Result |
|---|---|
| Reachability re-scan | **0 dead files** (189/189 reachable from entry points) |
| Broken relative imports | **0** |
| `npm run lint` (`tsc --noEmit`) | **exit 0, 0 errors** — was 11 |
| `npm test` | **78/78 pass** |
| `npm run build` | **exit 0** |
| Dev server module graph | **55 modules walked, 0 failures** |
| `npm install` | 103 packages removed (7 unused deps) |

---

## How "dead" was determined

Basename grepping under-reports, because a file can be imported *only by other
dead files*. Instead, an **import graph** was built:

- **Entry points:** `src/main.tsx` (from `index.html`), `server.ts`,
  `vite.config.ts`, `vitest.config.ts`, and every `*.test.ts(x)`.
- Every static `import`, dynamic `import()`, and `require()` was resolved
  through the `@/` alias and extension-less specifiers.
- Anything in `src/` not transitively reachable = dead.

This found **133 dead `.ts`/`.tsx` files** — versus 76 from basename matching.
The extra 57 were cascade-dead: reachable only from other dead files.

The scan was re-run after deletion: **0 remaining**.

---

## Deleted — whole feature domains

These features were scaffolding from the exploration phase and are no longer
part of the 5-tab app.

| Domain | Files | Lines |
|---|---|---|
| `features/hub/` (GitHub, browser, Ludo, web-IDE) | 17 | 1,873 |
| `features/reels/` (incl. `grixtube/`) | 13 | 2,111 |
| `features/home/` (feed, comments, share) | 10 | 2,141 |
| `features/tools/` (duplicate GitHub) | 8 | 904 |
| `features/analytics/` | 6 | 971 |
| `features/posts/` | 5 | 1,072 |
| `features/tube/` | 5 | 1,019 |
| `features/camera/` | 4 | 455 |
| `features/channels/` | 2 | 106 |
| `features/moments/` | 1 | 513 |
| `features/qna/` | 1 | 586 |
| `features/vibe/` | 1 | 537 |

## Deleted — unreachable pieces of surviving domains

| Domain | Files | Lines | What went |
|---|---|---|---|
| `features/call/` | 9 | 1,108 | `useWebrtc.ts` (332), `callSounds.ts`, `JoinView`, `MeetingView`, `CallsContactsList`, `CallsQuickActions`, `CallsSearchBar`, `hooks/useCalls.ts`, `index.ts` |
| `features/chat/` | 9 | 822 | duplicate `GrixAIScreen.tsx` (268), `GroupsTab.tsx`, `WatchTogether.tsx`, `useChat.ts`, `useChatRooms.ts`, `useTyping.ts`, `GofileService.ts`, `messageListUtils.ts`, `index.ts` |
| `features/profile/` | 7 | 889 | `ProfileTubeViewer`, `FollowListScreen`, duplicate `GrixAIProfile`, `ProfilePostViewer`, `ProfileReelViewer`, `ProfileContent`, `index.ts` |
| `features/settings/` | 7 | 495 | `SettingsScreen.tsx` (186 — `App.tsx` had a stale comment claiming it was imported), `SettingsMainScreen`, `SettingsList`, `Accessibility`/`Language`/`TimeSpent`, `index.ts` |
| `features/auth/` | 3 | 366 | `CompleteProfileScreen`, `ForgotPasswordScreen`, `index.ts` |
| `features/grixai/` | 3 | 341 | `GrixAICallOverlay`, `GrixAICallSelector`, `index.ts` |
| `features/stories/` | 3 | 402 | `StoryMakerScreen`, `TextStoryEditor`, `index.ts` |
| `features/search/` | 2 | 229 | `FriendsScreen`, `index.ts` |
| `features/github/` | 1 | 788 | `GithubRepoList.tsx` |
| `features/legal/`, `features/lock/` | 2 | 6 | unused barrels |

## Deleted — shared layers

| File | Lines | Note |
|---|---|---|
| `src/server/server.ts` | 454 | The duplicate Express server. See note below. |
| `src/components/DeveloperConsole.tsx` | 296 | Duplicate of `features/console/DeveloperConsole.tsx` |
| `src/components/FloatingDiagnosticsButton.tsx` | 160 | |
| `src/components/chat-ui/CallsTabDropdown.tsx` | 123 | |
| `src/components/chat-ui/SearchTabDropdown.tsx` | 67 | |
| `src/components/ui/{Button,Card,input,index}` | 143 | Nothing imported them |
| `src/services/firebase.ts` | 118 | Duplicate of `src/lib/firebase.ts` |
| `src/services/AudioService.ts`, `VideoService.ts` | 64 | |
| `src/lib/youtubeUtils.ts` | 16 | |
| `src/hooks/useDocumentTitle.ts` | 8 | |

### ⚠️ `src/server/server.ts` — this also fixed a deploy bug

Two Express servers existed. `vercel.json` deployed `src/server/server.ts`,
which was **missing `/api/grix-ai` and `/api/livekit-token`** — so GrixAI and
calling would have 404'd on Vercel while working locally.

Deleting it and repointing `vercel.json` at the root `server.ts` removes the
divergence entirely. `vercel.json` was updated in the same change.

## Deleted — non-source files

```
IMG_20260517_104632.png                            768K   root, referenced nowhere
IMG_20260517_114622.png                            808K   root, referenced nowhere
chat_icon_512_20kb.png                              9K    root, referenced nowhere
public/assets/IMG_20260517_104632.png              768K   duplicate of the root one
firestore.rules                                   2.4K   Firestore is not used
firebase-blueprint.json                           4.6K   AI Studio leftover
metadata.json                                      397B   AI Studio leftover
supabase-schema.sql                               9.3K   stale duplicate of sql/
supabase_schema.sql                               18K    stale duplicate (byte-identical)
supabase_posts_schema.sql                         2.7K   stale duplicate (byte-identical)
supabase_support_tickets_schema.sql               1.3K   stale duplicate (byte-identical)
grixchat_latest_db_updates.sql                    6.6K   stale AND divergent from sql/
src/features/hub/github/GithubZipHandler.tsx.txt    12K   a .txt backup
```

`task.md` (an old Google AI Studio prompt spec) and `IMPROVEMENT.md` (written
for a Firestore backend) were **moved**, not deleted:
→ `docs/legacy/task-ai-studio-prompt.md`, `docs/legacy/IMPROVEMENT-firestore-era.md`.

## Removed npm dependencies

Verified unreferenced in all live code (only appeared in `package.json`):

```
autoprefixer      — Tailwind 4 via @tailwindcss/vite needs no PostCSS step
clsx              — 103 packages removed in total
date-fns
groq-sdk          — VITE_GROQ_API_KEY was also dropped from .env.example
react-player
recharts          — was only used by features/analytics/
tailwind-merge
```

---

## Side effects worth knowing

Deleting the dead features also cleaned up the data layer:

| | Before | After |
|---|---|---|
| Tables queried by the app | 21 | **13** |
| Tables queried but **not defined in `sql/`** | **7** | **0** ✅ |
| RPCs called | 7 | **3** |
| RPCs called but **not defined in `sql/`** | **5** | **0** ✅ |

`reels`, `tube_videos`, `tube_live_chat`, `moments`, `likes`, `comments` and
`qna_questions` are no longer queried, so the schema-drift problem described in
[DATA_MODEL.md](./DATA_MODEL.md) is resolved.

**New consequence:** nothing in live code inserts into `notifications` any
more — every writer lived in the deleted `features/home/` components. The
notification screens now read a table the app never populates. Either add the
write path back or drop the screens.

Two smaller leftovers in surviving files:

- `NotificationsScreen.tsx:118` reads `notif.text`, but the schema column is
  `content`. Still wrong.
- `services/db/userProfileService.ts:192` reads `users.saved_posts`, which is
  not in the schema.
- `call_candidates` is defined in `sql/` but never queried — the live calling
  path signals over Broadcast instead.

---

## Reproducing the scan

The reachability script is not committed (it was a one-off audit tool), but the
procedure is:

1. Start from `src/main.tsx`, `server.ts`, `vite.config.ts`,
   `vitest.config.ts`, and all `*.test.ts(x)`.
2. Recursively resolve every `import` / `import()` / `require()` through the
   `@/` alias and extension-less specifiers.
3. Anything under `src/` not reached is dead.

`npm test` + `npm run lint` + `npm run build` are the regression gate.
