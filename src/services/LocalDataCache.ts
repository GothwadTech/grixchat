import { storage, safeSessionStorage } from './StorageService';
import { IndexedDBService } from './IndexedDBService';

import { logger } from '../utils/logger';
export interface LocalCacheConfig {
  maxAge: number; // in milliseconds
}

const DEFAULT_CONFIG: LocalCacheConfig = {
  maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days default TTL to ensure robust offline-fallback
};

class LocalDataCacheService {
  private memoryCache: Record<string, { value: any; timestamp: number }> = {};
  private listeners: Record<string, Set<(payload?: any) => void>> = {};
  private sessionAccessedKeys = new Set<string>();
  private initPromise: Promise<void> | null = null;
  private currentUserId: string | null = null;

  constructor() {
    this.initializeSession();
    this.initPromise = this.loadAllCachedDataIntoMemory();
  }

  public setCurrentUserId(userId: string | null): void {
    this.currentUserId = userId;
    logger.info(`[Cache Control] Switched active cache partition to: ${userId || 'guest'}`);
  }

  public getCurrentUserId(): string | null {
    return this.currentUserId;
  }

  public getPartitionedKey(key: string): string {
    if (!this.currentUserId) return key;
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.startsWith('grix_auth_') ||
      lowerKey.startsWith('grix_multi_') ||
      lowerKey === 'grix_active_account_id' ||
      lowerKey === 'app_lock_pin' ||
      lowerKey === 'app_lock_enabled' ||
      lowerKey === 'lock_state' ||
      lowerKey === 'grix_cached_user'
    ) {
      return key;
    }
    return `${this.currentUserId}_${key}`;
  }

  private getStoreNameForKey(key: string): 'kv_store' | 'conversations' | 'messages' {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith('gx_convs_')) {
      return 'conversations';
    }
    if (lowerKey.startsWith('gx_msgs_')) {
      return 'messages';
    }
    return 'kv_store';
  }

  public async loadAllCachedDataIntoMemory(): Promise<void> {
    try {
      logger.info('[Cache Control] Initializing Dual-Layer Caching (IndexedDB -> Memory Map)...');
      const [kv, convs, msgs] = await Promise.all([
        IndexedDBService.getAll<{ value: any; timestamp: number }>('kv_store'),
        IndexedDBService.getAll<{ value: any; timestamp: number }>('conversations'),
        IndexedDBService.getAll<{ value: any; timestamp: number }>('messages'),
      ]);

      // Populating the synchronous memory layer
      Object.entries(kv).forEach(([key, item]) => {
        if (item && item.value !== undefined) this.memoryCache[key] = item;
      });
      Object.entries(convs).forEach(([key, item]) => {
        if (item && item.value !== undefined) this.memoryCache[key] = item;
      });
      Object.entries(msgs).forEach(([key, item]) => {
        if (item && item.value !== undefined) this.memoryCache[key] = item;
      });

      logger.info(`[Cache Control] Prepopulated in-memory layers: ${Object.keys(this.memoryCache).length} active cache streams matched from local disk.`);
    } catch (err) {
      console.error('[Cache Control] Dual-Layer Prepopulation crash:', err);
    }
  }

  public getInitPromise(): Promise<void> {
    return this.initPromise || Promise.resolve();
  }

  private initializeSession(): void {
    try {
      this.sessionAccessedKeys.clear();
      safeSessionStorage.setItem('gx_session_initialized', 'true');
      logger.info('[Cache Control] Session initialized. Live-fetch Supabase bypass activated for the first request of all data feeds.');
    } catch (e) {
      console.warn('Session cache initialization warning:', e);
    }
  }

  /**
   * Safe helper to subscribe to cache-level updates or manual triggers.
   * Returns an unsubscribe function.
   */
  public subscribe(topic: string, callback: (payload?: any) => void): () => void {
    if (!this.listeners[topic]) {
      this.listeners[topic] = new Set();
    }
    this.listeners[topic].add(callback);
    return () => {
      this.listeners[topic]?.delete(callback);
      if (this.listeners[topic]?.size === 0) {
        delete this.listeners[topic];
      }
    };
  }

  /**
   * Safe helper to notify subscribers on a dynamic topic.
   */
  public notify(topic: string, payload?: any): void {
    if (this.listeners[topic]) {
      this.listeners[topic].forEach((callback) => {
        try {
          callback(payload);
        } catch (e) {
          console.error(`Error in subscriber notification for topic ${topic}:`, e);
        }
      });
    }
  }

  /**
   * Safe helper to write data to storage with a TTL timestamp.
   * Handles memory fallback automatically through StorageService.
   */
  public set(key: string, value: any): void {
    const partitionedKey = this.getPartitionedKey(key);
    const item = {
      value,
      timestamp: Date.now(),
    };
    try {
      this.memoryCache[partitionedKey] = item;
      
      // Async background write to IndexedDB
      const storeName = this.getStoreNameForKey(key);
      IndexedDBService.set(storeName, partitionedKey, item).catch((err) => {
        console.warn(`[Cache Control] Persistent write failed to IndexedDB for key "${partitionedKey}":`, err);
      });
    } catch (e) {
      console.warn(`LocalDataCache write failed for key ${key}. Memory fallback used.`, e);
    }
  }

  /**
   * Safe helper to fetch cached data, respecting expiry.
   * Returns null if not exists or if expired.
   */
  public get<T>(key: string, maxAge = DEFAULT_CONFIG.maxAge): T | null {
    try {
      const partitionedKey = this.getPartitionedKey(key);
      const item = this.memoryCache[partitionedKey];
      if (item) {
        const age = Date.now() - item.timestamp;
        if (age < maxAge) {
          return item.value as T;
        }
      }
    } catch (e) {
      console.warn(`LocalDataCache read failed for key ${key}`, e);
    }
    return null;
  }

  /**
   * Explicitly invalidate a cache key.
   */
  public remove(key: string): void {
    const partitionedKey = this.getPartitionedKey(key);
    delete this.memoryCache[partitionedKey];
    storage.removeItem(partitionedKey);
    
    // Async background remove from IndexedDB
    const storeName = this.getStoreNameForKey(key);
    IndexedDBService.remove(storeName, partitionedKey).catch((err) => {
      console.warn(`[Cache Control] Persistent remove failed from IndexedDB for key "${partitionedKey}":`, err);
    });
  }

  /**
   * Clears all cached items for a specific user ID.
   */
  public async clearAccountCache(userId: string): Promise<void> {
    try {
      const keysToWipe = Object.keys(this.memoryCache).filter((k) => k.startsWith(`${userId}_`));
      keysToWipe.forEach((key) => {
        delete this.memoryCache[key];
        storage.removeItem(key);
      });

      const stores: ('kv_store' | 'conversations' | 'messages')[] = ['kv_store', 'conversations', 'messages'];
      for (const storeName of stores) {
        const items = await IndexedDBService.getAll<any>(storeName);
        for (const [key] of Object.entries(items)) {
          if (key.startsWith(`${userId}_`)) {
            await IndexedDBService.remove(storeName, key);
          }
        }
      }
      logger.info(`[Cache Control] Cleared all partitioned cache contents for user: ${userId}`);
    } catch (err) {
      console.error('[Cache Control] Failed to wipe partitioned user cache:', err);
    }
  }

  /**
   * Secure wipe of both the in-memory cache and IndexedDB storage.
   * Prevents leakage of chats and personal messages between accounts.
   */
  public async clearAll(): Promise<void> {
    try {
      this.memoryCache = {};
      await Promise.all([
        IndexedDBService.clearStore('kv_store'),
        IndexedDBService.clearStore('conversations'),
        IndexedDBService.clearStore('messages'),
      ]);
      logger.info('[Cache Control] Local cache and IndexedDB stores successfully wiped securely.');
    } catch (err) {
      console.error('[Cache Control] Error during secure database cache wipe:', err);
    }
  }

  // --- Specific Conveniences for Conversations ---
  
  public getConversations(myUserId: string): any[] | null {
    return this.get<any[]>(`gx_convs_${myUserId}`, 1000 * 60 * 60 * 24 * 30); // Keep cached convs valid for 30 days to support robust offline launch
  }

  public invalidateConversations(myUserId: string): void {
    this.remove(`gx_convs_${myUserId}`);
    this.notify('conversations');
  }

  public saveConversations(myUserId: string, conversations: any[]): void {
    this.set(`gx_convs_${myUserId}`, conversations);
  }

  /**
   * Instantly updates the last message of a cached conversation and pushes it to the top.
   */
  public updateLastMessage(myUserId: string, conversationId: string, lastMessageText: string, timestamp: string = new Date().toISOString(), lastMsgStatus?: 'Sent' | 'Received'): void {
    const list = this.getConversations(myUserId);
    if (list && Array.isArray(list)) {
      let found = false;
      const updated = list.map((conv: any) => {
        if (conv.id === conversationId) {
          found = true;
          return {
            ...conv,
            lastMsg: lastMessageText,
            lastMsgAt: timestamp,
            time: this.formatTimeForCache(new Date(timestamp)),
            lastMsgStatus: lastMsgStatus !== undefined ? lastMsgStatus : 'Sent',
          };
        }
        return conv;
      }).sort((a: any, b: any) => {
        return new Date(b.lastMsgAt).getTime() - new Date(a.lastMsgAt).getTime();
      });
      
      this.saveConversations(myUserId, updated);
      this.notify('conversations', updated);

      if (!found) {
        // If conversation is new and not in cached conversations list, notify to trigger server fetch
        this.notify('conversations');
      }
    } else {
      this.notify('conversations');
    }
  }

  /**
   * Instantly marks a cached conversation's unread badge to 0.
   */
  public clearUnreadCount(myUserId: string, conversationId: string): void {
    const list = this.getConversations(myUserId);
    if (list && Array.isArray(list)) {
      let changed = false;
      const updated = list.map((conv: any) => {
        if (conv.id === conversationId && (conv.unread || conv.unreadCount > 0)) {
          changed = true;
          return {
            ...conv,
            unread: false,
            unreadCount: 0
          };
        }
        return conv;
      });
      if (changed) {
        this.saveConversations(myUserId, updated);
        this.notify('conversations', updated);
      }
    }
  }

  private formatTimeForCache(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    return date.toLocaleDateString();
  }

  // --- Specific Conveniences for Chat Messages ---

  public getMessages(conversationId: string): any[] | null {
    return this.get<any[]>(`gx_msgs_${conversationId}`, 1000 * 60 * 60 * 24); // Valid for 24 hours
  }

  public saveMessages(conversationId: string, messages: any[]): void {
    // Only cache last 200 messages to keep local footprint light & super fast
    const pruned = messages.slice(-200);
    this.set(`gx_msgs_${conversationId}`, pruned);
  }

  public addMessageToCache(conversationId: string, message: any): void {
    const list = this.getMessages(conversationId) || [];
    if (list.some((m: any) => m.id === message.id)) return;
    const updated = [...list, message].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    this.saveMessages(conversationId, updated);
    this.notify(`messages:${conversationId}`, updated);
  }

  public updateMessageInCache(conversationId: string, messageId: string, fieldsToUpdate: any): void {
    const list = this.getMessages(conversationId);
    if (list && Array.isArray(list)) {
      const updated = list.map((m: any) => {
        if (m.id === messageId) {
          return { ...m, ...fieldsToUpdate };
        }
        return m;
      });
      this.saveMessages(conversationId, updated);
      this.notify(`messages:${conversationId}`, updated);
    }
  }

  // --- Specific Conveniences for Vibe Feeds ---

  public getVibeVideos(): any[] | null {
    return this.get<any[]>('gx_vibe_feed', 1000 * 60 * 60 * 24 * 30); // 30 days video feed cache
  }

  public saveVibeVideos(videos: any[]): void {
    this.set('gx_vibe_feed', videos);
  }

  // --- Specific Conveniences for Home Feed & Stories ---

  public getHomeFeed(myUserId: string): any[] | null {
    return this.get<any[]>(`gx_home_feed_${myUserId}`, 1000 * 60 * 60 * 24 * 30); // 30 days cache
  }

  public saveHomeFeed(myUserId: string, posts: any[]): void {
    this.set(`gx_home_feed_${myUserId}`, posts);
  }

  public getHomeStories(myUserId: string): any[] | null {
    return this.get<any[]>(`gx_home_stories_${myUserId}`, 1000 * 60 * 60 * 24 * 30); // 30 days cache
  }

  public saveHomeStories(myUserId: string, stories: any[]): void {
    this.set(`gx_home_stories_${myUserId}`, stories);
  }

  // --- Specific Conveniences for Reels Feed ---

  public getReelsFeed(): any[] | null {
    return this.get<any[]>('gx_reels_feed', 1000 * 60 * 60 * 24 * 30); // 30 days cache
  }

  public saveReelsFeed(reels: any[]): void {
    this.set('gx_reels_feed', reels);
  }

  // --- Specific Conveniences for Notifications ---

  public getNotifications(myUserId: string, typeGroup: 'social' | 'activity'): any[] | null {
    return this.get<any[]>(`gx_notifs_${typeGroup}_${myUserId}`, 1000 * 60 * 60 * 24 * 7); // 7 days cache
  }

  public saveNotifications(myUserId: string, typeGroup: 'social' | 'activity', notifications: any[]): void {
    this.set(`gx_notifs_${typeGroup}_${myUserId}`, notifications);
  }

  public getMemoryCacheKeys(): { key: string; size: number; timestamp: number }[] {
    return Object.entries(this.memoryCache).map(([key, item]) => {
      let size = 0;
      try {
        size = JSON.stringify(item.value).length;
      } catch (_) { /* intentionally ignored: best-effort, failure is non-fatal */ }
      return {
        key,
        size,
        timestamp: item.timestamp
      };
    });
  }
}

export const LocalDataCache = new LocalDataCacheService();
