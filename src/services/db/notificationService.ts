import { supabase } from '../../lib/supabase';

/**
 * The `notifications` table used to be read-only from the app's point of view:
 * every INSERT lived in the deleted Posts/Reels features, so
 * `NotificationsScreen` and `LikeNotificationsScreen` could never show
 * anything. This service is the single write path.
 *
 * Column contract (matches `sql/01_schema.sql`):
 *   user_id       → recipient
 *   from_user_id  → actor
 *   type          → 'follow' | 'like' | 'comment' | 'system'
 *   title         → full sentence, e.g. "Aarav started following you"
 *   content       → short action phrase, e.g. "started following you"
 *   post_id       → optional subject of the notification
 *
 * Readers must use `content`; the schema has no `text` column.
 */
export type NotificationType = 'follow' | 'like' | 'comment' | 'system';

export interface CreateNotificationInput {
  /** Recipient. */
  userId: string;
  /** Who triggered it. */
  fromUserId?: string | null;
  type: NotificationType;
  title: string;
  content?: string | null;
  postId?: string | null;
}

export const notificationService = {
  /**
   * Inserts a notification row. Never throws: a failure here must not abort
   * the user action that produced it (following someone, sending a message).
   */
  async create(input: CreateNotificationInput): Promise<boolean> {
    if (!supabase) return false;
    // Nobody needs a notification about their own action.
    if (input.fromUserId && input.fromUserId === input.userId) return false;

    try {
      const { error } = await supabase.from('notifications').insert({
        user_id: input.userId,
        from_user_id: input.fromUserId ?? null,
        type: input.type,
        title: input.title,
        content: input.content ?? null,
        post_id: input.postId ?? null,
        is_read: false,
      });

      if (error) {
        console.warn('notificationService: insert failed:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('notificationService: insert threw:', err);
      return false;
    }
  },

  /**
   * "X started following you".
   *
   * Re-following after an unfollow reuses the existing row (bumped to the top
   * and unread again) instead of stacking duplicates.
   */
  async notifyFollow(fromUserId: string, toUserId: string): Promise<boolean> {
    if (!supabase || !fromUserId || !toUserId || fromUserId === toUserId) return false;

    try {
      const { data: actor } = await supabase
        .from('users')
        .select('full_name, username')
        .eq('id', fromUserId)
        .maybeSingle();

      const actorName = actor?.full_name || actor?.username || 'Someone';
      const content = 'started following you';
      const title = `${actorName} ${content}`;

      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', toUserId)
        .eq('from_user_id', fromUserId)
        .eq('type', 'follow')
        .maybeSingle();

      if (existing?.id) {
        await supabase
          .from('notifications')
          .update({ title, content, is_read: false, created_at: new Date().toISOString() })
          .eq('id', existing.id);
        return true;
      }

      return await notificationService.create({
        userId: toUserId,
        fromUserId,
        type: 'follow',
        title,
        content,
      });
    } catch (err) {
      console.warn('notificationService: notifyFollow threw:', err);
      return false;
    }
  },

  /** System / broadcast style entry, e.g. "GrixChat v1.0 released". */
  async notifySystem(userId: string, title: string, content?: string): Promise<boolean> {
    return notificationService.create({ userId, type: 'system', title, content });
  },
};

export default notificationService;
