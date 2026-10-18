import React, { useState } from 'react';
import { 
  ArrowLeft, 
  MoreVertical, 
  Search, 
  X, 
  Calendar, 
  Eraser,
  Forward,
  Trash,
  Copy,
  Star,
  Info
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChatHeaderDropdown } from '../chat-ui/ChatHeaderDropdown';
import Avatar from '../common/Avatar';

interface ChatHeaderProps {
  receiver: any;
  receiverId: string | undefined;
  formatLastSeen: (timestamp: any) => string;
  showOptions: boolean;
  setShowOptions: (show: boolean) => void;
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;
  deleteChat: () => void;
  hideChat?: () => void;
  archiveChat?: () => void;
  clearChat?: () => Promise<void>;
  isHidden?: boolean;
  isArchived?: boolean;
  optionsRef: React.RefObject<HTMLDivElement | null>;
  isTyping?: boolean;
  receiverStatus?: 'online' | 'offline';
  currentUserId?: string;
  type?: 'direct' | 'group';

  // Search filter states
  searchQuery?: string;
  setSearchQuery?: (q: string) => void;
  selectedDate?: string;
  setSelectedDate?: (d: string) => void;
  showSearch?: boolean;
  setShowSearch?: (s: boolean) => void;

  // Message Selection Mode
  selectedMsgCount?: number;
  onClearMsgSelection?: () => void;
  onForwardMsgSelection?: () => void;
  onDeleteMsgSelection?: () => void;
  onCopyMsgSelection?: () => void;
  onSelectChatTime?: () => void;
  onInfoMsgSelection?: () => void;
}

export default function ChatHeader({
  receiver,
  receiverId,
  formatLastSeen,
  isMuted,
  setIsMuted,
  deleteChat,
  hideChat,
  archiveChat,
  clearChat,
  isHidden,
  isArchived,
  optionsRef,
  isTyping,
  receiverStatus,
  type = 'direct',

  searchQuery = '',
  setSearchQuery,
  selectedDate = '',
  setSelectedDate,
  showSearch = false,
  setShowSearch,

  selectedMsgCount = 0,
  onClearMsgSelection,
  onForwardMsgSelection,
  onDeleteMsgSelection,
  onCopyMsgSelection,
  onSelectChatTime,
  onInfoMsgSelection
}: ChatHeaderProps) {
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectDropdownOpen, setSelectDropdownOpen] = useState(false);
  const [localToast, setLocalToast] = useState<string | null>(null);

  const showLocalToast = (msg: string) => {
    setLocalToast(msg);
    setTimeout(() => {
      setLocalToast(null);
    }, 2000);
  };

  const isOnline = receiverStatus === 'online';
  const isGroup = type === 'group';

  const getStatusText = () => {
    if (isGroup) return 'tap here for group info';
    if (isTyping) return 'typing…';
    // Live presence drives `isOnline`; when it says nobody is there we show the
    // durable "last seen …" string instead.
    if (!isOnline) return formatLastSeen(receiver?.lastSeen);
    return 'online';
  };
  
  const startCall = (callType: 'voice' | 'video') => {
    const sessionCallId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    navigate(`/call/${receiverId}?type=${callType}&callId=${sessionCallId}`);
  };

  const handleHeaderClick = () => {
    if (receiverId === 'gx-ai' || receiverId === 'grix-ai') {
      navigate('/profile/grix-ai');
    } else if (isGroup) {
      navigate(`/group-settings/${receiverId}`);
    } else {
      navigate(`/chat/${receiverId}/settings`);
    }
  };

  const toggleSearch = () => {
    if (showSearch) {
      if (setSearchQuery) setSearchQuery('');
      if (setSelectedDate) setSelectedDate('');
      if (setShowSearch) setShowSearch(false);
    } else {
      if (setShowSearch) setShowSearch(true);
    }
  };

  const hasActiveFilters = searchQuery !== '' || selectedDate !== '';

  const clearAllFilters = () => {
    if (setSearchQuery) setSearchQuery('');
    if (setSelectedDate) setSelectedDate('');
  };
  
  return (
    <div className="shrink-0 flex flex-col z-50 w-full bg-[var(--header-bg)] border-b border-[var(--border-color)]/35 shadow-sm rounded-b-2xl relative">
      {/* Premium Micro Floating Toast Banner above Header bounds */}
      <AnimatePresence>
        {localToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 12, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="absolute left-1/2 -translate-x-1/2 top-full z-[999] px-4 py-2.5 bg-[#1a1b1d]/95 hover:bg-[#1e2022]/95 text-white/95 text-xs font-bold tracking-wide rounded-2xl shadow-xl border border-white/10 flex items-center gap-2 backdrop-blur-md select-none font-sans whitespace-nowrap"
          >
            <span className="text-[#0494f4]">✨</span>
            <span>{localToast}</span>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Dynamic Main Bar based on Message Selection Mode */}
      {selectedMsgCount > 0 ? (
        <div className="flex items-center justify-between px-4 min-h-[56px] pt-safe w-full min-w-0 bg-[var(--header-bg)] rounded-b-2xl animate-fade-in text-[var(--header-text)]">
          <div className="flex items-center gap-1">
            <button 
              type="button"
              onClick={onClearMsgSelection}
              className="w-11 h-11 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors shrink-0 border-none bg-transparent cursor-pointer text-[var(--header-text)]"
              title="Clear selection"
            >
              <X size={22} />
            </button>
            <span className="text-[17px] font-black tracking-wide pl-1.5 min-w-[24px] text-center">
              {selectedMsgCount}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 relative">
            <button 
              type="button"
              onClick={onForwardMsgSelection}
              className="w-11 h-11 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors cursor-pointer border-none bg-transparent text-[var(--header-text)]"
              title="Forward selected messages"
            >
              <Forward size={21} />
            </button>

            <button 
              type="button"
              onClick={onDeleteMsgSelection}
              className="w-11 h-11 flex items-center justify-center text-rose-550 hover:text-red-500 hover:bg-red-500/10 rounded-full transition-colors cursor-pointer border-none bg-transparent"
              title="Delete selected messages"
            >
              <Trash size={21} />
            </button>

            {/* WhatsApp-style 3-Dot vertical option */}
            <div className="relative">
              <button 
                type="button"
                onClick={() => setSelectDropdownOpen(!selectDropdownOpen)}
                className="w-11 h-11 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors cursor-pointer border-none bg-transparent text-[var(--header-text)]"
                title="More options"
              >
                <MoreVertical size={21} />
              </button>

              <AnimatePresence>
                {selectDropdownOpen && (
                  <>
                    {/* Absolute fallback backdrop to dismiss on click/tap */}
                    <div role="presentation" 
                      className="fixed inset-0 z-[100] bg-transparent cursor-default" 
                      onClick={() => setSelectDropdownOpen(false)}
                    />
                    
                    {/* 100% Symmetrical dropdown matching ChatHeaderDropdown precisely */}
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -10 }}
                      transition={{ duration: 0.12, ease: 'easeOut' }}
                      className="absolute right-0 top-11 z-[101] w-[190px] bg-[var(--bg-card)] border border-[var(--border-color)]/60 shadow-[0_10px_35px_rgba(0,0,0,0.15)] rounded-2xl p-1.5 flex flex-col gap-[1px] text-[var(--text-primary)] overflow-hidden select-none"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (onCopyMsgSelection) onCopyMsgSelection();
                          setSelectDropdownOpen(false);
                        }}
                        className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--text-primary)]/10 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
                      >
                        <Copy size={16} className="text-[var(--text-secondary)]" />
                        <span>Copy message</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          showLocalToast(`Starred ${selectedMsgCount} message${selectedMsgCount > 1 ? 's' : ''}!`);
                          setSelectDropdownOpen(false);
                        }}
                        className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--text-primary)]/10 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
                      >
                        <Star size={16} className="text-yellow-500 fill-yellow-500/20" />
                        <span>Star message</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (onInfoMsgSelection) {
                            onInfoMsgSelection();
                          } else {
                            showLocalToast(`Message Info details are private.`);
                          }
                          setSelectDropdownOpen(false);
                        }}
                        className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--text-primary)]/10 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
                      >
                        <Info size={16} className="text-[var(--text-secondary)]" />
                        <span>Info</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (onClearMsgSelection) onClearMsgSelection();
                          setSelectDropdownOpen(false);
                        }}
                        className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-rose-500 hover:bg-rose-500/10 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
                      >
                        <X size={16} className="text-rose-500 font-bold" />
                        <span>Deselect All</span>
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between px-4 min-h-[56px] pt-safe w-full min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <button aria-label="Back" 
              type="button"
              onClick={() => navigate(-1)} 
              className="w-12 h-12 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors shrink-0 border-none bg-transparent cursor-pointer"
            >
              <ArrowLeft size={22} className="text-[var(--header-text)]" />
            </button>
            
            <div 
              className="flex items-center gap-2 cursor-pointer min-w-0" 
              onClick={handleHeaderClick}
            >
              <Avatar 
                url={(receiverId === 'gx-ai' || receiverId === 'grix-ai') ? '/assets/favicon.png' : (receiver?.photoURL || receiver?.icon)} 
                type={isGroup ? 'group' : 'direct'} 
                size="sm" 
                isOnline={(!isGroup && isOnline) || (receiverId === 'gx-ai' || receiverId === 'grix-ai')}
              />
              <div className="flex flex-col min-w-0">
                <h2 className="text-[14px] font-black text-[var(--header-text)] leading-tight truncate">
                  {isGroup ? (receiver?.name || 'Group') : (receiver?.fullName || (receiverId === 'gx-ai' || receiverId === 'flow-ai' || receiverId === 'grix-ai' ? 'Grix AI' : 'GrixChat User'))}
                </h2>
                <span className="text-[10px] text-[var(--header-text)] opacity-80 font-bold tracking-tight truncate flex items-center gap-1 h-4">
                  {isTyping ? (
                    <span className="flex items-center gap-1 text-[var(--primary)] animate-pulse">
                      <span>typing</span>
                      <span className="flex gap-0.5 items-center pb-0.5">
                        <motion.span animate={{ y: [0, -2, 0] }} transition={{ duration: 0.5, repeat: Infinity, ease: 'easeInOut' }} className="w-1 h-1 bg-[var(--primary)] rounded-full" />
                        <motion.span animate={{ y: [0, -2, 0] }} transition={{ duration: 0.5, repeat: Infinity, ease: 'easeInOut', delay: 0.15 }} className="w-1 h-1 bg-[var(--primary)] rounded-full" />
                        <motion.span animate={{ y: [0, -2, 0] }} transition={{ duration: 0.5, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }} className="w-1 h-1 bg-[var(--primary)] rounded-full" />
                      </span>
                    </span>
                  ) : (
                    getStatusText()
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Header Options */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Active Close / Dismiss Cross Icon only if search is open */}
            {showSearch && (
              <button 
                type="button"
                onClick={toggleSearch}
                className="p-2 hover:bg-white/10 rounded-full transition-colors cursor-pointer border-none bg-transparent"
                title="Close Search"
              >
                <X size={21} className="text-[#0494f4] font-bold animate-pulse" />
              </button>
            )}

            {/* 3-Dot Dropdown */}
            <div className="relative" ref={optionsRef}>
              <button aria-label="More options" 
                type="button"
                onClick={() => setDropdownOpen(true)}
                className="w-12 h-12 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors cursor-pointer border-none bg-transparent"
              >
                <MoreVertical size={22} className="text-[var(--header-text)]" />
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <ChatHeaderDropdown 
                    isOpen={dropdownOpen}
                    onClose={() => setDropdownOpen(false)}
                    receiverId={receiverId}
                    receiver={receiver}
                    isGroup={isGroup}
                    isMuted={isMuted}
                    setIsMuted={setIsMuted}
                    isArchived={!!isArchived}
                    archiveChat={archiveChat}
                    isHidden={!!isHidden}
                    hideChat={hideChat}
                    deleteChat={deleteChat}
                    clearChat={clearChat}
                    startCall={startCall}
                    triggerSearch={() => {
                      if (setShowSearch) setShowSearch(true);
                    }}
                    onSelectChatTime={onSelectChatTime}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}

      {/* Slide-out Native Calendar & Search Bar exactly like Telegram / Whatsapp */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden bg-[#111b21]/95 px-4 pb-3 border-t border-white/5 flex flex-col gap-2"
          >
            <div className="flex items-center gap-3 bg-[#202c33] rounded-xl px-3 py-2 w-full mt-1 border border-white/5 shadow-inner">
              <Search size={16} className="text-zinc-400 shrink-0" />
              
              <input 
                type="text"
                placeholder="Search messages by keyword..."
                value={searchQuery}
                onChange={(e) => setSearchQuery && setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-xs text-zinc-100 placeholder-zinc-500 outline-none w-full border-none"
              />

              {/* Symmetrical Calendar Anchor */}
              <div className="relative w-7 h-7 flex items-center justify-center hover:bg-zinc-700/60 rounded-full transition-colors shrink-0">
                <Calendar 
                  size={16} 
                  className={selectedDate ? "text-[#0494f4] font-bold" : "text-zinc-400"} 
                />
                <input 
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate && setSelectedDate(e.target.value)}
                  className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                  title="Search messages by date"
                />
              </div>

              {/* Symmetrical Clear Input Button */}
              {searchQuery && (
                <button aria-label="Close" 
                  type="button"
                  onClick={() => setSearchQuery && setSearchQuery('')}
                  className="p-0.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white shrink-0 border-none bg-transparent cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Display active filter helpers */}
            {hasActiveFilters && (
              <div className="flex items-center justify-between px-1">
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] text-zinc-500">Filters:</span>
                  {searchQuery && (
                    <span className="text-[10px] font-semibold bg-[#222e35] text-[#0494f4] px-2 py-0.5 rounded-full border border-[#0494f4]/20">
                      &ldquo;{searchQuery}&rdquo;
                    </span>
                  )}
                  {selectedDate && (
                    <span className="text-[10px] font-semibold bg-[#222e35] text-[#0494f4] px-2 py-0.5 rounded-full border border-[#0494f4]/20 flex items-center gap-1">
                      <span>Date:</span>
                      <span>{selectedDate}</span>
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-[10px] text-[#0494f4] hover:text-[#0382d6] font-bold underline cursor-pointer bg-transparent border-none flex items-center gap-1"
                >
                  <Eraser size={11} />
                  <span>Reset filters</span>
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
