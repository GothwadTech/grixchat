import { logger } from '../utils/logger';
/**
 * GrixChat Native IndexedDB Service
 *
 * Provides a lightweight, high-performance, asynchronous, non-blocking persistent database.
 * Extremely cost-efficient (0 Supabase egress / 0 database operations on load).
 * Fallbacks automatically to secure in-memory cache if IndexedDB is blocked or unavailable (e.g., private window / strict sandboxes).
 */

const DB_NAME = 'grixchat_offline_db_v2';
const DB_VERSION = 1;

class IndexedDBServiceImpl {
  private db: IDBDatabase | null = null;
  private isAvailable = false;
  private memoryFallback: Record<string, Record<string, any>> = {
    kv_store: {},
    conversations: {},
    messages: {},
  };

  constructor() {
    this.init();
  }

  private init(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        console.warn('[IndexedDB] IndexedDB is not supported in this environment.');
        resolve(null);
        return;
      }

      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event: any) => {
          const db = event.target.result;
          // 1. Generic Key-Value Store for settings, stories, vibe lists, user profile caches, and state flags
          if (!db.objectStoreNames.contains('kv_store')) {
            db.createObjectStore('kv_store');
          }
          // 2. Persistent Conversation ObjectStore
          if (!db.objectStoreNames.contains('conversations')) {
            db.createObjectStore('conversations');
          }
          // 3. Persistent Messages ObjectStore
          if (!db.objectStoreNames.contains('messages')) {
            db.createObjectStore('messages');
          }
          logger.info('[IndexedDB] Upgraded and initialized object stores.');
        };

        request.onsuccess = (event: any) => {
          this.db = event.target.result;
          this.isAvailable = true;
          logger.info('[IndexedDB] Connected successfully to GrixChat Offline DB.');
          resolve(this.db);
        };

        request.onerror = (event: any) => {
          // Changed console.error to console.warn to satisfy sandbox constraints (e.g. Google AI Studio iframes blocking third-party IndexedDB initialization)
          console.warn('[IndexedDB] Sandbox container blocked IndexedDB authorization. Falling back gracefully to memory/session-cache sync loops.', event.target.error);
          resolve(null);
        };
      } catch (err) {
        console.warn('[IndexedDB] Crash handling IndexedDB initialization in sandboxed iframe:', err);
        resolve(null);
      }
    });
  }

  /**
   * Run a database operation safely with fallback mechanisms
   */
  private async getStore(
    storeName: 'kv_store' | 'conversations' | 'messages',
    mode: IDBTransactionMode = 'readonly'
  ): Promise<IDBObjectStore | null> {
    if (!this.db) {
      await this.init();
    }
    if (!this.db) return null;

    try {
      const transaction = this.db.transaction(storeName, mode);
      return transaction.objectStore(storeName);
    } catch (err) {
      console.warn(`[IndexedDB] Transaction for store "${storeName}" failed.`, err);
      return null;
    }
  }

  /**
   * Retrieve an item from a given object store
   */
  public async get<T>(storeName: 'kv_store' | 'conversations' | 'messages', key: string): Promise<T | null> {
    const store = await this.getStore(storeName, 'readonly');
    if (!store) {
      return (this.memoryFallback[storeName][key] as T) || null;
    }

    return new Promise((resolve) => {
      try {
        const request = store.get(key);
        request.onsuccess = () => {
          resolve((request.result as T) || null);
        };
        request.onerror = () => {
          resolve((this.memoryFallback[storeName][key] as T) || null);
        };
      } catch (_e) {
        resolve((this.memoryFallback[storeName][key] as T) || null);
      }
    });
  }

  /**
   * Set a key-value pair inside an object store
   */
  public async set(storeName: 'kv_store' | 'conversations' | 'messages', key: string, value: any): Promise<void> {
    // Dual write: Always keep memory fallback synchronized
    this.memoryFallback[storeName][key] = value;

    const store = await this.getStore(storeName, 'readwrite');
    if (!store) return;

    return new Promise((resolve) => {
      try {
        const request = store.put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
      } catch (_e) {
        resolve();
      }
    });
  }

  /**
   * Remove a single entry from an object store
   */
  public async remove(storeName: 'kv_store' | 'conversations' | 'messages', key: string): Promise<void> {
    delete this.memoryFallback[storeName][key];

    const store = await this.getStore(storeName, 'readwrite');
    if (!store) return;

    return new Promise((resolve) => {
      try {
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
      } catch (_e) {
        resolve();
      }
    });
  }

  /**
   * Clear all records from a given store
   */
  public async clearStore(storeName: 'kv_store' | 'conversations' | 'messages'): Promise<void> {
    this.memoryFallback[storeName] = {};

    const store = await this.getStore(storeName, 'readwrite');
    if (!store) return;

    return new Promise((resolve) => {
      try {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
      } catch (_e) {
        resolve();
      }
    });
  }

  /**
   * Returns all items/records stored in a given objectStore as a dictionary or list
   */
  public async getAll<T>(storeName: 'kv_store' | 'conversations' | 'messages'): Promise<Record<string, T>> {
    const store = await this.getStore(storeName, 'readonly');
    if (!store) {
      return (this.memoryFallback[storeName] as Record<string, T>) || {};
    }

    return new Promise((resolve) => {
      try {
        const result: Record<string, T> = {};
        // Use a cursor to fetch all keys and values
        const request = store.openCursor();
        request.onsuccess = (event: any) => {
          const cursor = event.target.result;
          if (cursor) {
            result[cursor.key as string] = cursor.value as T;
            cursor.continue();
          } else {
            resolve(result);
          }
        };
        request.onerror = () => {
          resolve((this.memoryFallback[storeName] as Record<string, T>) || {});
        };
      } catch (_e) {
        resolve((this.memoryFallback[storeName] as Record<string, T>) || {});
      }
    });
  }
}

export const IndexedDBService = new IndexedDBServiceImpl();
