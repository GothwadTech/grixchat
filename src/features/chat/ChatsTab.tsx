import React, { useCallback } from 'react';
import { useSearch } from '../../contexts/SearchContext.tsx';
import { useNavigate } from 'react-router-dom';
import { Phone, Loader2 } from 'lucide-react';
import { useLayout } from '../../contexts/LayoutContext.tsx';
import { useConversations } from './hooks/useConversations.ts';
import { useCalls } from './hooks/useCalls.ts';
import { useAuth } from '../../providers/AuthProvider.tsx';
import { ChatUserList } from './components/ChatUserList.tsx';
import { CallsHistoryList } from '../call/components/CallsHistoryList.tsx';
import { initializeAcceptedConversations } from '../../utils/acceptedChats';
import { storage } from '../../services/StorageService';
import CommonSearchBar from '../../components/common/CommonSearchBar';

export default function ChatsTab() {
  const navigate = useNavigate();
  const { user: _authUser, userData } = useAuth();
  const { searchTerm, setSearchTerm } = useSearch();
  const { 
    activeFilters, 
    chatListFilter 
  } = useLayout();
  const activeFilter = activeFilters['chats'] || 'Chats';
  
  const { 
    conversations, 
    otherUsers, 
    loading: conversationsLoading,
    loadingMore: conversationsLoadingMore,
    hasMore: conversationsHasMore,
    loadMore: conversationsLoadMore
  } = useConversations(activeFilter);
  
  const { 
    calls, 
    loading: callsLoading,
    loadingMore: callsLoadingMore,
    hasMore: callsHasMore,
    loadMore: callsLoadMore
  } = useCalls(activeFilter);
  
  const loading = activeFilter === 'Calls' ? callsLoading : conversationsLoading;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isScrollable = target.scrollHeight > target.clientHeight;
    const closeToBottom = target.scrollHeight - target.scrollTop - target.clientHeight <= 100;
    if (isScrollable && target.scrollTop > 5 && closeToBottom) {
      if (activeFilter === 'Calls') {
        if (callsHasMore && !callsLoadingMore) {
          callsLoadMore();
        }
      } else {
        if (conversationsHasMore && !conversationsLoadingMore) {
          conversationsLoadMore();
        }
      }
    }
  }, [activeFilter, callsHasMore, callsLoadingMore, callsLoadMore, conversationsHasMore, conversationsLoadingMore, conversationsLoadMore]);

  const isSecretCodeEntered = !!(
    searchTerm && 
    userData?.hiddenChatSettings?.secretCode && 
    searchTerm.trim().toLowerCase() === userData.hiddenChatSettings.secretCode.trim().toLowerCase()
  );

  // Extract all user IDs that are part of hidden conversations
  const hiddenUserIds = React.useMemo(() => {
    if (!userData?.hiddenChats || !conversations) return [];
    return conversations
      .filter(c => userData.hiddenChats.includes(c.id))
      .map(c => c.otherUserId);
  }, [userData?.hiddenChats, conversations]);

  const filteredConversations = conversations.filter(c => {
    const isHidden = Array.isArray(userData?.hiddenChats) && userData.hiddenChats.includes(c.id);
    const isArchived = Array.isArray(userData?.archivedChats) && userData.archivedChats.includes(c.id);
    
    // Always hide hidden chats from the main chat lists/matches (they only show in unlocked /chats/hidden screen)
    if (isHidden) return false;
    if (isArchived) return false;

    // Support dynamic WhatsApp/Telegram filters
    if (chatListFilter === 'direct' && c.type !== 'direct') return false;
    if (chatListFilter === 'groups' && c.type !== 'group') return false;
    if (chatListFilter === 'channels' && c.type !== 'group') return false;

    // Filter out Message Requests (not yet accepted)
    if (conversations.length > 0 && !storage.getItem('grix_accepted_chats_initialized')) {
      initializeAcceptedConversations(conversations.map(x => x.id));
    }

    const matchesSearch = (c.user || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (c.username || "").toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

  const filteredOtherUsers = otherUsers.filter(u => {
    // Hide users who are part of any hidden conversation from standard suggestions
    if (hiddenUserIds.includes(u.uid)) return false;

    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (u.fullName || "")?.toLowerCase().includes(term) || 
           (u.username || "")?.toLowerCase().includes(term);
  });

  return (
    <div className="h-full flex flex-col bg-[var(--bg-card)] overflow-hidden animate-fade-in touch-pan-y">
      
      <div onScroll={handleScroll} className="flex-1 overflow-y-auto no-scrollbar pb-32 bg-[var(--bg-card)]">

        {/* Scrollable Reusable Search Bar */}
        <CommonSearchBar 
          placeholder="Search chats or messages..."
          value={searchTerm}
          onChange={setSearchTerm}
          onClear={() => setSearchTerm('')}
        />

        {/* User List (Chats or Calls) */}
        <div className="flex flex-col mt-1">
          {searchTerm && (
            <div className="px-4 py-2 bg-[var(--bg-main)]/30 border-b border-[var(--border-color)]/5 select-none text-[10px] font-black text-[#0494f4] uppercase tracking-wider flex items-center justify-between select-none font-mono">
              <span>Matching results for "{searchTerm}"</span>
              <span className="bg-[#0479c2]/20 text-[#0494f4] px-1.5 py-0.5 rounded text-[9px] font-bold">Client-Side Search</span>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-8 h-8 border-4 border-[var(--primary)]/20 border-t-[var(--primary)] rounded-full animate-spin" />
              <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">Loading {activeFilter === 'Calls' ? 'Calls' : 'Chats'}...</p>
            </div>
          ) : activeFilter === 'Calls' ? (
            (() => {
              const filteredCalls = calls.filter(call => !hiddenUserIds.includes(call.otherUserId));
              if (filteredCalls.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-20 px-10 text-center gap-4">
                    <div className="p-4 bg-[var(--bg-main)] rounded-full text-[var(--text-secondary)]">
                      <Phone size={40} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-[var(--text-primary)] mb-1">No calls yet</h3>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                        Your recent calls will appear here.
                      </p>
                    </div>
                  </div>
                );
              }
              return (
                <div className="flex flex-col">
                  <CallsHistoryList 
                    calls={filteredCalls} 
                    loading={callsLoading} 
                    onCall={(userId, type) => navigate(`/call/${userId}?type=${type}`)}
                    onReset={() => {}}
                  />
                  {callsLoadingMore && (
                    <div className="flex items-center justify-center py-4 gap-2 bg-[var(--bg-card)]">
                      <Loader2 size={16} className="text-[#0494f4] animate-spin" />
                      <span className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-wider">Loading more calls...</span>
                    </div>
                  )}
                </div>
              );
            })()
          ) : (
            <>
              <ChatUserList 
                conversations={filteredConversations}
                otherUsers={searchTerm ? [] : filteredOtherUsers} // Only show "Others" if not searching or if search returns nothing? 
                                                                 // Actually the user said "others user" should be below.
                showGrixAI={!searchTerm} 
                archivedCount={userData?.archivedChats?.length || 0}
                showSecretHeader={isSecretCodeEntered}
                onSecretHeaderClick={() => navigate('/chats/hidden')}
                secretCount={userData?.hiddenChats?.length || 0}
                showHiddenChatsEntry={userData?.hiddenChatSettings?.showMenuEntry !== false}
                loading={loading}
                usersWithStories={[]}
              />
              {conversationsLoadingMore && (
                <div className="flex items-center justify-center py-4 gap-2 bg-[var(--bg-card)]">
                  <Loader2 size={16} className="text-[#0494f4] animate-spin" />
                  <span className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-wider">Loading more chats...</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
