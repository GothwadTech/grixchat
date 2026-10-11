/**
 * The calling system's handshake, end to end, with a stubbed WebRTC stack.
 *
 * The bug this pins down: the old code "connected" a call from a timer, so an
 * outgoing call looked answered while the other phone was still ringing, and a
 * deploy without LiveKit credentials showed a fake connected call with no
 * media. A call may only reach `connected` when the peer connection says so.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {WebRtcCallService} from '../features/call/services/WebRtcCallService';

// ── a minimal WebRTC stand-in (jsdom ships none) ────────────────────────────

class FakeTrack {
  kind: string;
  enabled = true;
  readyState = 'live';
  constructor(kind: string) {
    this.kind = kind;
  }
  stop() {
    this.readyState = 'ended';
  }
  getSettings() {
    return {facingMode: 'user'};
  }
}

class FakeStream {
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  addTrack(track: FakeTrack) {
    this.tracks.push(track);
  }
  removeTrack(track: FakeTrack) {
    this.tracks = this.tracks.filter((t) => t !== track);
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  onicecandidate: ((e: any) => void) | null = null;
  ontrack: ((e: any) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = 'new';
  signalingState = 'stable';
  remoteDescription: any = null;
  localDescription: any = null;
  private senders: any[] = [];

  constructor(_config?: any) {
    FakePeerConnection.instances.push(this);
  }
  addTrack(track: FakeTrack) {
    this.senders.push({track, replaceTrack: async () => {}});
  }
  getSenders() {
    return this.senders;
  }
  async createOffer() {
    return {type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n'};
  }
  async createAnswer() {
    return {type: 'answer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n'};
  }
  async setLocalDescription(description: any) {
    this.localDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(description: any) {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async addIceCandidate(_candidate: any) {}
  close() {
    this.connectionState = 'closed';
  }
  /** Test helper: pretend ICE finished. */
  connect() {
    this.connectionState = 'connected';
    this.onconnectionstatechange?.();
  }
}

const flush = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  FakePeerConnection.instances = [];
  (globalThis as any).RTCPeerConnection = FakePeerConnection;
  (globalThis as any).RTCSessionDescription = class {
    constructor(public init: any) {}
    get type() {
      return this.init.type;
    }
    get sdp() {
      return this.init.sdp;
    }
  };
  (globalThis as any).RTCIceCandidate = class {
    constructor(public init: any) {}
  };
  (globalThis as any).MediaStream = FakeStream;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => new FakeStream([new FakeTrack('audio')])),
      getDisplayMedia: vi.fn(async () => new FakeStream([new FakeTrack('video')])),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('peer-to-peer call signalling', () => {
  it('completes the offer/answer handshake and only then reports connected', async () => {
    const callerEvents: string[] = [];
    const receiverEvents: string[] = [];

    const caller = new WebRtcCallService();
    const receiver = new WebRtcCallService();

    await caller.start({
      callId: 'call-1',
      selfId: 'user-a',
      peerId: 'user-b',
      callType: 'voice',
      role: 'caller',
      handlers: {
        onLocalStream: () => {},
        onRemoteStream: () => {},
        onStatus: (status) => callerEvents.push(status),
      },
    });

    await receiver.start({
      callId: 'call-1',
      selfId: 'user-b',
      peerId: 'user-a',
      callType: 'voice',
      role: 'receiver',
      handlers: {
        onLocalStream: () => {},
        onRemoteStream: () => {},
        onStatus: (status) => receiverEvents.push(status),
      },
    });

    await flush();

    const [callerPc, receiverPc] = FakePeerConnection.instances;
    expect(callerPc).toBeTruthy();
    expect(receiverPc).toBeTruthy();

    // The receiver heard the offer and produced an answer…
    expect(receiverPc.remoteDescription?.type).toBe('offer');
    expect(receiverPc.localDescription?.type).toBe('answer');
    // …and the caller applied that answer.
    expect(callerPc.remoteDescription?.type).toBe('answer');

    // Nothing may claim to be connected before ICE says so.
    expect(callerEvents).not.toContain('connected');
    expect(receiverEvents).not.toContain('connected');

    callerPc.connect();
    receiverPc.connect();

    expect(callerEvents).toContain('connected');
    expect(receiverEvents).toContain('connected');
    expect(callerEvents).not.toContain('failed');

    caller.stop();
    receiver.stop();
  });

  it('never reports connected when the connection fails — it says failed', async () => {
    const statuses: string[] = [];
    const caller = new WebRtcCallService();

    await caller.start({
      callId: 'call-2',
      selfId: 'user-a',
      peerId: 'user-b',
      callType: 'video',
      role: 'caller',
      handlers: {onLocalStream: () => {}, onRemoteStream: () => {}, onStatus: (s) => statuses.push(s)},
    });

    await flush();

    const pc = FakePeerConnection.instances[0];
    pc.connectionState = 'failed';
    pc.onconnectionstatechange?.();

    expect(statuses).toContain('connecting');
    expect(statuses).toContain('failed');
    expect(statuses).not.toContain('connected');

    caller.stop();
  });

  it('tears the session down when the peer hangs up', async () => {
    const statuses: string[] = [];
    const caller = new WebRtcCallService();
    const receiver = new WebRtcCallService();

    await caller.start({
      callId: 'call-3',
      selfId: 'user-a',
      peerId: 'user-b',
      callType: 'voice',
      role: 'caller',
      handlers: {onLocalStream: () => {}, onRemoteStream: () => {}, onStatus: () => {}},
    });
    await receiver.start({
      callId: 'call-3',
      selfId: 'user-b',
      peerId: 'user-a',
      callType: 'voice',
      role: 'receiver',
      handlers: {onLocalStream: () => {}, onRemoteStream: () => {}, onStatus: (s) => statuses.push(s)},
    });

    await flush();
    FakePeerConnection.instances[0]?.connect();
    FakePeerConnection.instances[1]?.connect();

    // The other side pressed "end call".
    await caller.stop();
    await flush();

    expect(statuses).toContain('closed');
  });
});

describe('ringing is not a failure', () => {
  it('keeps the caller ringing past the connect window while nobody answers', async () => {
    vi.useFakeTimers();
    try {
      const statuses: string[] = [];
      const caller = new WebRtcCallService();

      await caller.start({
        callId: 'call-ring-1',
        selfId: 'user-a',
        peerId: 'user-b',
        callType: 'voice',
        role: 'caller',
        handlers: {onLocalStream: () => {}, onRemoteStream: () => {}, onStatus: (s) => statuses.push(s)},
      });

      await flush();
      // Nobody picked up. The old code failed the call here, which turned an
      // unanswered ring into an "error" screen while the phone was still
      // ringing; the ring timeout owns this case.
      vi.advanceTimersByTime(60_000);
      await flush();

      expect(statuses).toContain('connecting');
      expect(statuses).not.toContain('failed');
      caller.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails honestly when the answered peer never finishes the handshake', async () => {
    vi.useFakeTimers();
    try {
      const callerStatuses: string[] = [];
      const caller = new WebRtcCallService();
      const receiver = new WebRtcCallService();
      const handlers = (sink: string[]) => ({
        onLocalStream: () => {},
        onRemoteStream: () => {},
        onStatus: (s: any) => sink.push(s),
      });

      await caller.start({
        callId: 'call-ring-2',
        selfId: 'user-a',
        peerId: 'user-b',
        callType: 'voice',
        role: 'caller',
        handlers: handlers(callerStatuses),
      });
      await receiver.start({
        callId: 'call-ring-2',
        selfId: 'user-b',
        peerId: 'user-a',
        callType: 'voice',
        role: 'receiver',
        handlers: handlers([]),
      });

      await flush();
      // The receiver answered (offer/answer done) but ICE never came up.
      expect(callerStatuses).not.toContain('failed');

      vi.advanceTimersByTime(31_000);
      await flush();

      expect(callerStatuses).toContain('failed');
      caller.stop();
      receiver.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
