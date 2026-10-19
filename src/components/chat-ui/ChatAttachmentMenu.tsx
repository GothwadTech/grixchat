import React, { useEffect, useRef } from 'react';
import { Image, FileText, MapPin, BarChart3, Folder, ClipboardList } from 'lucide-react';
import { motion } from 'motion/react';
import { useDialog } from '../../hooks/useDialog';

interface ChatAttachmentMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPhotoVideo: () => void;
  onSelectFile: () => void;
  onSelectFiles: () => void;
  onSelectLocation: () => void;
  onSelectPoll: () => void;
  onSelectTask: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}

export default function ChatAttachmentMenu({
  isOpen,
  onClose,
  onSelectPhotoVideo,
  onSelectFile,
  onSelectFiles,
  onSelectLocation,
  onSelectPoll,
  onSelectTask,
  buttonRef
}: ChatAttachmentMenuProps) {
  useDialog(onClose, isOpen);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current && 
        !containerRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose, buttonRef]);

  if (!isOpen) return null;

  return (
    <>
      {/* Absolute fallback backdrop to dismiss on click/tap */}
      <div role="presentation" 
        className="fixed inset-0 z-[100] bg-transparent cursor-default" 
        onClick={onClose} 
      />

      {/* 100% Symmetrical elegant menu matching the Chat Header Dropdown style precisely */}
      <div className="absolute bottom-16 right-4 sm:right-14 z-[101]">
        <motion.div
          ref={containerRef}
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          className="w-[190px] bg-[var(--bg-card)] border border-[var(--border-color)]/60 shadow-[0_10px_35px_rgba(0,0,0,0.15)] rounded-2xl p-1.5 flex flex-col gap-[1px] text-[var(--text-primary)] overflow-hidden select-none"
        >
          {/* Photo & Video Item */}
          <button
            type="button"
            onClick={() => {
              onSelectPhotoVideo();
              onClose();
            }}
            className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--bg-main)]/80 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
          >
            <Image size={16} className="text-[#0494f4]" />
            <span>Photo & Video</span>
          </button>

          {/* Document Item */}
          <button
            type="button"
            onClick={() => {
              onSelectFile();
              onClose();
            }}
            className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--bg-main)]/80 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
          >
            <FileText size={16} className="text-indigo-400" />
            <span>Document</span>
          </button>

          {/* Files Item (for pdf, folder etc.) */}
          <button
            type="button"
            onClick={() => {
              onSelectFiles();
              onClose();
            }}
            className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--bg-main)]/80 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
          >
            <Folder size={16} className="text-[#3b82f6]" />
            <span>Files</span>
          </button>

          {/* Shared Location Item */}
          <button
            type="button"
            onClick={() => {
              onSelectLocation();
              onClose();
            }}
            className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--bg-main)]/80 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
          >
            <MapPin size={16} className="text-emerald-500" />
            <span>Location</span>
          </button>

          {/* Interactive Poll Item */}
          <button
            type="button"
            onClick={() => {
              onSelectPoll();
              onClose();
            }}
            className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--bg-main)]/80 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
          >
            <BarChart3 size={16} className="text-amber-500" />
            <span>Poll</span>
          </button>

          {/* Task Item */}
          <button
            type="button"
            onClick={() => {
              onSelectTask();
              onClose();
            }}
            className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-main)] active:bg-[var(--bg-main)]/80 transition-colors flex items-center gap-3 rounded-xl cursor-pointer border-none bg-transparent"
          >
            <ClipboardList size={16} className="text-pink-400" />
            <span>Task</span>
          </button>
        </motion.div>
      </div>
    </>
  );
}
