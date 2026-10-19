import { useState, useEffect } from 'react';
import { 
  Users, 
  Shield, 
  Bell, 
  MessageSquare, 
  Sliders, 
  Star, 
  VolumeX, 
  UserMinus, 
  HelpCircle, 
  Lock,
  Info as InfoIcon,
  ChevronRight as ChevronRightIcon
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../providers/AuthProvider';
import { CommonSearchBar } from '../../../components/common/CommonSearchBar';
import Avatar from '../../../components/common/Avatar';
import { truncateToChars } from '../../../utils/bioHelper';
import { MultiAccountService, StoredAccount } from '../../../services/MultiAccountService';

export default function ProfileSettingsContent() {
  const { user: authUser, userData } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [switchableAccounts, setSwitchableAccounts] = useState<StoredAccount[]>([]);

  useEffect(() => {
    const list = MultiAccountService.getAccounts().filter((acc) => acc.userId !== authUser?.id);
    setSwitchableAccounts(list);
  }, [authUser]);

  const settingsItems = [
    { icon: Users, label: 'Account Settings', sub: 'Change email, password, delete account', onClick: () => navigate('/account-settings') },
    { icon: Lock, label: 'Privacy Settings', sub: userData?.isPrivate ? 'Private Account' : 'Public Account', onClick: () => navigate('/privacy-settings') },
    { icon: Shield, label: 'App Lock PIN', sub: 'Enable PIN/Passcode protection', onClick: () => navigate('/app-lock') },
    { icon: Bell, label: 'Notifications & Sounds', sub: 'Ringtones, Vibrations & Alerts', onClick: () => navigate('/notifications-settings') },
    { icon: MessageSquare, label: 'Chat Customizer & Wallpaper', sub: 'Bubbles shape, text size, wallpapers', onClick: () => navigate('/chat-settings') },
    { icon: Sliders, label: 'System Preferences', sub: 'App theme, network download, local database Backups', onClick: () => navigate('/app-preferences') },
    { icon: Star, label: 'Favorites Feed', sub: 'Manage star list curation', onClick: () => navigate('/favorites') },
    { icon: VolumeX, label: 'Muted Accounts', sub: 'Silenced chat channels', onClick: () => navigate('/muted-accounts') },
    { icon: UserMinus, label: 'Blocked Accounts', sub: 'Banned chat list users', onClick: () => navigate('/blocked-accounts') },
    { icon: HelpCircle, label: 'Grixvibe FAQ & Support', sub: 'Knowledgebase and system status', onClick: () => navigate('/help') },
    { icon: InfoIcon, label: 'About App', sub: 'Grixvibe V1.2.0 Stable Build', onClick: () => navigate('/app-info') },
  ];

  const DEFAULT_LOGO = "https://cdn-icons-png.flaticon.com/512/149/149071.png";
  const profilePic = userData?.photoURL || (userData as any)?.photo_url || authUser?.user_metadata?.avatar_url || DEFAULT_LOGO;

  const filteredItems = settingsItems.filter(item => 
    item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.sub && item.sub.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="w-full flex flex-col bg-[var(--bg-card)] overflow-hidden animate-fade-in touch-pan-y">
      <div className="flex-1 overflow-y-auto no-scrollbar pb-32 bg-[var(--bg-card)]">
        {/* Scrollable Reusable Search Bar */}
        <CommonSearchBar 
          placeholder="Search settings..."
          value={searchQuery}
          onChange={setSearchQuery}
          onClear={() => setSearchQuery('')}
        />

        {/* Settings options list */}
        <div className="flex flex-col mt-1 bg-[var(--bg-card)]">
          {searchQuery === '' && (
            <>
              {/* Profile card click element */}
              <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } }} 
                onClick={() => navigate('/edit-profile')}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--border-color)]/5 active:bg-[var(--border-color)]/10 transition-all duration-205 group cursor-pointer select-none border-b border-[var(--border-color)]/5 border-l-[4px] border-l-transparent"
              >
                <Avatar 
                  url={profilePic} 
                  type="direct" 
                  name={userData?.fullName || userData?.username || 'GrixChat User'} 
                  isOnline={false} 
                />
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <h3 className="text-[14.5px] truncate font-semibold text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors">
                    {userData?.fullName || 'GrixChat User'}
                  </h3>
                  <p className="text-[13px] text-[var(--text-secondary)] opacity-75 mt-0.5 font-medium truncate">
                    @{userData?.username || 'username'}
                  </p>
                </div>
                <ChevronRightIcon size={16} className="text-[var(--text-secondary)] opacity-15 group-hover:opacity-60 group-hover:translate-x-0.5 transition-all duration-200 shrink-0" />
              </div>

              {/* Bio block display */}
              {userData?.bio && (
                <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } }} 
                  onClick={() => navigate('/edit-profile')}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--border-color)]/5 active:bg-[var(--border-color)]/10 transition-all duration-205 group cursor-pointer select-none border-b border-[var(--border-color)]/5 border-l-[4px] border-l-transparent"
                >
                  <div className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center bg-[var(--primary)] text-[var(--primary-foreground)] border border-[var(--primary)]/10 shadow-sm shrink-0 group-hover:scale-[1.02] transition-transform">
                    <InfoIcon size={20} className="stroke-[2.2]" />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center select-none">
                    <span className="text-[10.5px] font-black text-[#0494f4] uppercase tracking-wider block font-sans opacity-95">
                      Bio
                    </span>
                    <p className="text-[13px] text-[var(--text-primary)] font-medium italic mt-0.5 truncate leading-tight">
                      "{truncateToChars(userData.bio)}"
                    </p>
                  </div>
                  <ChevronRightIcon size={16} className="text-[var(--text-secondary)] opacity-15 group-hover:opacity-60 group-hover:translate-x-0.5 transition-all duration-200 shrink-0" />
                </div>
              )}

              {/* Other registered accounts list */}
              {switchableAccounts.map((acc) => (
                <button 
                  key={acc.userId}
                  onClick={() => MultiAccountService.switchAccount(acc.userId)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--border-color)]/5 active:bg-[var(--border-color)]/10 transition-all duration-205 group text-left cursor-pointer select-none border-none outline-none bg-transparent border-b border-[var(--border-color)]/5 last:border-b-0 border-l-[4px] border-l-transparent"
                >
                  <div className="w-12 h-12 rounded-full overflow-hidden border border-[var(--border-color)]/20 shadow-sm shrink-0 group-hover:scale-[1.02] transition-all duration-150">
                    <img 
                      src={acc.photoURL} 
                      alt={acc.fullName} 
                      className="w-full h-full object-cover" 
                      referrerPolicy="no-referrer" 
                    />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <h3 className="text-[14.5px] truncate font-semibold text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors">
                      Switch Profile
                    </h3>
                    <p className="text-[13px] text-[var(--text-secondary)] opacity-75 mt-0.5 font-medium truncate">
                      @{acc.username}
                    </p>
                  </div>
                  <ChevronRightIcon size={16} className="text-[var(--text-secondary)] opacity-15 group-hover:opacity-60 group-hover:translate-x-0.5 transition-all duration-200 shrink-0" />
                </button>
              ))}
            </>
          )}

          {/* Render filtered settings option list */}
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2 select-none px-4">
              <p className="text-[13px] font-bold text-[var(--text-secondary)]">No settings matched your search</p>
              <p className="text-[11px] text-[var(--text-secondary)]/60 max-w-xs">Try searching for app preferences, account, password, sound, block etc.</p>
            </div>
          ) : (
            filteredItems.map((item) => (
              <button 
                key={item.label}
                onClick={item.onClick}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--border-color)]/5 active:bg-[var(--border-color)]/10 transition-all duration-205 group text-left cursor-pointer select-none border-none outline-none bg-transparent border-b border-[var(--border-color)]/5 last:border-b-0 border-l-[4px] border-l-transparent"
              >
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-[var(--primary)] text-[var(--primary-foreground)] border border-[var(--primary)]/10 shadow-sm group-hover:scale-[1.02] transition-transform shrink-0">
                  <item.icon size={20} className="stroke-[2.2]" />
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <h3 className="text-[14.5px] truncate font-semibold text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors">
                    {item.label}
                  </h3>
                  {item.sub && (
                    <p className="text-[13px] text-[var(--text-secondary)] opacity-75 mt-0.5 font-medium truncate">
                      {item.sub}
                    </p>
                  )}
                </div>
                <ChevronRightIcon size={16} className="text-[var(--text-secondary)] opacity-15 group-hover:opacity-60 group-hover:translate-x-0.5 transition-all duration-200 shrink-0" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
