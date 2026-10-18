/**
 * Egress budget — the regression guard for the 5 GB/month bug.
 *
 * Background: docs/EGRESS_AUDIT.md. The conversation list used to be re-fetched
 * on every realtime event (6 round-trips, ~127 KB measured) and pulled whole
 * user rows plus 135 message rows. These tests fail if that shape comes back.
 *
 * @vitest-environment node
 */
import { describe, expect, it} from 'vitest';
import {createClient} from '../../dev/mock/index';
import {store} from '../../dev/mock/store';
import {CONVERSATION_LIST_SELECT} from '../features/chat/hooks/useConversations';

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * Budget for one conversation-list fetch, in bytes.
 * Measured on the fixture below: 41 KB. The pre-fix path was 127 KB on the same
 * data (plus 5 more round-trips), so this catches a regression to `users(*)`
 * (+27 KB) or to fetching message rows for the preview (+37 KB).
 */
const FETCH_BUDGET = 48 * 1024;

let supabase: any;
let myId = '';

let seeded = false;

async function seedRealisticAccount() {
  if (seeded) return;
  seeded = true;
  supabase = createClient('http://mock', 'key');
  await supabase.auth.signInWithPassword({email: 'demo@grixchat.app', password: 'grixchat'});
  myId = (await supabase.auth.getUser()).data.user.id;

  // A realistic account: 20 chats, 60 follow edges, 400 messages, users with
  // the full private column set present (that is what makes `users(*)` heavy).
  const users = store.table('users') as any[];
  const extra: any[] = [];
  for (let i = 0; i < 40; i++) {
    extra.push({
      id: `u0000000-0000-4000-8000-00000000${String(i).padStart(4, '0')}`,
      email: `person${i}@grixchat.app`,
      phone: `+9190000000${String(i).padStart(2, '0')}`,
      full_name: `Person Number ${i}`,
      username: `person_${i}`,
      photo_url: 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
      bio: 'Available',
      is_verified: false,
      profile_type: 'personal',
      is_online: i % 3 === 0,
      last_seen: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      settings: {theme: 'dark', notifications: true, wallpaper: 'default', font_size: 14},
      lock: {enabled: true, pin_hash: 'x'.repeat(64)},
      blocked_users: [],
      muted_users: [],
      favorites: [],
      hidden_chats: [],
      archived_chats: [],
      hidden_chat_settings: {secretCode: null, showMenuEntry: true},
      fcm_tokens: ['token-a', 'token-b'],
    });
  }
  store.setTable('users', [...users, ...extra]);

  const follows: any[] = [];
  for (let i = 0; i < 30; i++) {
    follows.push({id: `f1${i}`, follower_id: myId, following_id: extra[i].id, created_at: new Date().toISOString()});
    follows.push({id: `f2${i}`, follower_id: extra[i].id, following_id: myId, created_at: new Date().toISOString()});
  }
  store.setTable('follows', follows);

  const convs: any[] = [];
  const parts: any[] = [];
  const msgs: any[] = [];
  let m = 0;
  for (let i = 0; i < 20; i++) {
    const cid = `c0000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`;
    const other = extra[i];
    convs.push({
      id: cid, type: 'direct', name: null, photo_url: null,
      last_message: 'Theek hai, kal baat karte hain',
      last_message_at: new Date(Date.now() - i * 60_000).toISOString(),
      updated_at: new Date(Date.now() - i * 60_000).toISOString(),
      created_at: new Date().toISOString(),
    });
    parts.push({id: `p1${i}`, conversation_id: cid, user_id: myId, last_read_at: new Date().toISOString(), created_at: new Date().toISOString(), joined_at: new Date().toISOString()});
    parts.push({id: `p2${i}`, conversation_id: cid, user_id: other.id, last_read_at: new Date().toISOString(), created_at: new Date().toISOString(), joined_at: new Date().toISOString()});
    for (let j = 0; j < 20; j++) {
      msgs.push({
        id: `m${String(m++).padStart(35, '0')}`,
        conversation_id: cid,
        sender_id: j % 2 === 1 ? other.id : myId,
        text: 'Arre yaar, ye message thoda lamba hai taaki payload realistic lage — chalo plan karte hain',
        media_url: null, media_type: null, reply_to: null, reactions: {},
        is_read: true, is_edited: false, is_deleted: false, deleted_by: [],
        created_at: new Date(Date.now() - i * 3_600_000 - j * 60_000).toISOString(),
      });
    }
  }
  store.setTable('conversations', [...(store.table('conversations') as any[]), ...convs]);
  store.setTable('conversation_participants', [...(store.table('conversation_participants') as any[]), ...parts]);
  store.setTable('messages', [...(store.table('messages') as any[]), ...msgs]);
}

/** Reads the exact query the hook runs, on the realistic fixture. */
async function fetchConversationList() {
  await seedRealisticAccount();
  return supabase
    .from('conversation_participants')
    .select(CONVERSATION_LIST_SELECT)
    .eq('user_id', myId);
}

describe('conversation-list egress budget', () => {
  it('fetches the list in one query, under budget', async () => {
    const t0 = Date.now();
    const {data, error} = await fetchConversationList();
    const elapsed = Date.now() - t0;

    expect(error).toBeFalsy();
    expect((data || []).length).toBeGreaterThanOrEqual(20);

    const size = bytes(data);
        console.log(`[egress] conversation list: ${(size / 1024).toFixed(1)} KB in ${elapsed} ms (budget ${FETCH_BUDGET / 1024} KB)`);
    expect(size).toBeLessThan(FETCH_BUDGET);
  });

  it('never selects private user columns for other people', async () => {
    const {data} = await fetchConversationList();

    const userRows = (data || []).flatMap((r: any) => (r.conversation?.participants || []).map((p: any) => p.user)).filter(Boolean);
    expect(userRows.length).toBeGreaterThan(0);

    for (const user of userRows) {
      // The passcode hash, FCM tokens and private settings must never be part
      // of a list payload.
      expect(user).not.toHaveProperty('lock');
      expect(user).not.toHaveProperty('settings');
      expect(user).not.toHaveProperty('fcm_tokens');
      expect(user).not.toHaveProperty('blocked_users');
      expect(user).not.toHaveProperty('email');
      expect(Object.keys(user).sort()).toEqual(
        ['full_name', 'id', 'is_online', 'last_seen', 'photo_url', 'username'].sort()
      );
    }
  });

  it('carries no message rows — the preview comes from conversations.last_message', async () => {
    const {data} = await fetchConversationList();

    const conversation = (data || [])[0]?.conversation;
    expect(conversation).toBeTruthy();
    expect(conversation.last_message).toBeTruthy();
    expect(conversation).not.toHaveProperty('messages');
    // No row in the payload may contain a message body array.
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('"text":');
  });

  it('the hook no longer selects * from users', async () => {
    const fs = await import('node:fs');
    const raw = fs.readFileSync(new URL('../features/chat/hooks/useConversations.ts', import.meta.url), 'utf8');
    // Strip comments so the prose that explains the rule does not trip it.
    const code = raw
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/users\s*\(\s*\*\s*\)/);
    expect(CONVERSATION_LIST_SELECT).not.toMatch(/users\s*\(\s*\*\s*\)/);
  });
});
