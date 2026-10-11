import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../providers/AuthProvider.tsx';
import { LocalDataCache } from '../../../services/LocalDataCache';
import { isUserOnline } from '../../../utils/presence';

// ─────────────────────────────────────────────────────────────────────────────
// Egress guards
//
// A conversation-list refresh is 6 round-trips and ~25–130 KB (measured, see
// docs/EGRESS_AUDIT.md). It used to run on EVERY realtime event — one per
// message and one per row of every read receipt — which is what filled the
// Supabase egress quota. It now runs on mount, on focus and on *structural*
// changes only; message traffic patches the list in place from the realtime
// payload, with no network call at all.
// ─────────────────────────────────────────────────────────────────────────────

/** Follows only change when someone follows/unfollows; cache them. */
const FOLLOWS_TTL_MS = 5 * 60 * 1000;
/** Coalesce bursts of structural events (new chat, participant added) into one refresh. */
const STRUCTURAL_DEBOUNCE_MS = 1200;
/** `conversation_id=in.(…)` filter length cap — beyond this, rely on focus refreshes. */
const REALTIME_IN_FILTER_LIMIT = 60;

/**
 * Does `conversation_participants.last_read_at` exist yet?
 * `null` = untested. Until sql/02_functions_realtime_storage.sql is applied we fall
 * back to the legacy `messages.is_read` scan, so the app works either way.
 */
let participantsSupportReadMarker: boolean | null = null;

const followsCacheKey = (myId: string) => `follows_v1_${myId}`;

/**
 * The conversation-list query.
 *
 * Exported so `src/__tests__/egressBudget.test.ts` can measure exactly what
 * ships over the wire. Rules this string encodes (docs/EGRESS_AUDIT.md):
 *   - never `users(*)` — the list renders six columns, not settings/lock/tokens
 *   - never fetch message rows — `conversations.last_message*` is authoritative
 *   - one embedded select = one round trip
 */
export const CONVERSATION_LIST_SELECT = `
  conversation_id,
  last_read_at,
  conversation:conversations (
    id, type, name, photo_url, last_message, last_message_at, updated_at, created_at,
    participants:conversation_participants (
      user_id, last_read_at,
      user:users (id, username, full_name, photo_url, is_online, last_seen)
    )
  )
`;

async function getMutualFriends(myId: string): Promise<Set<string>> {
  const key = followsCacheKey(myId);
  const cached = LocalDataCache.get<{ at: number; rows: any[] }>(key);
  if (cached && cached.rows && Date.now() - (cached.at || 0) < FOLLOWS_TTL_MS) {
    return buildMutualSet(cached.rows, myId);
  }
  if (!supabase) return new Set();
  const { data } = await supabase
    .from('follows')
    .select('follower_id, following_id')
    .or(`follower_id.eq.${myId},following_id.eq.${myId}`);
  LocalDataCache.set(key, { at: Date.now(), rows: data || [] });
  return buildMutualSet(data || [], myId);
}

function invalidateFollows(myId: string) {
  LocalDataCache.set(followsCacheKey(myId), { at: 0, rows: [] });
}

/** The chat list shows a one-line preview — strip the forward markers. */
function cleanPreview(text: string): string {
  if (typeof text !== 'string') return '';
  if (text.startsWith('\u200B[FWD_MANY]\u200B')) {
    return '↪ Forwarded many times: ' + text.replace('\u200B[FWD_MANY]\u200B', '');
  }
  if (text.startsWith('\u200B[FWD]\u200B')) {
    return '↪ Forwarded: ' + text.replace('\u200B[FWD]\u200B', '');
  }
  return text;
}

function buildMutualSet(rows: any[], myId: string): Set<string> {
  const iFollow = new Set<string>();
  const followsMe = new Set<string>();
  (rows || []).forEach((row: any) => {
    if (row.follower_id === myId) iFollow.add(row.following_id);
    if (row.following_id === myId) followsMe.add(row.follower_id);
  });
  const mutual = new Set<string>();
  iFollow.forEach((id) => { if (followsMe.has(id)) mutual.add(id); });
  return mutual;
}

export const useConversations = (activeFilter: string) => {
  const { user, isAuthReady, userData } = useAuth();
  
  // Use cached data instantly if it exists to prevent loader flickering
  const [conversations, setConversations] = useState<any[]>(() => {
    if (user?.id) {
      const cached = LocalDataCache.getConversations(user.id);
      if (cached && Array.isArray(cached)) {
        return cached;
      }
    }
    return [];
  });
  
  const [otherUsers, setOtherUsers] = useState<any[]>([]);
  
  // If we already have cached conversations, we don't need a full-screen loading spinner
  const [loading, setLoading] = useState(() => {
    if (user?.id) {
      const cached = LocalDataCache.getConversations(user.id);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        return false;
      }
    }
    return true;
  });

  const [limit, setLimit] = useState(15);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isPaginating, setIsPaginating] = useState(false);

  const chatChannelsRef = useRef<any[]>([]);
  const subscribedIdsRef = useRef<string[]>([]);

  /** Keeps a synchronous copy of the list so realtime patches never race React state. */
  const listRef = useRef<any[]>(conversations);
  useEffect(() => { listRef.current = conversations; }, [conversations]);

  /** Only one refresh may be in flight; bursts collapse into it. */
  const inFlightRef = useRef(false);
  const structuralTimerRef = useRef<any>(null);
  const refreshRef = useRef<(() => void) | null>(null);

  const formatTime = useCallback((date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    return date.toLocaleDateString();
  }, []);

  const fetchConversations = useCallback(async () => {
    if (!user || activeFilter === 'Calls' || !supabase || !isAuthReady) return;
    if (inFlightRef.current) return; // coalesce bursts into one request
    inFlightRef.current = true;

    const myId = user.id;
    const cached = LocalDataCache.getConversations(myId) || [];
    if (cached.length === 0) setLoading(true);

    const SELECT_MODERN = CONVERSATION_LIST_SELECT;
    const SELECT_LEGACY = `
      conversation_id,
      conversation:conversations (
        id, type, name, photo_url, last_message, last_message_at, updated_at, created_at,
        participants:conversation_participants (
          user_id,
          user:users (id, username, full_name, photo_url, is_online, last_seen)
        )
      )
    `;

    try {
      // ── 1. ONE round trip for the whole list ───────────────────────────────
      // `users(*)` used to bring 0.8 KB per participant (settings, the passcode
      // hash, FCM tokens); the list renders six columns.
      let rows: any[] | null = null;
      let haveReadMarker = participantsSupportReadMarker !== false;

      if (participantsSupportReadMarker !== false) {
        const { data, error } = await supabase
          .from('conversation_participants')
          .select(SELECT_MODERN)
          .eq('user_id', myId);

        if (!error) {
          rows = data as any[];
          participantsSupportReadMarker = true;
          haveReadMarker = true;
        } else {
          // Column not there yet (sql/02_functions_realtime_storage.sql not applied).
          participantsSupportReadMarker = false;
          haveReadMarker = false;
        }
      }

      if (rows === null) {
        const { data, error } = await supabase
          .from('conversation_participants')
          .select(SELECT_LEGACY)
          .eq('user_id', myId);
        if (error) {
          console.error('Error fetching conversation list:', error);
          return;
        }
        rows = data as any[];
      }

      const queryData = (rows || [])
        .filter((r: any) => r && r.conversation)
        .map((r: any) => ({ participation: r, conversation: r.conversation }));

      if (queryData.length === 0) {
        LocalDataCache.saveConversations(myId, []);
        setConversations([]);
        setHasMore(false);
        return;
      }

      const conversationIds = queryData.map((item: any) => item.conversation.id);

      // ── 2. Mutual friends — cached for 5 minutes ───────────────────────────
      const mutualFriendsSet = await getMutualFriends(myId);

      // ── 3. Unread — a comparison, not a per-message scan ───────────────────
      const unreadMap: Record<string, number> = {};

      if (haveReadMarker) {
        queryData.forEach(({ participation, conversation }: any) => {
          const seenAt = participation?.last_read_at;
          const lastAt = conversation.last_message_at || conversation.updated_at || conversation.created_at;
          if (!lastAt) return;
          if (seenAt && new Date(lastAt) <= new Date(seenAt)) return;

          // Exact count only when the messages are already on the device.
          const cachedMsgs = LocalDataCache.getMessages(conversation.id) as any[] | null;
          if (cachedMsgs && cachedMsgs.length > 0) {
            const n = cachedMsgs.filter((m: any) =>
              m && m.sender_id !== myId && (!seenAt || new Date(m.created_at) > new Date(seenAt))
            ).length;
            if (n > 0) unreadMap[conversation.id] = n;
          } else {
            unreadMap[conversation.id] = 1;
          }
        });
      } else if (conversationIds.length > 0) {
        // Legacy path: one row per unread message. Capped — this query grows
        // with the unread backlog, which is exactly what the read marker fixes.
        const { data: res } = await supabase
          .from('messages')
          .select('conversation_id')
          .eq('is_read', false)
          .neq('sender_id', myId)
          .in('conversation_id', conversationIds)
          .limit(500);
        (res || []).forEach((m: any) => {
          unreadMap[m.conversation_id] = (unreadMap[m.conversation_id] || 0) + 1;
        });
      }

      // ── 4. Per-chat nickname/avatar overrides ──────────────────────────────
      let settingsMap: Record<string, { nickname?: string; customPhotoUrl?: string }> = {};
      try {
        const { data: cSettings } = await supabase
          .from('chat_settings')
          .select('receiver_id, nickname, custom_photo_url')
          .eq('user_id', myId);
        (cSettings || []).forEach((s: any) => {
          if (s.receiver_id) {
            settingsMap[s.receiver_id] = {
              nickname: s.nickname || undefined,
              customPhotoUrl: s.custom_photo_url || undefined,
            };
          }
        });
      } catch (settingsError) {
        console.warn('Error fetching all chat_settings:', settingsError);
      }

      // ── 5. Shape the list. `last_message*` is maintained by the writer (and
      //      by a trigger once sql/09 is applied) — no message rows are fetched
      //      just to fill a one-line preview.
      const rawList = queryData
        .map((item: any) => {
          const conv = item.conversation;
          if (!conv) return null;
          const isGroup = conv.type === 'group';
          const otherParticipants = (conv.participants || []).filter((p: any) => p?.user?.id !== myId);
          const firstOther = otherParticipants[0]?.user;

          if (!isGroup && !firstOther) return null;

          // CRITICAL: direct messaging is only allowed and shown for mutual GrixChat Friends
          if (!isGroup && firstOther && !mutualFriendsSet.has(firstOther.id)) {
            return null;
          }

          const unreadCount = unreadMap[conv.id] || 0;

          let lastMsgVal = conv.last_message || 'New Conversation';
          let lastMsgAtVal = conv.last_message_at || conv.updated_at || conv.created_at;
          let lastMsgSenderId: string | undefined;

          // Ticks for the list row come from messages already cached on device.
          const cachedMsgs = LocalDataCache.getMessages(conv.id) as any[] | null;
          if (cachedMsgs && cachedMsgs.length > 0) {
            const newest = cachedMsgs[cachedMsgs.length - 1];
            if (newest && (!lastMsgAtVal || new Date(newest.created_at) >= new Date(lastMsgAtVal))) {
              lastMsgSenderId = newest.sender_id;
            }
          }

          if (typeof lastMsgVal === 'string') {
            if (lastMsgVal.startsWith('\u200B[FWD_MANY]\u200B')) {
              lastMsgVal = '↪ Forwarded many times: ' + lastMsgVal.replace('\u200B[FWD_MANY]\u200B', '');
            } else if (lastMsgVal.startsWith('\u200B[FWD]\u200B')) {
              lastMsgVal = '↪ Forwarded: ' + lastMsgVal.replace('\u200B[FWD]\u200B', '');
            }
          }

          let lastMsgStatusVal: 'Sent' | 'Received' | undefined = undefined;
          if (lastMsgSenderId && lastMsgVal !== 'New Conversation') {
            lastMsgStatusVal = lastMsgSenderId === myId ? 'Sent' : 'Received';
          }

          const customSetts = isGroup ? null : settingsMap[firstOther.id];
          const dynamicName = customSetts?.nickname || (isGroup ? (conv.name || 'Group') : (firstOther.full_name || firstOther.username || 'Unknown'));
          const dynamicAvatar = isGroup
            ? (conv.photo_url || `https://cdn-icons-png.flaticon.com/512/166/166258.png`)
            : (customSetts?.customPhotoUrl || firstOther?.photo_url || `https://cdn-icons-png.flaticon.com/512/149/149071.png`);

          return {
            id: conv.id,
            type: conv.type,
            otherUserId: isGroup ? conv.id : firstOther.id,
            user: dynamicName,
            username: isGroup ? 'group' : firstOther?.username,
            fullName: dynamicName,
            lastMsg: lastMsgVal,
            lastMsgAt: lastMsgAtVal,
            time: formatTime(new Date(lastMsgAtVal)),
            avatar: dynamicAvatar,
            unread: unreadCount > 0,
            unreadCount: unreadCount,
            isOnline: isGroup ? false : isUserOnline(firstOther?.is_online, firstOther?.last_seen),
            lastSeen: isGroup ? null : (firstOther?.last_seen || null),
            lastMsgStatus: lastMsgStatusVal
          };
        })
        .filter(Boolean);

      // De-duplicate direct conversations: Keep only the one with the most recent activity / actual messages
      const seenDict: Record<string, any> = {};
      (rawList as any[]).forEach((conv: any) => {
        if (conv.type !== 'direct') return;
        const existing = seenDict[conv.otherUserId];
        if (!existing) {
          seenDict[conv.otherUserId] = conv;
        } else {
          const currentHasMsg = conv.lastMsg && conv.lastMsg !== 'New Conversation';
          const existingHasMsg = existing.lastMsg && existing.lastMsg !== 'New Conversation';

          if (currentHasMsg && !existingHasMsg) {
            seenDict[conv.otherUserId] = conv;
          } else if (!currentHasMsg && existingHasMsg) {
            // keep existing, do nothing
          } else {
            if (new Date(conv.lastMsgAt).getTime() > new Date(existing.lastMsgAt).getTime()) {
              seenDict[conv.otherUserId] = conv;
            }
          }
        }
      });

      const formattedList = (rawList as any[])
        .filter((conv: any) => {
          if (conv.type !== 'direct') return true;
          return seenDict[conv.otherUserId]?.id === conv.id;
        })
        .sort((a, b) => new Date(b.lastMsgAt).getTime() - new Date(a.lastMsgAt).getTime());

      LocalDataCache.saveConversations(myId, formattedList);
      listRef.current = formattedList;
      setConversations(formattedList);
      setHasMore(false);
    } catch (err) {
      console.error('Crash in fetchConversations execution details:', err);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      setLoadingMore(false);
      setIsPaginating(false);
    }
  }, [user, activeFilter, isAuthReady, formatTime]);

  useEffect(() => { refreshRef.current = fetchConversations; }, [fetchConversations]);

  /** Debounced structural refresh: new chats, new participants, follow changes. */
  const scheduleStructuralRefresh = useCallback(() => {
    if (structuralTimerRef.current) return;
    structuralTimerRef.current = setTimeout(() => {
      structuralTimerRef.current = null;
      refreshRef.current?.();
    }, STRUCTURAL_DEBOUNCE_MS);
  }, []);

  /**
   * Realtime message → patch the list row in place.
   * This is the whole egress fix: the old code called `fetchConversations()`
   * here (6 round-trips, 25–130 KB) for every message and every read receipt.
   */
  const patchConversationFromMessage = useCallback((row: any) => {
    if (!user?.id || !row?.conversation_id) return;
    const myId = user.id;
    const current = listRef.current;
    const idx = current.findIndex((c) => c.id === row.conversation_id);
    if (idx === -1) {
      scheduleStructuralRefresh(); // a chat we do not know about yet
      return;
    }

    const isMine = row.sender_id === myId;
    const text = cleanPreview(row.text || (row.media_type ? `Sent a ${row.media_type}` : 'Sent a file'));
    const at = row.created_at || new Date().toISOString();
    const prev = current[idx];
    const updated = {
      ...prev,
      lastMsg: text,
      lastMsgAt: at,
      time: formatTime(new Date(at)),
      lastMsgStatus: isMine ? 'Sent' : 'Received',
      unread: isMine ? prev.unread : true,
      unreadCount: isMine ? prev.unreadCount : (prev.unreadCount || 0) + 1,
    };
    const next = [updated, ...current.filter((_, i) => i !== idx)];
    listRef.current = next;
    setConversations(next);
    LocalDataCache.saveConversations(myId, next);
  }, [user?.id, formatTime, scheduleStructuralRefresh]);

  /** Realtime `conversations` UPDATE → same idea, from the denormalized columns. */
  const patchConversationFromRow = useCallback((row: any) => {
    if (!user?.id || !row?.id) return;
    const current = listRef.current;
    const idx = current.findIndex((c) => c.id === row.id);
    if (idx === -1) return;
    const prev = current[idx];
    const at = row.last_message_at || row.updated_at || prev.lastMsgAt;
    const updated = {
      ...prev,
      lastMsg: row.last_message ? cleanPreview(row.last_message) : prev.lastMsg,
      lastMsgAt: at,
      time: formatTime(new Date(at)),
    };
    const next = [updated, ...current.filter((_, i) => i !== idx)];
    listRef.current = next;
    setConversations(next);
    LocalDataCache.saveConversations(user.id, next);
  }, [user?.id, formatTime]);

  useEffect(() => {
    if (!user || activeFilter === 'Calls' || !supabase || !isAuthReady) return;

    // Local cache first: instant, zero egress.
    const unsubscribeCache = LocalDataCache.subscribe('conversations', (updatedList) => {
      if (updatedList && Array.isArray(updatedList)) {
        listRef.current = updatedList;
        setConversations(updatedList);
      } else {
        scheduleStructuralRefresh();
      }
    });

    refreshRef.current?.();

    // Structural events only — these mean the list itself changed shape.
    // (A message arriving is NOT one of them any more: it patches in place.)
    const channelId = `conversations-realtime-${user.id}`;
    const channel = supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${user.id}` }, () => {
        scheduleStructuralRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follows', filter: `follower_id=eq.${user.id}` }, () => {
        invalidateFollows(user.id);
        scheduleStructuralRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follows', filter: `following_id=eq.${user.id}` }, () => {
        invalidateFollows(user.id);
        scheduleStructuralRefresh();
      })
      .subscribe();

    // Coming back to the tab is the natural moment to reconcile.
    const handleFocus = () => scheduleStructuralRefresh();
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      supabase.removeChannel(channel);
      unsubscribeCache();
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
      if (structuralTimerRef.current) {
        clearTimeout(structuralTimerRef.current);
        structuralTimerRef.current = null;
      }
    };
  }, [user?.id, activeFilter, isAuthReady, scheduleStructuralRefresh]);

  /**
   * Live traffic — ONE channel for the whole list, and every handler patches
   * local state from the realtime payload. Nothing here issues a query.
   */
  useEffect(() => {
    if (!supabase || !user || conversations.length === 0) return;

    const ids = conversations.map((c) => c.id).slice(0, REALTIME_IN_FILTER_LIMIT);
    const inFilter = `(${ids.join(',')})`;
    if (ids.length === 0) return;

    const channelName = `chat-list-live-${user.id}`;
    const ch = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=in.${inFilter}`,
      }, (payload: any) => patchConversationFromMessage(payload.new))
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversations',
        filter: `id=in.${inFilter}`,
      }, (payload: any) => patchConversationFromRow(payload.new))
      .subscribe();

    chatChannelsRef.current = [ch];
    subscribedIdsRef.current = ids;

    return () => {
      try { supabase.removeChannel(ch); } catch (err) { console.warn('Error removing channel:', err); }
      chatChannelsRef.current = [];
      subscribedIdsRef.current = [];
    };
  }, [conversations.map((c) => c.id).join(','), user?.id, patchConversationFromMessage, patchConversationFromRow]);

  // Suggested users fetch
  useEffect(() => {
    if (!user || !supabase || !isAuthReady) return;
    const fetchSuggested = async () => {
      const { data } = await supabase
        .from('users')
        .select('id, username, full_name, photo_url, is_online, last_seen')
        .neq('id', user.id)
        .limit(5);
      
      if (data) {
        setOtherUsers(data.map((u: any) => ({
          uid: u.id,
          username: u.username,
          fullName: u.full_name,
          photoURL: u.photo_url,
          isOnline: isUserOnline(u.is_online, u.last_seen)
        })));
      }
    };
    fetchSuggested();
  }, [user, isAuthReady]);

  const loadMore = useCallback(() => {
    if (!loading && !loadingMore && hasMore) {
      setIsPaginating(true);
      setLimit(prev => prev + 15);
    }
  }, [loading, loadingMore, hasMore]);

  return { conversations, otherUsers, loading, loadingMore, hasMore, loadMore };
};
