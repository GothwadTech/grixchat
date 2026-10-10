# [LEGACY] Infrastructure Improvement Roadmap — Firestore era

> ⚠️ **This document is historical and does not describe the current app.**
>
> It was written for a **Firestore + Realtime Database** backend (`getDoc`,
> sub-collections, Cloud Functions, RTDB presence). GrixChat is now **100%
> Supabase** — see [`../DATA_MODEL.md`](../DATA_MODEL.md) and
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md).
>
> Kept for context only. **Do not follow the advice below.** The current
> prioritised list is [`../KNOWN_ISSUES.md`](../KNOWN_ISSUES.md).
>
> Two ideas here did survive the migration and are worth keeping in mind:
> denormalising author name/avatar onto posts and messages (to avoid a profile
> fetch per row), and moving follower lists out of a single array column.

---

# Infrastructure Improvement Roadmap - GrixChat

This document outlines the necessary changes to reduce Firebase costs (Reads/Writes) and ensuring GrixChat is future-proof.

## 🛠 Short-Term Optimizations (Cost Reduction)

### 1. Fix the Home Feed "Following" Logic
*   **Current:** Fetch 20 global posts -> Filter in React.
*   **Improvement:** Use the `where("userId", "in", followingArray)` query.
*   **Constraint:** Firestore supports `in` with up to 30 IDs. For users following >30 people, implement a background sync or fetch blocks.
*   **Impact:** Reduces reads by **80-90%** for casual users.

### 2. Throttled Suggested Users
*   **Current:** `fetchOtherUsers` inside `onSnapshot` of conversations.
*   **Improvement:** Move suggested users to a separate `useEffect` that only runs **once on mount** or when a specific "Refresh" button is clicked.
*   **Impact:** Eliminates redundant reads triggered by incoming chat messages.

### 3. Presence Optimization
*   **Current:** RTDB -> Firestore Sync.
*   **Improvement:** Only use RTDB for presence indicators. Components should listen to `/status/{uid}` in RTDB directly using `usePresence` hook instead of reading the `users` Firestore document for the `isOnline` field.
*   **Impact:** Reduces Firestore Writes and subsequent Reads dramatically.

### 4. Data Denormalization (The Big One)
*   **Current:** Fetch `post` -> Fetch `author` doc for name/avatar.
*   **Improvement:** When creating a post or a message, include the `senderName` and `senderAvatar` directly in the document.
*   **Impact:** Reduces `getDoc` calls for user profiles to nearly **zero** during feed scrolling.

---

## 📈 Long-Term Scalability (Future-Proofing)

### 1. Escape the "Array Limit" for Social
*   **Current:** Followers in a single array.
*   **Risk:** 1MB document limit.
*   **Solution:** Move Followers/Following to a sub-collection (e.g., `users/{uid}/followers/{followerUid}`). This allows for millions of followers without hitting document limits.

### 2. Partitioned Messaging
*   **Current:** All messages in one `messages` collection with `chatId` index.
*   **Solution:** For extremely active groups, use a sub-collection `conversations/{chatId}/messages`. This keeps the index small and prevents global collection pollution.

### 3. Server-Side Aggregation (Cloud Functions)
*   **Issue:** Client calculates `unreadCount` and `likes` via increments.
*   **Improvement:** Use Cloud Functions to handle "Follow/Unfollow" atomic transactions and "Cleanup" of old messages/stories. This reduces client-side logic and ensures data integrity.

---

## 🚀 Priority Action Items
1.  **Stop "Suggest Users" from re-fetching** on every chat message.
2.  **Add a limit to following-based queries** in HomeTab.
3.  **Implement local storage persistence** that lasts longer than 1 hour for profile images/names.
