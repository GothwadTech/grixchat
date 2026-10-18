/**
 * Mock Supabase — auth, RPC and realtime behaviour.
 */
import {describe, expect, it} from 'vitest';
import {mockAuth} from '../auth';
import {callRpc} from '../rpc';
import {MockChannel} from '../realtime';
import {store} from '../store';
import {DEMO_LOGIN, SEED} from '../seed';
import {MockQueryBuilder} from '../query';

describe('auth', () => {
  it('signs in the demo user with the seeded credentials', async () => {
    const {data, error} = await mockAuth.signInWithPassword(DEMO_LOGIN);
    expect(error).toBeNull();
    expect(data.user.id).toBe(SEED.me);
    expect(data.user.user_metadata.username).toBe('aryan_v');
    expect(data.session.access_token).toContain(SEED.me);
  });

  it('rejects a wrong password', async () => {
    const {data, error} = await mockAuth.signInWithPassword({email: DEMO_LOGIN.email, password: 'nope'});
    expect(error).toBeTruthy();
    expect(data.user).toBeNull();
  });

  it('rejects an unknown email', async () => {
    const {error} = await mockAuth.signInWithPassword({email: 'ghost@example.com', password: 'grixchat'});
    expect(error).toBeTruthy();
  });

  it('fires SIGNED_IN then SIGNED_OUT on onAuthStateChange', async () => {
    const events: string[] = [];
    const sub = mockAuth.onAuthStateChange((event) => events.push(event));
    await mockAuth.signInWithPassword(DEMO_LOGIN);
    await mockAuth.signOut();
    await Promise.resolve();
    sub.data.subscription.unsubscribe();
    expect(events).toContain('SIGNED_IN');
    expect(events).toContain('SIGNED_OUT');
  });

  it('signUp creates a profile row (mirrors the handle_new_auth_user trigger)', async () => {
    const before = store.table('users').length;
    const {data, error} = await mockAuth.signUp({
      email: 'newcomer@example.com',
      password: 'grixchat',
      options: {data: {username: 'newcomer', full_name: 'New Comer'}},
    });
    expect(error).toBeNull();
    expect(data.user.id).toBeTruthy();
    expect(store.table('users')).toHaveLength(before + 1);
    const {data: row} = await new MockQueryBuilder('users')
      .select('full_name').eq('username', 'newcomer').single();
    expect(row.full_name).toBe('New Comer');
  });

  it('updateUser writes through to the users table', async () => {
    await mockAuth.signInWithPassword(DEMO_LOGIN);
    await mockAuth.updateUser({data: {full_name: 'Aryan V.', bio: 'updated bio'}});
    const {data} = await new MockQueryBuilder('users').select('full_name, bio').eq('id', SEED.me).single();
    expect(data.full_name).toBe('Aryan V.');
    expect(data.bio).toBe('updated bio');
  });

  it('accepts any 6-digit OTP', async () => {
    const {data, error} = await mockAuth.verifyOtp({token: '123456', type: 'email'});
    expect(error).toBeNull();
    expect(data.user).toBeTruthy();
  });
});

describe('rpc', () => {
  it('get_direct_conversation_id finds the seeded DM between me and Aarav', async () => {
    const {data, error} = await callRpc('get_direct_conversation_id', {u1: SEED.me, u2: SEED.aarav});
    expect(error).toBeNull();
    expect(data).toBe('c0000000-0000-4000-8000-000000000001');
  });

  it('get_direct_conversation_id returns null for two users with no DM', async () => {
    const {data} = await callRpc('get_direct_conversation_id', {u1: SEED.kabir, u2: SEED.rohit});
    expect(data).toBeNull();
  });

  it('increment_likes adjusts likes_count and never goes negative', async () => {
    const id = 'po000000-0000-4000-8000-000000000001';
    await callRpc('increment_likes', {target_id: id, target_table: 'posts', amount: 1});
    let row = store.table('posts').find((p) => p.id === id)!;
    expect(row.likes_count).toBe(129);
    await callRpc('increment_likes', {target_id: id, target_table: 'posts', amount: -500});
    row = store.table('posts').find((p) => p.id === id)!;
    expect(row.likes_count).toBe(0);
  });

  it('increment_video_views bumps the counter', async () => {
    const id = 't0000000-0000-4000-8000-000000000001';
    const before = store.table('tube_videos').find((v) => v.id === id)!.views_count;
    await callRpc('increment_video_views', {video_id: id});
    expect(store.table('tube_videos').find((v) => v.id === id)!.views_count).toBe(before + 1);
  });

  it('view_story records a viewer once only', async () => {
    const storyId = 's0000000-0000-4000-8000-000000000001';
    const args = {story_id_param: storyId, viewer_id_param: SEED.me, viewer_username_param: 'aryan_v', viewer_fullname_param: 'Aryan Verma'};
    await callRpc('view_story', args);
    await callRpc('view_story', args);
    const row = store.table('stories').find((s) => s.id === storyId)!;
    expect(row.views).toHaveLength(1);
    expect(row.views_count).toBe(1);
  });

  it('cleanup_expired_stories removes only stories older than 24h', async () => {
    store.table('stories').push({
      id: 'expired-story', user_id: SEED.sanya, type: 'text',
      text_content: 'old', created_at: new Date(Date.now() - 40 * 3600 * 1000).toISOString(),
    });
    const before = store.table('stories').length;
    await callRpc('cleanup_expired_stories');
    expect(store.table('stories')).toHaveLength(before - 1);
    expect(store.table('stories').some((s) => s.id === 'expired-story')).toBe(false);
  });

  it('an unknown rpc returns a 42883 error rather than throwing', async () => {
    const {data, error} = await callRpc('function_that_does_not_exist', {});
    expect(data).toBeNull();
    expect(error.code).toBe('42883');
  });
});

describe('realtime channels', () => {
  it('delivers postgres_changes for a matching filtered subscriber', async () => {
    const ch = new MockChannel('test-topic');
    const seen: any[] = [];
    ch.on('postgres_changes', {event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${SEED.me}`},
      (payload: any) => seen.push(payload));
    ch.subscribe();
    await Promise.resolve();

    await new MockQueryBuilder('messages').insert({
      conversation_id: 'c0000000-0000-4000-8000-000000000001',
      sender_id: SEED.me,
      text: 'realtime test',
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].new.text).toBe('realtime test');
    expect(seen[0].table).toBe('messages');
    await ch.unsubscribe();
  });

  it('honours the filter and drops other users\' inserts', async () => {
    const ch = new MockChannel('test-topic-2');
    const seen: any[] = [];
    ch.on('postgres_changes', {event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${SEED.sanya}`},
      (payload: any) => seen.push(payload));
    ch.subscribe();
    await Promise.resolve();

    await new MockQueryBuilder('messages').insert({
      conversation_id: 'c0000000-0000-4000-8000-000000000001',
      sender_id: SEED.me,
      text: 'should not match',
    });

    expect(seen).toHaveLength(0);
    await ch.unsubscribe();
  });

  it('broadcasts reach every channel subscribed to the same topic', async () => {
    const a = new MockChannel('typing:conv-1');
    const b = new MockChannel('typing:conv-1');
    const received: any[] = [];
    a.on('broadcast', {event: 'typing'}, (p: any) => received.push(p));
    a.subscribe();
    b.subscribe();
    await Promise.resolve();

    await b.send({type: 'broadcast', event: 'typing', payload: {userId: SEED.aarav}});
    expect(received).toHaveLength(1);
    expect(received[0].payload.userId).toBe(SEED.aarav);
    await a.unsubscribe();
    await b.unsubscribe();
  });
});
