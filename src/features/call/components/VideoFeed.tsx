import React from 'react';
import { motion } from 'motion/react';
import { VideoOff, Sparkles, AudioLines } from 'lucide-react';
import { CallStatus } from '../types/callTypes';

interface VideoFeedProps {
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  isVideoOff: boolean;
  callStatus: CallStatus;
  timer: number;
  receiver?: any;
  /**
   * True as soon as the peer's video track reaches this device. The glass
   * placeholder is only for the wait — showing it over a live stream (as the
   * old code did, unconditionally) hides the actual call behind a blur.
   */
  hasRemoteVideo?: boolean;
}

export const VideoFeed: React.FC<VideoFeedProps> = ({
  localVideoRef,
  remoteVideoRef,
  isVideoOff,
  callStatus,
  receiver,
  hasRemoteVideo = false,
}) => {
  const photoUrl = receiver?.photoURL || receiver?.photo_url || "https://cdn-icons-png.flaticon.com/512/149/149071.png";
  const displayName = receiver?.fullName || receiver?.full_name || receiver?.username || 'GrixChat User';

  return (
    <div className="absolute inset-0 z-0 bg-zinc-950 overflow-hidden">
      {/* 1. Full-screen Remote Video */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live call video: captions need a live transcription service */}
      <video 
        ref={remoteVideoRef as any} 
        autoPlay 
        playsInline 
        className="w-full h-full object-cover transition-opacity duration-1000 absolute inset-0 z-0"
      />
      
      {/* 2. Glassmorphism placeholder — only until the peer's video arrives */}
      {!hasRemoteVideo && (
      <div className="absolute inset-0 z-1 bg-gradient-to-b from-zinc-950/70 via-zinc-900/40 to-zinc-950/80 backdrop-blur-[60px] flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="relative mb-6 flex items-center justify-center scale-90 md:scale-100">
          {/* Wave Ripple 1 */}
          <motion.div
            animate={{ scale: [1, 1.4, 1], opacity: [0.15, 0.4, 0.15] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="absolute w-44 h-44 rounded-full border border-sky-500/30 bg-sky-500/5"
          />
          {/* Wave Ripple 2 */}
          <motion.div
            animate={{ scale: [1, 1.8, 1], opacity: [0.08, 0.25, 0.08] }}
            transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            className="absolute w-44 h-44 rounded-full border border-indigo-500/20 bg-indigo-500/5"
          />
          {/* Wave Ripple 3 (High vibe indicator) */}
          <motion.div
            animate={{ scale: [1, 2.2, 1], opacity: [0.03, 0.12, 0.03] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 2.2 }}
            className="absolute w-44 h-44 rounded-full border border-purple-500/10 bg-purple-500/5"
          />

          {/* Center Avatar Container */}
          <div className="w-28 h-28 md:w-32 md:h-32 rounded-full ring-[6px] ring-white/5 overflow-hidden shadow-2xl relative z-10 p-0.5 bg-gradient-to-tr from-sky-400 to-indigo-500">
            <img 
              src={photoUrl} 
              className="w-full h-full object-cover rounded-full"
              alt={displayName}
              referrerPolicy="no-referrer"
            />
          </div>
        </div>

        {/* Info panel */}
        <div className="z-10 bg-zinc-900/60 border border-white/5 rounded-3xl p-5 max-w-xs backdrop-blur-md shadow-2xl">
          <p className="text-[10px] font-black tracking-widest text-sky-400 uppercase flex items-center justify-center gap-1.5 mb-1.5">
            <Sparkles size={11} className="text-sky-400" />
            <span>{callStatus === 'connected' ? 'Waiting for Video' : 'Connecting Call'}</span>
          </p>
          <h3 className="text-base font-black text-white truncate uppercase tracking-widest">{displayName}</h3>
          <p className="text-[10px] text-zinc-400 font-mono mt-1 flex items-center justify-center gap-1">
            <AudioLines size={12} className="text-zinc-500 animate-pulse" />
            <span>{callStatus === 'connected' ? 'Peer connected — starting video' : 'Establishing secure media line'}</span>
          </p>
        </div>
      </div>
      )}

      {/* 3. Local Video Overlay (Pip) */}
      <motion.div 
        drag
        dragMomentum={false}
        dragConstraints={{ left: -200, right: 200, top: -400, bottom: 400 }}
        className="absolute top-[90px] md:top-[112px] right-4 w-28 h-40 md:w-32 md:h-48 bg-zinc-900 rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl z-20 cursor-move"
      >
        <video 
          ref={localVideoRef as any} 
          autoPlay 
          playsInline 
          muted 
          className={`w-full h-full object-cover ${isVideoOff ? 'hidden' : 'block'}`}
        />
        {isVideoOff && (
          <div className="w-full h-full flex items-center justify-center bg-zinc-900">
            <VideoOff size={24} className="text-zinc-600" />
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default VideoFeed;
