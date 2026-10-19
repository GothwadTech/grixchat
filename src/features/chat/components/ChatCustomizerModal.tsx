import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Palette } from 'lucide-react';
import { storage } from '../../../services/StorageService';
import { useDialog } from '../../../hooks/useDialog';

interface BackgroundItem {
  id: string;
  label: string;
  preview?: string;
}

interface BubbleItem {
  id: string;
  label: string;
  preview: string;
}

interface ChatCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  receiver: any;
  receiverId: string | undefined;
  customBg: string | null;
  setCustomBg: (bg: string | null) => void;
}

const WALLPAPERS: BackgroundItem[] = [
  { id: '', label: 'Default Solid' },
  { id: 'bg-gradient-to-br from-[#121214] via-[#1a1226] to-[#0d0912]', label: 'Cosmic Dusk', preview: 'bg-gradient-to-br from-[#121214] via-[#1a1226] to-[#0d0912]' },
  { id: 'bg-gradient-to-br from-[#0c1612] via-[#092218] to-[#04100c]', label: 'Minty Herb', preview: 'bg-gradient-to-br from-[#0c1612] via-[#092218] to-[#04100c]' },
  { id: 'bg-gradient-to-br from-[#091522] via-[#040e1a] to-[#02060c]', label: 'Deep Ocean', preview: 'bg-gradient-to-br from-[#091522] via-[#040e1a] to-[#02060c]' },
  { id: 'bg-gradient-to-br from-[#121212] via-[#1a1a1a] to-[#0d0d0d]', label: 'Charcoal Night', preview: 'bg-gradient-to-br from-[#121212] via-[#1a1a1a] to-[#0d0d0d]' },
];

const BUBBLES: BubbleItem[] = [
  { id: '', label: 'Default Glow', preview: 'bg-indigo-600' },
  { id: 'ocean-indigo', label: 'Ocean Indigo', preview: 'bg-gradient-to-br from-teal-400 to-indigo-600' },
  { id: 'forest-magic', label: 'Forest Magic', preview: 'bg-gradient-to-br from-emerald-400 to-teal-600' },
  { id: 'crimson-fire', label: 'Crimson Fire', preview: 'bg-gradient-to-br from-rose-400 to-orange-600' },
  { id: 'sunset-violet', label: 'Sunset Violet', preview: 'bg-gradient-to-br from-violet-600 to-purple-800' },
];

export const ChatCustomizerModal: React.FC<ChatCustomizerModalProps> = ({
  isOpen,
  onClose,
  receiver,
  receiverId,
  customBg,
  setCustomBg,
}) => {
  useDialog(onClose, isOpen);
  if (!receiverId) return null;

  const handleBgSelect = (bgId: string) => {
    if (bgId === '') {
      storage.removeItem(`app-chat-background-${receiverId}`);
    } else {
      storage.setItem(`app-chat-background-${receiverId}`, bgId);
    }
    setCustomBg(bgId || null);
    window.dispatchEvent(new Event(`chat-customization-changed-${receiverId}`));
  };

  const handleBubbleSelect = (bubbleId: string) => {
    if (bubbleId === '') {
      storage.removeItem(`app-chat-bubble-${receiverId}`);
    } else {
      storage.setItem(`app-chat-bubble-${receiverId}`, bubbleId);
    }
    window.dispatchEvent(new Event(`chat-customization-changed-${receiverId}`));
  };

  const activeBubbleId = storage.getItem(`app-chat-bubble-${receiverId}`) || '';

  return (
    <AnimatePresence>
      {isOpen && (
        <div role="dialog" aria-modal="true" aria-label="chat customizer modal" className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/75 backdrop-blur-[2px]">
          <div role="presentation" className="absolute inset-0" onClick={onClose} />
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-[90%] max-w-[340px] bg-[var(--bg-card)] border border-[var(--border-color)]/30 rounded-[28px] shadow-[0_20px_50px_rgba(0,0,0,0.45)] p-5 z-[100001] flex flex-col gap-4 text-left select-none"
          >
            <div className="flex items-center gap-2 text-[#0494f4] font-black">
              <Palette size={20} className="stroke-[2.5]" />
              <h3 className="text-[16px] font-black text-[var(--text-primary)] leading-none">
                Customize Chat Room
              </h3>
            </div>

            <p className="text-[12px] font-semibold text-[var(--text-secondary)] opacity-85 leading-normal -mt-1">
              Personalize background style and chat bubble gradients specifically for {receiver?.full_name || 'this friend'}.
            </p>

            {/* SECTION: BACKGROUND WALLPAPER */}
            <div className="flex flex-col gap-1.5">
              <h4 className="text-[10px] font-black uppercase text-[#0494f4] tracking-wider">Background Wallpaper</h4>
              <div className="grid grid-cols-2 gap-1.5">
                {WALLPAPERS.map((bgItem) => {
                  const isSelected = (customBg || '') === bgItem.id;
                  return (
                    <button
                      key={bgItem.label}
                      type="button"
                      onClick={() => handleBgSelect(bgItem.id)}
                      className={`p-1.5 rounded-xl text-left border cursor-pointer select-none transition-all flex flex-col gap-1 w-full bg-transparent ${
                        isSelected ? 'border-[#0494f4] bg-[#0479c2]/5' : 'border-[var(--border-color)]/20 hover:bg-white/5'
                      }`}
                    >
                      <div className={`h-5 w-full rounded-md border border-white/5 ${bgItem.preview || 'bg-[var(--bg-main)]'}`} />
                      <span className={`text-[9.5px] font-bold leading-normal truncate ${isSelected ? 'text-[#0494f4]' : 'text-[var(--text-primary)]'}`}>
                        {bgItem.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* SECTION: BUBBLE GRADIENT */}
            <div className="flex flex-col gap-1.5 mt-0.5">
              <h4 className="text-[10px] font-black uppercase text-[#0494f4] tracking-wider">Self Bubble Gradient</h4>
              <div className="grid grid-cols-2 gap-1.5">
                {BUBBLES.map((bubItem) => {
                  const isSelected = activeBubbleId === bubItem.id;
                  return (
                    <button
                      key={bubItem.label}
                      type="button"
                      onClick={() => handleBubbleSelect(bubItem.id)}
                      className={`p-1.5 rounded-xl text-left border cursor-pointer select-none transition-all flex flex-col gap-1 w-full bg-transparent ${
                        isSelected ? 'border-[#0494f4] bg-[#0479c2]/5' : 'border-[var(--border-color)]/20 hover:bg-white/5'
                      }`}
                    >
                      <div className={`h-5 w-full rounded-md border border-white/5 ${bubItem.preview}`} />
                      <span className={`text-[9.5px] font-bold leading-normal truncate ${isSelected ? 'text-[#0494f4]' : 'text-[var(--text-primary)]'}`}>
                        {bubItem.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full text-center py-2.5 text-[13px] font-black text-white bg-[#0479c2] hover:bg-[#0382d6] active:scale-[0.98] transition-all rounded-xl cursor-pointer border-none shadow-sm mt-1"
            >
              Apply Customs
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
