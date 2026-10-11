import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../providers/AuthProvider.tsx';
import { isUserOnline, resolveOnline } from '../../../utils/presence';
import { useIsUserOnline } from '../../../providers/PresenceProvider';
import { LocalDataCache } from '../../../services/LocalDataCache';

function getInitialReceiverCached(receiverId: string | undefined, convType: 'direct' | 'group') {
  if (!receiverId) return null;

  const currentUserId = LocalDataCache.getCurrentUserId();

  if (convType === 'direct') {
    // 1. Try directly from universal profile cache
    const userCached = LocalDataCache.get<any>(`user_prof_${receiverId}`);
    if (userCached) {
      return {
        uid: userCached.id,
        fullName: userCached.full_name,
        username: userCached.username,
        photoURL: userCached.photo_url,
        isOnline: isUserOnline(userCached.is_online, userCached.last_seen),
        lastSeen: userCached.last_seen
      };
    }

    // 2. Try conversations cache
    if (currentUserId) {
      const cachedList = LocalDataCache.getConversations(currentUserId) || [];
      const match = cachedList.find((c: any) => c.otherUserId === receiverId);
      if (match) {
        return {
          uid: match.otherUserId,
          fullName: match.fullName || match.user,
          username: match.username || '',
          photoURL: match.avatar,
          isOnline: match.isOnline,
          lastSeen: match.lastSeen || match.lastMsgAt
        };
      }
    }
  } else {
    // Group conversation
    if (currentUserId) {
      const cachedList = LocalDataCache.getConversations(currentUserId) || [];
      const match = cachedList.find((c: any) => c.id === receiverId);
      if (match) {
        return {
          id: match.id,
          name: match.fullName || match.user,
          photo_url: match.avatar,
          type: 'group'
        };
      }
    }
  }

  // Fallback for special Grix AI bot immediately
  if (receiverId === 'grix-ai' || receiverId === 'gx-ai') {
    return {
      uid: receiverId,
      fullName: 'Grix AI',
      username: 'grix_ai_bot',
      photoURL: '/assets/favicon.png',
      isOnline: true,
      lastSeen: new Date().toISOString()
    };
  }

  return null;
}

export function useChatSync(receiverId: string | undefined, chatId: string, convType: 'direct' | 'group') {
  const [receiver, setReceiver] = useState<any>(() => getInitialReceiverCached(receiverId, convType));
  const [receiverStatus, setReceiverStatus] = useState<'online' | 'offline'>(() => {
    const cached = getInitialReceiverCached(receiverId, convType);
    return cached && cached.isOnline ? 'online' : 'offline';
  });
  const [receiverLastSeen, setReceiverLastSeen] = useState<any>(() => {
    const cached = getInitialReceiverCached(receiverId, convType);
    return cached ? cached.lastSeen : null;
  });
  const [chatSettings, setChatSettings] = useState<any>(null);
  const [currentUserData, setCurrentUserData] = useState<any>(null);
  const [watchData, setWatchData] = useState<any>(null);
  const [isWatchMode, setIsWatchMode] = useState(false);
  const { user, userData: authUser } = useAuth();

  const [prevReceiverId, setPrevReceiverId] = useState<string | undefined>(receiverId);
  // Live roster answer for this chat partner (null until the roster has synced).
  const livePresence = useIsUserOnline(convType === 'direct' ? receiverId : undefined);

  // Synchronously update state on receiverId / convType change to prevent ANY GrixChat User / offline flicker
  if (receiverId !== prevReceiverId) {
    setPrevReceiverId(receiverId);
    const cached = getInitialReceiverCached(receiverId, convType);
    setReceiver(cached);
    setReceiverStatus(cached && cached.isOnline ? 'online' : 'offline');
    setReceiverLastSeen(cached ? cached.lastSeen : null);
  }

  useEffect(() => {
    // Check if we can instantly find details from cache to prevent the "GrixChat User / Offline" flicker
    let cachedInfo = getInitialReceiverCached(receiverId, convType);

    if (cachedInfo) {
      setReceiver(cachedInfo);
      setReceiverStatus(cachedInfo.isOnline ? 'online' : 'offline');
      if (cachedInfo.lastSeen) {
        setReceiverLastSeen(cachedInfo.lastSeen);
      }
    } else {
      // Clear old states immediately if no cache is found on receiverId change to prevent visual bleed from the previous conversation
      setReceiver(null);
      setReceiverStatus('offline');
      setReceiverLastSeen(null);
    }

    if (!receiverId || !supabase) return;

    const fetchReceiver = async () => {
      if (convType === 'direct') {
        const { data } = await supabase
          .from('users')
          .select('*')
          .eq('id', receiverId)
          .single();
        
        if (data) {
          // Save or update user profile cache to keep it fast for subsequent loads
          LocalDataCache.set(`user_prof_${receiverId}`, {
            id: data.id,
            username: data.username,
            full_name: data.full_name,
            photo_url: data.photo_url,
            is_online: data.is_online,
            last_seen: data.last_seen
          });

          setReceiver({
            uid: data.id,
            fullName: data.full_name,
            username: data.username,
            photoURL: data.photo_url,
            isOnline: data.is_online,
            lastSeen: data.last_seen
          });
          setReceiverStatus(
            resolveOnline(livePresence, data.is_online, data.last_seen) ? 'online' : 'offline'
          );
          setReceiverLastSeen(data.last_seen);
        }
      } else {
        const { data } = await supabase
          .from('conversations')
          .select('*')
          .eq('id', receiverId)
          .single();
        if (data) setReceiver(data);
      }
    };

    fetchReceiver();

    const channel = supabase
      .channel(`sync:${receiverId}`)
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: convType === 'direct' ? 'users' : 'conversations',
        filter: `id=eq.${receiverId}`
      }, (payload) => {
        const data = payload.new as any;
        if (convType === 'direct') {
          // Keep local cache synced
          LocalDataCache.set(`user_prof_${receiverId}`, {
            id: data.id,
            username: data.username,
            full_name: data.full_name,
            photo_url: data.photo_url,
            is_online: data.is_online,
            last_seen: data.last_seen
          });

          setReceiverStatus(
            resolveOnline(livePresence, data.is_online, data.last_seen) ? 'online' : 'offline'
          );
          setReceiverLastSeen(data.last_seen);
          setReceiver(prev => ({ 
            ...prev, 
            isOnline: data.is_online, 
            lastSeen: data.last_seen,
            fullName: data.full_name,
            username: data.username,
            photoURL: data.photo_url
          }));
        } else {
          setReceiver(data);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [receiverId, convType, user?.id, livePresence]);

  // Presence is the live signal; this tick only lets the *durable* fallback
  // decay while we are looking at the screen (no network involved).
  useEffect(() => {
    if (convType !== 'direct' || !receiver) return;

    const interval = setInterval(() => {
      const expected = resolveOnline(livePresence, receiver.isOnline, receiverLastSeen)
        ? 'online'
        : 'offline';
      setReceiverStatus(expected);
    }, 20000);

    return () => clearInterval(interval);
  }, [receiver?.isOnline, receiverLastSeen, convType, livePresence]);

  useEffect(() => {
    // Clear old watch data states instantly when chatId changes
    setWatchData(null);
    setIsWatchMode(false);

    if (!user || !chatId || !supabase) return;

    // Fetch conversation data (including watch together state)
    const fetchChat = async () => {
      const { data } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', chatId)
        .single();
      
      if (data) {
        setWatchData(data);
        if (data.watch_together_url) setIsWatchMode(true);
      }
    };

    fetchChat();

    const channel = supabase
      .channel(`chat_sync:${chatId}`)
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'conversations',
        filter: `id=eq.${chatId}`
      }, (payload) => {
        const data = payload.new as any;
        setWatchData(data);
        // Add more specific sync logic for watch together if needed
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId, user?.id]);

  useEffect(() => {
    if (!user || !receiverId || !supabase) {
      setChatSettings(null);
      return;
    }
    
    const fetchChatSettings = async () => {
      const { data } = await supabase
        .from('chat_settings')
        .select('*')
        .eq('user_id', user.id)
        .eq('receiver_id', receiverId)
        .maybeSingle();
      
      if (data) {
        setChatSettings({
          nickname: data.nickname,
          customPhotoUrl: data.custom_photo_url,
          isMuted: data.is_muted
        });
      } else {
        setChatSettings(null);
      }
    };
    
    fetchChatSettings();

    const channel = supabase
      .channel(`chat_settings_sync:${receiverId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_settings',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const newData = payload.new as any;
        if (newData && newData.receiver_id === receiverId) {
          setChatSettings({
            nickname: newData.nickname,
            customPhotoUrl: newData.custom_photo_url,
            isMuted: newData.is_muted
          });
        } else {
          fetchChatSettings();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, receiverId]);

  useEffect(() => {
    if (authUser) setCurrentUserData(authUser);
  }, [authUser]);

  const updateWatchState = async (updates: any) => {
    // Implementation for Supabase
  };

  const toggleWatchMode = async () => {
    // Implementation for Supabase
  };

  return {
    receiver,
    receiverStatus,
    receiverLastSeen,
    chatSettings,
    currentUserData,
    watchData,
    isWatchMode,
    updateWatchState,
    toggleWatchMode
  };
}
