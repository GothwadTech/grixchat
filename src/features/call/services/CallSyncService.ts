import { supabase } from '../../../lib/supabase';
import { LocalDataCache } from '../../../services/LocalDataCache';

import { logger } from '../../../utils/logger';
export interface CallRecord {
  id: string;
  otherUserId: string;
  user: string;
  avatar: string;
  type: 'voice' | 'video' | 'group' | string;
  isIncoming: boolean;
  isMissed: boolean;
  time: string;
  created_at?: string;
}

class CallSyncServiceImpl {
  /**
   * Instantly load calls history from Synchronous Memory Layer / IndexedDB backplane.
   */
  public getCachedCalls(userId: string): CallRecord[] {
    if (!userId) return [];
    const cached = LocalDataCache.get<any[]>(`gx_calls_history_${userId}`);
    if (cached && Array.isArray(cached)) {
      return cached as CallRecord[];
    }
    return [];
  }

  /**
   * Save a set of call records explicitly to local cache.
   */
  public saveCachedCalls(userId: string, calls: CallRecord[]): void {
    if (!userId) return;
    LocalDataCache.set(`gx_calls_history_${userId}`, calls);
  }

  /**
   * Fetch call history from the Supabase service, with support for cursor/limit,
   * map records nicely, and sync them back to IndexedDB.
   */
  public async fetchCallsHistory(
    userId: string,
    limit: number
  ): Promise<{ callList: CallRecord[]; hasMore: boolean }> {
    if (!userId || !supabase) {
      return { callList: [], hasMore: false };
    }

    try {
      const { data, error } = await supabase
        .from('calls')
        .select(`
          *,
          caller:users!calls_caller_id_fkey (id, username, photo_url, full_name),
          receiver:users!calls_receiver_id_fkey (id, username, photo_url, full_name)
        `)
        .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`)
        // Finished calls only: a row that is still `ringing`/`accepted` is not
        // history yet, and a `rejected`/`error` one is (declined calls used to
        // be invisible here).
        .in('status', ['ended', 'rejected', 'error'])
        .order('created_at', { ascending: false })
        .limit(limit + 1);

      if (error) throw error;
      if (!data) return { callList: [], hasMore: false };

      let hasMore = false;
      let queryData = data;
      if (queryData.length > limit) {
        hasMore = true;
        queryData = queryData.slice(0, limit);
      }

      const callList: CallRecord[] = queryData.map((c: any) => {
        const isCaller = c.caller_id === userId;
        const otherUser = isCaller ? c.receiver : c.caller;

        return {
          id: c.id,
          otherUserId: isCaller ? c.receiver_id : c.caller_id,
          user: otherUser?.full_name || otherUser?.username || 'GrixChat User',
          avatar: otherUser?.photo_url || `https://cdn-icons-png.flaticon.com/512/149/149071.png`,
          type: c.type === 'audio' ? 'voice' : c.type,
          isIncoming: !isCaller,
          isMissed: c.is_missed || false,
          time: c.created_at
            ? new Date(c.created_at).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'Recently',
          created_at: c.created_at,
        };
      });

      // Write-through caching to IndexedDB backplane via LocalDataCache
      this.saveCachedCalls(userId, callList);

      return { callList, hasMore };
    } catch (err) {
      console.error('[CallSyncService] Error fetching call logs:', err);
      // Fallback to cache on error
      const cached = this.getCachedCalls(userId);
      return { callList: cached, hasMore: false };
    }
  }

  /**
   * Set up a lightweight, filtered real-time Postgres subscription to listen to call changes
   * representing the active user. Calls are instantly reconciled and synchronized on updates.
   */
  public subscribeToCalls(userId: string, onUpdate: () => void): () => void {
    if (!userId || !supabase) return () => {};

    const channelId = `realtime-calls-sync-${userId}-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'calls',
          filter: `caller_id=eq.${userId}`,
        },
        () => {
          logger.info('[CallSyncService] Realtime update detected (caller activity)');
          onUpdate();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'calls',
          filter: `receiver_id=eq.${userId}`,
        },
        () => {
          logger.info('[CallSyncService] Realtime update detected (receiver activity)');
          onUpdate();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }
}

export const CallSyncService = new CallSyncServiceImpl();
