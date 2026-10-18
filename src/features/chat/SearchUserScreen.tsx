import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../providers/AuthProvider.tsx';
import { Search, X, ArrowLeft, Loader2, MessageSquare } from 'lucide-react';
import { isUserOnline } from '../../utils/presence';
import Avatar from '../../components/common/Avatar';
import { useLivePresence } from '../../providers/PresenceProvider';

import { sanitizeSearchTerm } from '../../utils/searchTerm';
interface UserProfile {
  uid: string;
  username: string;
  fullName: string;
  photoURL: string;
  isOnline?: boolean;
}

const UserItem = ({ 
  user, 
  navigate
}: { 
  user: UserProfile; 
  navigate: any; 
}) => {
  const liveOf = useLivePresence();
  return (
  <div 
    onClick={() => navigate(`/user/${user.uid}`)}
    className="flex items-center gap-3 p-4 hover:bg-[var(--bg-main)] transition-colors cursor-pointer group"
  >
    <Avatar url={user.photoURL} type="direct" size="md" name={user.username} isOnline={liveOf(user.uid) ?? user.isOnline} />
    <div className="flex-1 min-w-0">
      <h4 className="text-sm font-bold text-[var(--text-primary)] truncate">{user.fullName || user.username}</h4>
      <p className="text-xs text-[var(--text-secondary)] truncate">@{user.username}</p>
    </div>
    <button 
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/chat/${user.uid}`);
      }}
      className="px-3.5 py-1.5 bg-[#0494f4] hover:bg-[#0494f4]/90 text-white rounded-lg text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1 min-w-[85px] shadow-sm shrink-0"
    >
      <MessageSquare size={12} strokeWidth={2.5} />
      <span>Message</span>
    </button>
  </div>
  );
};

export default function SearchUserScreen() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  
  const [userResults, setUserResults] = useState<UserProfile[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    if (!supabase) return;
    try {
      setLoading(true);
      
      // Fetch Suggested Users
      const { data: usersData } = await supabase
        .from('users')
        .select('id, username, full_name, photo_url, is_online, last_seen')
        .neq('id', authUser?.id)
        .limit(20);
      
      if (usersData) {
        setSuggestedUsers(usersData.map(u => ({
          uid: u.id,
          username: u.username,
          fullName: u.full_name,
          photoURL: u.photo_url,
          isOnline: isUserOnline(u.is_online, u.last_seen)
        })));
      }

    } catch (error) {
      console.error('Error fetching discovery data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchTerm.trim()) {
        handleSearch();
      } else {
        fetchInitialData();
      }
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm]);

  const handleSearch = async () => {
    const term = searchTerm.toLowerCase();
    const safeTerm = sanitizeSearchTerm(term);
    if (!safeTerm) { setLoading(false); return; }
    if (!supabase) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('users')
        .select('id, username, full_name, photo_url, is_online, last_seen')
        .or(`username.ilike.%${safeTerm}%,full_name.ilike.%${safeTerm}%`)
        .neq('id', authUser?.id)
        .limit(30);
      
      if (data) {
        setUserResults(data.map(u => ({
          uid: u.id,
          username: u.username,
          fullName: u.full_name,
          photoURL: u.photo_url,
          isOnline: isUserOnline(u.is_online, u.last_seen)
        })));
      }
    } catch (error) {
      console.error('Error searching:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-main)] overflow-hidden font-sans">
      {/* Header (TabHeader style) */}
      <div className="w-full bg-[var(--header-bg)] px-4 h-14 flex items-center z-50 shrink-0 relative border-b border-[var(--border-color)] shadow-sm">
        <div className="flex items-center gap-3">
          <button aria-label="Back" 
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-black/5 rounded-full transition-colors cursor-pointer"
          >
            <ArrowLeft size={24} className="text-[var(--header-text)]" />
          </button>
          <h1 className="text-xl font-black text-[var(--header-text)] tracking-tighter">
            Search Users
          </h1>
        </div>
      </div>

      {/* Search Input Container */}
      <div className="px-4 py-4 z-40 shrink-0">
        <div className="flex items-center bg-[var(--bg-card)] rounded-xl px-4 h-[50px] border border-[var(--border-color)] shadow-sm">
          <Search size={20} className="text-[var(--text-secondary)] mr-3 opacity-50" />
          <input 
            autoFocus
            type="text" 
            placeholder="Search by username or name..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-[15px] font-bold text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/40"
          />
          {searchTerm && (
            <button aria-label="Close" 
              onClick={() => setSearchTerm('')}
              className="p-1 hover:bg-black/5 rounded-full transition-colors"
            >
              <X size={18} className="text-[var(--text-secondary)]" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-20">
        {loading && !searchTerm ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="animate-spin text-blue-500" size={32} />
            <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">Finding Connections...</p>
          </div>
        ) : (
          <div className="space-y-1 flex flex-col">
            <div className="flex items-center justify-between px-6 mb-2">
              <h3 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">
                {searchTerm ? 'Search Results' : 'Suggested For You'}
              </h3>
              {!searchTerm && suggestedUsers.length > 0 && (
                <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest">See All</span>
              )}
            </div>
            {(searchTerm ? userResults : suggestedUsers).map(user => (
              <UserItem 
                key={user.uid} user={user} navigate={navigate} 
              />
            ))}
            
            {!loading && searchTerm && userResults.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className="w-16 h-16 bg-[var(--bg-card)] rounded-full flex items-center justify-center mb-4 border border-[var(--border-color)]">
                  <Search size={24} className="text-[var(--text-secondary)] opacity-20" />
                </div>
                <h4 className="text-sm font-bold text-[var(--text-primary)] mb-1">No users found</h4>
                <p className="text-xs text-[var(--text-secondary)]">Try searching for a different name or username</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
