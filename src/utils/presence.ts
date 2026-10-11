import { formatDetailedLastSeen } from './lastSeenFormatter';

/**
 * Presence has two layers, and this module is the single place that decides
 * what "online" means for both of them.
 *
 *  1. **Realtime Presence** (`src/services/PresenceService.ts`) — the live
 *     signal. Every open client joins one shared channel and is listed there
 *     while its websocket is alive. Zero database bytes, instant join/leave,
 *     and it survives a killed browser/phone because the socket dies with it.
 *
 *  2. **`users.is_online` / `users.last_seen`** — the durable fallback. It is
 *     written by `AuthProvider`'s heartbeat (every 5 min, or immediately when
 *     the status flips) so that a peer who opens a chat *before* the presence
 *     roster has synced still sees the right thing.
 *
 * The window below must stay comfortably larger than the heartbeat interval,
 * otherwise a user who is perfectly online flickers offline between two
 * heartbeats. It used to be 150 s against a 300 s heartbeat — a user was shown
 * offline for 90 seconds out of every 240.
 */
export const PRESENCE_ONLINE_WINDOW_MS = 360_000;

/**
 * Is this user online right now?
 *
 * @param isOnline      the `users.is_online` column (the fallback)
 * @param lastSeenStr   the `users.last_seen` column (the fallback)
 * @param livePresence  `true` when the Realtime Presence roster lists the user.
 *                      When omitted the check degrades to the DB fallback,
 *                      which is what offline screenshots/caches get.
 */
export function isUserOnline(
  isOnline: boolean | undefined | null,
  lastSeenStr: string | undefined | null,
  livePresence?: boolean | null,
): boolean {
  if (livePresence === true) return true;
  if (!isOnline) return false;
  if (!lastSeenStr) return false;

  const lastSeenDate = new Date(lastSeenStr);
  if (isNaN(lastSeenDate.getTime())) return false;

  const diffMs = Date.now() - lastSeenDate.getTime();
  // A last_seen in the future is clock skew, not a proof of presence.
  return diffMs >= 0 && diffMs < PRESENCE_ONLINE_WINDOW_MS;
}

/**
 * Combines the live roster answer with the durable fallback:
 *   live === true  → online now
 *   live === false → the roster is authoritative and they are not in it
 *   live === null  → roster not ready, trust `is_online` + `last_seen`
 */
export function resolveOnline(
  live: boolean | null | undefined,
  isOnline: boolean | undefined | null,
  lastSeenStr: string | undefined | null,
): boolean {
  if (live !== null && live !== undefined) return live;
  return isUserOnline(isOnline, lastSeenStr);
}

/**
 * Telegram-style presence label: "Online" while the user is here, otherwise a
 * human "last seen …" string.
 */
export function formatLastSeen(
  isOnline: boolean | undefined | null,
  lastSeenStr: string | undefined | null,
  livePresence?: boolean | null,
): string {
  if (isUserOnline(isOnline, lastSeenStr, livePresence)) return 'Online';
  if (!lastSeenStr) return 'Offline';

  const formatted = formatDetailedLastSeen(lastSeenStr);
  if (formatted === 'OnlineNow') return 'Online';
  return formatted;
}
