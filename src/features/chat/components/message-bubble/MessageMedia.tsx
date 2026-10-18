import React from 'react';
import { motion } from 'motion/react';
import { FileIcon, Download, Play, Film } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { VoiceMessage } from '../../../../components/ChatUIComponents';

interface VideoPreviewBubbleProps {
  mediaUrl: string;
  isMe: boolean;
  receiver: any;
  isSending?: boolean;
}

const VideoPreviewBubble: React.FC<VideoPreviewBubbleProps> = ({
  mediaUrl,
  isMe,
  receiver,
  isSending = false,
}) => {
  const navigate = useNavigate();
  const [duration, setDuration] = React.useState<string>('');
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const totalSec = Math.floor(videoRef.current.duration);
      if (isNaN(totalSec) || !isFinite(totalSec)) return;
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      setDuration(`${mins}:${secs.toString().padStart(2, '0')}`);
    }
  };

  const handleOpenFullscreen = (e: React.MouseEvent) => {
    if (isSending) return;
    e.stopPropagation();
    navigate('/chat/preview', {
      state: {
        videoUrl: mediaUrl,
        senderName: isMe ? 'You' : (receiver?.fullName || receiver?.full_name || 'GrixChat User')
      }
    });
  };

  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      onClick={handleOpenFullscreen}
      className="mb-1 rounded-2xl overflow-hidden border border-white/5 dark:border-white/10 aspect-video w-64 bg-[#0a0a0c] group/video relative shadow-lg cursor-pointer"
    >
      <video
        ref={videoRef}
        src={mediaUrl}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        className="w-full h-full object-cover opacity-85 group-hover/video:opacity-95 transition-opacity"
        playsInline
        muted
      />
      <div className="absolute inset-0 bg-black/15 group-hover/video:bg-black/5 transition-colors duration-200" />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <div className="w-12 h-12 rounded-full flex items-center justify-center bg-black/45 backdrop-blur-md border border-white/20 text-white shadow-2xl transition-all group-hover/video:scale-110 active:scale-95 duration-200">
          <Play size={20} className="fill-white stroke-none ml-0.5" />
        </div>
      </div>
      <div className="absolute bottom-2.5 right-2.5 bg-black/65 backdrop-blur-sm border border-white/10 rounded-lg px-2 py-0.5 flex items-center gap-1.5 text-white/95 text-[9.5px] font-black tracking-wider select-none shadow z-10">
        <Film size={10} className="stroke-[2.2]" />
        <span>{duration || 'Video'}</span>
      </div>
      {isSending && (
        <div className="absolute inset-0 bg-black/65 backdrop-blur-[1.5px] flex flex-col items-center justify-center gap-2 z-20">
          <div className="w-8 h-8 rounded-full border-2 border-white/25 border-t-[var(--primary)] animate-spin" />
          <span className="text-[8.5px] font-extrabold tracking-widest text-[#0494f4] uppercase animate-pulse select-none">
            Uploading
          </span>
        </div>
      )}
    </motion.div>
  );
};

interface MessageMediaProps {
  mediaUrl: string;
  mediaType: string;
  isMe: boolean;
  receiver: any;
  fileName?: string;
  isSending?: boolean;
}

export const MessageMedia: React.FC<MessageMediaProps> = ({
  mediaUrl,
  mediaType,
  isMe,
  receiver,
  fileName,
  isSending = false,
}) => {
  const navigate = useNavigate();

  if (!mediaUrl) return null;

  if (mediaType === 'image') {
    return (
      <motion.div 
        className="mb-1 rounded-xl overflow-hidden border border-white/5 dark:border-white/10 shadow-md cursor-pointer relative group-hover:scale-[1.01] transition-transform duration-250"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (isSending) return;
          e.stopPropagation();
          navigate('/chat/preview', { 
            state: { 
              imageUrl: mediaUrl, 
              senderName: isMe ? 'You' : receiver?.fullName 
            } 
          });
        }}
      >
        <img 
          src={mediaUrl} 
          alt="Shared attachment preview" 
          className="max-w-full h-auto max-h-64 object-cover hover:opacity-95 transition-opacity"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent pointer-events-none" />
        
        {isSending && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1.5px] flex flex-col items-center justify-center gap-1.5 z-20">
            <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-[var(--primary)] animate-spin" />
            <span className="text-[8.5px] font-extrabold tracking-widest text-[#0494f4] uppercase animate-pulse select-none">
              Uploading
            </span>
          </div>
        )}
      </motion.div>
    );
  }

  if (mediaType === 'video') {
    return <VideoPreviewBubble mediaUrl={mediaUrl} isMe={isMe} receiver={receiver} isSending={isSending} />;
  }

  if (mediaType === 'audio') {
    return (
      <div className="mb-1 w-full flex justify-center relative">
        <VoiceMessage fileUrl={mediaUrl} isMe={isMe} />
        {isSending && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px] rounded-xl flex items-center justify-center gap-2 z-20 px-4">
            <div className="w-4 h-4 rounded-full border border-white/20 border-t-[var(--primary)] animate-spin" />
            <span className="text-[8px] font-black text-[#0494f4] uppercase tracking-widest animate-pulse">
              sending...
            </span>
          </div>
        )}
      </div>
    );
  }

  if (mediaType === 'file') {
    return (
      <div className="mb-1.5 p-2 rounded-xl bg-black/10 dark:bg-black/15 border border-white/10 flex items-center gap-3 relative overflow-hidden shadow-sm group/file w-full min-w-[200px] hover:bg-black/15 transition-all">
        <div className="w-8 h-8 rounded-lg bg-[var(--primary)]/90 text-white flex items-center justify-center shadow-md shrink-0">
          <FileIcon size={16} className="stroke-[2.2]" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-xs font-bold truncate text-[var(--bubble-text-own)] leading-tight">
            {fileName || 'Document File'}
          </p>
          <p className="text-[8px] opacity-70 font-semibold tracking-wide uppercase mt-0.5">
            {mediaUrl.split('.').pop()?.toUpperCase() || 'FILE'} • DOCUMENT
          </p>
        </div>
        {isSending ? (
          <div className="p-1.5 rounded-full text-white flex items-center justify-center shrink-0">
            <div className="w-4 h-4 rounded-full border border-white/20 border-t-[var(--primary)] animate-spin" />
          </div>
        ) : (
          <a 
            href={mediaUrl} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="p-1.5 bg-white/10 hover:bg-white/15 rounded-full text-white transition-all active:scale-90 flex items-center justify-center shadow whitespace-nowrap shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <Download size={11} className="stroke-[2.5]" />
          </a>
        )}
      </div>
    );
  }

  return null;
};
