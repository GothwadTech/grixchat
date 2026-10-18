import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, Settings, Unlock } from 'lucide-react';
import { useAuth } from '../../providers/AuthProvider';
import { useConversations } from './hooks/useConversations';
import { ChatUserList } from './components/ChatUserList';
import { CommonSearchBar } from '../../components/common/CommonSearchBar';
import { motion } from 'motion/react';

// Safe Session Storage Wrapper for sandboxed iframe environments
const safeSessionStorage = {
  getItem: (key: string): string | null => {
    try {
      return sessionStorage.getItem(key);
    } catch (_e) {
      // Fallback to window global memory if denied
      return (window as any)[`__grix_${key}`] || null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      sessionStorage.setItem(key, value);
    } catch (_e) {
      // Fallback to window global memory if denied
      (window as any)[`__grix_${key}`] = value;
    }
  },
  removeItem: (key: string): void => {
    try {
      sessionStorage.removeItem(key);
    } catch (_e) {
      // Fallback to window global memory if denied
      delete (window as any)[`__grix_${key}`];
    }
  }
};

export default function HideChatScreen() {
  const navigate = useNavigate();
  const { userData } = useAuth();
  const { conversations, loading } = useConversations('Chats');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Lock state
  const secretCode = userData?.hiddenChatSettings?.secretCode || '';
  const [isUnlocked, setIsUnlocked] = useState(() => {
    // If no secret code is configured yet, we let them enter so they can set one
    if (!userData?.hiddenChatSettings?.secretCode) return true;
    return safeSessionStorage.getItem('grix_hidden_unlocked') === 'true';
  });
  const [inputCode, setInputCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Synchronize lock state when userData updates
  useEffect(() => {
    if (!secretCode) {
      setIsUnlocked(true);
    } else {
      const alreadyUnlocked = safeSessionStorage.getItem('grix_hidden_unlocked') === 'true';
      setIsUnlocked(alreadyUnlocked);
    }
  }, [secretCode]);

  const handleUnlock = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!secretCode) return;

    if (inputCode.trim() === secretCode.trim()) {
      safeSessionStorage.setItem('grix_hidden_unlocked', 'true');
      setIsUnlocked(true);
      setErrorMsg('');
    } else {
      setErrorMsg('Incorrect Secret Code');
      setInputCode('');
    }
  };

  const handleLock = () => {
    safeSessionStorage.removeItem('grix_hidden_unlocked');
    setIsUnlocked(false);
    setInputCode('');
    setErrorMsg('');
  };

  // Filter only hidden chats matching search term
  const hiddenConversations = conversations.filter(c => {
    const isHidden = userData?.hiddenChats?.includes(c.id);
    if (!isHidden) return false;

    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (c.user || '').toLowerCase().includes(term) ||
      (c.username || '').toLowerCase().includes(term)
    );
  });

  // Render Lock Screen if there is a configured secret code and we are locked
  if (!isUnlocked && secretCode) {
    return (
      <div className="h-full flex flex-col bg-[var(--bg-xs)] justify-between overflow-hidden font-sans select-none">
        {/* Header with back */}
        <div className="shrink-0 flex items-center px-4 min-h-[56px] pt-safe pb-1.5 bg-[var(--header-bg)] border-b border-[var(--border-color)]/35 shadow-sm rounded-b-2xl">
          <button aria-label="Back" 
            onClick={() => navigate('/profile')} 
            className="w-12 h-12 flex items-center justify-center hover:bg-black/5 rounded-full transition-colors"
          >
            <ArrowLeft size={22} className="text-[var(--header-text)]" />
          </button>
          <span className="text-sm font-bold text-[var(--header-text)]/60 uppercase tracking-widest ml-2">Secure Unlock</span>
        </div>

        {/* Lock Body */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-[340px] bg-[var(--bg-card)] border border-[var(--border-color)]/55 rounded-3xl p-6 shadow-[0_15px_40px_rgba(0,0,0,0.15)] flex flex-col items-center text-center space-y-6"
          >
            {/* Pulsing Shield Icon Container */}
            <div className="relative w-16 h-16 bg-rose-500/10 text-rose-500 rounded-2xl flex items-center justify-center border border-rose-500/15">
              <Lock size={28} className="animate-pulse" />
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-[var(--bg-card)]" />
            </div>

            <div className="space-y-2">
              <h2 className="text-lg font-black text-[var(--text-primary)] tracking-tight uppercase">
                Hidden Chats Locked
              </h2>
              <p className="text-xs text-[var(--text-secondary)]/80 leading-relaxed font-medium">
                Please enter your Grix Secret Code to view the hidden chats.
              </p>
            </div>

            <form onSubmit={handleUnlock} className="w-full space-y-4">
              <div className="relative">
                <input 
                  type="password"
                  placeholder="Enter secret code (e.g. #786)"
                  value={inputCode}
                  onChange={(e) => {
                    setErrorMsg('');
                    setInputCode(e.target.value);
                  }}
                  autoFocus
                  className="w-full bg-[var(--bg-main)] border border-[var(--border-color)] rounded-xl px-4 py-3.5 text-center text-base font-black tracking-widest text-[var(--text-primary)] outline-none focus:border-[var(--primary)] transition-all shadow-sm"
                />
              </div>

              {errorMsg && (
                <motion.p 
                  initial={{ y: -5, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="text-xs font-bold text-rose-500 text-center animate-bounce"
                >
                  {errorMsg}
                </motion.p>
              )}

              <button
                type="submit"
                disabled={!inputCode.trim()}
                className="w-full py-3 bg-[var(--primary)] text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-[var(--primary)]/15 hover:shadow-[var(--primary)]/25 flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-40 select-none cursor-pointer"
              >
                <Unlock size={14} />
                Unlock Area
              </button>
            </form>
          </motion.div>
        </div>

        <div className="pb-8 text-center text-[9px] font-bold text-[var(--text-secondary)]/50 uppercase tracking-[0.22em] select-none">
          Grix Cryptographic Bridge
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-card)] overflow-hidden font-sans">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 min-h-[56px] pt-safe pb-1.5 bg-[var(--header-bg)] z-50 shadow-sm border-b border-[var(--border-color)]/35 rounded-b-2xl">
        <div className="flex items-center gap-3">
          <button aria-label="Back" onClick={() => navigate('/profile')} className="w-12 h-12 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors">
            <ArrowLeft size={22} className="text-[var(--header-text)]" />
          </button>
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-[var(--header-text)] opacity-60" />
            <h1 className="text-xl font-black text-[var(--header-text)] tracking-tight">
              Hidden chats
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {secretCode && (
            <button 
              onClick={handleLock}
              className="w-12 h-12 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors"
              title="Lock Screen"
            >
              <Lock size={20} className="text-[var(--header-text)] text-rose-400" />
            </button>
          )}
          <button 
            onClick={() => navigate('/chats/hidden/settings')}
            className="w-12 h-12 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors"
            title="Hidden Settings"
          >
            <Settings size={20} className="text-[var(--header-text)]" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-10 animate-fade-in scroll-smooth">
        <CommonSearchBar 
          placeholder="Search hidden chats..."
          value={searchTerm}
          onChange={setSearchTerm}
          onClear={() => setSearchTerm('')}
        />

        <ChatUserList 
          conversations={hiddenConversations}
          loading={loading}
          emptyMessage={searchTerm ? "No matches found" : "No hidden chats"}
          emptySubMessage={searchTerm ? "Try searching for another name or username." : "Secret conversations can be tucked away here for maximum privacy."}
        />
      </div>
    </div>
  );
}
