import React from 'react';
import { motion, useMotionValue, AnimatePresence, useTransform } from 'motion/react';
import { 
  CornerUpRight,
  ChevronsRight,
  CheckCheck,
  Clock,
  Check,
  MapPin,
  Compass,
  HelpCircle,
  CheckCircle2,
  Circle,
  ClipboardList,
  Calendar
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../providers/AuthProvider.tsx';
import { formatTime } from '../../../utils/dateUtils.ts';
import { storage } from '../../../services/StorageService.ts';
import { isUserOnline } from '../../../utils/presence';
import { ChatMessageReactions } from '../../../components/ChatUIComponents';
import { supabase } from '../../../lib/supabase';
import { LocalDataCache } from '../../../services/LocalDataCache';

// Modular split files
import { SystemMessage } from './message-bubble/SystemMessage';
import { ReplyHeader } from './message-bubble/ReplyHeader';
import { MessageMedia } from './message-bubble/MessageMedia';

interface MessageBubbleProps {
  msg: any;
  isMe: boolean;
  isSameSender: boolean;
  convType: 'direct' | 'group';
  receiver: any;
  activeMessageMenu: any;
  setActiveMessageMenu: (msg: any) => void;
  replyingTo: any;
  setReplyingTo: (msg: any) => void;
  showReactionPicker: any;
  setShowReactionPicker: (msg: any) => void;
  receiverStatus: string;
  handleMessageTap: (e: any, msg: any) => void;
  performReactToMessage: (id: string, emoji: string) => void;
  onJumpToMessage?: (messageId: string) => void;
  isHighlighted?: boolean;
  isLatestMessage?: boolean;
  isSelected?: boolean;
  selectedMsgIds?: any[];
  allMessages?: any[];
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  msg,
  isMe,
  isSameSender,
  convType,
  receiver,
  activeMessageMenu,
  setReplyingTo,
  showReactionPicker,
  setShowReactionPicker,
  handleMessageTap,
  performReactToMessage,
  onJumpToMessage,
  isHighlighted,
  isSelected,
  selectedMsgIds,
  allMessages
}) => {
  const _navigate = useNavigate();
  const { user } = useAuth();
  const x = useMotionValue(0);
  const [swipeActive, setSwipeActive] = React.useState(false);
  const hasVibratedRef = React.useRef(false);

  const replyIconOpacity = useTransform(x, [0, 35], [0, 1]);
  const replyIconScale = useTransform(x, [0, 45], [0.55, 1.15]);
  const replyIconRotate = useTransform(x, [0, 45], [-45, 0]);
  const replyIconX = useTransform(x, [0, 45, 75], [-42, 12, 16]);

  React.useEffect(() => {
    if (!x) return;
    const handler = (latestValue: number) => {
      if (latestValue > 42) {
        setSwipeActive(true);
        if (!hasVibratedRef.current) {
          hasVibratedRef.current = true;
          if (window.navigator && window.navigator.vibrate) {
            try { window.navigator.vibrate(14); } catch (_err) { /* intentionally ignored: best-effort, failure is non-fatal */ }
          }
        }
      } else {
        setSwipeActive(false);
        if (latestValue < 5) {
          hasVibratedRef.current = false;
        }
      }
    };
    if (typeof (x as any).on === 'function') {
      return (x as any).on("change", handler);
    } else if (typeof (x as any).onChange === 'function') {
      return (x as any).onChange(handler);
    }
  }, [x]);

  const [_tick, setTick] = React.useState(0);
  const [customBubble, setCustomBubble] = React.useState<string | null>(null);

  React.useEffect(() => {
    const contactId = receiver?.id || receiver?.uid || (isMe ? msg.receiver_id : msg.sender_id);
    if (!contactId) return;
    
    const loadCustom = () => {
      setCustomBubble(storage.getItem(`app-chat-bubble-${contactId}`));
    };
    loadCustom();
    window.addEventListener(`chat-customization-changed-${contactId}`, loadCustom);
    return () => {
      window.removeEventListener(`chat-customization-changed-${contactId}`, loadCustom);
    };
  }, [receiver, msg, isMe]);

  const bubbleStyleSetting = storage.getItem('app-chat-bubble-style') || 'whatsapp';
  const fontSizeSetting = storage.getItem('app-chat-font-size') || 'medium';

  const contentFontClass = 
    fontSizeSetting === 'small' ? 'text-[12px] leading-relaxed font-normal' :
    fontSizeSetting === 'large' ? 'text-[15.5px] leading-relaxed font-normal' :
    fontSizeSetting === 'extra-large' ? 'text-[17.5px] leading-relaxed font-medium' :
    'text-[14px] leading-snug font-normal'; // medium default is standard visual crispiness

  React.useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 10000); // update relative presence or status tick
    return () => clearInterval(timer);
  }, []);

  // Resolve reply reference
  let resolvedReplyTo = msg.reply_to;
  if (resolvedReplyTo) {
    if (typeof resolvedReplyTo === 'string' || typeof resolvedReplyTo === 'number') {
      const parentMsg = allMessages?.find((m: any) => m.id === resolvedReplyTo);
      if (parentMsg) {
        resolvedReplyTo = {
          id: parentMsg.id,
          sender_id: parentMsg.sender_id,
          content: parentMsg.content || parentMsg.text || '',
          text: parentMsg.text || parentMsg.content || '',
          sender: parentMsg.sender,
          media_url: parentMsg.media_url || parentMsg.imageUrl || parentMsg.fileUrl || null,
          media_type: parentMsg.media_type || parentMsg.type || null,
          file_name: parentMsg.file_name || null
        };
      }
    } else if (typeof resolvedReplyTo === 'object') {
      const pUrl = resolvedReplyTo.media_url || resolvedReplyTo.imageUrl || resolvedReplyTo.fileUrl;
      const pType = resolvedReplyTo.media_type || resolvedReplyTo.type;
      resolvedReplyTo = {
        ...resolvedReplyTo,
        media_url: pUrl || null,
        media_type: pType || null,
      };
    }
  }
  
  // System messages render early, but ONLY after every hook below has run.
  // An early return above the hooks changes the hook count between renders
  // (rules-of-hooks), which crashes React when the same row flips type.
  const isSystemMessage = msg.type === 'system' || msg.media_type === 'system';

  const rawTextContent = typeof msg.content === 'string' ? msg.content : (msg.text || '');
  const isMsgDeleted = msg.is_deleted === true || rawTextContent.includes('🚫 This message was deleted') || rawTextContent.includes('This message was deleted');

  const mediaUrl = isMsgDeleted ? null : (msg.media_url || msg.imageUrl || msg.fileUrl);
  const mediaType = msg.media_type || msg.type;

  const isForwardedMany = !isMsgDeleted && rawTextContent.startsWith('\u200B[FWD_MANY]\u200B');
  const isForwarded = !isMsgDeleted && (isForwardedMany || rawTextContent.startsWith('\u200B[FWD]\u200B'));
  const cleanRawText = isMsgDeleted 
    ? (isMe ? '🚫 You deleted this message' : '🚫 This message was deleted')
    : rawTextContent
        .replace('\u200B[FWD_MANY]\u200B', '')
        .substring(0) 
        .replace('\u200B[FWD]\u200B', '');
  const isGrixAiMessage = !isMsgDeleted && cleanRawText.startsWith('🤖 Grix AI:');
  const actualIsMe = isGrixAiMessage ? false : isMe;

  // Modern, ios, retro, or classic-style shapes
  let bubbleShapeClass = 'rounded-2xl';
  if (bubbleStyleSetting === 'modern') {
    bubbleShapeClass = 'rounded-[20px]';
  } else if (bubbleStyleSetting === 'ios') {
    bubbleShapeClass = 'rounded-[22px]';
  } else if (bubbleStyleSetting === 'retro') {
    bubbleShapeClass = 'rounded-none border-2 border-[var(--border-color)]';
  } else { 
    bubbleShapeClass = 'rounded-2xl';
  }

  // Press-and-hold (long-press) logic for instant message selection
  const holdTimeoutRef = React.useRef<any>(null);
  const touchStartPosRef = React.useRef<{ x: number; y: number } | null>(null);
  const wasLongPressedRef = React.useRef<boolean>(false);

  const startPressTimer = (clientX: number, clientY: number) => {
    if (isMsgDeleted) return;
    
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
    }
    
    wasLongPressedRef.current = false;
    touchStartPosRef.current = { x: clientX, y: clientY };

    // Ultra-fast responsive threshold of 260ms
    holdTimeoutRef.current = setTimeout(() => {
      wasLongPressedRef.current = true;
      if (window.navigator?.vibrate) {
        try { window.navigator.vibrate(35); } catch (_err) { /* intentionally ignored: best-effort, failure is non-fatal */ }
      }
      handleMessageTap({ isLongPress: true, stopPropagation: () => {} }, msg);
    }, 260);
  };

  const cancelPressTimer = () => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      startPressTimer(touch.clientX, touch.clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch && touchStartPosRef.current) {
      const dx = touch.clientX - touchStartPosRef.current.x;
      const dy = touch.clientY - touchStartPosRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 8) {
        cancelPressTimer();
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (wasLongPressedRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
    cancelPressTimer();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      startPressTimer(e.clientX, e.clientY);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (wasLongPressedRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
    cancelPressTimer();
  };

  const handleMouseLeave = () => {
    cancelPressTimer();
  };

  const handleVote = async (optionId: string) => {
    if (!user || isMsgDeleted || !supabase) return;
    try {
      const poll = JSON.parse(cleanRawText);
      const updatedOptions = poll.options.map((opt: any) => {
        const voters = Array.isArray(opt.voters) ? opt.voters : [];
        if (opt.id === optionId) {
          if (voters.includes(user.id)) {
            return { ...opt, voters: voters.filter((uid: string) => uid !== user.id) };
          } else {
            return { ...opt, voters: [...voters, user.id] };
          }
        } else {
          if (!poll.multiple) {
            return { ...opt, voters: voters.filter((uid: string) => uid !== user.id) };
          }
          return opt;
        }
      });
      const updatedPoll = { ...poll, options: updatedOptions };
      const updatedText = JSON.stringify(updatedPoll);

      // 1. Optimistic Cache Update
      const conversationId = msg.conversation_id;
      if (conversationId) {
        const cached = LocalDataCache.getMessages(conversationId) || [];
        const nextMsgs = cached.map((m: any) => {
          if (m.id === msg.id) {
            return { ...m, text: updatedText, content: updatedText };
          }
          return m;
        });
        LocalDataCache.saveMessages(conversationId, nextMsgs);
        LocalDataCache.notify(`messages:${conversationId}`, nextMsgs);
      }

      // 2. Database persistent write
      await supabase
        .from('messages')
        .update({ text: updatedText })
        .eq('id', msg.id);

    } catch (err) {
      console.error("Failed to vote in poll:", err);
    }
  };

  const handleToggleTask = async () => {
    if (!user || isMsgDeleted || !supabase) return;
    try {
      const task = JSON.parse(cleanRawText);
      const updatedStatus = task.status === 'completed' ? 'pending' : 'completed';
      const updatedTask = { ...task, status: updatedStatus };
      const updatedText = JSON.stringify(updatedTask);

      // 1. Optimistic Cache Update
      const conversationId = msg.conversation_id;
      if (conversationId) {
        const cached = LocalDataCache.getMessages(conversationId) || [];
        const nextMsgs = cached.map((m: any) => {
          if (m.id === msg.id) {
            return { ...m, text: updatedText, content: updatedText };
          }
          return m;
        });
        LocalDataCache.saveMessages(conversationId, nextMsgs);
        LocalDataCache.notify(`messages:${conversationId}`, nextMsgs);
      }

      // 2. Database persistent write
      await supabase
        .from('messages')
        .update({ text: updatedText })
        .eq('id', msg.id);

    } catch (err) {
      console.error("Failed to toggle task:", err);
    }
  };

  let renderedContent: any = cleanRawText;
  if (isGrixAiMessage) {
    renderedContent = cleanRawText.replace(/^🤖 Grix AI:\s*/i, '');
  }

  // Render location message beautifully
  if (mediaType === 'location' && !isMsgDeleted) {
    try {
      const loc = JSON.parse(cleanRawText);
      renderedContent = (
        <a 
          href={`https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block mb-1 group/loc max-w-[210px] bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/15 rounded-2xl overflow-hidden transition-all shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="h-24 bg-emerald-400/20 relative flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(#10b981_1.5px,transparent_1.5px)] [background-size:16px_16px] opacity-45" />
            <motion.div 
              animate={{ y: [0, -4, 0] }}
              transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
              className="text-emerald-500 relative z-10"
            >
              <MapPin size={34} className="fill-emerald-500/30 font-black" />
            </motion.div>
          </div>
          <div className="p-3">
            <p className="text-xs font-black text-emerald-400 flex items-center gap-1">
              <Compass size={12} className="animate-spin-slow text-emerald-500" />
              <span>Location shared</span>
            </p>
            <p className="text-[12.5px] font-bold text-zinc-100 truncate mt-0.5">
              {loc.name || 'Shared Location'}
            </p>
            <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">
              {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
            </p>
          </div>
        </a>
      );
    } catch (err) {
      console.warn("Could not parse location JSON:", err);
    }
  }

  // Render interactive poll widget beautifully
  if (mediaType === 'poll' && !isMsgDeleted) {
    try {
      const poll = JSON.parse(cleanRawText);
      const options = poll.options || [];
      const totalVotes = options.reduce((sum: number, opt: any) => sum + (Array.isArray(opt.voters) ? opt.voters.length : 0), 0);

      renderedContent = (
        <div 
          className="flex flex-col gap-2 min-w-[230px] max-w-[280px] p-2 bg-black/15 dark:bg-black/25 rounded-2xl border border-white/5 text-zinc-200 select-none cursor-default"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Question title */}
          <div className="flex items-start gap-2 mb-1.5 pl-0.5">
            <div className="w-6.5 h-6.5 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0 mt-0.5 border border-amber-500/10">
              <HelpCircle size={13} />
            </div>
            <div>
              <p className="text-[13px] font-black text-zinc-100 leading-snug">
                {poll.question}
              </p>
              <p className="text-[8.5px] font-semibold text-zinc-500 uppercase tracking-wider mt-0.5">
                {poll.multiple ? 'Multiple Choices Allowed' : 'Single Option Select'}
              </p>
            </div>
          </div>

          {/* Options List */}
          <div className="space-y-2">
            {options.map((opt: any) => {
              const voters = Array.isArray(opt.voters) ? opt.voters : [];
              const userVoted = voters.includes(user?.id);
              const optVotesCount = voters.length;
              const percentage = totalVotes > 0 ? Math.round((optVotesCount / totalVotes) * 100) : 0;

              return (
                <button
                  key={opt.id}
                  onClick={() => handleVote(opt.id)}
                  className="w-full relative py-2.5 px-3 rounded-xl border border-white/5 hover:border-white/10 text-left bg-[#1e2022]/45 hover:bg-[#1e2022]/70 active:scale-[0.99] transition-all flex items-center justify-between overflow-hidden cursor-pointer select-none border-none outline-none text-white font-sans"
                >
                  {/* Dynamic background progress bar slider */}
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${percentage}%` }}
                    transition={{ type: "spring", stiffness: 45, damping: 15 }}
                    className="absolute inset-y-0 left-0 bg-[var(--primary)]/15 z-0 pointer-events-none rounded-r-lg"
                  />

                  {/* Text contents above progress layer */}
                  <div className="flex items-center gap-2.5 relative z-10 shrink-1 min-w-0 pr-2">
                    {userVoted ? (
                      <CheckCircle2 size={16} className="text-[#0494f4] shrink-0" />
                    ) : (
                      <Circle size={16} className="text-zinc-600 hover:text-zinc-500 shrink-0" />
                    )}
                    <span className={`text-[12px] truncate ${userVoted ? 'font-black text-[#0494f4]' : 'font-bold text-zinc-300'}`}>
                      {opt.text}
                    </span>
                  </div>

                  {/* Vote Count / Percentage display */}
                  <div className="flex items-center gap-1.5 relative z-10 shrink-0 text-[10.5px]">
                    <span className="font-extrabold text-zinc-400">
                      {percentage}%
                    </span>
                    <span className="text-[9px] font-medium text-zinc-500 whitespace-nowrap">
                      ({optVotesCount})
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* total votes count bar */}
          <div className="flex items-center justify-between text-[9px] text-zinc-500 font-extrabold tracking-wider uppercase pt-1.5 px-1 border-t border-white/5 mt-1 leading-none select-none">
            <span>Poll Summary</span>
            <span className="text-[#0494f4]">{totalVotes} {totalVotes === 1 ? 'Vote' : 'Votes'}</span>
          </div>
        </div>
      );
    } catch (err) {
      console.warn("Could not parse poll JSON:", err);
    }
  }

  // Render interactive task widget beautifully
  if (mediaType === 'task' && !isMsgDeleted) {
    try {
      const task = JSON.parse(cleanRawText);
      const isCompleted = task.status === 'completed';

      renderedContent = (
        <div 
          className="flex flex-col gap-2 min-w-[230px] max-w-[280px] p-3 bg-black/15 dark:bg-black/25 rounded-2xl border border-white/5 text-zinc-200 select-none cursor-default"
          onClick={(e) => {
            e.stopPropagation();
            handleToggleTask();
          }}
        >
          {/* Header */}
          <div className="flex items-start gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 border ${
              isCompleted 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/15' 
                : 'bg-pink-500/10 text-pink-400 border-pink-500/15'
            }`}>
              <ClipboardList size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] font-black leading-snug transition-all ${
                isCompleted ? 'line-through text-zinc-500' : 'text-zinc-100'
              }`}>
                {task.title}
              </p>
              {task.description && (
                <p className="text-[11px] font-medium text-zinc-400 mt-1 line-clamp-2">
                  {task.description}
                </p>
              )}
            </div>
          </div>

          {/* Details Row */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1 pt-2 border-t border-white/5">
            {task.assignee && (
              <div className="flex items-center gap-1 bg-white/5 px-2 py-1 rounded-lg text-[10px] font-bold text-zinc-300">
                <span className="text-zinc-500 font-medium">For:</span>
                <span className="text-zinc-100 truncate max-w-[80px]">{task.assignee}</span>
              </div>
            )}
            
            {task.dueDate && (
              <div className="flex items-center gap-1 bg-white/5 px-2 py-1 rounded-lg text-[10px] font-bold text-zinc-300">
                <Calendar size={10} className="text-zinc-500" />
                <span className="text-zinc-100">{task.dueDate}</span>
              </div>
            )}

            <div className={`ml-auto flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-lg uppercase tracking-wider ${
              isCompleted 
                ? 'bg-emerald-500/15 text-emerald-400' 
                : 'bg-pink-500/15 text-pink-400'
            }`}>
              {isCompleted ? 'Completed' : 'Pending'}
            </div>
          </div>
        </div>
      );
    } catch (err) {
      console.warn("Could not parse task JSON:", err);
    }
  }

  const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0 && !isMsgDeleted;
  const hasReplyHeader = !!resolvedReplyTo;
  const isTextString = typeof renderedContent === 'string';
  const isLongOrMultiLine = isTextString && (renderedContent.length > 55 || renderedContent.includes('\n'));
  const isShortWithReply = hasReplyHeader && isTextString && !isLongOrMultiLine;
  
  // NOTE: Space reduction critical enhancement!
  // We remove '|| hasReplyHeader' from block layout check so that text-only replied messages
  // can use the inline-timestamp layout, preventing giant empty spacer gaps!
  const _useBlockFormat = (!!mediaUrl || !isTextString || isLongOrMultiLine) && !isShortWithReply;

  const isReceiverOnlineNow = receiver && isUserOnline(
    receiver.isOnline !== undefined ? receiver.isOnline : receiver.is_online,
    receiver.lastSeen !== undefined ? receiver.lastSeen : receiver.last_seen
  );
  let wasReceiverOnlineAfterMessage = false;
  if (receiver && (receiver.lastSeen || receiver.last_seen)) {
    try {
      const lastSeenTime = new Date(receiver.lastSeen || receiver.last_seen).getTime();
      const msgTime = new Date(msg.created_at).getTime();
      wasReceiverOnlineAfterMessage = lastSeenTime >= msgTime;
    } catch (_e) { /* intentionally ignored: best-effort, failure is non-fatal */ }
  }
  const isMessageDelivered = isReceiverOnlineNow || wasReceiverOnlineAfterMessage;

  if (isSystemMessage) {
    return <SystemMessage text={msg.text || msg.content || ''} />;
  }

  return (
    <div 
      id={`msg-${msg.id}`} 
      onClick={(e) => {
        if (selectedMsgIds && selectedMsgIds.length > 0) {
          if (isMsgDeleted) return;
          handleMessageTap(e as any, msg);
        }
      }}
      className={`flex flex-col w-full max-w-full ${actualIsMe ? 'items-end' : 'items-start'} ${!isSameSender ? 'pt-3' : 'pt-0.5'} ${hasReactions ? 'pb-3.5' : 'pb-0.5'} relative transition-all duration-100 px-2.5 cursor-default ${
        isSelected 
          ? 'bg-[var(--primary)]/15 select-none' 
          : 'hover:bg-black/[0.01] dark:hover:bg-white/[0.003]'
      } ${selectedMsgIds && selectedMsgIds.length > 0 ? 'cursor-pointer select-none' : ''}`}
    >
      <AnimatePresence>
        {isHighlighted && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.15 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-[var(--primary)] z-0 pointer-events-none"
          />
        )}
      </AnimatePresence>

      {selectedMsgIds && selectedMsgIds.length > 0 && (
        <div 
          className={`absolute top-1/2 -translate-y-1/2 z-20 flex items-center justify-center pointer-events-none transition-all duration-150 ${
            actualIsMe ? 'left-6' : 'right-6'
          }`}
        >
          {isSelected ? (
            <motion.div 
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 20 }}
              className="w-5.5 h-5.5 rounded-full bg-[var(--primary)] text-white flex items-center justify-center shadow-lg shadow-[var(--primary)]/30 border border-transparent"
            >
              <svg 
                className="w-3.5 h-3.5 text-white" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="4.5" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </motion.div>
          ) : (
            <div className="w-5.5 h-5.5 rounded-full border-1.5 border-neutral-500/30 bg-black/5 dark:bg-zinc-850/10" />
          )}
        </div>
      )}
      
      <div className={`relative group max-w-[85%] lg:max-w-[70%] min-w-0 flex items-center gap-2 ${isHighlighted ? 'z-10' : ''}`}>

        {/* Smooth WhatsApp/Telegram sliding background reply indicator */}
        <motion.div 
          style={{ 
            x: replyIconX,
            opacity: replyIconOpacity,
            scale: replyIconScale,
            rotate: replyIconRotate,
          }}
          className={`absolute left-0 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center shadow-md pointer-events-none z-0 transition-colors duration-100 ${
            swipeActive 
              ? 'bg-[var(--primary)] text-neutral-900 scale-110 shadow-lg shadow-[var(--primary)]/30 border-none' 
              : 'bg-black/10 dark:bg-zinc-800/80 text-teal-400 border border-white/5'
          }`}
        >
          <CornerUpRight size={13} className={`stroke-[3.2] ${swipeActive ? 'scale-110' : ''}`} />
        </motion.div>

        <motion.div 
          style={{ x }}
          drag="x"
          dragDirectionLock={true}
          dragConstraints={{ left: 0, right: 80 }}
          dragElastic={{ left: 0, right: 0.25 }}
          dragTransition={{ bounceStiffness: 950, bounceDamping: 25 }}
          dragSnapToOrigin
          onDragStart={(e) => {
            e.stopPropagation();
            hasVibratedRef.current = false;
          }}
          onDragEnd={(_, info) => {
            if (swipeActive || info.offset.x > 42) {
              setReplyingTo(msg);
              if (window.navigator && window.navigator.vibrate) {
                try { window.navigator.vibrate(10); } catch(_e){ /* intentionally ignored: best-effort, failure is non-fatal */ }
              }
            }
            setSwipeActive(false);
            hasVibratedRef.current = false;
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onClick={(e) => {
            if (isMsgDeleted) return;
            e.stopPropagation();
            if (wasLongPressedRef.current) {
              wasLongPressedRef.current = false;
              return;
            }
            handleMessageTap(e as any, msg);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (isMsgDeleted) return;
            e.stopPropagation();
            if (wasLongPressedRef.current) {
              wasLongPressedRef.current = false;
              return;
            }
            handleMessageTap(e as any, msg);
          }}
          animate={isHighlighted ? { 
            backgroundColor: actualIsMe ? 'var(--bubble-own)' : 'var(--bubble-other)',
            scale: [1, 1.02, 1],
            transition: { duration: 0.5, repeat: 1 }
          } : {}}
          className={`px-3 pt-2 pb-[19px] ${hasReactions ? 'pb-[27px]' : ''} ${resolvedReplyTo ? 'min-w-[190px]' : 'min-w-[70px]'} shadow-sm border border-neutral-800/10 dark:border-white/5 relative cursor-pointer select-none max-w-full overflow-visible touch-pan-y w-fit transition-colors duration-200 ${bubbleShapeClass} ${
            activeMessageMenu?.id === msg.id ? 'z-50 ring-2.5 ring-[var(--primary)]/45 scale-[1.01] shadow-lg' : 'z-10'
          } ${
            !actualIsMe 
              ? 'bg-gradient-to-b from-[var(--bubble-other)] to-[var(--bubble-other)]/98 text-[var(--bubble-text-other)] mr-auto border-l-0 font-light' 
              : customBubble === 'ocean-indigo'
                ? 'bg-gradient-to-br from-teal-400 to-indigo-600 text-white ml-auto border-r-0 font-light shadow-md'
                : customBubble === 'forest-magic'
                  ? 'bg-gradient-to-br from-emerald-400 to-teal-600 text-white ml-auto border-r-0 font-light shadow-md'
                  : customBubble === 'crimson-fire'
                    ? 'bg-gradient-to-br from-rose-400 to-orange-600 text-white ml-auto border-r-0 font-light shadow-md'
                    : customBubble === 'sunset-violet'
                      ? 'bg-gradient-to-br from-violet-600 to-purple-800 text-white ml-auto border-r-0 font-light shadow-md'
                      : 'bg-gradient-to-b from-[var(--bubble-own)] to-[var(--bubble-own)]/98 text-[var(--bubble-text-own)] ml-auto border-r-0 font-light'
          } hover:brightness-[1.02]`}
        >
          {isForwardedMany ? (
            <p className="text-[9px] text-sky-400 font-extrabold italic mb-1 flex items-center gap-1 select-none tracking-wide">
              <ChevronsRight size={10} className="text-sky-400" />
              <span>Forwarded many times</span>
            </p>
          ) : isForwarded ? (
            <p className="text-[9px] text-zinc-400 font-bold italic mb-0.5 flex items-center gap-1 select-none tracking-wide">
              <CornerUpRight size={10} className="text-zinc-400" />
              <span>Forwarded</span>
            </p>
          ) : null}

          {isGrixAiMessage && (
            <div className="flex items-center gap-1 mb-1 py-0.5 px-1.5 bg-indigo-500/15 border border-indigo-500/25 rounded text-[8px] font-black text-indigo-400 uppercase tracking-wider leading-none w-fit select-none">
              <span className="relative flex h-1 w-1">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1 w-1 bg-indigo-500"></span>
              </span>
              🤖 Grix AI Verified
            </div>
          )}

          {convType === 'group' && !actualIsMe && !isSameSender && !isGrixAiMessage && (
            <p className="text-[9.5px] font-extrabold text-rose-500 mb-0.5 uppercase tracking-wider leading-none">
              {msg.sender?.full_name || msg.senderName || 'User'}
            </p>
          )}

          {showReactionPicker?.id === msg.id && (
            <ChatMessageReactions 
              onReact={(emoji) => performReactToMessage(msg.id, emoji)}
              onClose={() => setShowReactionPicker(null)}
              position={isMe ? 'right' : 'left'}
            />
          )}

          {/* Replied message block rendered in compact structure */}
          {resolvedReplyTo && (
            <ReplyHeader 
              resolvedReplyTo={resolvedReplyTo} 
              actualIsMe={actualIsMe} 
              currentUser={user} 
              receiver={receiver} 
              onJumpToMessage={onJumpToMessage} 
            />
          )}

          <div className="flex flex-col min-w-[50px] max-w-full">
            {/* Media Attachment Player (Image, Video, Voice, Document) */}
            <MessageMedia 
              mediaUrl={mediaUrl} 
              mediaType={mediaType} 
              isMe={isMe} 
              receiver={receiver} 
              fileName={msg.file_name} 
              isSending={msg.status === 'sending'}
            />
            
            {renderedContent && (
              typeof renderedContent === 'string' ? (
                <p className={`${isMsgDeleted ? 'italic text-zinc-400 dark:text-zinc-500 font-normal select-none text-[12.5px] opacity-75' : contentFontClass} break-words whitespace-pre-wrap overflow-visible [word-break:normal] text-left leading-normal`}>
                  {renderedContent}
                </p>
              ) : (
                renderedContent
              )
            )}

            {/* Always-fixed bottom-right corner timestamp & tick (WhatsApp perfect alignment style) */}
            <div className="absolute bottom-[4px] right-[10px] flex items-center gap-0.5 select-none pointer-events-none leading-none z-20">
              <span className={`text-[9.5px] font-medium tracking-tight whitespace-nowrap ${actualIsMe ? 'text-[var(--bubble-text-own)]/55' : 'text-[var(--bubble-text-other)]/55'}`}>
                {formatTime(msg.created_at)}
                {msg.is_edited && ' • Ed'}
              </span>
              {actualIsMe && (
                <span className="shrink-0 flex items-center ml-0.5">
                  {msg.status === 'sending' ? (
                    <Clock size={10} className="text-[var(--bubble-text-own)]/55 animate-pulse" />
                  ) : msg.is_read ? (
                    <CheckCheck size={13} className="text-[#34b7f1]" strokeWidth={2.8} />
                  ) : (convType === 'group' || isMessageDelivered) ? (
                    <CheckCheck size={13} className={`${actualIsMe ? 'text-[var(--bubble-text-own)]/40' : 'text-[var(--bubble-text-other)]/40'}`} strokeWidth={2.8} />
                  ) : (
                    <Check size={13} className={`${actualIsMe ? 'text-[var(--bubble-text-own)]/40' : 'text-[var(--bubble-text-other)]/40'}`} strokeWidth={2.8} />
                  )}
                </span>
              )}
            </div>
          </div>

          {msg.reactions && Object.keys(msg.reactions).length > 0 && !isMsgDeleted && (
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              whileHover={{ scale: 1.05 }}
              className={`absolute -bottom-2.5 ${actualIsMe ? 'right-2' : 'left-2'} flex items-center gap-1 bg-zinc-900/90 dark:bg-zinc-800/95 backdrop-blur-md rounded-full px-2 py-0.5 shadow-md border border-white/10 z-20 select-none`}
            >
              <div className="flex items-center -space-x-0.5">
                {Object.entries(msg.reactions).slice(0, 3).map(([uid, emoji]) => (
                  <span key={uid} className="text-[10px] filter drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]">{emoji as string}</span>
                ))}
              </div>
              {Object.keys(msg.reactions).length > 1 && (
                <span className="text-[9px] font-black tracking-wide text-white opacity-90 pl-0.5">{Object.keys(msg.reactions).length}</span>
              )}
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  );
};
