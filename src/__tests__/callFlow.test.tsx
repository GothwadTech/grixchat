/**
 * The call lifecycle through the REAL app: an incoming `calls` row rings the
 * receiver, answering it writes `accepted` + one chat log, and hanging up
 * closes the row. Media APIs are stubbed (jsdom ships no WebRTC), everything
 * else — the provider, the mock Realtime channel, the database writes — is the
 * production path.
 *
 * This is the test that would have caught the old bugs: the duplicate incoming
 * card wrote `denied` (rejected by the `calls.status` CHECK constraint, so a
 * decline never reached the database), and the call screen re-dialled the peer
 * as soon as a call ended.
 */
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import App from '../App';
import {AppProviders} from '../providers/AppProviders';
import {store} from '../../dev/mock/store';
import {mockAuth} from '../../dev/mock/auth';

// ── a minimal WebRTC stand-in ───────────────────────────────────────────────

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

  constructor(_config?: any) {
    FakePeerConnection.instances.push(this);
  }
  addTrack() {}
  getSenders() {
    return [];
  }
  async createOffer() {
    return {type: 'offer', sdp: 'v=0\r\n'};
  }
  async createAnswer() {
    return {type: 'answer', sdp: 'v=0\r\n'};
  }
  async setLocalDescription(description: any) {
    this.localDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(description: any) {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async addIceCandidate() {}
  close() {
    this.connectionState = 'closed';
  }
  connect() {
    this.connectionState = 'connected';
    this.onconnectionstatechange?.();
  }
}

const demoUser = '00000000-0000-4000-8000-000000000001';

async function login(u: ReturnType<typeof userEvent.setup>) {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AppProviders>
        <App />
      </AppProviders>
    </MemoryRouter>,
  );

  await waitFor(() => screen.getByPlaceholderText(/Email, Phone or Username/i), {timeout: 8000});
  await u.type(screen.getByPlaceholderText(/Email, Phone or Username/i), 'demo@grixchat.app');
  await u.type(screen.getByPlaceholderText('Password'), 'grixchat');
  const form = screen.getByPlaceholderText('Password').closest('form') as HTMLFormElement;
  const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement;
  await waitFor(() => expect(submit).not.toBeDisabled(), {timeout: 5000});
  await u.click(submit);
  await waitFor(() => expect(screen.getByText(/mock data ready/i)).toBeInTheDocument(), {timeout: 15000});
}

function ringFrom(callerId: string, type: 'audio' | 'video' = 'audio') {
  const row: any = {
    id: `call-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    caller_id: callerId,
    receiver_id: demoUser,
    type,
    status: 'ringing',
    is_missed: false,
    created_at: new Date().toISOString(),
  };
  store.setTable('calls', [...(store.table('calls') as any[]), row]);
  store.emit('INSERT', 'calls', row);
  return row;
}

const callsTable = () => store.table('calls') as any[];
const callById = (id: string) => callsTable().find((c) => c.id === id);

describe('call lifecycle', () => {
  it('declining an incoming call writes `rejected`, never the invalid `denied`', async () => {
    const u = userEvent.setup();
    await login(u);

    const caller = (store.table('users') as any[]).find((x) => x.id !== demoUser);
    const call = ringFrom(caller.id);

    await waitFor(() => expect(screen.getByText(/INCOMING CALL/i)).toBeInTheDocument(), {timeout: 8000});
    await u.click(screen.getByText('Decline'));

    await waitFor(() => expect(callById(call.id)?.status).toBe('rejected'), {timeout: 8000});
    expect(callById(call.id)?.is_missed).toBe(true);
    // The old duplicate card wrote `denied` here and the CHECK constraint threw.
    expect(callById(call.id)?.status).not.toBe('denied');
  });

  it('answers, connects, logs the call once, and closes the row when it ends', async () => {
    const u = userEvent.setup();
    await login(u);

    const caller = (store.table('users') as any[]).find((x) => x.id !== demoUser);
    const call = ringFrom(caller.id);

    await waitFor(() => expect(screen.getByText(/INCOMING CALL/i)).toBeInTheDocument(), {timeout: 8000});
    await u.click(screen.getByText('Answer'));

    // Answering is written to the database (that is what stops the caller's ring).
    await waitFor(() => expect(callById(call.id)?.status).toBe('accepted'), {timeout: 8000});

    // Exactly one system log for the call.
    await waitFor(() => {
      const logs = (store.table('messages') as any[]).filter((m) => m.media_type === 'system');
      expect(logs.length).toBe(1);
    }, {timeout: 8000});

    // ICE comes up → the call screen leaves "connecting".
    await act(async () => {
      FakePeerConnection.instances.forEach((pc) => pc.connect());
      await Promise.resolve();
    });

    const endButton = await screen.findByTitle('End Call', {}, {timeout: 8000});
    await u.click(endButton);

    await waitFor(() => expect(callById(call.id)?.status).toBe('ended'), {timeout: 8000});
    expect(callById(call.id)?.is_missed).toBe(false);

    // The screen must not re-dial the peer after the call ends.
    await new Promise((r) => setTimeout(r, 300));
    const extraRinging = callsTable().filter((c) => c.status === 'ringing' && c.id !== call.id);
    expect(extraRinging).toEqual([]);
  });

  it('stops listening for a call the other side already ended', async () => {
    const u = userEvent.setup();
    await login(u);

    const caller = (store.table('users') as any[]).find((x) => x.id !== demoUser);
    const call = ringFrom(caller.id);

    await waitFor(() => expect(screen.getByText(/INCOMING CALL/i)).toBeInTheDocument(), {timeout: 8000});

    // The caller gives up while the phone is still ringing.
    const updated = {...call, status: 'ended', is_missed: true};
    store.setTable('calls', callsTable().map((c) => (c.id === call.id ? updated : c)));
    await act(async () => {
      store.emit('UPDATE', 'calls', updated, call);
      await Promise.resolve();
    });

    await waitFor(
      () => expect(screen.queryByText(/INCOMING CALL/i)).not.toBeInTheDocument(),
      {timeout: 8000},
    );
  });
});

// A previous test's session would skip the login screen entirely.
beforeEach(async () => {
  await mockAuth.signOut();
  FakePeerConnection.instances = [];
});

// Keep the stubs installed for the whole file (jsdom has no media stack).
beforeAll(() => {
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
