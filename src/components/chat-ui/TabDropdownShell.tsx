import React, { useEffect } from 'react';
import { motion } from 'motion/react';

interface TabDropdownShellProps {
  /** Called on backdrop click and on Escape. */
  onDismiss: () => void;
  /** Accessible name of the menu. */
  label: string;
  children: React.ReactNode;
}

/**
 * The shared chrome of the header menus on the chat and profile tabs: a click-away
 * backdrop, the animated panel, and Escape to close. Each menu supplies only its
 * own rows.
 */
export const TabDropdownShell: React.FC<TabDropdownShellProps> = ({ onDismiss, label, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <>
      <div role="presentation" className="fixed inset-0 z-[100] bg-transparent cursor-default" onClick={onDismiss} />
      <motion.div
        role="menu"
        aria-label={label}
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ duration: 0.12, ease: 'easeOut' }}
        className="absolute right-0 top-11 z-[101] w-[190px] bg-[var(--bg-card)] border border-[var(--border-color)]/60 shadow-[0_10px_35px_rgba(0,0,0,0.15)] rounded-2xl"
      >
        {children}
      </motion.div>
    </>
  );
};
