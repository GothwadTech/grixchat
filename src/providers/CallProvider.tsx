import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/apiClient';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { Phone, PhoneOff, Video, Volume2, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CallStatus, CallType } from '../features/call/types/callTypes';
import { Room, RoomEvent, Track } from 'livekit-client';
import { webRtcCallService } from '../features/call/services/WebRtcCallService';

/**
 * How long the caller rings before the call is written off as missed. Every
 * other timeout in the file is derived from it, so the two sides can never
 * disagree about when a call is over.
 */
const RING_TIMEOUT_MS = 45_000;
/**
 * A ringing row may only be force-closed by the periodic sweep *after* the
 * caller's own timeout has had time to fire — otherwise the receiver's sweep
 * kills calls the caller is still legitimately ringing (the old 40 s sweep
 * raced the 45 s give-up).
 */
const ZOMBIE_THRESHOLD_MS = RING_TIMEOUT_MS + 8_000;
/**
 * Once the receiver has picked up, the media path has this long to come up.
 * Without it, a peer that accepts and then fails to produce media (permission
 * denied, dead tab) left the other side ringing forever: the database said
 * `accepted`, so the ring timeout no longer applied.
 */
const CONNECT_WATCHDOG_MS = 20_000;
const ZOMBIE_SWEEP_MS = 20_000;

// Highly-polished Web Audio API sound designer for native-like offline-resilient calling sounds
class PhoneRingtones {
  private static audioCtx: AudioContext | null = null;
  private static ringInterval: any = null;

  static playRingtone() {
    this.stop();
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      // Elegant dual-frequency telephone ring cadences with ambient secondary harmonic harmonics
      const ringPattern = () => {
        const now = ctx.currentTime;
        
        // Main standard frequencies for high-fidelity ringers
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc1.type = 'sine';
        osc2.type = 'sine';

        osc1.frequency.setValueAtTime(400, now);
        osc1.frequency.linearRampToValueAtTime(450, now + 0.1);
        osc1.frequency.linearRampToValueAtTime(400, now + 0.5);
        osc1.frequency.linearRampToValueAtTime(450, now + 0.9);
        osc1.frequency.linearRampToValueAtTime(400, now + 1.3);

        osc2.frequency.setValueAtTime(480, now);
        osc2.frequency.linearRampToValueAtTime(520, now + 0.2);
        osc2.frequency.linearRampToValueAtTime(480, now + 0.6);
        osc2.frequency.linearRampToValueAtTime(520, now + 1.0);

        // Professional envelope 1.8s active state, 2.2s dead state
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.12, now + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.08, now + 1.0);
        gainNode.gain.linearRampToValueAtTime(0.08, now + 1.7);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.85);
        osc2.stop(now + 1.85);
      };

      ringPattern();
      this.ringInterval = setInterval(() => {
        ringPattern();
      }, 4000);
    } catch (e) {
      console.warn('Ringtone failed to generate:', e);
    }
  }

  static playOutgoingBeep() {
    this.stop();
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const beepPattern = () => {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(425, now);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.05, now + 0.1);
        gain.gain.setValueAtTime(0.05, now + 1.2);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.30);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 1.35);
      };

      beepPattern();
      this.ringInterval = setInterval(() => {
        beepPattern();
      }, 4000);
    } catch (e) {
      console.warn('Outgoing tone generation failed:', e);
    }
  }

  /**
   * Mobile browsers only allow audio after a user gesture. The ringtone must
   * not be silently swallowed just because nobody has tapped on this tab yet,
   * so the first interaction anywhere unlocks the shared AudioContext.
   */
  static unlock() {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
    } catch (_) {
      /* no Web Audio — the vibration + visual card still work */
    }
  }

  static stop() {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }
}

interface ActiveCallState {
  id: string; // db call id
  otherUserId: string;
  type: CallType;
  role: 'caller' | 'receiver';
  status: CallStatus;
  receiver: any; // user profile details
}

interface CallContextType {
  incomingCall: any | null;
  caller: any | null;
  activeCall: ActiveCallState | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  timer: number;
  isMuted: boolean;
  isVideoOff: boolean;
  speakerState: number; // 0=muted, 1=earpiece, 2=loudspeaker
  isScreenSharing: boolean;
  setIsVideoOff: React.Dispatch<React.SetStateAction<boolean>>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  initiateCall: (otherUserId: string, callType: 'voice' | 'video') => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleSpeaker: () => void;
  toggleScreenShare: () => Promise<void>;
  flipCamera: () => Promise<void>;
  playOutgoingBeep: () => void;
  stopSounds: () => void;
  room: Room | null;
  /** `livekit` = SFU room, `p2p` = direct WebRTC, `none` = no media path. */
  transport: 'none' | 'livekit' | 'p2p';
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user: authUser } = useAuth();
  const navigate = useNavigate();

  // Basic incoming states
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [caller, setCaller] = useState<any>(null);

  // Advanced calling state
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [timer, setTimer] = useState<number>(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [speakerState, setSpeakerState] = useState(2); // 0=muted, 1=earpiece, 2=loudspeaker
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [room, setRoom] = useState<Room | null>(null);
  /** Which media path is carrying this call: LiveKit, direct WebRTC, or none. */
  const [transport, setTransport] = useState<'none' | 'livekit' | 'p2p'>('none');

  // LiveKit internal refs
  const roomRef = useRef<Room | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const activeCallChannelRef = useRef<any>(null);
  const initiatingCallRef = useRef<boolean>(false);
  /** Mirror of `activeCall` for async callbacks that must not read stale state. */
  const activeCallRef = useRef<ActiveCallState | null>(null);
  /** The 45 s "nobody answered" timer, cleared as soon as the call resolves. */
  const ringTimeoutRef = useRef<any>(null);
  /** Repeating haptic pattern while an incoming call is ringing. */
  const vibrateTimerRef = useRef<any>(null);
  /** Fires if an answered call's media path never comes up. */
  const connectWatchdogRef = useRef<any>(null);

  // Keep the async-callback mirror in sync
  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  // Reset sounds / haptics on status change
  useEffect(() => {
    if (activeCall && ['connected', 'ended', 'denied', 'error', 'offline'].includes(activeCall.status)) {
      PhoneRingtones.stop();
      stopVibration();
    }
    if (activeCall && ['connected', 'ended', 'denied', 'error', 'offline', 'rejected'].includes(activeCall.status)) {
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
    }
  }, [activeCall?.status]);

  /** Telegram-style: keep buzzing until somebody picks up or the ring dies. */
  const startVibration = () => {
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    stopVibration();
    const buzz = () => {
      try { navigator.vibrate([400, 300, 400]); } catch (_) {}
    };
    buzz();
    vibrateTimerRef.current = setInterval(buzz, 2500);
  };

  const stopVibration = () => {
    if (vibrateTimerRef.current) {
      clearInterval(vibrateTimerRef.current);
      vibrateTimerRef.current = null;
    }
    try { navigator?.vibrate?.(0); } catch (_) {}
  };

  // Unlock Web Audio on the first gesture of the session (see PhoneRingtones.unlock)
  useEffect(() => {
    const unlock = () => PhoneRingtones.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Defensive Auto-reconciliation of stale zombie calls matching current user
  useEffect(() => {
    if (!authUser || !supabase) return;

    const cleanupStaleZombieCalls = async () => {
      try {
        const thresholdDate = new Date(Date.now() - ZOMBIE_THRESHOLD_MS).toISOString();
        
        // Find existing ringing calls where the user was a caller/receiver and they have timed out
        const { data: staleCalls } = await supabase
          .from('calls')
          .select('id')
          .eq('status', 'ringing')
          .or(`caller_id.eq.${authUser.id},receiver_id.eq.${authUser.id}`)
          .lt('created_at', thresholdDate);

        if (staleCalls && staleCalls.length > 0) {
          const ids = staleCalls.map(c => c.id);
          console.log("[Call System] Auto-cleaning stale zombie calls: ", ids);
          await supabase
            .from('calls')
            .update({ status: 'ended', is_missed: true } as any)
            .in('id', ids);
        }
      } catch (err) {
        console.warn("[Call System] Auto zombie cleanup error:", err);
      }
    };

    cleanupStaleZombieCalls();
    
    // Periodic safety net for rows whose caller vanished (closed laptop, killed
    // tab). It must be slower than the caller's own timeout — see the
    // ZOMBIE_THRESHOLD_MS comment.
    const interval = setInterval(cleanupStaleZombieCalls, ZOMBIE_SWEEP_MS);
    return () => clearInterval(interval);
  }, [authUser?.id]);

  // Handle active call duration timer
  useEffect(() => {
    let intervalId: any;
    if (activeCall && activeCall.status === 'connected') {
      intervalId = setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
    } else {
      setTimer(0);
    }
    return () => clearInterval(intervalId);
  }, [activeCall?.status]);

  // Insert chat room logs dynamically
  const addLoggingMessage = async (status: 'started' | 'ended' | 'missed', cid: string, partnerId: string, callType: CallType) => {
    if (!authUser || !partnerId || !supabase) return;
    try {
      const { data: convId } = await supabase.rpc('get_direct_conversation_id', { u1: authUser.id, u2: partnerId });
      let finalConvId = convId;

      if (!finalConvId) {
        const generatedId = crypto.randomUUID();
        const { error } = await supabase.from('conversations').insert({ id: generatedId, type: 'direct' } as any);
        if (!error) {
          await supabase.from('conversation_participants').insert([
            { conversation_id: generatedId, user_id: authUser.id },
            { conversation_id: generatedId, user_id: partnerId }
          ]);
          finalConvId = generatedId;
        }
      }

      if (finalConvId) {
        const textMessage = status === 'started' ? `📞 Started a ${callType} call` : 
                     status === 'missed' ? `📥 Missed ${callType} call` : 
                     `🏁 ${callType.charAt(0).toUpperCase() + callType.slice(1)} call ended`;
        
        await supabase.from('messages').insert({
          conversation_id: finalConvId,
          sender_id: authUser.id,
          text: textMessage,
          media_type: 'system'
        } as any);
      }
    } catch (e) {
      console.warn("Error adding call logging message:", e);
    }
  };

  // Helper local shutdown
  const handleEndCallLocally = async () => {
    // 0. Close the peer-to-peer session (no-op when LiveKit is carrying it)
    try {
      webRtcCallService.stop();
    } catch (err) {
      console.warn('[P2P] teardown failed:', err);
    }
    setTransport('none');

    // 1. Terminate and disconnect LiveKit Room
    if (roomRef.current) {
      try {
        roomRef.current.disconnect();
      } catch (err) {
        console.warn("[LiveKit] Clean disconnect failed:", err);
      }
      roomRef.current = null;
    }
    setRoom(null);

    // 2. Tear down streams
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (err) {}
      });
      localStreamRef.current = null;
    }
    setLocalStream(null);

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (err) {}
      });
      remoteStreamRef.current = null;
    }
    setRemoteStream(null);

    // 3. Remove active real-time channel
    if (activeCallChannelRef.current) {
      try {
        supabase.removeChannel(activeCallChannelRef.current);
      } catch (err) {}
      activeCallChannelRef.current = null;
    }

    PhoneRingtones.stop();
    stopVibration();
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    clearConnectWatchdog();
    setActiveCall(null);
    setIncomingCall(null);
    setCaller(null);
    setTimer(0);
    setIsMuted(false);
    setIsVideoOff(false);
    setSpeakerState(2);
    setIsScreenSharing(false);
  };

  // Monitor incoming calls for the logged-in user
  useEffect(() => {
    if (!authUser || !supabase) return;

    const fetchIncomingCall = async () => {
      const { data, error } = await supabase
        .from('calls')
        .select('*, users:users!calls_caller_id_fkey (username, photo_url, full_name)')
        .eq('receiver_id', authUser.id)
        .eq('status', 'ringing')
        .order('created_at', { ascending: false })
        .limit(1);

      if (!error && data && data.length > 0) {
        const callData = data[0];
        // A ring older than the ringing window is a zombie: do not resurrect it.
        const callAgeMs = new Date().getTime() - new Date(callData.created_at).getTime();
        if (callAgeMs < RING_TIMEOUT_MS) {
          setIncomingCall(callData);
          setCaller({
            id: callData.caller_id,
            userName: callData.users?.username,
            fullName: callData.users?.full_name,
            photoURL: callData.users?.photo_url
          });
          
          PhoneRingtones.playRingtone();
          startVibration();
        } else {
          // Explicit cleanup for stale, unanswered rings fetched from database
          setIncomingCall(null);
          setCaller(null);
          PhoneRingtones.stop();
          stopVibration();
        }
      } else {
        setIncomingCall(null);
        setCaller(null);
        PhoneRingtones.stop();
        stopVibration();
      }
    };

    fetchIncomingCall();

    const channel = supabase
      .channel(`calls-for-${authUser.id}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'calls', 
        filter: `receiver_id=eq.${authUser.id}` 
      }, (payload: any) => {
        const eventType = payload.eventType;
        const currentData = payload.new as any;

        if (eventType === 'DELETE') {
          setIncomingCall(null);
          setCaller(null);
          PhoneRingtones.stop();
          stopVibration();
          return;
        }

        if (currentData) {
          if (['ended', 'rejected', 'denied', 'accepted'].includes(currentData.status)) {
            setIncomingCall(null);
            setCaller(null);
            PhoneRingtones.stop();
            stopVibration();
          } else if (currentData.status === 'ringing') {
            fetchIncomingCall();
          }
        } else {
          fetchIncomingCall();
        }
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
      PhoneRingtones.stop();
    };
  }, [authUser]);

  // Aggregate tracks helper to maintain backward compatible HTML Video srcObject MediaStreams
  const updateLocalStreamFromRoom = (room: Room) => {
    const mediaStream = new MediaStream();
    const localPart = room.localParticipant;
    
    localPart.getTrackPublications().forEach(pub => {
      const track = pub.track;
      if (track && track.mediaStreamTrack) {
        mediaStream.addTrack(track.mediaStreamTrack);
      }
    });
    
    localStreamRef.current = mediaStream;
    setLocalStream(mediaStream);
  };

  const updateRemoteStreamFromRoom = (room: Room) => {
    const mediaStream = new MediaStream();
    
    // Find first active remote participant
    const remotePart = Array.from(room.remoteParticipants.values())[0];
    if (remotePart) {
      remotePart.getTrackPublications().forEach(pub => {
        const track = pub.track;
        if (track && track.mediaStreamTrack) {
          mediaStream.addTrack(track.mediaStreamTrack);
        }
      });
    }
    
    remoteStreamRef.current = mediaStream;
    setRemoteStream(mediaStream);
  };

  /**
   * LiveKit transport. Returns `false` when the project has no LiveKit
   * credentials (or no `VITE_LIVEKIT_URL`), which means the caller should use
   * the peer-to-peer transport instead. Returns `true` once a real room is up.
   */
  const connectViaLiveKit = async (roomName: string, participantIdentity: string, callType: CallType): Promise<boolean> => {
    try {
      console.log(`[Calling] Fetching secure token from backend for room_id: ${roomName}...`);
      
      let payload = { success: false, token: "mock-livekit-token-sandbox", error: "" };
      
      try {
        const res = await apiFetch("/api/livekit-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomName, participantIdentity })
        });
        
        if (res.ok) {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            payload = await res.json();
          } else {
            console.warn("[Calling] Received non-JSON response from backend. Defaulting to sandbox mode.");
          }
        } else {
          console.warn(`[Calling] Backend token generation returned status ${res.status}. Defaulting to sandbox mode.`);
        }
      } catch (fetchErr) {
        console.warn("[Calling] Failed to communicate with livekit-token API or parse JSON. Defaulting to sandbox mode:", fetchErr);
      }
      
      // Fallback or explicit cloud address
      const livekitUrl = import.meta.env.VITE_LIVEKIT_URL;
      
      let token = payload.token;
      
      // No LiveKit on this deployment (no credentials, no URL, or the API
      // answered with the sandbox marker) → the caller uses real WebRTC.
      const liveKitUnavailable = !payload.success || !livekitUrl || token === "mock-livekit-token-sandbox";

      if (liveKitUnavailable) {
        console.warn('[Calling] LiveKit is not configured; using the peer-to-peer transport.');
        return false;
      }

      if (!token) {
        throw new Error(payload.error || "Failed to generate LiveKit endpoint credentials.");
      }

      setTransport('livekit');

      // Establish Room Client
      const roomInstance = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      roomRef.current = roomInstance;
      setRoom(roomInstance);

      roomInstance.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        console.log(`[LiveKit] Remote track subscribed: ${track.kind}`);
        updateRemoteStreamFromRoom(roomInstance);
        setActiveCall(prev => {
          if (prev && prev.status !== 'connected') {
            return { ...prev, status: 'connected' };
          }
          return prev;
        });
      });

      roomInstance.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        console.log(`[LiveKit] Remote track unsubscribed: ${track.kind}`);
        updateRemoteStreamFromRoom(roomInstance);
      });

      roomInstance.on(RoomEvent.LocalTrackPublished, (publication, participant) => {
        console.log(`[LiveKit] Local track published: ${publication.track?.kind}`);
        updateLocalStreamFromRoom(roomInstance);
      });

      roomInstance.on(RoomEvent.LocalTrackUnpublished, (publication, participant) => {
        console.log(`[LiveKit] Local track unpublished: ${publication.track?.kind}`);
        updateLocalStreamFromRoom(roomInstance);
      });

      roomInstance.on(RoomEvent.ParticipantConnected, (p) => {
        console.log(`[LiveKit] Peer Participant online:`, p.identity);
        clearConnectWatchdog();
        setActiveCall(prev => {
          if (prev && prev.status !== 'connected') {
            return { ...prev, status: 'connected' };
          }
          return prev;
        });
      });

      roomInstance.on(RoomEvent.ParticipantDisconnected, (p) => {
        console.log(`[LiveKit] Peer Participant offline:`, p.identity);
        endCall();
      });

      roomInstance.on(RoomEvent.Disconnected, () => {
        console.log(`[LiveKit] Room disconnected`);
        handleEndCallLocally();
      });

      // Joint connection Handshake
      await roomInstance.connect(livekitUrl, token);
      console.log(`[LiveKit] Connected to SFU gateway seamlessly.`);

      // Enable devices dynamically
      if (callType === 'video') {
        await roomInstance.localParticipant.setCameraEnabled(true);
        await roomInstance.localParticipant.setMicrophoneEnabled(true);
      } else {
        await roomInstance.localParticipant.setMicrophoneEnabled(true);
      }

      updateLocalStreamFromRoom(roomInstance);
      return true;

    } catch (error: any) {
      console.error("[LiveKit Initialization Error]", error);
      // A half-open room would steal the media toggles from the P2P fallback.
      if (roomRef.current) {
        try {
          roomRef.current.disconnect();
        } catch (_) {
          /* ignore */
        }
        roomRef.current = null;
      }
      setRoom(null);
      return false;
    }
  };

  const clearConnectWatchdog = () => {
    if (connectWatchdogRef.current) {
      clearTimeout(connectWatchdogRef.current);
      connectWatchdogRef.current = null;
    }
  };

  /**
   * The receiver answered but no media path appeared (they denied the camera
   * permission, their tab died, …). Give the handshake a window, then end the
   * call honestly instead of ringing into the void.
   */
  const armConnectWatchdog = () => {
    clearConnectWatchdog();
    connectWatchdogRef.current = setTimeout(() => {
      connectWatchdogRef.current = null;
      const call = activeCallRef.current;
      if (!call || call.status === 'connected') return;
      console.warn('[Calling] the answered call never produced a media path');
      void endCallFromTransport('error');
    }, CONNECT_WATCHDOG_MS);
  };

  /**
   * Closes the `calls` row and writes exactly one chat log entry for it.
   *
   * Idempotent on purpose: when a call ends, both sides notice at the same
   * instant (one hangs up, the other sees the media path close), and the first
   * writer wins. The status filter makes the second write a no-op *and* tells
   * us whether we were the first — which is what decides who logs the message.
   */
  const closeCallRow = async (
    callId: string,
    otherUserId: string,
    callType: CallType,
    opts: { status: 'ended' | 'rejected' | 'error'; missed: boolean },
  ) => {
    if (!supabase || !callId || callId.startsWith('temp-')) return;
    try {
      const { data } = await supabase
        .from('calls')
        .update({ status: opts.status, is_missed: opts.missed } as any)
        .eq('id', callId)
        .in('status', ['ringing', 'accepted'])
        .select('id');

      if (data && data.length > 0) {
        await addLoggingMessage(opts.missed ? 'missed' : 'ended', callId, otherUserId, callType);
      }
    } catch (err) {
      console.warn('[Calling] failed to close the call row:', err);
    }
  };

  /**
   * The media path died on its own — the peer closed the tab, ICE failed, or
   * they sent `bye`. The database row must not be left claiming an active call.
   */
  const endCallFromTransport = async (uiStatus: CallStatus) => {
    const call = activeCallRef.current;
    if (!call) {
      await handleEndCallLocally();
      return;
    }

    const neverConnected = call.status === 'ringing' || call.status === 'connecting';
    setActiveCall((prev) => (prev ? { ...prev, status: uiStatus } : prev));
    await closeCallRow(call.id, call.otherUserId, call.type, {
      status: 'ended',
      missed: neverConnected,
    });
    await handleEndCallLocally();
  };

  /**
   * Opens the media path for a call. LiveKit first (when the deployment has it
   * configured), otherwise a real peer-to-peer WebRTC session signalled over
   * Supabase Realtime.
   */
  const connectCallSession = async (
    callId: string,
    callType: CallType,
    role: 'caller' | 'receiver',
    peerId: string,
  ) => {
    if (!authUser?.id) return;

    const viaLiveKit = await connectViaLiveKit(callId, authUser.id, callType);
    if (viaLiveKit) return;

    try {
      console.log('[Calling] Establishing a peer-to-peer WebRTC session...');
      setTransport('p2p');

      await webRtcCallService.start({
        callId,
        selfId: authUser.id,
        peerId,
        callType,
        role,
        handlers: {
          onLocalStream: (stream) => {
            localStreamRef.current = stream;
            setLocalStream(stream);
          },
          onRemoteStream: (stream) => {
            remoteStreamRef.current = stream;
            setRemoteStream(stream);
          },
          onScreenShareEnded: () => setIsScreenSharing(false),
          onStatus: (status) => {
            if (status === 'connected') {
              PhoneRingtones.stop();
              stopVibration();
              if (ringTimeoutRef.current) {
                clearTimeout(ringTimeoutRef.current);
                ringTimeoutRef.current = null;
              }
              clearConnectWatchdog();
              // A connected media path outranks a slower database event.
              setActiveCall(prev => (prev ? { ...prev, status: 'connected' as CallStatus } : prev));
            } else if (status === 'failed') {
              // ICE never came up (or died): end the call everywhere, do not
              // leave the row as `accepted` with two frozen avatars.
              void endCallFromTransport('error');
            } else if (status === 'closed') {
              // The peer hung up (or the connection died for good).
              void endCallFromTransport('ended');
            }
          },
        },
      });
    } catch (err) {
      console.error('[Calling] peer-to-peer session failed:', err);
      setActiveCall(prev => (prev ? { ...prev, status: 'error' as CallStatus } : prev));
    }
  };

  // RECEIVER accepting call
  const acceptCall = async () => {
    if (!incomingCall || !authUser || !supabase) return;

    PhoneRingtones.stop();
    stopVibration();
    const cid = incomingCall.id;
    const otherUserId = incomingCall.caller_id;
    const callType = (incomingCall.type === 'audio' ? 'voice' : incomingCall.type) as CallType;

    // 1. Fetch caller profile
    let callerProfile: any = null;
    try {
      const { data } = await supabase.from('users').select('*').eq('id', otherUserId).single();
      callerProfile = data;
    } catch (e) {
      console.warn("Error fetching caller profile details:", e);
    }

    // Set initial receiver call state
    const initialCall: ActiveCallState = {
      id: cid,
      otherUserId,
      type: callType,
      role: 'receiver',
      status: 'connecting',
      receiver: callerProfile,
    };
    setActiveCall(initialCall);
    setIncomingCall(null);
    setCaller(null);
    setIsVideoOff(callType === 'voice');

    // Navigate to call screen immediately prior to initialization to prevent media frame blockages
    navigate(`/call/${otherUserId}?type=${callType}&role=receiver&callId=${cid}`);

    // Update call status database-wise to notify the caller
    try {
      // The caller may have hung up while this phone was still ringing.
      const { data: fresh } = await supabase.from('calls').select('status').eq('id', cid).single();
      if (fresh && fresh.status !== 'ringing') {
        console.log('[Calling] Call is no longer ringing, not answering:', fresh.status);
        setActiveCall(null);
        navigate('/chats', { replace: true });
        return;
      }

      await supabase.from('calls').update({ status: 'accepted' } as any).eq('id', cid);
      await addLoggingMessage('started', cid, otherUserId, callType);
      
      // Open the media path (LiveKit if configured, otherwise P2P WebRTC)
      await connectCallSession(cid, callType, 'receiver', otherUserId);

      // Establish real-time listen triggers for termination updates
      const callChannel = supabase
        .channel(`call-active-${cid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `id=eq.${cid}` }, (payload) => {
          const data = payload.new as any;
          if (!data) return;

          // 'denied' is a legacy value (the CHECK constraint only allows
          // rejected) — treat it exactly like a rejection.
          if (data.status === 'ended' || data.status === 'denied' || data.status === 'rejected') {
            setActiveCall(prev => prev ? { ...prev, status: data.status as any } : null);
            handleEndCallLocally();
          }
        })
        .subscribe();

      activeCallChannelRef.current = callChannel;
    } catch (err) {
      console.error("[Calling Receiver Accept Fail]", err);
      setActiveCall(prev => prev ? { ...prev, status: 'error' } : null);
      // Never leave a row claiming an answered call that has no media.
      await closeCallRow(cid, otherUserId, callType, { status: 'error', missed: true });
    }
  };

  // RECEIVER rejecting call
  const rejectCall = async () => {
    if (incomingCall && supabase) {
      PhoneRingtones.stop();
      stopVibration();
      const cid = incomingCall.id;
      const otherUserId = incomingCall.caller_id;
      const callType = (incomingCall.type === 'audio' ? 'voice' : incomingCall.type) as CallType;

      try {
        await closeCallRow(cid, otherUserId, callType, { status: 'rejected', missed: true });
      } catch (e) {
        console.warn('Error rejecting call in database:', e);
      }

      setIncomingCall(null);
      setCaller(null);
    }
  };

  // CALLER initiating call
  const initiateCall = async (otherUserId: string, callType: 'voice' | 'video') => {
    if (!authUser || !supabase) return;
    if (initiatingCallRef.current) {
      console.log("[Call Hook] Call already initiating, skipping duplicate invocation.");
      return;
    }
    
    initiatingCallRef.current = true;
    try {
      await handleEndCallLocally();
      playOutgoingBeep();

      let receiverProfile: any = null;
      try {
        const { data } = await supabase.from('users').select('*').eq('id', otherUserId).single();
        receiverProfile = data;
      } catch (e) {
        console.warn("Grixchat user profile retrieval failure:", e);
      }

      const placeholderId = `temp-${Date.now()}`;
      const initialCall: ActiveCallState = {
        id: placeholderId,
        otherUserId,
        type: callType,
        role: 'caller',
        status: 'connecting',
        receiver: receiverProfile,
      };
      setActiveCall(initialCall);
      setIsVideoOff(callType === 'voice');

      // Create database ringing document
      const dbType = callType === 'voice' ? 'audio' : callType;
      const { data: callData, error: callError } = await supabase.from('calls').insert({
        caller_id: authUser.id,
        receiver_id: otherUserId,
        type: dbType,
        status: 'ringing',
        offer: {} // dummy offer to satisfy older schema defaults if valid
      } as any).select().single();

      if (callError || !callData) {
        console.error("[LiveKit Caller] database registration failed:", callError);
        setActiveCall(prev => prev ? { ...prev, status: 'error' } : null);
        PhoneRingtones.stop();
        return;
      }

      const realCallId = callData.id;
      setActiveCall(prev => prev ? { ...prev, id: realCallId, status: 'ringing' } : null);

      // Open the media path right away: the peer answers the incoming offer,
      // and for LiveKit the room is already warm when they pick up.
      await connectCallSession(realCallId, callType, 'caller', otherUserId);

      // Listen for remote partner changes (like acceptance or ends)
      const callChannel = supabase
        .channel(`call-active-${realCallId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `id=eq.${realCallId}` }, (payload) => {
          const data = payload.new as any;
          if (!data) return;

          // 'denied' is a legacy value (the CHECK constraint only allows
          // rejected) — treat it exactly like a rejection.
          if (data.status === 'ended' || data.status === 'denied' || data.status === 'rejected') {
            setActiveCall(prev => prev ? { ...prev, status: data.status as any } : null);
            handleEndCallLocally();
          }

          if (data.status === 'accepted') {
            PhoneRingtones.stop();
            stopVibration();
            if (ringTimeoutRef.current) {
              clearTimeout(ringTimeoutRef.current);
              ringTimeoutRef.current = null;
            }
            // The receiver picked up. On LiveKit that is our cue to start the
            // timer; on the peer-to-peer path the media session reports the
            // truth (`connected` only once ICE is up), and claiming otherwise
            // would start the duration counter on a silent line.
            if (roomRef.current) {
              setActiveCall(prev => prev ? { ...prev, status: 'connected' } : null);
            } else {
              setActiveCall(prev => prev ? { ...prev, status: 'connecting' } : null);
              armConnectWatchdog();
            }
          }
        })
        .subscribe();

      activeCallChannelRef.current = callChannel;

      // Auto-answer scenario if the user calls themselves or Grix AI
      if (otherUserId === 'grix-ai' || otherUserId === authUser.id) {
        setTimeout(async () => {
          try {
            console.log("[Grix Simulator] Auto-accepting simulated call...");
            await supabase.from('calls').update({ status: 'accepted' } as any).eq('id', realCallId);
            await addLoggingMessage('started', realCallId, otherUserId, callType);
          } catch (e) {
            console.warn("Auto-accept simulation update failure:", e);
          }
        }, 2200);
      }

      // Nobody answered in time → the call is over (and it is a missed call).
      if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = setTimeout(async () => {
        ringTimeoutRef.current = null;
        if (!supabase) return;
        const { data: snap } = await supabase.from('calls').select('status').eq('id', realCallId).single();
        if (snap && snap.status === 'ringing') {
          console.log(`[Call Timeout] No answer after ${RING_TIMEOUT_MS / 1000} s, marking as ended/missed...`);
          await closeCallRow(realCallId, otherUserId, callType, { status: 'ended', missed: true });
          setActiveCall(prev => prev ? { ...prev, status: 'ended' } : null);
          await handleEndCallLocally();
        }
      }, RING_TIMEOUT_MS);

    } catch (e) {
      console.error("[LiveKit Caller] Setup exception:", e);
      setActiveCall(prev => prev ? { ...prev, status: 'error' } : null);
    } finally {
      initiatingCallRef.current = false;
    }
  };

  // Termination handler (either caller or receiver can end active call)
  const endCall = async () => {
    if (!activeCall || !supabase) {
      await handleEndCallLocally();
      return;
    }

    const cid = activeCall.id;
    const otherUserId = activeCall.otherUserId;
    const callType = activeCall.type;

    try {
      const neverConnected = activeCall.status === 'ringing' || activeCall.status === 'connecting';
      // Declining an incoming call is a rejection; hanging up mid-call is not.
      const endStatus = (activeCall.status === 'ringing' && activeCall.role === 'receiver') ? 'rejected' : 'ended';
      await closeCallRow(cid, otherUserId, callType, { status: endStatus, missed: neverConnected });
    } catch (e) {
      console.warn("Error updating active call status to ended in DB:", e);
    }

    await handleEndCallLocally();
  };

  const toggleMute = () => {
    setIsMuted(prev => {
      const nextMuted = !prev;
      if (roomRef.current) {
        roomRef.current.localParticipant.setMicrophoneEnabled(!nextMuted)
          .catch(err => console.warn("LiveKit mic toggle failed:", err));
      } else if (webRtcCallService.active) {
        webRtcCallService.setMicEnabled(!nextMuted);
      } else if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(track => { track.enabled = !nextMuted; });
      }
      return nextMuted;
    });
  };

  const toggleVideo = () => {
    setIsVideoOff(prev => {
      const nextVideoOff = !prev;
      if (roomRef.current) {
        roomRef.current.localParticipant.setCameraEnabled(!nextVideoOff)
          .catch(err => console.warn("LiveKit video toggle failed:", err));
      } else if (webRtcCallService.active) {
        webRtcCallService.setCameraEnabled(!nextVideoOff);
      } else if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach(track => { track.enabled = !nextVideoOff; });
      }
      return nextVideoOff;
    });
  };

  const toggleSpeaker = () => {
    setSpeakerState(prev => (prev + 1) % 3);
  };

  const toggleScreenShare = async () => {
    try {
      const nextScreenShare = !isScreenSharing;
      if (roomRef.current) {
        await roomRef.current.localParticipant.setScreenShareEnabled(nextScreenShare);
        updateLocalStreamFromRoom(roomRef.current);
      } else if (webRtcCallService.active) {
        await webRtcCallService.setScreenShareEnabled(nextScreenShare);
        const stream = webRtcCallService.stream;
        if (stream) {
          localStreamRef.current = stream;
          setLocalStream(stream);
        }
      } else {
        return;
      }
      setIsScreenSharing(nextScreenShare);
    } catch (e) {
      console.warn("Screen share toggle failed:", e);
    }
  };

  const flipCamera = async () => {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    try {
      if (roomRef.current) {
        const videoTrackPubs = Array.from(roomRef.current.localParticipant.videoTrackPublications.values());
        const videoTrackPub = videoTrackPubs[0];
        if (videoTrackPub && videoTrackPub.videoTrack) {
          await (videoTrackPub.videoTrack as any).restart({ facingMode: nextFacing });
        }
      } else if (webRtcCallService.active) {
        await webRtcCallService.flipCamera();
        const stream = webRtcCallService.stream;
        if (stream) {
          localStreamRef.current = stream;
          setLocalStream(stream);
        }
      }
      setFacingMode(nextFacing);
    } catch (e) {
      console.warn("Failed to flip camera:", e);
    }
  };

  const playOutgoingBeep = () => {
    PhoneRingtones.playOutgoingBeep();
  };

  const stopSounds = () => {
    PhoneRingtones.stop();
  };

  return (
    <CallContext.Provider value={{ 
      incomingCall, 
      caller, 
      activeCall, 
      localStream, 
      remoteStream, 
      timer, 
      isMuted, 
      isVideoOff, 
      speakerState, 
      isScreenSharing, 
      setIsVideoOff,
      acceptCall, 
      rejectCall, 
      initiateCall, 
      endCall, 
      toggleMute, 
      toggleVideo, 
      toggleSpeaker, 
      toggleScreenShare, 
      flipCamera, 
      playOutgoingBeep, 
      stopSounds,
      room,
      transport
    }}>
      {children}
      
      {/* Premium overlay incoming call card */}
      <AnimatePresence>
        {incomingCall && caller && (
          <div className="fixed inset-x-0 top-0 z-[9999] px-4 py-4 pointer-events-none flex justify-center">
            <motion.div
              initial={{ y: -100, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -100, opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className="w-full max-w-md bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-[2rem] p-5 shadow-2xl flex flex-col gap-4 pointer-events-auto"
            >
              {/* Header Info */}
              <div className="flex items-center gap-3.5">
                <div className="relative shrink-0">
                  <img
                    src={caller.photoURL || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}
                    alt={caller.fullName || 'User'}
                    className="w-12 h-12 rounded-full object-cover border border-white/10"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute -bottom-1 -right-1 bg-[#0494f4] p-1.5 rounded-full border-2 border-zinc-900 text-white animate-pulse">
                    {incomingCall.type === 'video' ? <Video size={10} /> : <Phone size={10} />}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-black tracking-widest text-[#0494f4] uppercase bg-[#0494f4]/10 px-2 py-0.5 rounded-full">
                      INCOMING CALL
                    </span>
                  </div>
                  <h4 className="text-sm font-black text-white truncate mt-0.5">
                    {caller.fullName || 'Grixvibe User'}
                  </h4>
                  <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                    @{caller.userName || 'username'}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 mt-1">
                {/* Decline Button */}
                <button
                  onClick={rejectCall}
                  className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-semibold rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-rose-600/20 transition-all cursor-pointer"
                >
                  <PhoneOff size={14} />
                  <span>Decline</span>
                </button>

                {/* Answer Button */}
                <button
                  onClick={acceptCall}
                  className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white text-xs font-semibold rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
                >
                  <Phone size={14} className="animate-bounce" />
                  <span>Answer</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </CallContext.Provider>
  );
};

export const useCall = () => {
  const context = useContext(CallContext);
  if (context === undefined) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
};
