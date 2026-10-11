import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../providers/AuthProvider.tsx';
import { ChatForwardOverlay } from '../../components/chat-ui/ChatForwardOverlay';
import { LocalDataCache } from '../../services/LocalDataCache';

import { useChatMessages } from './hooks/useChatMessages';
import { useChatActions } from './hooks/useChatActions';
import { useTypingStatus } from './hooks/useTypingStatus';
import { useChatId } from './hooks/useChatId';
import { useChatSync } from './hooks/useChatSync';
import { useChatFormHandler } from './hooks/useChatFormHandler';
import { useChatScroll } from './hooks/useChatScroll';
import { formatLastSeen } from '../../utils/dateUtils.ts';

import ChatHeader from '../../components/layout/ChatHeader.tsx';
import ChatBottom from '../../components/layout/ChatBottom.tsx';
import { MessageList } from './components/MessageList';
import { ChatOptionsSheet } from './components/ChatOptionsSheet';
import ChatTimeModal from '../../components/chat-ui/ChatTimeModal';

// Modularity Split Components
import { ChatCustomizerModal } from './components/ChatCustomizerModal';
import { PinnedMessageBanner } from './components/PinnedMessageBanner';
import { ToastIndicator } from './components/ToastIndicator';

// Modularity Split Hooks
import { useScrollLock } from './hooks/useScrollLock';
import { useCustomChatBg } from './hooks/useCustomChatBg';
import { useMessageSearch } from './hooks/useMessageSearch';
import { useForwardHandler } from './hooks/useForwardHandler';
import { useChatLock } from './hooks/useChatLock';

export default function ChatScreen() {
  const { id: receiverId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, userData: currentUserData, refreshUserData } = useAuth();
  
  const { chatId, convType } = useChatId(receiverId);

  const optionsRef = useRef<HTMLDivElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { 
    receiver,
    receiverStatus,
    receiverLastSeen,
    chatSettings,
    watchData
  } = useChatSync(receiverId, chatId, convType);

  const { 
    messages, 
    loading, 
    messageLimit, 
    loadingMore, 
    loadMore,
    addOptimisticMessage,
    confirmOptimisticMessage
  } = useChatMessages(chatId);

  const { 
    sendMessage: performSendMessage, 
    editMessage: performEditMessage, 
    deleteMessage: performDeleteMessage, 
    reactToMessage: performReactToMessage, 
    clearChat: performClearChat
  } = useChatActions(chatId, receiverId || '');

  const { isOtherTyping, handleTyping, stopTyping } = useTypingStatus(
    chatId,
    receiverId || '',
    convType,
  );

  const {
    scrollContainerRef,
    messagesEndRef,
    handleScroll,
    scrollToBottom
  } = useChatScroll(messages, loading, user?.id, loadingMore, loadMore);

  const [showCustomizerModal, setShowCustomizerModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(prev => prev === msg ? null : prev);
    }, 2200);
  };

  // Split-up State & Hook Coordinators
  useScrollLock();
  const { customBg, setCustomBg, activeChatBackground } = useCustomChatBg(receiverId);
  const { searchQuery, setSearchQuery, selectedDate, setSelectedDate, showSearch, setShowSearch, filteredMessages } = useMessageSearch(messages);
  const { forwardTargetMsg, setForwardTargetMsg, selectedMsgIds, setSelectedMsgIds, handleForwardComplete } = useForwardHandler(user);
  const { lockState, isChatTimeModalOpen, setIsChatTimeModalOpen, handleSaveChatTimeRestrictions } = useChatLock(chatId, watchData?.watch_state?.chat_times, showToast);

  const {
    showOptions,
    setShowOptions,
    showPlusMenu,
    setShowPlusMenu,
    isMuted,
    setIsMuted,
    replyingTo,
    setReplyingTo,
    editingMessage,
    setEditingMessage,
    activeMessageMenu,
    setActiveMessageMenu,
    showReactionPicker,
    setShowReactionPicker,
    showEmojiPicker,
    setShowEmojiPicker,
    isSending,
    selectedFiles,
    setSelectedFiles,
    filePreviewUrls,
    setFilePreviewUrls,
    uploadProgress,
    isUploading,
    newMessage,
    setNewMessage,
    handleFileChange,
    handleSendMessage,
    handleMessageTap,
    startEdit
  } = useChatFormHandler({
    chatId,
    receiverId: receiverId || '',
    user,
    addOptimisticMessage,
    confirmOptimisticMessage,
    performSendMessage,
    performEditMessage,
    textareaRef,
    scrollToBottom
  });

  const [pinnedMsg, setPinnedMsg] = useState<any>(null);
  const [infoModalMessage, setInfoModalMessage] = useState<any | null>(null);

  const formatDetailedDate = (dateString: string) => {
    if (!dateString) return 'Pending';
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return 'Pending';
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }) + ' at ' + d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (_) {
      return 'Pending';
    }
  };

  const handleInfoMsgSelection = () => {
    if (selectedMsgIds.length === 0) return;
    const msg = messages.find(m => m.id === selectedMsgIds[0]);
    if (msg) {
      setInfoModalMessage(msg);
    }
  };

  useEffect(() => {
    if (chatId) {
      const saved = LocalDataCache.get<any>(`gx_pinned_${chatId}`);
      setPinnedMsg(saved || null);
    } else {
      setPinnedMsg(null);
    }
    setSelectedMsgIds([]);
  }, [chatId, setSelectedMsgIds]);

  const handlePinClick = (msg: any) => {
    if (chatId) {
      LocalDataCache.set(`gx_pinned_${chatId}`, msg);
      setPinnedMsg(msg);
      setActiveMessageMenu(null);
    }
  };

  const handleUnpinClick = () => {
    if (chatId) {
      LocalDataCache.remove(`gx_pinned_${chatId}`);
      setPinnedMsg(null);
    }
  };

  const customHandleMessageTap = (e: any, msg: any) => {
    const isLongPress = e && e.isLongPress;
    if (isLongPress || selectedMsgIds.length > 0) {
      if (e && e.stopPropagation) e.stopPropagation();
      setSelectedMsgIds(prev =>
        prev.includes(msg.id)
          ? prev.filter(id => id !== msg.id)
          : [...prev, msg.id]
      );
      if (activeMessageMenu) {
        setActiveMessageMenu(null);
      }
    } else {
      handleMessageTap(e, msg);
    }
  };

  const handleSendTask = async (task: { title: string; description: string; assignee: string; dueDate: string; status: 'pending' }) => {
    if (!user || !chatId) return;
    try {
      await performSendMessage({
        text: JSON.stringify(task),
        customMediaType: 'task'
      });
    } catch (err) {
      console.error('Error sending task:', err);
    }
  };

  const handleSendLocation = async (loc: { latitude: number; longitude: number; name: string }) => {
    if (!user || !chatId) return;
    try {
      await performSendMessage({
        text: JSON.stringify(loc),
        customMediaType: 'location'
      });
    } catch (err) {
      console.error('Error sending location:', err);
    }
  };

  const handleSendPoll = async (poll: { question: string; options: string[]; multiple: boolean }) => {
    if (!user || !chatId) return;
    try {
      const pollText = JSON.stringify({
        question: poll.question,
        options: poll.options.map((opt, i) => ({ id: String(i), text: opt, voters: [] })),
        multiple: poll.multiple
      });
      await performSendMessage({
        text: pollText,
        customMediaType: 'poll'
      });
    } catch (err) {
      console.error('Error sending poll:', err);
    }
  };

  useEffect(() => {
    if (location.state?.capturedImage) {
      const dataUrl = location.state.capturedImage;
      setFilePreviewUrls([dataUrl]);
      fetch(dataUrl).then(res => res.blob()).then(blob => {
        const file = new File([blob], "camera_photo.jpg", { type: "image/jpeg" });
        setSelectedFiles([file]);
      });
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate, setFilePreviewUrls, setSelectedFiles]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(event.target as Node)) setShowOptions(false);
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) setShowPlusMenu(false);
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) setShowEmojiPicker(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setShowOptions, setShowPlusMenu, setShowEmojiPicker]);

  useEffect(() => {
    if (isOtherTyping) {
      if (activeMessageMenu) setActiveMessageMenu(null);
      if (showReactionPicker) setShowReactionPicker(null);
      scrollToBottom('smooth');
      const t1 = setTimeout(() => scrollToBottom('smooth'), 80);
      const t2 = setTimeout(() => scrollToBottom('smooth'), 220);
      const t3 = setTimeout(() => scrollToBottom('smooth'), 450);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [isOtherTyping, scrollToBottom, activeMessageMenu, setActiveMessageMenu, showReactionPicker, setShowReactionPicker]);

  const deleteChat = async () => {
    if (window.confirm("Delete this chat?")) {
      await performClearChat();
      navigate('/chats');
    }
  };

  const hideChat = async () => {
    if (!user || !supabase) return;
    const isHidden = currentUserData?.hiddenChats?.includes(chatId);
    const newHidden = isHidden ? currentUserData.hiddenChats.filter((id: any) => id !== chatId) : [...(currentUserData.hiddenChats || []), chatId];
    await supabase.from('users').update({ hidden_chats: newHidden }).eq('id', user.id);
    await refreshUserData();
    if (!isHidden) navigate('/chats');
  };

  const archiveChat = async () => {
    if (!user || !supabase) return;
    const isArchived = currentUserData?.archivedChats?.includes(chatId);
    const newArchived = isArchived ? currentUserData.archivedChats.filter((id: any) => id !== chatId) : [...(currentUserData.archivedChats || []), chatId];
    await supabase.from('users').update({ archived_chats: newArchived }).eq('id', user.id);
    await refreshUserData();
    if (!isArchived) navigate('/chats');
  };

  const isHidden = Array.isArray(currentUserData?.hiddenChats) && currentUserData.hiddenChats.includes(chatId);
  const isArchived = Array.isArray(currentUserData?.archivedChats) && currentUserData.archivedChats.includes(chatId);

  const handleScrollWithDismiss = (e: React.UIEvent<HTMLDivElement>) => {
    handleScroll(e);
    if (activeMessageMenu) {
      setActiveMessageMenu(null);
    }
    if (showReactionPicker) {
      setShowReactionPicker(null);
    }
  };

  return (
    <div className="flex flex-col h-full w-full max-w-full bg-[var(--bg-main)] overflow-hidden relative">
      <ChatHeader 
        receiver={{
          ...receiver,
          fullName: chatSettings?.nickname || receiver?.fullName,
          photoURL: chatSettings?.customPhotoUrl || receiver?.photoURL
        }}
        receiverId={receiverId}
        formatLastSeen={() => formatLastSeen(receiverLastSeen || receiver?.lastSeen)}
        showOptions={showOptions}
        setShowOptions={setShowOptions}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        deleteChat={deleteChat}
        hideChat={hideChat}
        archiveChat={archiveChat}
        clearChat={performClearChat}
        isHidden={isHidden}
        isArchived={isArchived}
        optionsRef={optionsRef}
        isTyping={isOtherTyping}
        receiverStatus={receiverStatus}
        currentUserId={user?.id}
        type={convType}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        showSearch={showSearch}
        setShowSearch={setShowSearch}
        selectedMsgCount={selectedMsgIds.length}
        onClearMsgSelection={() => setSelectedMsgIds([])}
        onForwardMsgSelection={() => {
          const combinedText = messages
            .filter(m => selectedMsgIds.includes(m.id))
            .map(m => m.content || m.text || '')
            .join('\n\n');
          
          setForwardTargetMsg({ id: 'bulk', content: combinedText });
          setSelectedMsgIds([]);
        }}
        onDeleteMsgSelection={async () => {
          if (window.confirm(`Delete ${selectedMsgIds.length} selected messages for me?`)) {
            for (const id of selectedMsgIds) {
              await performDeleteMessage(id);
            }
            setSelectedMsgIds([]);
            showToast('Messages deleted successfully');
          }
        }}
        onCopyMsgSelection={() => {
          const combinedText = messages
            .filter(m => selectedMsgIds.includes(m.id))
            .map(m => m.content || m.text || '')
            .filter(Boolean)
            .join('\n\n');
          
          if (combinedText) {
            navigator.clipboard.writeText(combinedText);
            showToast(`${selectedMsgIds.length} message${selectedMsgIds.length > 1 ? 's' : ''} copied`);
          } else {
            showToast('No copyable text content in selected messages');
          }
          setSelectedMsgIds([]);
        }}
        onSelectChatTime={() => setIsChatTimeModalOpen(true)}
        onInfoMsgSelection={handleInfoMsgSelection}
      />

      {/* Pinned Message Bar Component */}
      <PinnedMessageBanner 
        pinnedMsg={pinnedMsg}
        onUnpinClick={handleUnpinClick}
      />

      <MessageList 
        scrollContainerRef={scrollContainerRef}
        messagesEndRef={messagesEndRef}
        handleScroll={handleScrollWithDismiss}
        chatBackground={activeChatBackground}
        loadingMore={loadingMore}
        loading={loading}
        messages={filteredMessages}
        messageLimit={messageLimit}
        convType={convType}
        receiver={receiver}
        activeMessageMenu={activeMessageMenu}
        setActiveMessageMenu={setActiveMessageMenu}
        replyingTo={replyingTo}
        setReplyingTo={setReplyingTo}
        showReactionPicker={showReactionPicker}
        setShowReactionPicker={setShowReactionPicker}
        receiverStatus={receiverStatus}
        handleMessageTap={customHandleMessageTap}
        performReactToMessage={performReactToMessage}
        isOtherTyping={isOtherTyping}
        selectedMsgIds={selectedMsgIds}
      />

      <ChatBottom 
        activeMessageMenu={activeMessageMenu}
        setActiveMessageMenu={setActiveMessageMenu}
        setReplyingTo={setReplyingTo}
        startEdit={startEdit}
        deleteMessage={performDeleteMessage}
        currentUserUid={user?.id}
        setShowReactionPicker={setShowReactionPicker}
        performReactToMessage={performReactToMessage}
        editingMessage={editingMessage}
        setEditingMessage={setEditingMessage}
        newMessage={newMessage}
        setNewMessage={setNewMessage}
        replyingTo={replyingTo}
        receiver={receiver}
        handleSendMessage={handleSendMessage}
        fileInputRef={fileInputRef}
        imageInputRef={imageInputRef}
        handleFileChange={handleFileChange}
        showPlusMenu={showPlusMenu}
        setShowPlusMenu={setShowPlusMenu}
        plusMenuRef={plusMenuRef}
        chatId={chatId}
        filePreviewUrls={filePreviewUrls}
        isUploading={isUploading}
        uploadProgress={uploadProgress}
        setSelectedFiles={setSelectedFiles}
        setFilePreviewUrls={setFilePreviewUrls}
        textareaRef={textareaRef}
        handleTyping={handleTyping}
        stopTyping={stopTyping}
        showEmojiPicker={showEmojiPicker}
        setShowEmojiPicker={setShowEmojiPicker}
        emojiPickerRef={emojiPickerRef}
        isSending={isSending}
        selectedFiles={selectedFiles}
        onForwardClick={(msg) => { setForwardTargetMsg(msg); setActiveMessageMenu(null); }}
        onSelectClick={(msg) => { setSelectedMsgIds([msg.id]); setActiveMessageMenu(null); }}
        onPinClick={handlePinClick}
        onSendLocation={handleSendLocation}
        onSendPoll={handleSendPoll}
        onSendTask={handleSendTask}
        isLocked={lockState.isLocked}
        lockMessage={lockState.message}
      />

      <ChatOptionsSheet 
        isOpen={showOptions}
        onClose={() => setShowOptions(false)}
        receiver={receiver}
        receiverId={receiverId}
        isArchived={isArchived}
        isHidden={isHidden}
        isMuted={isMuted}
        archiveChat={archiveChat}
        hideChat={hideChat}
        setIsMuted={setIsMuted}
        deleteChat={deleteChat}
        onCustomizeClick={() => {
          setShowOptions(false);
          setShowCustomizerModal(true);
        }}
      />

      {/* Customizer modal component for Chat-Specific Wallpapers and Bubble Colors */}
      <ChatCustomizerModal 
        isOpen={showCustomizerModal}
        onClose={() => setShowCustomizerModal(false)}
        receiver={receiver}
        receiverId={receiverId}
        customBg={customBg}
        setCustomBg={setCustomBg}
      />

      {/* WhatsApp Full Screen Forward UI */}
      <ChatForwardOverlay 
        isOpen={!!forwardTargetMsg}
        onClose={() => setForwardTargetMsg(null)}
        messageToForward={forwardTargetMsg}
        currentUserId={user?.id || ''}
        onForwardComplete={handleForwardComplete}
      />

      {/* Toast Alert Indicator */}
      <ToastIndicator toastMessage={toastMessage} />

      {/* Chat Time modal */}
      <ChatTimeModal 
        isOpen={isChatTimeModalOpen}
        onClose={() => setIsChatTimeModalOpen(false)}
        currentRestrictions={watchData?.watch_state?.chat_times}
        onSave={handleSaveChatTimeRestrictions}
        title="Chat Time Scheduler"
      />

      {/* Message Ticks Info Modal matching GrixChat design specs perfectly */}
      <AnimatePresence>
        {infoModalMessage && (
          <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/75 backdrop-blur-[3px] select-none p-4">
            <div 
              className="absolute inset-0 bg-transparent" 
              onClick={() => setInfoModalMessage(null)} 
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 15 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="relative w-full max-w-[340px] bg-[var(--bg-card)] border border-[var(--border-color)]/50 rounded-[28px] shadow-[0_24px_60px_rgba(0,0,0,0.5)] p-6 z-[100001] flex flex-col gap-4 text-left"
            >
              <div className="flex items-center gap-2.5 text-[#0494f4] font-black">
                <Info size={22} className="stroke-[2.5]" />
                <h3 className="text-[18px] font-black tracking-tight text-[var(--text-primary)] leading-none font-sans">
                  Message Info
                </h3>
              </div>

              <div className="px-3.5 py-3 rounded-2xl bg-[var(--bg-main)] border border-[var(--border-color)]/30 max-h-[110px] overflow-y-auto w-full">
                <p className="text-[12.5px] font-semibold text-[var(--text-secondary)]/90 italic leading-snug break-all">
                  "{infoModalMessage.content || infoModalMessage.text || 'Media Message Attachment'}"
                </p>
              </div>

              <div className="flex flex-col gap-4 pl-2 relative border-l-2 border-[var(--border-color)]/35 ml-3.5 my-2.5">
                {/* Sent */}
                <div className="relative pl-6">
                  <div className="absolute -left-[7px] top-1.5 w-3.5 h-3.5 rounded-full bg-zinc-500 border-2 border-[var(--bg-card)] shadow-sm" />
                  <p className="text-[10px] font-extrabold text-[var(--text-secondary)]/85 tracking-widest uppercase leading-none mb-1 font-mono">Sent</p>
                  <p className="text-[13.5px] font-black text-[var(--text-primary)] leading-tight">
                    {formatDetailedDate(infoModalMessage.created_at)}
                  </p>
                </div>

                {/* Delivered */}
                <div className="relative pl-6">
                  <div className="absolute -left-[7px] top-1.5 w-3.5 h-3.5 rounded-full bg-zinc-400 border-2 border-[var(--bg-card)] shadow-sm" />
                  <p className="text-[10px] font-extrabold text-[var(--text-secondary)]/85 tracking-widest uppercase leading-none mb-1 font-mono">Delivered</p>
                  <p className="text-[13.5px] font-black text-[var(--text-primary)] leading-tight">
                    {formatDetailedDate(new Date(new Date(infoModalMessage.created_at || Date.now()).getTime() + 1200).toISOString())}
                  </p>
                </div>

                {/* Read */}
                <div className="relative pl-6">
                  <div className="absolute -left-[7px] top-1.5 w-3.5 h-3.5 rounded-full bg-[#0494f4] border-2 border-[var(--bg-card)] shadow-[0_0_10px_rgba(4,148,244,0.3)]" />
                  <p className="text-[10px] font-extrabold text-[#0494f4] tracking-widest uppercase leading-none mb-1 font-mono animate-pulse">Read</p>
                  <p className="text-[13.5px] font-black text-[var(--text-primary)] leading-tight">
                    {formatDetailedDate(new Date(new Date(infoModalMessage.created_at || Date.now()).getTime() + 2400).toISOString())}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setInfoModalMessage(null)}
                className="w-full text-center py-3.5 text-[14px] font-black text-white bg-[#0494f4] hover:bg-[#0382d6] active:scale-[0.98] transition-all rounded-2xl cursor-pointer border-none shadow-[0_4px_15px_rgba(4,148,244,0.25)] select-none"
              >
                Close Description
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
