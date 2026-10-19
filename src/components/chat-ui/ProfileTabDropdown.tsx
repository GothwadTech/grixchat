import React, { useEffect, useState } from 'react';
import { 
  UserPlus, 
  LogOut, 
  User,
  Shield,
  Github,
  Terminal
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../providers/AuthProvider.tsx';
import { MultiAccountService, StoredAccount } from '../../services/MultiAccountService';
import { storage } from '../../services/StorageService';
import { authService } from '../../features/auth/services/authService.ts';
import { TabDropdownShell } from './TabDropdownShell';

interface ProfileTabDropdownProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileTabDropdown: React.FC<ProfileTabDropdownProps> = ({
  isOpen,
  onClose,
}) => {
  const navigate = useNavigate();
  const { userData, user: authUser } = useAuth();
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);

  useEffect(() => {
    if (isOpen) {
      setAccounts(MultiAccountService.getAccounts());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddAccount = () => {
    storage.setItem('grix_adding_account', 'true');
    onClose();
    navigate('/login');
  };

  const handleSwitchAccount = async (userId: string) => {
    onClose();
    await MultiAccountService.switchAccount(userId);
  };

  const handleProfileLogout = async () => {
    onClose();
    try {
      await authService.logout();
      navigate('/login');
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  // Filter out the currently active account to list other switchable accounts below
  const otherAccounts = accounts.filter(acc => acc.userId !== authUser?.id);
  const DEFAULT_LOGO = "https://cdn-icons-png.flaticon.com/512/149/149071.png";
  const _profilePic = userData?.photoURL || (userData as any)?.photo_url || authUser?.user_metadata?.avatar_url || DEFAULT_LOGO;

  return (
    <TabDropdownShell onDismiss={onClose} label="Profile menu">
        <div className="flex flex-col gap-[1px]">
          {/* Top: Current active account (styled exactly like switch profiles, with User icon) */}
          <div className="w-full px-4 py-2.5 text-left flex items-center gap-3 min-w-0 text-[13px] font-semibold text-[var(--text-primary)]">
            <User size={16} className="text-[var(--text-secondary)] shrink-0" />
            <span className="truncate flex-1 font-semibold">@{userData?.username || 'username'}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0479c2] shrink-0" />
          </div>

          {/* Other Switchable accounts listed immediately below current account */}
          {otherAccounts.length > 0 && (
            <div className="flex flex-col gap-[1px]">
              {otherAccounts.map((acc) => (
                <button
                  key={acc.userId}
                  type="button"
                  onClick={() => handleSwitchAccount(acc.userId)}
                  className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--bg-main)]/80 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
                >
                  <User size={16} className="text-[var(--text-secondary)] shrink-0" />
                  <span className="truncate flex-1 font-semibold text-[var(--text-secondary)]">@{acc.username}</span>
                </button>
              ))}
            </div>
          )}

          {/* Options divider styled as a clean top-border on the next section to ensure mathematically exact spacing with zero layout noise */}
          <button
            type="button"
            onClick={handleAddAccount}
            className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--bg-main)]/80 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent border-t border-[var(--border-color)]/30 mt-1 pt-2"
          >
            <UserPlus size={16} className="text-[var(--text-secondary)] shrink-0" />
            <span>Add Account</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              navigate('/app-lock');
            }}
            className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--bg-main)]/80 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
          >
            <Shield size={16} className="text-[var(--text-secondary)] shrink-0" />
            <span>Profile PIN</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              navigate('/github');
            }}
            className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--bg-main)]/80 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
          >
            <Github size={16} className="text-[var(--text-secondary)] shrink-0" />
            <span>GitHub</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              window.dispatchEvent(new CustomEvent('toggle-dev-console'));
            }}
            className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--bg-main)]/80 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
          >
            <Terminal size={16} className="text-[var(--text-secondary)] shrink-0" />
            <span>Console</span>
          </button>

          {/* Last option: Logout of current account */}
          <button
            type="button"
            onClick={handleProfileLogout}
            className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-rose-500 hover:bg-rose-500/10 active:bg-rose-500/10 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent border-t border-[var(--border-color)]/30 mt-1 pt-2"
          >
            <LogOut size={16} className="text-rose-500 shrink-0" />
            <span>Log Out</span>
          </button>
        </div>
    </TabDropdownShell>
  );
};
