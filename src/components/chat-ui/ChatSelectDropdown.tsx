import React from 'react';
import { 
  MessageSquare, 
  CheckSquare, 
  Lock, 
  Star, 
  ListPlus, 
  Trash2
} from 'lucide-react';
import { motion } from 'motion/react';

interface ChatSelectDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAll: () => void;
  onLockChats: () => void;
  onActionWithAlert: (msg: string) => void;
}

export const ChatSelectDropdown: React.FC<ChatSelectDropdownProps> = ({
  isOpen,
  onClose,
  onSelectAll,
  onLockChats,
  onActionWithAlert,
}) => {
  if (!isOpen) return null;

  const selectOptions = [
    { 
      label: 'Mark as unread', 
      icon: MessageSquare, 
      onClick: () => onActionWithAlert('Marked selected conversations as unread!') 
    },
    { 
      label: 'Select all', 
      icon: CheckSquare, 
      onClick: () => {
        onSelectAll();
        onClose();
      } 
    },
    { 
      label: 'Lock chats', 
      icon: Lock, 
      onClick: () => {
        onLockChats();
        onClose();
      } 
    },
    { 
      label: 'Add to Favorites', 
      icon: Star, 
      onClick: () => onActionWithAlert('Added chats to Favorites list!') 
    },
    { 
      label: 'Add to list', 
      icon: ListPlus, 
      onClick: () => onActionWithAlert('Added selected chats to list folders!') 
    },
    { 
      label: 'Clear chats', 
      icon: Trash2, 
      isDanger: true,
      onClick: () => onActionWithAlert('Cleared chat message threads!') 
    },
  ];

  return (
    <>
      {/* Backdrop trigger for soft dismissal on tap */}
      <div role="presentation" 
        className="fixed inset-0 z-[100] bg-transparent cursor-default" 
        onClick={onClose} 
      />

      {/* Symmetrical elegant dropdown matching ChatHeaderDropdown animations and styles precisely */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ duration: 0.12, ease: 'easeOut' }}
        className="absolute right-0 top-11 z-[101] w-[190px] bg-[var(--bg-card)] border border-[var(--border-color)]/60 shadow-[0_10px_35px_rgba(0,0,0,0.15)] rounded-2xl p-1.5 flex flex-col gap-[1px] text-[var(--text-primary)] overflow-hidden select-none"
      >
        <div className="flex flex-col gap-[1px]">
          {selectOptions.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={opt.onClick}
              className={`w-full px-4 py-2.5 text-left text-[13px] font-semibold transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent ${
                opt.isDanger 
                  ? 'text-rose-500 hover:bg-rose-500/10 active:bg-rose-500/15' 
                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--bg-main)]/80'
              }`}
            >
              <opt.icon 
                size={16} 
                className={opt.isDanger ? 'text-rose-500' : 'text-[var(--text-secondary)]'} 
              />
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </>
  );
};
