import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../providers/AuthProvider.tsx';
import { LocalDataCache } from '../../../services/LocalDataCache';

/**
 * Does `conversation_participants.last_read_at` exist yet?
 * `null` = untested. Read receipts used to UPDATE one row per unread message;
 * with REPLICA IDENTITY FULL each of those rows was broadcast as a full
 * old+new payload *and* triggered a conversation-list refetch in every client.
 * One marker row replaces all of it — with a fallback until
 * sql/09_egress_optimizations.sql is applied. See docs/EGRESS_AUDIT.md.
 */
let readMarkerSupported: boolean | null = null;
const readMarkerKey = (conversationId: string) => `read_at_${conversationId}`;

export const useChatMessages = (conversationId: string, initialLimit: number = 20) => {
  const [messages, setMessages] = useState<any[]>(() => {
    if (conversationId) {
      const cached = LocalDataCache.getMessages(conversationId);
      if (cached && Array.isArray(cached)) {
        return cached;
      }
    }
    return [];
  });
  
  const [loading, setLoading] = useState(() => {
    if (conversationId) {
      const cached = LocalDataCache.getMessages(conversationId);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        return false;
      }
    }
    return true;
  });
  
  const [loadingMore, setLoadingMore] = useState(false);
  const [messageLimit, setMessageLimit] = useState(initialLimit);
  const lastMessageCount = useRef(0);
  const { user, userData, isAuthReady } = useAuth();
  const markAsReadTimeoutRef = useRef<any>(null);

  // Cleanup markAsRead debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (markAsReadTimeoutRef.current) {
        clearTimeout(markAsReadTimeoutRef.current);
      }
    };
  }, []);

  const messagesRef = useRef<any[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  
  const confirmOptimisticMessage = useCallback((tempId: string, dbMessage: any) => {
    if (!dbMessage) return;
    dbMessage.content = dbMessage.text || dbMessage.content || '';
    
    setMessages(prev => {
      const filtered = prev.filter(m => m.id !== tempId);
      if (filtered.some(m => m.id === dbMessage.id)) {
        return filtered;
      }
      const newList = [...filtered, dbMessage];
      const sorted = newList.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      
      if (conversationId) {
        LocalDataCache.saveMessages(conversationId, sorted);
      }
      return sorted;
    });
  }, [conversationId]);

  const addOptimisticMessage = useCallback((msg: any) => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setMessages(prev => {
      const newList = [...prev, {
        ...msg,
        id: tempId,
        created_at: new Date().toISOString(),
        sender_id: user?.id,
        is_read: false,
        status: 'sending', // New field for status indicator
        sender: {
          id: user?.id,
          username: userData?.username,
          full_name: userData?.fullName,
          photo_url: userData?.photoURL
        }
      }];
      return newList.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    });
    return tempId;
  }, [user, userData]);

  const fetchMessages = useCallback(async (isMore = false) => {
    if (!conversationId || !supabase) return;

    if (isMore) setLoadingMore(true);

    try {
      // Delta sync check using local database cache
      const currentCached = LocalDataCache.getMessages(conversationId) || [];
      const nonOptimistic = currentCached.filter((m: any) => m && m.id && !m.id.startsWith('temp-') && m.created_at);

      let query = supabase
        .from('messages')
        .select(`
          *,
          sender:users (
            id,
            username,
            full_name,
            photo_url
          ),
          reply_to:reply_to (
            id,
            text,
            sender_id
          )
        `)
        .eq('conversation_id', conversationId);

      if (isMore) {
        // Fetch older messages for pagination
        const minCreatedAt = nonOptimistic.length > 0 ? nonOptimistic[0].created_at : null;
        if (minCreatedAt) {
          query = query.lt('created_at', minCreatedAt).order('created_at', { ascending: false }).limit(20);
        } else {
          query = query.order('created_at', { ascending: false }).limit(messageLimit);
        }
      } else {
        // Fetch only new messages since the latest message in cache (delta sync)
        const maxCreatedAt = nonOptimistic.length > 0 ? nonOptimistic[nonOptimistic.length - 1].created_at : null;
        if (maxCreatedAt) {
          // Subtract a small 1-second safety offset to bypass transaction latency and clock drift
          const driftOffset = 1000;
          const checkTimestamp = new Date(new Date(maxCreatedAt).getTime() - driftOffset).toISOString();
          query = query.gt('created_at', checkTimestamp).order('created_at', { ascending: false });
        } else {
          query = query.order('created_at', { ascending: false }).limit(messageLimit);
        }
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching messages:', error);
      } else {
        const fetchedMsgs = data as any[] || [];
        fetchedMsgs.forEach((m: any) => {
          m.content = m.text || m.content || '';
        });

        const reversed = [...fetchedMsgs].reverse();
        
        // Mark as read immediately if any unread message from another user was fetched
        const hasUnreadFromOthers = reversed.some(
          (m: any) => m && m.sender_id !== user?.id && !m.is_read
        );
        if (hasUnreadFromOthers) {
          markAsReadRef.current(true);
        }
        
        setMessages(prev => {
          const mergedMap = new Map();
          // Seed map with existing cached messages
          prev.forEach(msg => {
            if (msg && msg.id) mergedMap.set(msg.id, msg);
          });
          // Merge newly fetched delta elements, overwriting previous values
          reversed.forEach(msg => {
            if (msg && msg.id) mergedMap.set(msg.id, msg);
          });
          const mergedList = Array.from(mergedMap.values())
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          
          LocalDataCache.saveMessages(conversationId, mergedList);
          return mergedList;
        });
      }
    } catch (e) {
      console.error('Exception caught inside fetchMessages:', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [conversationId, messageLimit, user?.id]);

  // Synchronously sync messages & loading state when conversationId changes
  useEffect(() => {
    if (conversationId) {
      const cached = LocalDataCache.getMessages(conversationId);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        setMessages(cached);
        setLoading(false);
      } else {
        setMessages([]);
        setLoading(true);
      }
    } else {
      setMessages([]);
      setLoading(true);
    }
    setMessageLimit(initialLimit);
  }, [conversationId, initialLimit]);

  // Stabilize fetchMessages callback via a ref so real-time subscription doesn't thrash
  const fetchMessagesRef = useRef(fetchMessages);
  useEffect(() => {
    fetchMessagesRef.current = fetchMessages;
  }, [fetchMessages]);

  // Mark as read function that will be stored in a ref to stay fresh but stable
  const markAsRead = useCallback(async (force: boolean = false) => {
    if (!conversationId || !user || !supabase) return;
    
    // Instantly clear cached count for zero local UI latency!
    LocalDataCache.clearUnreadCount(user.id, conversationId);

    if (!force) {
      // Optimize DB write egress: Check if there is actually any unread message from another user in the active message list or cache.
      // If we have none, skip performing the DB update request to save budget and API traffic!
      const hasUnreadLocally = messagesRef.current.some(
        (m: any) => m && m.sender_id !== user.id && !m.is_read
      );

      let hasUnreadInCache = false;
      try {
        const cachedConvs = LocalDataCache.getConversations(user.id);
        const activeConv = cachedConvs?.find((c: any) => c.id === conversationId);
        if (activeConv && (activeConv.unread || activeConv.unreadCount > 0)) {
          hasUnreadInCache = true;
        }
      } catch (_) {}

      if (!hasUnreadLocally && !hasUnreadInCache) {
        return; // No unread messages locally or in cached badge, skip remote DB write!
      }
    }

    const executeUpdate = async () => {
      const now = new Date().toISOString();

      // Preferred path: move ONE row — this participant's read marker. Every
      // other client derives "unread" by comparing it with
      // `conversations.last_message_at`, so a read receipt is a single realtime
      // event instead of one per unread message.
      if (readMarkerSupported !== false) {
        try {
          const { error } = await supabase
            .from('conversation_participants')
            .update({ last_read_at: now } as any)
            .eq('conversation_id', conversationId)
            .eq('user_id', user.id);

          if (!error) {
            readMarkerSupported = true;
            LocalDataCache.set(readMarkerKey(conversationId), now);
            return;
          }
          // Column not there yet — remember and fall back for this session.
          readMarkerSupported = false;
        } catch (err) {
          readMarkerSupported = false;
        }
      }

      // Legacy path: mark the message rows. Bounded to messages newer than the
      // last marker so re-opening a chat never rewrites its whole history.
      try {
        const since = LocalDataCache.get<string>(readMarkerKey(conversationId));
        let query: any = supabase
          .from('messages')
          .update({ is_read: true } as any)
          .eq('conversation_id', conversationId)
          .neq('sender_id', user.id)
          .eq('is_read', false);
        if (since) query = query.gt('created_at', since);

        const { error } = await query;
        if (error) {
          console.error('Error marking messages as read:', error);
        } else {
          LocalDataCache.set(readMarkerKey(conversationId), now);
        }
      } catch (err) {
        console.error('Failed to mark messages as read:', err);
      }
    };

    if (force) {
      // Immediate update for critical focus triggers/transitions
      if (markAsReadTimeoutRef.current) {
        clearTimeout(markAsReadTimeoutRef.current);
        markAsReadTimeoutRef.current = null;
      }
      await executeUpdate();
    } else {
      // Debounce non-force read confirmations by 1200ms
      // This collapses multiple updates into 1 singular database write request!
      if (markAsReadTimeoutRef.current) {
        clearTimeout(markAsReadTimeoutRef.current);
      }
      markAsReadTimeoutRef.current = setTimeout(() => {
        executeUpdate();
      }, 1200);
    }
  }, [conversationId, user?.id]);

  const markAsReadRef = useRef(markAsRead);
  useEffect(() => {
    markAsReadRef.current = markAsRead;
  }, [markAsRead]);

  // 1. Hook for loading initial messages and paging loads
  useEffect(() => {
    if (!conversationId || !isAuthReady) return;
    const isMore = messageLimit > initialLimit;
    fetchMessages(isMore);
  }, [conversationId, messageLimit, initialLimit, isAuthReady]);

  // 3. Hook for Realtime Postgres Subscription (Bound exclusively to conversation ID)
  useEffect(() => {
    if (!conversationId || !supabase || !user || !isAuthReady) return;

    // Real-time subscription for new messages or edits
    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, async (payload) => {
        // Skip inserts from the current user as they are handled optimistically and confirmed inside the component
        if (payload.new.sender_id === user.id) {
          return;
        }

        // If it's a new message from OTHER user, mark it as read since we are in the chat
        markAsReadRef.current();
        
        try {
          const { data, error } = await supabase
            .from('messages')
            .select(`
              *,
              sender:users (
                id,
                username,
                full_name,
                photo_url
              ),
              reply_to:reply_to (
                id,
                text,
                sender_id
              )
            `)
            .eq('id', payload.new.id)
            .single();

          if (!error && data) {
            data.content = data.text || data.content || '';
            setMessages(prev => {
              const filtered = prev.filter(m => {
                if (m.status !== 'sending') return true;
                const contentMatch = m.content === data.content;
                const mediaMatch = (!m.media_url && !data.media_url) || (m.media_url && data.media_url);
                return !(contentMatch && mediaMatch && m.sender_id === data.sender_id);
              });

              if (filtered.some(m => m.id === data.id)) return filtered;
              const newList = [...filtered, data];
              return newList.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            });
          } else {
            fetchMessagesRef.current();
          }
        } catch (err) {
          fetchMessagesRef.current();
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE', 
        schema: 'public', 
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        // Merge real-time updates directly to preserve metadata and render instantly
        setMessages(prev => prev.map(m => {
          if (m.id === payload.new.id) {
            const preservedReplyTo = m.reply_to && typeof m.reply_to === 'object' ? m.reply_to : payload.new.reply_to;
            return {
              ...m,
              ...payload.new,
              reply_to: preservedReplyTo,
              content: payload.new.text || payload.new.content || m.content || ''
            };
          }
          return m;
        }));
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        setMessages(prev => {
          const index = prev.findIndex(m => m.id === payload.old.id);
          if (index === -1) return prev;
          
          // If deleted message is more than 30 messages deep from newest, it's db pruning! Keep it in UI from local cache.
          const isPrune = (prev.length - index) > 30;
          if (isPrune) {
            return prev;
          }
          return prev.filter(m => m.id !== payload.old.id);
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Successfully subscribed to chat:', conversationId);
        }
      });

    // Mark as read immediately on active screen entering
    markAsReadRef.current(true);

    const handleFocus = () => {
      markAsReadRef.current(true);
      // Instantly call fetchMessages on focus to capture any updates instantly when returning
      fetchMessagesRef.current();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
      supabase.removeChannel(channel);
    };
  }, [conversationId, user?.id, isAuthReady]);

  const loadMore = useCallback(() => {
    if (!loading && !loadingMore) setMessageLimit(prev => prev + 20);
  }, [loading, loadingMore]);

  useEffect(() => {
    if (messages?.length > 0 && conversationId) {
      const seenIds = new Set<string>();
      const unique = messages.filter(m => {
        if (!m || !m.id) return false;
        if (seenIds.has(m.id)) return false;
        seenIds.add(m.id);
        return true;
      });
      if (unique.length !== messages.length) {
        setMessages(unique);
      }
      LocalDataCache.saveMessages(conversationId, unique);
    }
  }, [messages, conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const unsubscribe = LocalDataCache.subscribe(`messages:${conversationId}`, (updated) => {
      if (updated && Array.isArray(updated)) setMessages(updated);
    });
    return () => unsubscribe();
  }, [conversationId]);

  const visibleMessages = messages.filter((m: any) => {
    if (!m) return false;
    // Hide completely if current authenticated user's id is inside deleted_by array
    if (user?.id && Array.isArray(m.deleted_by) && m.deleted_by.includes(user.id)) {
      return false;
    }
    return true;
  });

  return { 
    messages: visibleMessages, 
    loading, 
    loadingMore,
    loadMore,
    addOptimisticMessage,
    confirmOptimisticMessage,
    messageLimit,
    lastMessageCount
  };
};
