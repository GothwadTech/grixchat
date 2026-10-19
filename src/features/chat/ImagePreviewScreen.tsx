import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Download, Share2, Play, Pause,
  Volume2, VolumeX, Gauge, RotateCcw, RotateCw, Check,
  MoreVertical, RefreshCw, Trash2, Info, ChevronLeft, ShieldAlert
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

import { logger } from '../../utils/logger';
export default function ImagePreviewScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { imageUrl, videoUrl, senderName, timestamp } = location.state || {};

  // Image & Viewport states
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [bgColor, setBgColor] = useState<'black' | 'slate' | 'emerald'>('black');
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Video player states
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekFeedback, setSeekFeedback] = useState<'rewind' | 'forward' | null>(null);

  // Cache and details
  const [cacheSize, setCacheSize] = useState<string>('0.00 KB');
  const [showDetailsPanel, setShowDetailsPanel] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controlsTimeoutRef = useRef<any>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const mouseStartRef = useRef({ x: 0, y: 0 });

  // Calculate random cache specs to simulate true offline cache registration
  useEffect(() => {
    const randomSize = (Math.random() * 2.8 + 0.4).toFixed(2);
    setCacheSize(`${randomSize} MB`);
  }, [imageUrl, videoUrl]);

  // Stable: only refs and the state setter are touched, so they are safe as effect deps.
  const clearControlsTimeout = useCallback(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
  }, []);

  const resetControlsTimeout = useCallback(() => {
    clearControlsTimeout();
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 4500);
  }, [clearControlsTimeout]);

  // Auto-hide controls timer while playing
  useEffect(() => {
    if (isPlaying && !showSpeedMenu && !showContextMenu && !showDetailsPanel && !isSeeking) {
      resetControlsTimeout();
    } else {
      clearControlsTimeout();
    }
    return () => clearControlsTimeout();
  }, [isPlaying, showSpeedMenu, showContextMenu, showDetailsPanel, isSeeking, resetControlsTimeout, clearControlsTimeout]);


  const toggleControls = (_e: React.MouseEvent) => {
    if (showSpeedMenu || showContextMenu || showDetailsPanel) {
      setShowSpeedMenu(false);
      setShowContextMenu(false);
      setShowDetailsPanel(false);
      return;
    }
    setShowControls(prev => !prev);
    if (!showControls) {
      resetControlsTimeout();
    }
  };

  // Video control triggers
  const handlePlayPause = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(err => console.warn("Video play failed:", err));
      setIsPlaying(true);
    }
    resetControlsTimeout();
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (amount: number) => {
    if (!videoRef.current) return;
    let nextTime = videoRef.current.currentTime + amount;
    nextTime = Math.max(0, Math.min(nextTime, duration));
    videoRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);

    // Double tap feedback animation
    setSeekFeedback(amount < 0 ? 'rewind' : 'forward');
    setTimeout(() => {
      setSeekFeedback(null);
    }, 650);

    resetControlsTimeout();
  };

  const handleLeftDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleSeek(-10);
  };

  const handleRightDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleSeek(10);
  };

  const handleTimelineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (videoRef.current) {
      const nextTime = (val / 100) * duration;
      videoRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    resetControlsTimeout();
  };

  const changeSpeed = (speed: number) => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = speed;
    setPlaybackSpeed(speed);
    setShowSpeedMenu(false);
    resetControlsTimeout();
  };

  const handleRotate = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRotation(prev => (prev + 90) % 360);
    resetControlsTimeout();
  };

  const handleReset = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setScale(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
    setShowContextMenu(false);
  };

  // Dragging support for desktop/mobile panning
  const handleMouseDown = (e: React.MouseEvent) => {
    mouseStartRef.current = { x: e.clientX, y: e.clientY };
    if (scale <= 1) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || scale <= 1) return;
    const nextX = e.clientX - dragStartRef.current.x;
    const nextY = e.clientY - dragStartRef.current.y;
    setPosition({ x: nextX, y: nextY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Single click Google Photos style zoom toggle
  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Verify distance to avoid zooming on drag release
    const dx = Math.abs(e.clientX - mouseStartRef.current.x);
    const dy = Math.abs(e.clientY - mouseStartRef.current.y);
    if (dx > 6 || dy > 6) return;

    if (scale > 1) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    } else {
      setScale(2.5);
    }
  };

  // Helper formatting time
  const formatTime = (timeInSecs: number) => {
    if (isNaN(timeInSecs) || !isFinite(timeInSecs)) return '0:00';
    const mins = Math.floor(timeInSecs / 60);
    const secs = Math.floor(timeInSecs % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetUrl = videoUrl || imageUrl;
    if (!targetUrl) return;

    try {
      const response = await fetch(targetUrl);
      const blob = await response.blob();
      const localBlobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = localBlobUrl;
      link.download = videoUrl ? 'GrixChat_video.mp4' : 'GrixChat_image.jpg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(localBlobUrl);
    } catch {
      window.open(targetUrl, '_blank');
    }
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetUrl = videoUrl || imageUrl;
    if (!targetUrl) return;

    if (navigator.share) {
      navigator.share({
        title: 'GrixChat Media Share',
        text: 'Shared from GrixChat',
        url: targetUrl
      }).catch(err => logger.info('Share dismissed:', err));
    } else {
      navigator.clipboard.writeText(targetUrl);
      alert('Media URL copied to clipboard!');
    }
  };

  const clearViewerCache = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCacheSize('0.00 KB');
    setShowContextMenu(false);
    alert('Temporary viewer media cache cleared safely!');
  };

  const renderTimestamp = () => {
    if (timestamp) return timestamp;
    const now = new Date();
    return `Today at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  if (!imageUrl && !videoUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-black text-white p-6 gap-4">
        <ShieldAlert size={48} className="text-[#0494f4] animate-pulse" />
        <p className="text-sm font-semibold tracking-wide text-white/90">No media parameters to preview</p>
        <button
          onClick={() => navigate(-1)}
          className="px-5 py-2.5 bg-white/10 hover:bg-white/15 rounded-full border border-white/10 text-xs font-black tracking-widest uppercase transition-all"
        >
          Go Back
        </button>
      </div>
    );
  }

  const getBgClass = () => {
    switch (bgColor) {
      case 'slate':
        return 'bg-[#0f1013]';
      case 'emerald':
        return 'bg-[#031d1a]';
      case 'black':
      default:
        return 'bg-black';
    }
  };

  const isMe = senderName === 'You' || !senderName;

  return (
    <div
      ref={containerRef}
      className={`h-[100dvh] w-full transition-colors duration-300 ${getBgClass()} flex flex-col relative overflow-hidden select-none font-sans`}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Dynamic Double Tap Seek Arc Feedback (Video only) */}
      <AnimatePresence>
        {seekFeedback && (
          <motion.div
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            className={`absolute top-1/2 z-[60] transform -translate-y-1/2 pointer-events-none rounded-full bg-black/55 backdrop-blur-md px-6 py-4 flex flex-col items-center gap-2 text-white border border-white/10 shadow-2xl ${
              seekFeedback === 'rewind' ? 'left-[15%]' : 'right-[15%]'
            }`}
          >
            {seekFeedback === 'rewind' ? (
              <>
                <RotateCcw size={24} className="stroke-[2.5]" />
                <span className="text-[10px] font-black tracking-widest uppercase text-sky-400">Rewind -10s</span>
              </>
            ) : (
              <>
                <RotateCw size={24} className="stroke-[2.5]" />
                <span className="text-[10px] font-black tracking-widest uppercase text-sky-400">Forward +10s</span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Premium Header Matching ChatHeader Exactly */}
      <motion.div
        initial={{ y: 0 }}
        animate={{ y: showControls ? 0 : -100 }}
        transition={{ duration: 0.25 }}
        className="absolute top-0 inset-x-0 z-50 shrink-0 flex items-center justify-between px-3 min-h-[64px] pt-safe w-full bg-[var(--header-bg)] border-b border-[var(--border-color)]/35 shadow-sm rounded-b-2xl text-[var(--header-text)]"
      >
        {/* Left Side: Back Arrow & Details text */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button aria-label="Back"
            onClick={() => navigate(-1)}
            type="button"
            className="w-11 h-11 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors shrink-0 text-[var(--header-text)] cursor-pointer"
          >
            <ChevronLeft size={24} className="stroke-[2.5]" />
          </button>
          
          <div className="flex flex-col min-w-0 pr-2">
            <h1 className="text-[var(--header-text)] font-extrabold text-sm tracking-wide leading-tight truncate">
              {isMe ? 'You' : senderName}
            </h1>
            <p className="text-[var(--header-text)]/60 text-[10px] font-medium mt-0.5 tracking-normal truncate">
              {renderTimestamp()}
            </p>
          </div>
        </div>

        {/* Right Side Tools */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleRotate}
            type="button"
            className="w-10 h-10 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors text-[var(--header-text)] cursor-pointer"
            title="Rotate 90"
          >
            <RotateCw size={19} />
          </button>

          <button
            onClick={handleDownload}
            type="button"
            className="w-10 h-10 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors text-[var(--header-text)] cursor-pointer"
            title="Save media"
          >
            <Download size={19} />
          </button>

          <button
            onClick={handleShare}
            type="button"
            className="w-10 h-10 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors text-[var(--header-text)] cursor-pointer"
            title="Share media"
          >
            <Share2 size={19} />
          </button>

          {/* 3-Dot Options dropdown */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowContextMenu(!showContextMenu);
              }}
              type="button"
              className={`w-10 h-10 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors text-[var(--header-text)] cursor-pointer ${
                showContextMenu ? 'bg-white/15' : ''
              }`}
              title="More options"
            >
              <MoreVertical size={20} />
            </button>

            {/* Context Dropdown Box */}
            <AnimatePresence>
              {showContextMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  className="absolute right-0 mt-2 w-52 rounded-2xl bg-[#121318] border border-white/10 p-1.5 shadow-2xl z-50 text-left overflow-hidden"
                >
                  <button
                    onClick={handleRotate}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[11px] font-black text-white/85 hover:bg-white/5 hover:text-white rounded-xl transition-all text-left"
                  >
                    <RotateCw size={13.5} className="text-emerald-400" />
                    <span>Rotate Clockwise</span>
                  </button>

                  <button
                    onClick={handleReset}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[11px] font-black text-white/85 hover:bg-white/5 hover:text-white rounded-xl transition-all text-left"
                  >
                    <RefreshCw size={13.5} className="text-sky-400" />
                    <span>Reset Orientation</span>
                  </button>

                  <div className="h-[1px] bg-white/10 my-1"></div>

                  <div className="px-3.5 py-2 text-[8px] font-black tracking-widest text-white/40 uppercase">
                    Background Mode
                  </div>

                  <div className="grid grid-cols-3 gap-1 px-2.5 pb-2">
                    {['black', 'slate', 'emerald'].map((bg) => (
                      <button
                        key={bg}
                        onClick={() => setBgColor(bg as any)}
                        className={`py-1.5 rounded-lg border text-[9px] font-bold capitalize ${
                          bgColor === bg
                            ? 'bg-white/15 border-white/30 text-white'
                            : 'border-white/5 bg-transparent text-white/50 hover:bg-white/5'
                        }`}
                      >
                        {bg}
                      </button>
                    ))}
                  </div>

                  <div className="h-[1px] bg-white/10 my-1"></div>

                  <button
                    onClick={() => {
                      setShowDetailsPanel(true);
                      setShowContextMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[11px] font-black text-white/85 hover:bg-white/5 hover:text-white rounded-xl transition-all text-left"
                  >
                    <Info size={13.5} className="text-pink-400" />
                    <span>Media Properties</span>
                  </button>

                  <button
                    onClick={clearViewerCache}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[11px] font-black text-rose-450 hover:bg-rose-500/10 rounded-xl transition-all text-left"
                  >
                    <Trash2 size={13.5} />
                    <span>Clear Cache</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      {/* Main Presentation Stage */}
      <div
        className="flex-1 flex items-center justify-center relative overflow-hidden"
        onClick={toggleControls}
        onMouseDown={handleMouseDown}
      >
        {videoUrl ? (
          <div
            className="relative w-full max-w-4xl aspect-video bg-black flex items-center justify-center rounded-2xl overflow-hidden shadow-2xl border border-white/5"
            onClick={(e) => e.stopPropagation()}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              style={{
                transform: `rotate(${rotation}deg) scale(${scale})`,
                transition: isDragging ? 'none' : 'transform 0.25s ease-out'
              }}
              className="w-full h-full object-contain pointer-events-auto"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onClick={handlePlayPause}
              onEnded={() => setIsPlaying(false)}
              playsInline
            />

            {/* Tap areas for dual speed rewinding/seeking */}
            <div
              className="absolute top-0 left-0 w-[33%] h-full z-20 cursor-pointer"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={handleLeftDoubleClick}
            />
            <div
              className="absolute top-0 right-0 w-[33%] h-full z-20 cursor-pointer"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={handleRightDoubleClick}
            />

            {/* Play overlay overlay */}
            <AnimatePresence>
              {(!isPlaying || showControls) && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 bg-black/15"
                >
                  <button
                    onClick={handlePlayPause}
                    className="w-16 h-16 rounded-full flex items-center justify-center bg-black/45 backdrop-blur-md border border-white/20 text-white shadow-2xl pointer-events-auto hover:scale-110 active:scale-95 transition-transform"
                  >
                    {isPlaying ? (
                      <Pause size={25} className="fill-white stroke-none" />
                    ) : (
                      <Play size={25} className="fill-white stroke-none ml-1" />
                    )}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <motion.div
            style={{
              scale,
              rotate: `${rotation}deg`,
              x: position.x,
              y: position.y,
              transition: isDragging ? 'none' : 'transform 0.18s ease-out, scale 0.18s ease-out'
            }}
            className={`relative max-w-full max-h-[85vh] p-4 flex items-center justify-center transition-shadow duration-300 ${
              scale === 1 ? 'cursor-zoom-in' : 'cursor-zoom-out'
            }`}
            onClick={handleImageClick}
          >
            <img
              src={imageUrl}
              alt="Preview Pane"
              className="max-w-full max-h-[80vh] object-contain select-none pointer-events-none rounded-xl"
              referrerPolicy="no-referrer"
            />
          </motion.div>
        )}
      </div>

      {/* Media Details Spec Modal */}
      <AnimatePresence>
        {showDetailsPanel && (
          <div
role="presentation"             className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-5"
            onClick={() => setShowDetailsPanel(false)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              className="bg-[#121318] border border-white/10 rounded-3xl w-full max-w-sm overflow-hidden p-6 text-white text-left shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}
            >
              <button aria-label="Close"
                onClick={() => setShowDetailsPanel(false)}
                className="absolute top-4 right-4 p-1.5 hover:bg-white/10 rounded-full text-white/60 hover:text-white"
              >
                <X size={16} />
              </button>

              <h3 className="text-xs font-black tracking-widest text-[#0494f4] uppercase mb-4">
                Media Property Specs
              </h3>

              <div className="flex flex-col gap-3 text-xs text-white/80 font-semibold mb-6 font-sans">
                <div className="flex justify-between items-center bg-white/5 p-2 rounded-xl">
                  <span className="text-white/50">Sender:</span>
                  <span className="text-white">{isMe ? 'You' : senderName}</span>
                </div>
                <div className="flex justify-between items-center bg-white/5 p-2 rounded-xl">
                  <span className="text-white/50">Media Codec/Type:</span>
                  <span className="text-white font-mono bg-white/10 px-1.5 py-0.5 rounded text-[10px]">
                    {videoUrl ? 'video/mp4 H.264' : 'image/jpeg (RGB)'}
                  </span>
                </div>
                <div className="flex justify-between items-center bg-white/5 p-2 rounded-xl">
                  <span className="text-white/50">Estimated Cache Size:</span>
                  <span className="text-teal-400 font-mono font-bold">{cacheSize}</span>
                </div>
                <div className="flex justify-between items-center bg-white/5 p-2 rounded-xl">
                  <span className="text-white/50">Platform Secure Flag:</span>
                  <span className="text-emerald-400 font-bold uppercase tracking-wider text-[9px] bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    Verified Secure
                  </span>
                </div>
              </div>

              <button
                onClick={() => setShowDetailsPanel(false)}
                className="w-full bg-[#0494f4] hover:bg-[#037ed1] text-white text-[11px] font-black uppercase tracking-wider py-3 rounded-xl transition-all"
              >
                Done
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Bottom Menu Controls (Only rendered if video is playing to keep image preview strictly clean) */}
      {videoUrl && (
        <motion.div
          initial={{ y: 0 }}
          animate={{ y: showControls ? 0 : 100 }}
          transition={{ duration: 0.25 }}
          className="absolute bottom-0 inset-x-0 z-50 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-6 pb-8 flex flex-col gap-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-full flex flex-col gap-2 px-1">
            <div className="flex items-center justify-between text-[11px] font-black text-white/60 tracking-wider">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <div className="relative group/slider flex items-center h-4">
              <input
                type="range"
                min="0"
                max="100"
                value={duration ? (currentTime / duration) * 100 : 0}
                onChange={handleTimelineChange}
                onMouseDown={() => {
                  setIsSeeking(true);
                  clearControlsTimeout();
                }}
                onMouseUp={() => {
                  setIsSeeking(false);
                  resetControlsTimeout();
                }}
                className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#0494f4] focus:outline-none focus:ring-0 active:h-1.5 transition-all group-hover/slider:h-1.5"
                style={{
                  background: `linear-gradient(to right, #0494f4 0%, #0494f4 ${duration ? (currentTime / duration) * 100 : 0}%, rgba(255, 255, 255, 0.2) ${duration ? (currentTime / duration) * 100 : 0}%, rgba(255, 255, 255, 0.2) 100%)`
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-3.5">
              <button
                onClick={handlePlayPause}
                className="p-3 bg-white/10 hover:bg-white/15 hover:text-white rounded-full text-white transition-all active:scale-95"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={17} className="fill-white" /> : <Play size={17} className="fill-white stroke-none ml-0.5" />}
              </button>

              <button
                onClick={() => handleSeek(-10)}
                className="p-2.5 bg-white/5 hover:bg-white/10 rounded-full text-white/80 hover:text-white transition-all active:scale-95 flex items-center justify-center"
                title="Rewind 10s"
              >
                <RotateCcw size={15} />
              </button>

              <button
                onClick={() => handleSeek(10)}
                className="p-2.5 bg-white/5 hover:bg-white/10 rounded-full text-white/80 hover:text-white transition-all active:scale-95 flex items-center justify-center"
                title="Fast Forward 10s"
              >
                <RotateCw size={15} />
              </button>

              <button
                onClick={toggleMute}
                className="p-2.5 bg-white/5 hover:bg-white/10 rounded-full text-white/85 hover:text-white transition-all active:scale-95"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX size={15} className="text-rose-500" /> : <Volume2 size={15} />}
              </button>

              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSpeedMenu(!showSpeedMenu);
                  }}
                  className={`px-3 py-1.5 hover:bg-white/10 rounded-full text-white transition-all flex items-center justify-center gap-1.5 border border-white/10 ${
                    playbackSpeed !== 1 ? 'border-[#0494f4] bg-[#0494f4]/15 text-sky-400' : ''
                  }`}
                >
                  <Gauge size={13} />
                  <span className="text-[10px] font-bold tracking-wide">{playbackSpeed}x</span>
                </button>

                <AnimatePresence>
                  {showSpeedMenu && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9, y: -20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: -20 }}
                      className="absolute bottom-11 left-0 w-28 rounded-2xl bg-[#121318] border border-white/10 p-1 shadow-2xl z-50 overflow-hidden"
                    >
                      {[0.5, 1, 1.25, 1.5, 2].map((speed) => (
                        <button
                          key={speed}
                          onClick={(e) => {
                            e.stopPropagation();
                            changeSpeed(speed);
                          }}
                          className={`w-full flex items-center justify-between px-3.5 py-2 text-[10px] font-black rounded-lg transition-all ${
                            playbackSpeed === speed
                              ? 'bg-[#0494f4] text-white'
                              : 'text-white/80 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <span>{speed === 1 ? 'Normal' : `${speed}x`}</span>
                          {playbackSpeed === speed && <Check size={11} className="stroke-[3]" />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
