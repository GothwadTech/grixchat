/**
 * Mock Supabase — query builder behaviour.
 *
 * These tests pin the contract that src/ relies on: if the mock drifts from
 * real PostgREST semantics, the app would silently break, so the semantics
 * are asserted here rather than assumed.
 */
import {describe, expect, it} from 'vitest';
import {MockQueryBuilder} from '../query';
import {store} from '../store';
import {SEED} from '../seed';
import {parseSelect} from '../query';

const from = (t: string) => new MockQueryBuilder(t);

describe('select', () => {
  it('returns every seeded user', async () => {
    const {data, error} = await from('users').select('*');
    expect(error).toBeNull();
    expect(data).toHaveLength(8);
  });

  it('projects only the requested columns', async () => {
    const {data} = await from('users').select('id, username').eq('id', SEED.me).single();
    expect(Object.keys(data).sort()).toEqual(['id', 'username']);
    expect(data.username).toBe('aryan_v');
  });

  it('supports eq + single', async () => {
    const {data} = await from('users').select('*').eq('username', 'sanya_g').single();
    expect(data.full_name).toBe('Sanya Gupta');
  });

  it('maybeSingle returns null instead of an error when nothing matches', async () => {
    const {data, error} = await from('users').select('*').eq('username', 'does_not_exist').maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('single returns a PGRST116 error when nothing matches', async () => {
    const {data, error} = await from('users').select('*').eq('username', 'does_not_exist').single();
    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error.code).toBe('PGRST116');
  });

  it('supports neq', async () => {
    const {data} = await from('users').select('id').neq('id', SEED.me);
    expect(data).toHaveLength(7);
    expect(data.some((u: any) => u.id === SEED.me)).toBe(false);
  });

  it('supports in', async () => {
    const {data} = await from('users').select('id').in('id', [SEED.aarav, SEED.priya]);
    expect(data).toHaveLength(2);
  });

  it('supports or() with the PostgREST mini-language', async () => {
    const {data} = await from('users')
      .select('id')
      .or(`id.eq.${SEED.me},id.eq.${SEED.sanya}`);
    expect(data).toHaveLength(2);
  });

  it('supports match() as multi-eq', async () => {
    const {data} = await from('chat_settings').select('*').match({user_id: SEED.me, receiver_id: SEED.aarav});
    expect(data).toHaveLength(1);
    expect(data[0].nickname).toBe('Aaru');
  });

  it('supports contains() on Postgres arrays', async () => {
    const {data} = await from('users').select('id').contains('favorites', [SEED.aarav]);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(SEED.me);
  });

  it('orders descending by created_at', async () => {
    const {data} = await from('messages')
      .select('created_at')
      .eq('conversation_id', 'c0000000-0000-4000-8000-000000000001')
      .order('created_at', {ascending: false});
    const times = data.map((m: any) => Date.parse(m.created_at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('applies limit', async () => {
    const {data} = await from('messages').select('id').limit(5);
    expect(data).toHaveLength(5);
  });

  it('applies range inclusively', async () => {
    const {data} = await from('messages').select('id').range(0, 2);
    expect(data).toHaveLength(3);
  });

  it('returns count when count:exact is requested', async () => {
    const {data, count} = await from('reels').select('*', {count: 'exact'});
    expect(count).toBe(3);
    expect(data).toHaveLength(3);
  });
});

describe('embedded resources (PostgREST joins)', () => {
  it("resolves 'users:user_id(...)' on stories", async () => {
    const {data} = await from('stories').select('*, users:user_id(username, photo_url)').eq('user_id', SEED.sanya);
    expect(data).toHaveLength(1);
    expect(data[0].users.username).toBe('sanya_g');
    expect(data[0].users.photo_url).toBeTruthy();
  });

  it('resolves a to-one join by table name', async () => {
    const {data} = await from('conversation_participants')
      .select('conversation_id, conversation:conversations(id, type)')
      .eq('conversation_id', 'c0000000-0000-4000-8000-000000000006')
      .limit(1);
    expect(data[0].conversation).toBeTruthy();
    expect(data[0].conversation.type).toBe('group');
  });

  it('resolves an aliased join on a differently-named fk (from_user_id)', async () => {
    const {data} = await from('notifications')
      .select('*, from_user:from_user_id(username, full_name, photo_url)')
      .eq('id', 'n0000000-0000-4000-8000-000000000001')
      .single();
    expect(data.from_user.username).toBe('sanya_g');
  });

  it('resolves the callers fkey hint form', async () => {
    const {data} = await from('calls')
      .select('*, users:users!calls_caller_id_fkey (username, photo_url, full_name)')
      .eq('id', 'k0000000-0000-4000-8000-000000000002')
      .single();
    expect(data.users.username).toBe('sanya_g');
  });
});

describe('parseSelect', () => {
  it('does not split on commas nested inside parens', () => {
    const parts = parseSelect('*, users:user_id(id, username, full_name, photo_url)');
    expect(parts).toHaveLength(2);
    expect(parts[0].column).toBe('*');
    expect(parts[1].alias).toBe('users');
    expect(parts[1].ref).toBe('user_id');
    expect(parts[1].nested).toBe('id, username, full_name, photo_url');
  });
});

describe('mutations', () => {
  it('inserts a row and returns it', async () => {
    const {data} = await from('messages').insert({
      conversation_id: 'c0000000-0000-4000-8000-000000000001',
      sender_id: SEED.me,
      text: 'hello from a test',
    }).select();

    // PostgREST returns an array from .insert().select() — only .single() collapses it.
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].id).toBeTruthy();
    expect(data[0].created_at).toBeTruthy();
    expect(store.table('messages').some((m) => m.text === 'hello from a test')).toBe(true);
  });

  it('updates only the matched rows', async () => {
    const {data} = await from('messages')
      .update({is_read: true})
      .eq('conversation_id', 'c0000000-0000-4000-8000-000000000001')
      .select('id, is_read');
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((m: any) => m.is_read === true)).toBe(true);
  });

  it('deletes and reports what was removed', async () => {
    const before = store.table('messages').length;
    const {data} = await from('messages').delete().eq('text', 'Bhai mock backend bana diya maine').select('id');
    expect(data).toHaveLength(1);
    expect(store.table('messages').length).toBe(before - 1);
  });

  it('upserts on conflict', async () => {
    await from('chat_settings').upsert({
      id: 'cs000000-0000-4000-8000-000000000001',
      user_id: SEED.me,
      receiver_id: SEED.aarav,
      nickname: 'Aaru Bhai',
    }, {onConflict: 'id'});
    const {data} = await from('chat_settings').select('*').eq('user_id', SEED.me).eq('receiver_id', SEED.aarav).single();
    expect(data.nickname).toBe('Aaru Bhai');
    expect(store.table('chat_settings')).toHaveLength(2);
  });
});
