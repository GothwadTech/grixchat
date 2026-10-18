import { supabase } from '../../../lib/supabase';

/**
 * Peer-to-peer calling with Supabase Realtime as the signalling channel.
 *
 * Why this exists: LiveKit is the primary transport, but it needs server
 * credentials (`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` + `VITE_LIVEKIT_URL`).
 * Without them the old code fell back to a *simulator* that auto-"connected"
 * both sides to nothing — the call screen looked alive while no audio or video
 * ever left the device. This module replaces that illusion with a real WebRTC
 * session: two browsers, one offer/answer exchange, actual media both ways.
 * No extra service, no extra cost.
 *
 * Signalling rides on the existing Realtime connection (`call-rtc:<callId>`,
 * a broadcast topic private to the two participants by convention — the same
 * trust model as the `calls` row itself), so nothing has to be enabled in the
 * Supabase dashboard beyond Realtime, which the app already uses.
 *
 * Only the **caller** makes an offer; the receiver answers. That removes
 * glare/rollback entirely, and the later tricks (screen share, camera flip,
 * mute) go through `replaceTrack`/`enabled`, which need no renegotiation at all.
 */

export type P2PStatus = 'idle' | 'connecting' | 'connected' | 'failed' | 'closed';

export interface P2PHandlers {
  onLocalStream: (stream: MediaStream) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onStatus: (status: P2PStatus) => void;
  /** The browser's own "Stop sharing" button ended the screen share. */
  onScreenShareEnded?: () => void;
}

export interface P2PStartOptions {
  callId: string;
  selfId: string;
  peerId: string;
  callType: 'voice' | 'video';
  /** The caller offers; the receiver answers. */
  role: 'caller' | 'receiver';
  handlers: P2PHandlers;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/** How long to wait for the peer's SDP/ICE before giving up honestly. */
const CONNECT_TIMEOUT_MS = 30_000;
/** ICE `disconnected` is usually a blip — only a *lasting* one is a failure. */
const DISCONNECT_GRACE_MS = 8_000;

interface SignalPayload {
  from: string;
  type: 'hello' | 'offer' | 'answer' | 'candidate' | 'bye';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export class WebRtcCallService {
  private pc: RTCPeerConnection | null = null;
  private channel: any = null;
  private localStream: MediaStream | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private remoteStream: MediaStream | null = null;
  private options: P2PStartOptions | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  /** Grace period after ICE reports `disconnected` before declaring failure. */
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private sentOffer = false;
  private stopped = false;

  /** True while a P2P session is running. */
  get active(): boolean {
    return Boolean(this.pc) && !this.stopped;
  }

  get stream(): MediaStream | null {
    return this.localStream;
  }

  async start(options: P2PStartOptions): Promise<void> {
    this.stop(); // never leak a previous session
    this.options = options;
    this.stopped = false;

    const { callId, role, callType, handlers } = options;
    if (!supabase) throw new Error('Realtime client unavailable — cannot signal the call');

    try {
      handlers.onStatus('connecting');

      // 1. Media first: the offer must describe what we are actually sending.
      const constraints: MediaStreamConstraints =
        callType === 'video'
          ? {
              audio: { echoCancellation: true, noiseSuppression: true },
              video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
            }
          : { audio: { echoCancellation: true, noiseSuppression: true }, video: false };

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.cameraTrack = this.localStream.getVideoTracks()[0] || null;
      handlers.onLocalStream(this.localStream);

      // 2. Peer connection
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.pc = pc;
      this.remoteStream = new MediaStream();
      this.localStream.getTracks().forEach((track) => pc.addTrack(track, this.localStream!));

      pc.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((track) => {
          if (!this.remoteStream!.getTracks().includes(track)) {
            this.remoteStream!.addTrack(track);
          }
        });
        handlers.onRemoteStream(this.remoteStream!);
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) this.send({ type: 'candidate', candidate: event.candidate.toJSON() });
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'connected') {
          this.clearTimeout();
          this.clearDisconnectTimer();
          handlers.onStatus('connected');
        } else if (state === 'failed') {
          this.clearTimeout();
          this.clearDisconnectTimer();
          handlers.onStatus('failed');
        } else if (state === 'disconnected') {
          // Give ICE a moment to recover before calling it a failure — but not
          // forever: a frozen screen with two avatars is worse than honesty.
          handlers.onStatus('connecting');
          if (!this.disconnectTimer) {
            this.disconnectTimer = setTimeout(() => {
              this.disconnectTimer = null;
              if (!this.stopped && this.pc && this.pc.connectionState !== 'connected') {
                handlers.onStatus('failed');
              }
            }, DISCONNECT_GRACE_MS);
          }
        } else if (state === 'closed') {
          handlers.onStatus('closed');
        }
      };

      // 3. Signalling
      const channel = supabase.channel(`call-rtc:${callId}`);
      this.channel = channel;

      channel.on('broadcast', { event: 'signal' }, ({ payload }: any) => {
        this.handleSignal(payload as SignalPayload).catch((err) => {
          console.warn('[P2P] signal handling failed:', err);
        });
      });

      channel.subscribe(async (status: string) => {
        if (status !== 'SUBSCRIBED' || this.stopped) return;
        if (role === 'receiver') {
          // "I am here, listening" — the caller offers only after this, so the
          // offer can never arrive before the receiver has subscribed. Repeated
          // (cheaply) until the offer lands, which also covers the case where
          // the *caller* joins the topic later and missed the first hello.
          this.send({ type: 'hello' });
          if (this.helloTimer) clearInterval(this.helloTimer);
          this.helloTimer = setInterval(() => {
            if (this.stopped || this.pc?.remoteDescription) {
              if (this.helloTimer) clearInterval(this.helloTimer);
              this.helloTimer = null;
              return;
            }
            this.send({ type: 'hello' });
          }, 2500);
        }
      });

      if (role === 'caller') {
        // Nothing to time out yet: we only offer once the receiver says hello,
        // and until then the call is simply ringing — the caller's own
        // RING_TIMEOUT_MS owns the "nobody answered" case. Starting a 30 s
        // clock here made unanswered calls die with an error at 30 s while the
        // phone was still ringing on the other side.
      } else {
        this.timeoutTimer = setTimeout(() => {
          if (this.pc?.connectionState !== 'connected' && !this.stopped) {
            handlers.onStatus('failed');
          }
        }, CONNECT_TIMEOUT_MS);
      }
    } catch (err) {
      console.error('[P2P] unable to start the call:', err);
      this.stop();
      throw err;
    }
  }

  /** Ends the session and tells the peer, so their UI ends instantly too. */
  stop(notifyPeer = true): void {
    if (notifyPeer && this.channel && this.options && !this.stopped) {
      try {
        this.send({ type: 'bye' });
      } catch (_) {
        /* best effort */
      }
    }
    this.stopped = true;
    this.clearTimeout();
    if (this.helloTimer) {
      clearInterval(this.helloTimer);
      this.helloTimer = null;
    }

    if (this.pc) {
      try {
        this.pc.onicecandidate = null;
        this.pc.onconnectionstatechange = null;
        this.pc.ontrack = null;
        this.pc.close();
      } catch (_) {
        /* ignore */
      }
      this.pc = null;
    }

    this.localStream?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (_) {
        /* ignore */
      }
    });
    this.localStream = null;
    this.remoteStream = null;
    this.cameraTrack = null;
    this.screenTrack = null;
    this.pendingCandidates = [];
    this.sentOffer = false;

    if (this.channel) {
      try {
        supabase?.removeChannel(this.channel);
      } catch (_) {
        /* ignore */
      }
      this.channel = null;
    }
    this.options = null;
  }

  // ── media controls (no renegotiation required) ───────────────────────────

  setMicEnabled(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  setCameraEnabled(enabled: boolean): void {
    if (this.cameraTrack) this.cameraTrack.enabled = enabled;
  }

  async flipCamera(): Promise<void> {
    if (!this.pc || !this.cameraTrack) return;
    const sender = this.pc.getSenders().find((s) => s.track === this.cameraTrack);
    const current = this.cameraTrack.getSettings().facingMode;
    const next = current === 'environment' ? 'user' : 'environment';

    const fresh = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: next, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const track = fresh.getVideoTracks()[0];
    if (!track || !sender) {
      fresh.getTracks().forEach((t) => t.stop());
      return;
    }

    track.enabled = this.cameraTrack.enabled;
    await sender.replaceTrack(track);
    this.cameraTrack.stop();
    this.cameraTrack = track;

    // Keep the preview in sync with what is being sent.
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((t) => this.localStream!.removeTrack(t));
      this.localStream.addTrack(track);
    }
    this.publishLocalStream();
  }

  async setScreenShareEnabled(enabled: boolean): Promise<void> {
    if (!this.pc) return;
    // A voice call has no video m-line, so a "shared screen" would never leave
    // the device. Refuse loudly instead of showing a control that lies.
    if (enabled && !this.cameraTrack) {
      throw new Error('Screen sharing needs a video call');
    }
    const sender = this.pc.getSenders().find((s) => s.track === this.cameraTrack);

    if (enabled) {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0];
      if (!track) return;
      this.screenTrack = track;
      // The browser's own "Stop sharing" button ends the track — mirror it.
      track.onended = () => {
        this.setScreenShareEnabled(false)
          .then(() => this.options?.handlers.onScreenShareEnded?.())
          .catch(() => {});
      };
      await sender?.replaceTrack(track);
      if (this.localStream) {
        this.localStream.getVideoTracks().forEach((t) => this.localStream!.removeTrack(t));
        this.localStream.addTrack(track);
      }
      this.publishLocalStream();
    } else {
      const camera = this.cameraTrack;
      if (camera && sender) await sender.replaceTrack(camera);
      this.screenTrack?.stop();
      this.screenTrack = null;
      if (this.localStream && camera) {
        this.localStream.getVideoTracks().forEach((t) => this.localStream!.removeTrack(t));
        this.localStream.addTrack(camera);
      }
      this.publishLocalStream();
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private send(payload: Omit<SignalPayload, 'from'>): void {
    if (!this.channel || !this.options) return;
    this.channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: { ...payload, from: this.options.selfId } as SignalPayload,
    });
  }

  private async handleSignal(payload: SignalPayload): Promise<void> {
    if (!payload || this.stopped || !this.options || !this.pc) return;
    // Only messages from the other participant of *this* call count.
    if (payload.from && payload.from !== this.options.peerId) return;

    switch (payload.type) {
      case 'hello': {
        if (this.options.role === 'caller' && !this.sentOffer) {
          await this.createAndSendOffer();
        }
        break;
      }
      case 'offer': {
        if (this.options.role !== 'receiver' || !payload.sdp) return;
        if (this.helloTimer) {
          clearInterval(this.helloTimer);
          this.helloTimer = null;
        }
        if (this.pc.signalingState !== 'stable') return; // duplicate offer
        await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await this.flushCandidates();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.send({ type: 'answer', sdp: answer });
        break;
      }
      case 'answer': {
        if (this.options.role !== 'caller' || !payload.sdp) return;
        if (this.pc.signalingState === 'have-local-offer') {
          await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await this.flushCandidates();
        }
        break;
      }
      case 'candidate': {
        if (!payload.candidate) return;
        if (this.pc.remoteDescription) {
          await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } else {
          // ICE often beats the SDP across the wire — buffer, never drop.
          this.pendingCandidates.push(payload.candidate);
        }
        break;
      }
      case 'bye': {
        this.options.handlers.onStatus('closed');
        break;
      }
    }
  }

  private async createAndSendOffer(): Promise<void> {
    if (!this.pc) return;
    this.sentOffer = true;
    // The receiver has picked up: from here on, a silent line is a failure.
    this.clearTimeout();
    this.timeoutTimer = setTimeout(() => {
      if (!this.stopped && this.pc?.connectionState !== 'connected') {
        console.warn('[P2P] the receiver never completed the handshake');
        this.options?.handlers.onStatus('failed');
      }
    }, CONNECT_TIMEOUT_MS);
    const offer = await this.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: this.options?.callType === 'video' });
    await this.pc.setLocalDescription(offer);
    this.send({ type: 'offer', sdp: offer });
  }

  private async flushCandidates(): Promise<void> {
    if (!this.pc) return;
    const queued = [...this.pendingCandidates];
    this.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[P2P] dropped an ICE candidate:', err);
      }
    }
  }

  private clearTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.clearDisconnectTimer();
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  /**
   * Hand the UI a fresh MediaStream object after a track swap. Mutating the
   * tracks of a stream that a `<video>` is already playing does not reliably
   * repaint, so the preview kept showing the old camera after a flip.
   */
  private publishLocalStream(): void {
    if (!this.localStream) return;
    this.options?.handlers.onLocalStream(new MediaStream(this.localStream.getTracks()));
  }
}

export const webRtcCallService = new WebRtcCallService();
