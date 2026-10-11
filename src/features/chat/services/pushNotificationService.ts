import { supabase } from '../../../lib/supabase';
import { apiPostJson } from '../../../lib/apiClient';

export const pushNotificationService = {
  /**
   * Notifies the other participants of a conversation about a new message.
   *
   * Only the conversation id and the message preview are sent — the server
   * looks up the recipients' FCM tokens itself and derives the notification
   * title from the authenticated sender, so this endpoint can no longer be
   * used to push arbitrary text to arbitrary devices.
   */
  async sendNotificationForMessage(
    conversationId: string,
    senderId: string,
    senderName: string,
    messageText: string,
    mediaType?: string
  ) {
    // `senderName` is intentionally unused: the server reads the sender's
    // display name from the database so it cannot be spoofed.
    if (!supabase) return;

    try {
      // 1. Fetch all participants in this conversation
      const { data: participants, error: partError } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId);

      if (partError || !participants) {
        console.warn('FCM: Failed to fetch participants for push notification:', partError);
        return;
      }

      // Filter out the sender
      const recipientIds = participants
        .map(p => p.user_id)
        .filter(id => id !== senderId);

      if (recipientIds.length === 0) return;

      // 2. Fetch recipient user profiles to extract active fcm_tokens and muted_users configuration
      const { data: profiles, error: profError } = await supabase
        .from('users')
        .select('id, fcm_tokens, muted_users')
        .in('id', recipientIds);

      if (profError || !profiles) {
        console.warn('FCM: Failed to fetch recipient profiles for push:', profError);
        return;
      }

      // Collect active FCM tokens from unmuted recipients
      const allTokens: string[] = [];
      profiles.forEach(profile => {
        const isMuted = Array.isArray(profile.muted_users) && profile.muted_users.includes(senderId);
        if (!isMuted && Array.isArray(profile.fcm_tokens)) {
          allTokens.push(...profile.fcm_tokens);
        }
      });

      if (allTokens.length === 0) {
        console.log('FCM: No active registration tokens found for receiver(s).');
        return;
      }

      const bodyText = messageText || (mediaType ? `Sent a ${mediaType}` : 'Sent an attachment');

      // 3. Dispatch bulk send request through our proxy API.
      //
      // The server re-derives the recipient tokens and the notification title
      // from `conversationId`, and only keeps tokens that belong to the other
      // participants — the local `allTokens` list is a cheap pre-flight check
      // that keeps us from calling the API when nobody can be notified.
      console.log(`FCM: Dispatching push dispatch for conversation ${conversationId} to ${allTokens.length} tokens.`);
      const { ok, status, data: resData } = await apiPostJson('/api/send-notification', {
        conversationId,
        body: bodyText,
        data: {
          click_action: `/chats/${conversationId}`,
          conversationId,
          senderId
        }
      });

      if (!ok) {
        console.warn(`FCM: Push dispatch rejected by the server (${status}):`, resData);
        return;
      }
      console.log('FCM: Push notification service response:', resData);
    } catch (err) {
      console.warn('FCM: pushNotificationService exception encountered:', err);
    }
  }
};
export default pushNotificationService;
