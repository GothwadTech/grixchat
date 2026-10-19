import React from 'react';
import { X } from 'lucide-react';

interface PinnedMessageBannerProps {
  pinnedMsg: any | null;
  onUnpinClick: () => void;
}

export const PinnedMessageBanner: React.FC<PinnedMessageBannerProps> = ({
  pinnedMsg,
  onUnpinClick,
}) => {
  if (!pinnedMsg) return null;

  const handleBannerClick = () => {
    const element = document.getElementById(`msg-${pinnedMsg.id}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } }} 
      onClick={handleBannerClick}
      className="shrink-0 h-11 bg-[#17212b] border-b border-zinc-800 flex items-center px-4 justify-between gap-3 cursor-pointer hover:bg-zinc-850/60 transition-colors z-[45]"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-1 h-7 bg-[#5085b4] rounded" />
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] font-black text-[#5288c1] uppercase tracking-wider leading-none">Pinned Message</span>
          <p className="text-xs text-zinc-300 truncate font-semibold leading-normal mt-0.5 max-w-xs sm:max-w-md">
            {pinnedMsg.content || pinnedMsg.text || 'Media attachment'}
          </p>
        </div>
      </div>
      <button aria-label="Close" 
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUnpinClick();
        }}
        className="p-1 rounded-full text-zinc-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer border-none bg-transparent"
      >
        <X size={14} />
      </button>
    </div>
  );
};
