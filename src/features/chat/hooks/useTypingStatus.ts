import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../../providers/AuthProvider';
import { TypingService } from '../../../services/TypingService';

/**
 * Typing indicator for a conversation.
 *
 * Returns the ids of the people typing (never yourself) and a `handleTyping`
 * callback to be called on every keystroke. The channel is shared with the
 * chat-list row through `TypingService`, so watching a chat does not open a
 * second subscription for the same topic.
 *
 * @param chatId      conversation id (the broadcast topic is `typing:<chatId>`)
 * @param receiverId  the other participant (direct chats)
 * @param convType    `'group'` makes the indicator mean "anyone is typing"
 */
export const useTypingStatus = (
  chatId: string,
  receiverId: string,
  convType: 'direct' | 'group' = 'direct',
) => {
  const { user } = useAuth();
  const [typingIds, setTypingIds] = useState<string[]>([]);
  const myIdRef = useRef<string | null>(null);
  myIdRef.current = user?.id || null;

  useEffect(() => {
    if (!chatId) return;
    setTypingIds([]);
    return TypingService.acquire(chatId, setTypingIds);
  }, [chatId]);

  // Never leave the peer staring at "typing…": stop on unmount, on chat change
  // and when the tab goes to the background.
  useEffect(() => {
    const stop = () => {
      if (chatId && myIdRef.current) TypingService.stopTyping(chatId, myIdRef.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [chatId]);

  const others = typingIds.filter((id) => id !== myIdRef.current);
  const isOtherTyping =
    convType === 'group' ? others.length > 0 : Boolean(receiverId && others.includes(receiverId));

  const handleTyping = useCallback(() => {
    if (!chatId || !myIdRef.current) return;
    TypingService.notifyTyping(chatId, myIdRef.current);
  }, [chatId]);

  const stopTyping = useCallback(() => {
    if (!chatId || !myIdRef.current) return;
    TypingService.stopTyping(chatId, myIdRef.current);
  }, [chatId]);

  return { isOtherTyping, handleTyping, stopTyping };
};

/**
 * Who is typing in this conversation right now (excluding `exceptUserId`).
 * Used by the chat list, where a row has no idea what your own id is.
 */
export const useTypingUsers = (
  conversationId: string,
  exceptUserId?: string | null,
): string[] => {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    if (!conversationId) return;
    setIds(TypingService.typingUsers(conversationId, exceptUserId));
    return TypingService.acquire(conversationId, setIds);
  }, [conversationId, exceptUserId]);

  return ids.filter((id) => id !== exceptUserId);
};
