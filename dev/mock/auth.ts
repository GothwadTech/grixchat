/**
 * GrixChat Mock Supabase — auth.
 *
 * Session state lives in localStorage under the same key shape the real SDK
 * uses, so a reload keeps you signed in.
 *
 * Demo credentials:  demo@grixchat.app  /  grixchat
 * (exported as DEMO_LOGIN from ./seed)
 */
import { store } from './store';
import { DEMO_LOGIN, SEED } from './seed';
import { clone, looseEq, nowISO, Row, uuid } from './utils';

const SESSION_KEY = 'grixchat_mock_auth_session';
const DEMO_PASSWORD = DEMO_LOGIN.password;

export interface MockSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: MockUser;
}

export interface MockUser {
  id: string;
  email: string;
  phone?: string;
  email_confirmed_at: string | null;
  user_metadata: Record<string, any>;
  app_metadata: Record<string, any>;
  aud: string;
  role: string;
  created_at: string;
}

type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'USER_UPDATED' | 'TOKEN_REFRESHED' | 'INITIAL_SESSION';
type AuthListener = (event: AuthEvent, session: MockSession | null) => void;

function toAuthUser(profile: Row, email: string): MockUser {
  return {
    id: profile.id,
    email,
    phone: profile.phone,
    email_confirmed_at: nowISO(),
    user_metadata: {
      username: profile.username,
      full_name: profile.full_name,
      name: profile.full_name,
      avatar_url: profile.photo_url,
    },
    app_metadata: { provider: 'email', providers: ['email'] },
    aud: 'authenticated',
    role: 'authenticated',
    created_at: profile.created_at || nowISO(),
  };
}

class MockAuth {
  private listeners = new Set<AuthListener>();
  session: MockSession | null = null;

  constructor() {
    this.restore();
  }

  private persist() {
    try {
      if (this.session) globalThis.localStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
      else globalThis.localStorage.removeItem(SESSION_KEY);
    } catch { /* storage unavailable */ }
  }

  private restore() {
    try {
      const raw = globalThis.localStorage.getItem(SESSION_KEY);
      if (raw) this.session = JSON.parse(raw);
    } catch { /* ignore */ }
    this.emit('INITIAL_SESSION', this.session);
  }

  private emit(event: AuthEvent, session: MockSession | null) {
    this.listeners.forEach((fn) => {
      try { fn(event, session ? clone(session) : null); } catch { /* subscriber bug */ }
    });
  }

  private findProfileByEmail(email: string): Row | undefined {
    return store.table('users').find((u) => looseEq(String(u.email).toLowerCase(), String(email).toLowerCase()));
  }

  private makeSession(profile: Row, email: string): MockSession {
    return {
      access_token: `mock-access-${profile.id}`,
      refresh_token: `mock-refresh-${profile.id}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: toAuthUser(profile, email),
    };
  }

  async getSession() {
    return { data: { session: this.session ? clone(this.session) : null }, error: null };
  }

  async getUser() {
    if (!this.session) return { data: { user: null }, error: { message: 'Auth session missing' } };
    const profile = store.table('users').find((u) => looseEq(u.id, this.session!.user.id));
    return { data: { user: profile ? toAuthUser(profile, this.session.user.email) : this.session.user }, error: null };
  }

  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const profile = this.findProfileByEmail(email);
    if (!profile) {
      return { data: { user: null, session: null }, error: { message: 'Invalid login credentials', status: 400 } };
    }
    // Every seeded user shares the demo password — this is a mock.
    if (password !== DEMO_PASSWORD) {
      return { data: { user: null, session: null }, error: { message: 'Invalid login credentials', status: 400 } };
    }
    this.session = this.makeSession(profile, email);
    this.persist();
    this.emit('SIGNED_IN', this.session);
    return { data: { user: clone(this.session.user), session: clone(this.session) }, error: null };
  }

  async signUp({ email, password, options }: { email: string; password: string; options?: any }) {
    if (this.findProfileByEmail(email)) {
      return { data: { user: null, session: null }, error: { message: 'User already registered', status: 422 } };
    }
    const meta = options?.data || {};
    const username = meta.username || String(email).split('@')[0];
    const profile: Row = {
      id: uuid(),
      email,
      full_name: meta.full_name || meta.name || username,
      username,
      photo_url: meta.avatar_url || 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
      bio: 'Available',
      is_verified: false,
      profile_type: 'personal',
      is_online: true,
      last_seen: nowISO(),
      updated_at: nowISO(),
      created_at: nowISO(),
      settings: {},
      lock: null,
      blocked_users: [], muted_users: [], favorites: [],
      hidden_chats: [], archived_chats: [],
      hidden_chat_settings: { secretCode: null, showMenuEntry: true },
      fcm_tokens: [],
    };
    store.table('users').push(profile);
    store.emit('INSERT', 'users', profile);
    store.save();
    // Mirrors the handle_new_auth_user trigger: profile exists before the session.
    this.session = this.makeSession(profile, email);
    this.persist();
    this.emit('SIGNED_IN', this.session);
    return { data: { user: clone(this.session.user), session: clone(this.session) }, error: null };
  }

  async signInWithOAuth({ provider }: { provider: string }) {
    // Real OAuth cannot happen in a mock — auto-sign in as the demo user so
    // the button still exercises the whole post-login flow.
    const profile = store.table('users').find((u) => looseEq(u.id, SEED.me))!;
    this.session = this.makeSession(profile, profile.email);
    this.persist();
    this.emit('SIGNED_IN', this.session);
    return { data: { provider, url: null, mocked: true }, error: null };
  }

  async signOut() {
    this.session = null;
    this.persist();
    this.emit('SIGNED_OUT', null);
    return { error: null };
  }

  async updateUser(attrs: { email?: string; password?: string; data?: Record<string, any> }) {
    if (!this.session) return { data: { user: null }, error: { message: 'Auth session missing' } };
    const profile = store.table('users').find((u) => looseEq(u.id, this.session!.user.id));
    if (profile) {
      const before = clone(profile);
      if (attrs.email) profile.email = attrs.email;
      if (attrs.data) {
        if (attrs.data.full_name !== undefined) profile.full_name = attrs.data.full_name;
        if (attrs.data.username !== undefined) profile.username = attrs.data.username;
        if (attrs.data.avatar_url !== undefined) profile.photo_url = attrs.data.avatar_url;
        if (attrs.data.photo_url !== undefined) profile.photo_url = attrs.data.photo_url;
        if (attrs.data.bio !== undefined) profile.bio = attrs.data.bio;
        if (attrs.data.phone !== undefined) profile.phone = attrs.data.phone;
        profile.updated_at = nowISO();
      }
      store.emit('UPDATE', 'users', profile, before);
      store.save();
      this.session.user = toAuthUser(profile, profile.email);
      this.persist();
      this.emit('USER_UPDATED', this.session);
    }
    return { data: { user: clone(this.session.user) }, error: null };
  }

  async setSession({ access_token }: { access_token: string }) {
    const id = String(access_token).replace('mock-access-', '');
    const profile = store.table('users').find((u) => looseEq(u.id, id));
    if (!profile) return { data: { user: null, session: null }, error: { message: 'Invalid session' } };
    this.session = this.makeSession(profile, profile.email);
    this.persist();
    this.emit('SIGNED_IN', this.session);
    return { data: { user: clone(this.session.user), session: clone(this.session) }, error: null };
  }

  async refreshSession() {
    if (!this.session) return { data: { session: null }, error: { message: 'Auth session missing' } };
    this.session.expires_at = Math.floor(Date.now() / 1000) + 3600;
    this.persist();
    this.emit('TOKEN_REFRESHED', this.session);
    return { data: { session: clone(this.session), user: clone(this.session.user) }, error: null };
  }

  async verifyOtp({ token, type }: { token: string; type?: string }) {
    // Accept any 6-digit OTP against the demo account.
    if (!/^\d{6}$/.test(String(token))) {
      return { data: { user: null, session: null }, error: { message: 'Invalid OTP' } };
    }
    const profile = store.table('users').find((u) => looseEq(u.id, SEED.me))!;
    this.session = this.makeSession(profile, profile.email);
    this.persist();
    this.emit('SIGNED_IN', this.session);
    return { data: { user: clone(this.session.user), session: clone(this.session) }, error: null, type };
  }

  async resend({ email }: { email?: string; type?: string } = {}) {
    return { data: null, error: null, mocked: true, email };
  }

  async resetPasswordForEmail(email: string) {
    // eslint-disable-next-line no-console
    console.info(`[grixMock] password reset requested for ${email} (no email is actually sent)`);
    return { data: null, error: null };
  }

  onAuthStateChange(cb: AuthListener) {
    this.listeners.add(cb);
    // The real client fires INITIAL_SESSION asynchronously on subscribe.
    Promise.resolve().then(() => cb('INITIAL_SESSION', this.session ? clone(this.session) : null));
    return { data: { subscription: { unsubscribe: () => this.listeners.delete(cb) } } };
  }
}

export const mockAuth = new MockAuth();
