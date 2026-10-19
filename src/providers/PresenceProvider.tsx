import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import {PresenceService} from '../services/PresenceService';
import {useAuth} from './AuthProvider.tsx';

/**
 * Wires the live presence roster to the signed-in session and exposes it to the
 * UI. Must sit **inside** `AuthProvider` (it follows `user.id`).
 */
export const PresenceProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const {user} = useAuth();

  useEffect(() => {
    PresenceService.start(user?.id);
    if (!user?.id) PresenceService.stop();
    // Signing out must remove us from the roster immediately, not on reload.
    return () => {
      if (!user?.id) PresenceService.stop();
    };
  }, [user?.id]);

  return <>{children}</>;
};

/**
 * The raw roster. `version` changes whenever somebody joins or leaves; the
 * returned `ids` array is derived from it so it stays stable across renders.
 */
export function usePresenceRoster() {
  const version = useSyncExternalStore(
    PresenceService.subscribe,
    PresenceService.getSnapshot,
    PresenceService.getSnapshot,
  );

  // `version` is a change trigger: recompute the set whenever the roster changes.
  const ids = useMemo(() => {
    void version;
    return new Set(PresenceService.onlineIds());
  }, [version]);
  return {ids, version};
}

/**
 * Live online state for one user, in the shape `isUserOnline()` expects:
 *   `true`  — they are in the roster right now,
 *   `false` — the roster is authoritative and they are not in it,
 *   `null`  — the roster has not synced yet → use `is_online`/`last_seen`.
 */
export function useIsUserOnline(userId: string | null | undefined): boolean | null {
  const version = useSyncExternalStore(
    PresenceService.subscribe,
    PresenceService.getSnapshot,
    PresenceService.getSnapshot,
  );
  return useMemo(() => {
    void version; // trigger: re-evaluate when the roster changes
    return PresenceService.presenceOf(userId);
  }, [version, userId]);
}

/**
 * A stable lookup for lists that render many avatars: call it once per screen
 * and ask it about each row.
 *
 *   true  → in the live roster right now
 *   false → the roster is synced and they are not (authoritative)
 *   null  → roster not ready yet → keep whatever the cached row said
 *
 * `useIsUserOnline` cannot be called inside `.map()`, so this is how the
 * search / requests / forward lists stay in sync with the roster.
 */
export function useLivePresence() {
  const version = useSyncExternalStore(
    PresenceService.subscribe,
    PresenceService.getSnapshot,
    PresenceService.getSnapshot,
  );

  return useMemo(() => {
    // `version` is the identity of the roster snapshot — recompute per change.
    void version;
    return (userId: string | null | undefined): boolean | null =>
      PresenceService.presenceOf(userId);
  }, [version]);
}
