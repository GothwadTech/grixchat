import React, { createContext, useContext, useEffect, useState, useRef, useMemo } from 'react';
import { User, RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { UserProfile } from '../types';
import { storage, safeSessionStorage } from '../services/StorageService';
import { userProfileService } from '../services/db/userProfileService';
import { sessionService } from '../services/db/sessionService';
import { LocalDataCache } from '../services/LocalDataCache';
import { MultiAccountService } from '../services/MultiAccountService';

/**
 * How often the client re-asserts "I am online" while the tab is visible.
 * Presence is Realtime Presence; this only refreshes the DB fallback columns,
 * and each write re-broadcasts the whole `users` row to its subscribers.
 * 300 s was 60 s before the egress work — see docs/EGRESS_AUDIT.md.
 */
const PRESENCE_HEARTBEAT_MS = 300_000;

interface CustomUser extends User {
  uid: string;
}

interface AuthContextType {
  user: CustomUser | null;
  userData: UserProfile | null;
  loading: boolean;
  isAuthReady: boolean;
  refreshUserData: () => Promise<void>;
  followingIds: string[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<CustomUser | null>(() => {
    try {
      const cached = storage.getItem('grix_cached_user');
      const u = cached ? JSON.parse(cached) : null;
      if (u) {
        LocalDataCache.setCurrentUserId(u.id);
      }
      return u;
    } catch (_) { return null; }
  });

  const [userData, setUserData] = useState<UserProfile | null>(null);

  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [followingIds, setFollowingIds] = useState<string[]>([]);

  const profileChannelRef = useRef<RealtimeChannel | null>(null);
  const sessionRegisteredRef = useRef<boolean>(false);
  const userRef = useRef<CustomUser | null>(user);

  useEffect(() => {
    userRef.current = user;
    if (user) {
      LocalDataCache.setCurrentUserId(user.id);
    } else {
      LocalDataCache.setCurrentUserId(null);
    }
  }, [user]);

  const fetchProfileData = async (currentUserId: string, email: string, meta: any) => {
    const { profileData, following } = await userProfileService.fetchFullProfileData(currentUserId, email, meta);
    if (profileData) {
      setUserData(profileData);
      setFollowingIds(following);
      
      // Update multi-account storage with up-to-date details
      MultiAccountService.addOrUpdateAccount(
        currentUserId,
        email,
        profileData.username || '',
        profileData.fullName || '',
        profileData.photoURL || ''
      ).catch(console.error);
    }
  };

  const refreshUserData = async () => {
    if (user?.id) {
      await fetchProfileData(user.id, user.email || '', user.user_metadata);
    }
  };

  // 1. Auth Listener and Session Bootstrap
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setIsAuthReady(true);
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        const supabaseUser = session?.user ?? null;
        const currentUser = supabaseUser ? { ...supabaseUser, uid: supabaseUser.id } as CustomUser : null;

        if (supabaseUser && session) {
          MultiAccountService.updateSession(supabaseUser.id, {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          });
        }
        
        if (event === 'SIGNED_OUT') {
          const currentUserId = userRef.current?.id;
          if (currentUserId) {
            userProfileService.throttledSetStatus(currentUserId, false, true).catch(() => {});
          }
          // Securely wipe all message and chat histories on logout
          LocalDataCache.clearAll().catch((err) => {
            console.error('Failed to wipe local cache on SIGNED_OUT:', err);
          });
          setUserData(null);
          setUser(null);
          setLoading(false);
          setIsAuthReady(true);
        } else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || (event as string) === 'USER_UPDATED') {
          storage.removeItem('grix_adding_account');
          if (supabaseUser) {
            userProfileService.throttledSetStatus(supabaseUser.id, true, true).catch(() => {});
            // Fetch profile data in the background
            fetchProfileData(supabaseUser.id, supabaseUser.email || '', supabaseUser.user_metadata).catch(console.error);
          }
          setUser(currentUser);
          setLoading(false);
          setIsAuthReady(true);
        } else {
          if (supabaseUser) {
            fetchProfileData(supabaseUser.id, supabaseUser.email || '', supabaseUser.user_metadata).catch(console.error);
          }
          setUser(currentUser);
          setLoading(false);
          setIsAuthReady(true);
        }
      } catch (err) {
        console.error('onAuthStateChange execution error:', err);
        setLoading(false);
        setIsAuthReady(true);
      }
    });

    const initAuth = async () => {
      let resolved = false;
      const timeoutTimer = setTimeout(() => {
        if (!resolved) {
          console.warn('initAuth timed out. Forcing ready state.');
          setLoading(false);
          setIsAuthReady(true);
        }
      }, 4000);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const currentUser = session?.user ? { ...session.user, uid: session.user.id } as CustomUser : null;
        setUser(currentUser);
        if (currentUser) {
          // Fetch profile data with timeout race protection
          const fetchPromise = fetchProfileData(currentUser.id, currentUser.email || '', currentUser.user_metadata);
          await Promise.race([fetchPromise, new Promise((res) => setTimeout(res, 2500))]);
        } else {
          setUserData(null);
        }
      } catch (err) {
        console.error('Initial session fetch error:', err);
      } finally {
        resolved = true;
        clearTimeout(timeoutTimer);
        setLoading(false);
        setIsAuthReady(true);
      }
    };

    initAuth();
    return () => subscription.unsubscribe();
  }, []);

  // 2. Profile and Realtime Presence Subscriptions
  useEffect(() => {
    if (!user || !supabase) return;

    const currentUserId = user.id;
    let isSubscribed = true;

    const setupProfileAndPresence = async () => {
      try {
        if (profileChannelRef.current) supabase.removeChannel(profileChannelRef.current);

        // Fetch primary profile data updates
        fetchProfileData(currentUserId, user.email || '', user.user_metadata);

        // Setup realtime profile change listener
        const profileUniqueId = `profile-${currentUserId}-${Math.random().toString(36).substring(2, 7)}`;
        const profileChannel = supabase
          .channel(profileUniqueId)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `id=eq.${currentUserId}` }, () => {
            if (isSubscribed) fetchProfileData(currentUserId, user.email || '', user.user_metadata);
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'follows', filter: `follower_id=eq.${currentUserId}` }, () => {
            if (isSubscribed) fetchProfileData(currentUserId, user.email || '', user.user_metadata);
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'follows', filter: `following_id=eq.${currentUserId}` }, () => {
            if (isSubscribed) fetchProfileData(currentUserId, user.email || '', user.user_metadata);
          });
        
        profileChannel.subscribe();
        profileChannelRef.current = profileChannel;

        // Live presence is owned by PresenceService (`grix-presence`), which
        // knows who is online for real. The old `online-users` channel here
        // only ever watched *ourselves* and wrote `is_online` on join/leave,
        // which duplicated that work (and one extra websocket per client).
        // `users.is_online` / `last_seen` remain as the durable fallback,
        // written by the heartbeat below.
      } catch (err) {
        console.error('Presence setup error:', err);
      }
    };

    setupProfileAndPresence();

    return () => {
      isSubscribed = false;
      if (profileChannelRef.current) supabase.removeChannel(profileChannelRef.current);
    };
  }, [user?.id]);

  // 3. Heartbeat & Tab Visibility (Throttled write-prevention: Issue 2)
  useEffect(() => {
    if (!user?.id) return;
    let heartbeatInterval: any = null;

    const updateStatus = (online: boolean) => {
      userProfileService.throttledSetStatus(user.id, online);
    };

    // A background tab is still an open session: switching tabs must not flip
    // you offline (Telegram Web behaves the same way). Only an actual unload
    // does. Long background gaps are covered because the heartbeat below keeps
    // `last_seen` inside `PRESENCE_ONLINE_WINDOW_MS`.
    const handleUnload = () => updateStatus(false);

    updateStatus(true);
    heartbeatInterval = setInterval(() => updateStatus(true), PRESENCE_HEARTBEAT_MS);

    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [user?.id]);

  // Sync cache records
  useEffect(() => {
    if (user) {
      storage.setItem('grix_cached_user', JSON.stringify(user));
    } else {
      storage.removeItem('grix_cached_user');
    }
  }, [user]);

  // Sync Device Login Session Metadata
  useEffect(() => {
    if (!user || !userData || !isAuthReady) return;
    sessionService.registerActiveSession(user.id, userData.settings).catch(() => {});
  }, [userData?.id]);

  // Secure instant remote logouts
  useEffect(() => {
    if (!user || !userData || !isAuthReady || !supabase) return;

    const sessId = safeSessionStorage.getItem('grix_current_session_id');
    if (!sessId) return;

    const activeSessions = (userData.settings as any)?.active_sessions;
    if (Array.isArray(activeSessions)) {
      const stillRegistered = activeSessions.some((s: any) => s.id === sessId);
      if (stillRegistered) {
        sessionRegisteredRef.current = true;
      } else if (sessionRegisteredRef.current) {
        console.warn('Revocation detected remotely. Signing out.');
        supabase.auth.signOut().then(() => {
          safeSessionStorage.removeItem('grix_current_session_id');
          storage.removeItem('grix_cached_user');
          window.location.reload();
        });
      }
    }
  }, [(userData?.settings as any)?.active_sessions]);

  // Bootstrap failsafe timeout
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isAuthReady) {
        setLoading(false);
        setIsAuthReady(true);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [isAuthReady]);

  const authContextValue = useMemo(() => ({ 
    user, userData, loading, isAuthReady, refreshUserData, followingIds 
  }), [user, userData, loading, isAuthReady, followingIds]);

  return <AuthContext.Provider value={authContextValue}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
