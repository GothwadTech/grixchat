import { supabase } from '../../lib/supabase';
import { notificationService } from './notificationService';
import { IndexedDBService } from '../IndexedDBService';

export interface PendingTransaction {
  id: string;
  type: 
    | 'story_insert' 
    | 'message_insert' 
    | 'post_insert' 
    | 'post_comment_insert' 
    | 'post_like_toggle' 
    | 'support_ticket_insert' 
    | 'follow_user_toggle' 
    | 'profile_update_insert';
  payload: any;
  timestamp: number;
  retries: number;
}

const QUEUE_STORAGE_KEY = 'grix_pending_transactions';

class TransactionQueueService {
  private cachedQueue: PendingTransaction[] = [];
  private isProcessing = false;
  private isLoaded = false;

  constructor() {
    this.init();
  }

  private async init() {
    try {
      // Load queue from IndexedDB's high-speed kv_store bucket
      const raw = await IndexedDBService.get<PendingTransaction[]>('kv_store', QUEUE_STORAGE_KEY);
      if (raw && Array.isArray(raw)) {
        this.cachedQueue = raw;
      } else {
        // Fallback and migrate from legacy localStorage if present
        try {
          const legacy = localStorage.getItem(QUEUE_STORAGE_KEY);
          if (legacy) {
            this.cachedQueue = JSON.parse(legacy);
            await IndexedDBService.set('kv_store', QUEUE_STORAGE_KEY, this.cachedQueue);
            localStorage.removeItem(QUEUE_STORAGE_KEY);
          }
        } catch (_) {}
      }
      this.isLoaded = true;
      console.log(`[TransactionQueue] Loaded queue model. Active cache contains ${this.cachedQueue.length} transactions pending.`);
    } catch (e) {
      console.warn('[TransactionQueue] Prepopulated memory loading crashed, falling back to memory layer.', e);
      this.isLoaded = true;
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('Device returned online. Triggering transactional queue process...');
        this.processQueue();
      });

      // Run initial check on launch
      setTimeout(() => this.processQueue(), 5000);

      // Periodic check interval (every 35 seconds)
      setInterval(() => {
        if (navigator.onLine) {
          this.processQueue();
        }
      }, 35000);
    }
  }

  // Retrieve pending queue array (Synchronous from in-memory cache replica)
  getQueue(): PendingTransaction[] {
    return [...this.cachedQueue];
  }

  // Add transactional task to the FIFO queue
  async addTransaction(
    type: 
      | 'story_insert' 
      | 'message_insert' 
      | 'post_insert' 
      | 'post_comment_insert' 
      | 'post_like_toggle' 
      | 'support_ticket_insert' 
      | 'follow_user_toggle' 
      | 'profile_update_insert', 
    payload: any
  ): Promise<void> {
    const newTask: PendingTransaction = {
      id: 'tx_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now(),
      type,
      payload,
      timestamp: Date.now(),
      retries: 0
    };

    this.cachedQueue.push(newTask);
    
    // Non-blocking writes to IndexedDB & sync
    await IndexedDBService.set('kv_store', QUEUE_STORAGE_KEY, this.cachedQueue).catch((e) => {
      console.warn('[TransactionQueue] Background IndexedDB write failed, falling back to in-memory caching.', e);
    });

    console.log(`Saved pending transaction to queue: type=${type}, id=${newTask.id}`);
    
    // Attempt processing immediately if online
    if (navigator.onLine) {
      this.processQueue();
    }
  }

  // Sequential FIFO queue executor
  async processQueue(): Promise<void> {
    if (!this.isLoaded || this.isProcessing) return;
    this.isProcessing = true;

    try {
      if (this.cachedQueue.length === 0) {
        this.isProcessing = false;
        return;
      }

      console.log(`Processing transactional queue: ${this.cachedQueue.length} items pending offline sync.`);
      const remaining: PendingTransaction[] = [];

      for (const tx of this.cachedQueue) {
        if (!navigator.onLine) {
          console.warn('Network offline during transaction execution. Yielding queue process.');
          remaining.push(tx);
          continue;
        }

        let success = false;

        try {
          switch (tx.type) {
            case 'story_insert':
              success = await this.executeStoryInsert(tx.payload);
              break;
            case 'message_insert':
              success = await this.executeMessageInsert(tx.payload);
              break;
            case 'post_insert':
              success = await this.executePostInsert(tx.payload);
              break;
            case 'post_comment_insert':
              success = await this.executePostCommentInsert(tx.payload);
              break;
            case 'post_like_toggle':
              success = await this.executePostLikeToggle(tx.payload);
              break;
            case 'support_ticket_insert':
              success = await this.executeSupportTicketInsert(tx.payload);
              break;
            case 'follow_user_toggle':
              success = await this.executeFollowUserToggle(tx.payload);
              break;
            case 'profile_update_insert':
              success = await this.executeProfileUpdateInsert(tx.payload);
              break;
            default:
              console.warn(`Unregistered transaction block type: ${tx.type}. Dropping payload.`);
              success = true; // Drop unrecognized transactions
              break;
          }
        } catch (err) {
          console.error(`Execution error for transaction ID ${tx.id}:`, err);
        }

        if (success) {
          console.log(`Transaction ${tx.id} executed successfully.`);
        } else {
          tx.retries += 1;
          // Drop if maximum retries exceeded to prevent blocking (e.g., malformed payload params)
          if (tx.retries > 8) {
            console.error(`Transaction ${tx.id} exceeded maximum retry attempts (8). Dropping transaction.`);
          } else {
            console.log(`Transaction ${tx.id} marked for retry. Retries: ${tx.retries}`);
            remaining.push(tx);
          }
        }
      }

      this.cachedQueue = remaining;
      await IndexedDBService.set('kv_store', QUEUE_STORAGE_KEY, this.cachedQueue).catch((e) => {
        console.warn('[TransactionQueue] Failed to update Queue inside IndexedDB.', e);
      });
    } catch (globalErr) {
      console.error('Fatal retry queue handler error:', globalErr);
    } finally {
      this.isProcessing = false;
    }
  }

  // Story worker
  private async executeStoryInsert(payload: any): Promise<boolean> {
    if (!supabase) return false;
    try {
      const { error } = await supabase.from('stories').insert({
        user_id: payload.userId,
        media_url: payload.mediaUrl,
        type: payload.type || 'image'
      } as any);

      if (error) {
        console.warn('Failed stories insertion attempt:', error.message);
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // Message worker
  private async executeMessageInsert(payload: any): Promise<boolean> {
    if (!supabase) return false;
    try {
      const dbPayload: any = {
        conversation_id: payload.roomId || payload.conversation_id || payload.conversationId,
        sender_id: payload.senderId || payload.sender_id,
        text: payload.content || payload.text || '',
        media_url: payload.mediaUrl || payload.media_url || null,
        media_type: payload.mediaType || payload.media_type || null,
        reply_to: payload.replyToId || payload.reply_to || null,
      };

      const { error } = await supabase.from('messages').insert(dbPayload);

      if (error) {
        console.warn('Failed messages insertion attempt:', error.message);
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // Post worker
  private async executePostInsert(payload: any): Promise<boolean> {
    if (!supabase) return false;
    try {
      const { error } = await supabase.from('posts').insert({
        user_id: payload.userId,
        image_url: payload.imageUrl || '',
        caption: payload.caption || ''
      } as any);

      if (error) {
        console.warn('Failed posts insertion attempt:', error.message);
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // Comment worker
  private async executePostCommentInsert(payload: any): Promise<boolean> {
    if (!supabase) return false;
    try {
      const { error } = await supabase.from('post_comments').insert({
        post_id: payload.postId,
        user_id: payload.userId,
        text: payload.text
      } as any);

      if (error) {
        console.warn('Failed post comments insertion attempt:', error.message);
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // Likes worker
  private async executePostLikeToggle(payload: any): Promise<boolean> {
    if (!supabase) return false;
    try {
      if (payload.hasLiked) {
        const { error } = await supabase.from('post_likes').insert({
          post_id: payload.postId,
          user_id: payload.userId
        } as any);

        if (error && !error.message.includes('duplicate key')) {
          console.warn('Failed post likes insertion attempt:', error.message);
          return false;
        }
      } else {
        const { error } = await supabase.from('post_likes')
          .delete()
          .eq('post_id', payload.postId)
          .eq('user_id', payload.userId);

        if (error) {
          console.warn('Failed post likes deletion attempt:', error.message);
          return false;
        }
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // Support inquiry worker
  private async executeSupportTicketInsert(payload: any): Promise<boolean> {
    if (!supabase) return false;
    try {
      const { error } = await supabase.from('support_tickets').insert({
        user_id: payload.userId || null,
        email: payload.email,
        category: payload.category || 'General support',
        subject: payload.subject,
        message: payload.message,
        status: 'open'
      } as any);

      if (error) {
        console.warn('Failed support ticket insertion attempt:', error.message);
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // Follow worker
  private async executeFollowUserToggle(payload: any): Promise<boolean> {
    if (!supabase) return false;
    try {
      if (payload.isFollowing) {
        const { error } = await supabase.from('follows').insert({
          follower_id: payload.followerId,
          following_id: payload.followingId
        } as any);

        if (error && !error.message.includes('duplicate key')) {
          console.warn('Failed follows relationship insertion attempt:', error.message);
          return false;
        }

        // The queued (offline) follow paths notify too, so a follow made
        // offline still shows up in the recipient's notifications inbox.
        await notificationService.notifyFollow(payload.followerId, payload.followingId);
      } else {
        const { error } = await supabase.from('follows')
          .delete()
          .eq('follower_id', payload.followerId)
          .eq('following_id', payload.followingId);

        if (error) {
          console.warn('Failed follows relationship deletion attempt:', error.message);
          return false;
        }
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // Profile update worker
  private async executeProfileUpdateInsert(payload: any): Promise<boolean> {
    if (!supabase) return false;
    try {
      const { error } = await supabase.from('users')
        .update(payload.updateFields)
        .eq('id', payload.userId);

      if (error) {
        console.warn('Failed profile details updates attempt:', error.message);
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }
}

export const transactionQueue = new TransactionQueueService();
export default transactionQueue;
