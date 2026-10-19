import { useState, useRef, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { 
  Bell, 
  MoreVertical, 
  Settings, 
  Users, 
  Archive,
  EyeOff,
  Heart,
  VolumeX,
  Lock,
  Radio,
  MessageCircle,
  Trash,
  Pin,
  ArrowLeft
} from 'lucide-react';
import { storage } from '../../services/StorageService';
import { LocalDataCache } from '../../services/LocalDataCache';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useSearch } from '../../contexts/SearchContext.tsx';
import { useAuth } from '../../providers/AuthProvider.tsx';
import { useLayout } from '../../contexts/LayoutContext.tsx';
import { ChatTabDropdown } from '../chat-ui/ChatTabDropdown';
import { ChatSelectDropdown } from '../chat-ui/ChatSelectDropdown';
import { ProfileTabDropdown } from '../chat-ui/ProfileTabDropdown';
export default function TabHeader() {
  const { userData, user: authUser, refreshUserData } = useAuth();
  useSearch();
  const location = useLocation();
  const _navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [_isMuted, _setIsMuted] = useState(false);
  const [hasUnreadLikes, setHasUnreadLikes] = useState(false);
  const [hasUnreadNotifs, setHasUnreadNotifs] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showSelectMenu, setShowSelectMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const selectMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
      if (selectMenuRef.current && !selectMenuRef.current.contains(event.target as Node)) {
        setShowSelectMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const uid = authUser?.id;
    if (!uid || !supabase) return;

    const fetchUnread = async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('type, is_read')
        .eq('user_id', uid)
        .eq('is_read', false)
        .limit(20);
      
      if (!error && data) {
        const hasLikes = data.some(d => ["like", "comment"].includes(d.type));
        const hasNotifs = data.some(d => ["follow", "system"].includes(d.type));
        
        setHasUnreadLikes(hasLikes);
        setHasUnreadNotifs(hasNotifs);
      }
    };

    fetchUnread();

    const headerChannelId = `tab-header-notifs:${uid}-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(headerChannelId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${uid}`
      }, () => {
        fetchUnread();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authUser?.id]);

  const { chatListFilter, setChatListFilter, isChatSelectMode, setChatSelectMode, selectedChatIds, setSelectedChatIds } = useLayout();

  const _menuOptions = [
    { label: 'New group', icon: Users, path: '/new-group?type=group' },
    { label: 'New channel', icon: Radio, path: '/new-group?type=channel' },
    { label: 'Archived', icon: Archive, path: '/chats/archived' },
    ...(userData?.hiddenChatSettings?.showMenuEntry !== false ? [
      { label: 'Hidden chats', icon: EyeOff, path: '/chats/hidden' }
    ] : []),
    { label: 'Settings', icon: Settings, path: '/profile' },
  ];

  const _filterOptions = [
    { label: 'All Chats', filter: 'all', icon: MessageCircle },
    { label: 'Private Chats', filter: 'direct', icon: Lock },
    { label: 'Groups Only', filter: 'groups', icon: Users },
    { label: 'Channels Only', filter: 'channels', icon: Radio },
  ] as const;

  const isChatsPage = location.pathname === '/' || location.pathname === '/chats';
  const _isStoriesPage = location.pathname === '/stories';
  const isReelsPage = location.pathname === '/reels';
  const _isPostsPage = location.pathname === '/posts';
  const _isSearchPage = location.pathname === '/search';
  const isProfilePage = location.pathname === '/profile';
  const _isCallsPage = location.pathname === '/calls';

  if (isChatSelectMode && isChatsPage) {
    const handleSelectAll = () => {
      const cachedList = authUser ? (LocalDataCache.getConversations(authUser.uid || authUser.id) || []) : [];
      const activeIds = cachedList.filter((c: any) => {
        const isHidden = Array.isArray(userData?.hiddenChats) && userData.hiddenChats.includes(c.id);
        const isArchived = Array.isArray(userData?.archivedChats) && userData.archivedChats.includes(c.id);
        if (isHidden || isArchived) return false;
        
        if (chatListFilter === 'direct' && c.type !== 'direct') return false;
        if (chatListFilter === 'groups' && c.type !== 'group') return false;
        if (chatListFilter === 'channels' && c.type !== 'group') return false;
        
        return true;
      }).map((c: any) => c.id);
      
      setSelectedChatIds(activeIds);
      setShowSelectMenu(false);
    };

    const handleLockChats = async () => {
      if (userData && authUser) {
        try {
          const currentHidden = Array.isArray(userData.hiddenChats) ? userData.hiddenChats : [];
          const updatedHidden = [...new Set([...currentHidden, ...selectedChatIds])];
          
          if (supabase) {
            const targetId = authUser.id || authUser.uid;
            await supabase
              .from('users')
              .update({ hidden_chats: updatedHidden })
              .eq('id', targetId);
            
            if (refreshUserData) {
              await refreshUserData();
            }
          }
        } catch (err) {
          console.error('Failed to lock chats:', err);
        }
      }
      setSelectedChatIds([]);
      setChatSelectMode(false);
      setShowSelectMenu(false);
    };

    const handleActionWithAlert = (message: string) => {
      alert(message);
      setSelectedChatIds([]);
      setChatSelectMode(false);
      setShowSelectMenu(false);
    };

    return (
      <div className="w-full px-4 min-h-[56px] flex justify-between items-center z-50 shrink-0 relative animate-fade-in select-none">
        <div className="flex items-center gap-3">
          <button aria-label="Back" 
            type="button" 
            onClick={() => {
              setChatSelectMode(false);
              setSelectedChatIds([]);
            }} 
            className="w-11 h-11 flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors cursor-pointer active:scale-95 duration-100"
          >
            <ArrowLeft size={22} className="text-[var(--text-primary)]" />
          </button>
          <span className="font-bold text-[20px] text-[var(--text-primary)]">
            {selectedChatIds.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Pin action */}
          <button 
            type="button"
            disabled={selectedChatIds.length === 0}
            onClick={() => {
              const pinned = JSON.parse(storage.getItem('app-pinned-chats') || '[]');
              let updated = [...pinned];
              
              selectedChatIds.forEach(id => {
                if (updated.includes(id)) {
                  updated = updated.filter(x => x !== id);
                } else if (updated.length < 3) {
                  updated.push(id);
                } else {
                  alert("You can only pin up to 3 chats.");
                }
              });
              
              storage.setItem('app-pinned-chats', JSON.stringify(updated));
              window.dispatchEvent(new Event('pinned-chats-changed'));
              
              setChatSelectMode(false);
              setSelectedChatIds([]);
            }}
            className={`w-11 h-11 flex items-center justify-center rounded-full transition-all cursor-pointer ${
              selectedChatIds.length > 0 
                ? 'text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 active:scale-90' 
                : 'text-[var(--text-secondary)]/20 cursor-not-allowed'
            }`}
            title="Pin/Unpin"
          >
            <Pin size={22} />
          </button>

          {/* Delete (Hide) action */}
          <button 
            type="button"
            disabled={selectedChatIds.length === 0}
            onClick={async () => {
              if (userData && authUser) {
                try {
                  const currentHidden = Array.isArray(userData.hiddenChats) ? userData.hiddenChats : [];
                  const updatedHidden = [...new Set([...currentHidden, ...selectedChatIds])];
                  
                  if (supabase) {
                    const targetId = authUser.id || authUser.uid;
                    await supabase
                      .from('users')
                      .update({ hidden_chats: updatedHidden })
                      .eq('id', targetId);
                    
                    if (refreshUserData) {
                      await refreshUserData();
                    }
                  }
                } catch (err) {
                  console.error('Failed to hide selected chats:', err);
                }
              }
              setSelectedChatIds([]);
              setChatSelectMode(false);
            }}
            className={`w-11 h-11 flex items-center justify-center rounded-full transition-all cursor-pointer ${
              selectedChatIds.length > 0 
                ? 'text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 active:scale-90' 
                : 'text-[var(--text-secondary)]/20 cursor-not-allowed'
            }`}
            title="Delete"
          >
            <Trash size={22} />
          </button>

          {/* Mute action */}
          <button 
            type="button"
            disabled={selectedChatIds.length === 0}
            onClick={() => {
              alert("Muted selected chats!");
              setChatSelectMode(false);
              setSelectedChatIds([]);
            }}
            className={`w-11 h-11 flex items-center justify-center rounded-full transition-all cursor-pointer ${
              selectedChatIds.length > 0 
                ? 'text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 active:scale-90' 
                : 'text-[var(--text-secondary)]/20 cursor-not-allowed'
            }`}
            title="Mute"
          >
            <VolumeX size={22} />
          </button>

          {/* Archive action */}
          <button 
            type="button"
            disabled={selectedChatIds.length === 0}
            onClick={async () => {
              if (userData && authUser) {
                try {
                  const currentArchived = Array.isArray(userData.archivedChats) ? userData.archivedChats : [];
                  const updatedArchived = [...new Set([...currentArchived, ...selectedChatIds])];
                  
                  if (supabase) {
                    const targetId = authUser.id || authUser.uid;
                    await supabase
                      .from('users')
                      .update({ archived_chats: updatedArchived })
                      .eq('id', targetId);
                    
                    if (refreshUserData) {
                      await refreshUserData();
                    }
                  }
                } catch (err) {
                  console.error('Failed to archive chats:', err);
                }
              }
              setSelectedChatIds([]);
              setChatSelectMode(false);
            }}
            className={`w-11 h-11 flex items-center justify-center rounded-full transition-all cursor-pointer ${
              selectedChatIds.length > 0 
                ? 'text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 active:scale-90' 
                : 'text-[var(--text-secondary)]/20 cursor-not-allowed'
            }`}
            title="Archive"
          >
            <Archive size={22} />
          </button>

          {/* 3-Dot vertical dropdown Trigger */}
          <div className="relative" ref={selectMenuRef}>
            <button 
              type="button"
              onClick={() => setShowSelectMenu(prev => !prev)}
              className="w-11 h-11 flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors cursor-pointer relative active:scale-95 duration-100"
              title="More options"
            >
              <MoreVertical size={22} className="text-[var(--text-primary)]" />
            </button>
            <AnimatePresence>
              {showSelectMenu && (
                <ChatSelectDropdown
                  isOpen={showSelectMenu}
                  onClose={() => setShowSelectMenu(false)}
                  onSelectAll={handleSelectAll}
                  onLockChats={handleLockChats}
                  onActionWithAlert={handleActionWithAlert}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 min-h-[56px] flex justify-between items-center z-50 shrink-0 relative">
      <div className="flex items-center">
        <Link to="/chats" className="flex items-center gap-2">
          <h1 className="text-[22px] font-bold text-[var(--text-primary)]">
            GrixChat
          </h1>
        </Link>
      </div>
      <div className="flex items-center gap-1">
        {/* Heart Icon - Show on Reels */}
        {isReelsPage && (
          <Link to="/notifications/likes" className="p-2 hover:bg-black/5 rounded-full transition-colors cursor-pointer group relative">
            <Heart size={22} className="text-[var(--header-text)] group-active:scale-110 transition-transform stroke-[2.5]" fill={location.pathname === '/notifications/likes' ? "currentColor" : "none"} />
            {hasUnreadLikes && (
              <span className="absolute top-2 right-2 w-2 h-2 bg-[#0494f4] rounded-full border-2 border-[var(--header-bg)]" />
            )}
          </Link>
        )}

        {/* Bell Icon - Show on Reels */}
        {isReelsPage && (
          <Link to="/notifications" className="p-2 hover:bg-black/5 rounded-full transition-colors cursor-pointer group relative">
            <Bell size={22} className="text-[var(--header-text)] group-active:scale-110 transition-transform stroke-[2.5]" />
            {hasUnreadNotifs && (
              <span className="absolute top-2 right-2 w-2 h-2 bg-[#0494f4] rounded-full border-2 border-[var(--header-bg)]" />
            )}
          </Link>
        )}

        {/* 3 Dots Menu - Show on Chats tab only */}
        {isChatsPage && (
          <div className="relative" ref={menuRef}>
            <button aria-label="More options" 
              onClick={() => setShowMenu(prev => !prev)}
              className="w-12 h-12 flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors cursor-pointer relative active:scale-95 duration-100"
              id="header-three-dots"
            >
              <MoreVertical size={22} className="text-[var(--header-text)]" />
            </button>
            <AnimatePresence>
              {showMenu && (
                <ChatTabDropdown 
                  isOpen={showMenu}
                  onClose={() => setShowMenu(false)}
                  chatListFilter={chatListFilter}
                  setChatListFilter={setChatListFilter}
                  showHiddenChatsEntry={userData?.hiddenChatSettings?.showMenuEntry !== false}
                />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 3 Dots Menu - Show on Profile Tab */}
        {isProfilePage && (
          <div className="relative" ref={profileMenuRef}>
            <button aria-label="More options" 
              onClick={() => setShowProfileMenu(prev => !prev)}
              className="w-12 h-12 flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors cursor-pointer relative active:scale-95 duration-100"
              id="header-profile-three-dots"
            >
              <MoreVertical size={22} className="text-[var(--header-text)]" />
            </button>
            <AnimatePresence>
              {showProfileMenu && (
                <ProfileTabDropdown 
                  isOpen={showProfileMenu}
                  onClose={() => setShowProfileMenu(false)}
                />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Settings button is removed from header since it is mixed into the profile tab */}
      </div>
    </div>
  );
}
