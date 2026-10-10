# Architecture

How GrixChat is put together, and — just as important — which parts of it are
actually reachable.

---

## Runtime shape

```
                      ┌─────────────────────────────────────┐
                      │  React 19 SPA (Vite 6, Tailwind 4)  │
                      └─────────────────────────────────────┘
                            │                    │
              Supabase JS   │                    │  fetch('/api/…')
                            ▼                    ▼
              ┌──────────────────┐    ┌──────────────────────────┐
              │     Supabase     │    │  Express (server.ts)     │
              │  Postgres        │    │  /api/grix-ai    → Gemini│
              │  Realtime (WS)   │    │  /api/send-notif → FCM   │
              │  Auth            │    │  /api/livekit-token      │
              │  Storage         │    │  /api/upload-file→catbox │
              └──────────────────┘    │  /api/github/*   → proxy │
                                      └──────────────────────────┘
```

The Express server exists only for things a browser cannot do: holding secret
API keys, OAuth code exchange, and FCM's service-account auth. **It holds no
application data.** All state lives in Supabase.

---

## Boot sequence

`src/main.tsx`

```
ErrorBoundary
└── BrowserRouter
    └── AppProviders
        ├── ThemeProvider      (contexts/ThemeContext)
        ├── SearchProvider     (contexts/SearchContext)
        ├── AuthProvider       (providers/AuthProvider)  ← subscribes to Supabase auth
        └── CallProvider       (providers/CallProvider)  ← global WebRTC, survives navigation
            └── App            (App.tsx — every route)
```

`App.tsx` (582 lines) holds **all 57 routes**. Structure:

```
<Route element={<MainLayout />}>          ← shell: TopNav + TabBottom + DesktopSidebar
  /            → DesktopWelcome | ChatsTab
  /chats       → ChatsTab
  /stories /search /calls /profile /notifications …
  <Route element={<ChatLayout />}>        ← chat sub-shell
    /chat/grix-ai  /chat/:id  /chat/:id/settings  /group-settings/:id
  </Route>
</Route>
/login /signup /forgot-password /verify-email /privacy-policy /terms
```

Bottom navigation (`components/layout/TabBottom.tsx:204-208`) exposes exactly
five tabs: **Chats · Stories · Search · Calls · Profile**.

~40 screens are `React.lazy`-loaded from `App.tsx`.

---

## Directory map

```
src/
├── App.tsx                    581 lines — all 57 routes
├── main.tsx                   bootstrap
├── index.css                  Tailwind 4 theme + CSS custom properties
│
├── config/appConfig.ts        logo URL, app constants
├── lib/
│   ├── supabase.ts            THE client. getSupabase() → null if env missing
│   └── firebase.ts            FCM only. Graceful null when unconfigured
│
├── providers/                 global React contexts
│   ├── AuthProvider.tsx       session, profile hydration, presence
│   ├── CallProvider.tsx       987 lines — WebRTC signalling + media
│   └── AppProviders.tsx       the nesting order above
│
├── contexts/                  ThemeContext, SearchContext, NavContext, LayoutContext
│
├── services/                  global singletons (the layer features must share)
│   ├── ChatService.ts         send / fetch messages, get-or-create DM
│   ├── LocalDataCache.ts      in-memory cache in front of IndexedDB
│   ├── IndexedDBService.ts    durable offline storage
│   ├── StorageService.ts      localStorage wrapper
│   ├── SupabaseStorageService.ts   bucket uploads
│   ├── LockService.ts         PIN / app lock
│   ├── MultiAccountService.ts account switching
│   ├── CacheService.ts, ImageService.ts, AIService.ts, ConsoleLoggerService.ts
│   └── db/                    sessionService, transactionQueueService, userProfileService
│
├── components/                cross-feature UI
│   ├── layout/                MainLayout, TopNav, TabBottom, DesktopSidebar, …
│   ├── chat-ui/               shared chat modals & menus
│   ├── common/                Avatar, CommonSearchBar
│   └── incoming-call/  NotificationHandler, SplashScreen, PWAInstallPrompt, TermuxConsoleButton
│
├── features/                  13 domains, all reachable — see below
│
├── utils/          pure functions: dateUtils, scheduleUtils, presence, …
└── types/index.ts  shared interfaces (UserProfile, ChatMessage, ChatRoom)

dev/
├── mock/           the mock Supabase — see docs/TESTING.md
└── test/setup.ts   jsdom polyfills + per-test DB reset

sql/                THE authoritative schema (01…08 + master instructions)
docs/               you are here
```

---

## The chat data flow

The most important path in the app:

```
ChatScreen
  └── useConversations()          → conversation_participants → conversations
  └── useChatMessages()           → messages (+ sender join, + reply_to join)
  └── chatService.sendMessage()   → insert message → update conversation preview
  └── useTypingStatus()           → channel(`typing:${chatId}`).send()   [broadcast, no DB]
  └── useChatSync()               → channel.on('postgres_changes', filter:…)
```

Key queries:

```ts
// list of conversations for the current user
.from('conversation_participants').select('conversation_id').eq('user_id', myId)
.from('conversations')
  .select('*, participants:conversation_participants ( user:users (*) )')
  .in('id', convIds)
  .order('updated_at', {ascending: false})
  .limit(limit + 1)

// messages for one conversation
.from('messages')
  .select('*, sender:users (id, username, full_name, photo_url),
              reply_to:reply_to (id, text, sender_id)')
  .eq('conversation_id', conversationId)
  .order('created_at', {ascending: false})
  .limit(50)
```

`useConversations` implements **delta sync**: it caches the max `updated_at`
locally and only re-fetches conversations newer than that, falling back to a
full sync on error. That is the main egress optimisation in the app.

---

## Reachability

**Every file under `src/` is reachable from an entry point.** Verified by
building the import graph from `src/main.tsx`, `server.ts`, `vite.config.ts`,
`vitest.config.ts` and the test files, then resolving every static and dynamic
import: **189/189 reachable, 0 dead.**

146 files (18,826 lines) were removed to get here — Reels, Tube, Posts,
Moments, Q&A, Vibe, Analytics, Camera, an in-app browser, Ludo, a web IDE, and
every duplicate screen. The full record with per-file line counts is in
**[DEAD_CODE.md](./DEAD_CODE.md)**.

**Do not reintroduce unreachable files.** If you add a screen, wire its route
in the same change. The scan procedure is documented at
[DEAD_CODE.md → Reproducing the scan](./DEAD_CODE.md#reproducing-the-scan).

### The 13 feature domains

```
chat/            the core — ChatScreen, ChatsTab, GroupsTab, hooks/, services/
call/            CallsTab, CallScreen, components/, services/CallSyncService
profile/         ProfileTab, EditProfileScreen, UserProfileScreen, FollowList…
settings/        15 settings screens + sheets
stories/         StoriesTab, StoryCreationScreen, StoryWatcherScreen
search/          SearchTab
auth/            Login, Signup, VerifyEmail
grixai/          GrixAIScreen, GrixAIProfile + components
github/          GithubScreen + components (repo browser / zip upload)
notifications/   NotificationsScreen, LikeNotificationsScreen
console/         DeveloperConsole + Console* panels
legal/           PrivacyPolicyScreen, TermsAndConditionsScreen
lock/            AppLock, GlobalLock, SetupLock, VerifyLock
```

### Routes that only redirect

```tsx
/forgot-password  → /login      // LoginScreen has its own isForgotPassword mode
/search-user      → /profile
/channels         → /search
/updates          → /search
```


---

## Design system

- **Fonts:** Space Grotesk (display), Inter (body), JetBrains Mono (code)
- **Theme:** CSS custom properties — `--bg-main`, `--bg-card`, `--text-primary`,
  `--text-secondary`, `--border-color`, `--primary`, `--header-text`
- **Motion:** `motion/react` for staggered enter/exit and sheet transitions
- **Mobile:** `h-[100dvh]`, `pb-[safe]`, 44 px minimum touch targets
- **Message ticks:** ✓ sent · ✓✓ delivered · ✓✓ (blue) read

---

## Build & deploy

| Target | Entry | Status |
|---|---|---|
| `npm run dev` | `server.ts` → Vite middleware on :3000 | ✅ works |
| `npm run build` | `vite build` + esbuild → `dist/server.cjs` | ✅ works |
| Vercel | `vercel.json` → `server.ts` | ✅ fixed — the duplicate server was deleted |
| GitHub Pages | `.github/workflows/deploy.yml` | ⚠️ needs `VITE_BASE_URL=/grixchat/` |
| Android TWA/WebView | external wrapper, not in this repo | — |

Details and fixes: **[DEV_SETUP.md](./DEV_SETUP.md#deploy-targets)**.
