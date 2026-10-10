/**
 * Integration tests for the real ChatService (src/services/ChatService.ts)
 * running against the mock Supabase.
 *
 * These exercise the actual shipped code paths — including the multi-line
 * embedded-resource select that ChatService.getMessages() sends — so a
 * regression in either layer shows up here, not in production.
 */
import {beforeEach, describe, expect, it} from 'vitest';
import {chatService} from '../services/ChatService';
import {mockAuth} from '../../dev/mock/auth';
import {SEED} from '../../dev/mock/seed';

const AARAV_CONV = 'c0000000-0000-4000-8000-000000000001';
const TEAM_CONV = 'c0000000-0000-4000-8000-000000000006';

describe('chatService.getMessages', () => {
  it('loads the seeded thread in chronological order', async () => {
    const messages = await chatService.getMessages(AARAV_CONV);
    expect(messages.length).toBe(7);

    const times = messages.map((m: any) => Date.parse(m.created_at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('hydrates the sender join that the UI renders avatars from', async () => {
    const messages = await chatService.getMessages(AARAV_CONV);
    const fromAarav = messages.filter((m: any) => m.sender_id === SEED.aarav);
    expect(fromAarav.length).toBeGreaterThan(0);
    fromAarav.forEach((m: any) => {
      expect(m.sender).toBeTruthy();
      expect(m.sender.username).toBe('aarav_j');
      expect(m.sender.photo_url).toBeTruthy();
    });
  });

  it('maps text onto the `content` field the UI reads', async () => {
    const messages = await chatService.getMessages(AARAV_CONV);
    messages.forEach((m: any) => expect(typeof m.content).toBe('string'));
    expect(messages.some((m: any) => m.content.includes('mock data ready'))).toBe(true);
  });

  it('respects the pagination limit', async () => {
    const messages = await chatService.getMessages(AARAV_CONV, 3);
    expect(messages).toHaveLength(3);
  });

  it('returns an empty list for an unknown conversation instead of throwing', async () => {
    const messages = await chatService.getMessages('conversation-does-not-exist');
    expect(messages).toEqual([]);
  });

  it('loads a group thread and distinguishes multiple senders', async () => {
    const messages = await chatService.getMessages(TEAM_CONV);
    const senders = new Set(messages.map((m: any) => m.sender_id));
    expect(senders.size).toBeGreaterThan(2);
  });
});

describe('chatService.sendMessage', () => {
  it('persists the message and updates the conversation preview', async () => {
    const sent = await chatService.sendMessage(AARAV_CONV, SEED.me, 'Testing the mock backend');
    expect(sent.id).toBeTruthy();
    expect(sent.content).toBe('Testing the mock backend');

    const conv = await chatService.getConversation(AARAV_CONV);
    expect(conv.last_message).toBe('Testing the mock backend');
    expect(Date.parse(conv.last_message_at)).toBeGreaterThan(Date.now() - 60_000);

    const messages = await chatService.getMessages(AARAV_CONV);
    expect(messages).toHaveLength(8);
    expect(messages[messages.length - 1].text).toBe('Testing the mock backend');
  });

  it('falls back to a media label when there is no text', async () => {
    await chatService.sendMessage(AARAV_CONV, SEED.me, '', {url: 'https://example.com/a.jpg', type: 'image'});
    const conv = await chatService.getConversation(AARAV_CONV);
    expect(conv.last_message).toBe('Sent a image');
  });

  it('attaches reply_to when replying', async () => {
    const messages = await chatService.getMessages(AARAV_CONV);
    const target = messages[0];
    const sent = await chatService.sendMessage(AARAV_CONV, SEED.me, 'Replying to you', undefined, target);
    expect(sent.reply_to).toBeTruthy();
  });
});

describe('chatService.getOrCreateDirectConversation', () => {
  it('reuses the existing DM between me and Aarav', async () => {
    const id = await chatService.getOrCreateDirectConversation(SEED.me, SEED.aarav);
    expect(id).toBe(AARAV_CONV);
  });

  it('creates a conversation + both participants when none exists', async () => {
    const id = await chatService.getOrCreateDirectConversation(SEED.me, SEED.kabir);
    expect(id).toBeTruthy();
    expect(id).not.toBe(AARAV_CONV);

    const conv = await chatService.getConversation(id!);
    expect(conv.type).toBe('direct');

    // Both sides must be able to resolve the same conversation id.
    const fromOtherSide = await chatService.getOrCreateDirectConversation(SEED.kabir, SEED.me);
    expect(fromOtherSide).toBe(id);
  });
});

describe('auth-gated flows', () => {
  beforeEach(async () => {
    await mockAuth.signInWithPassword({email: 'demo@grixchat.app', password: 'grixchat'});
  });

  it('exposes the signed-in profile row that the header reads', async () => {
    const {data} = await mockAuth.getUser();
    expect(data.user.id).toBe(SEED.me);
    expect(data.user.user_metadata.username).toBe('aryan_v');
  });

  it('marks the other party as read the way the tick logic does', async () => {
    await chatService.sendMessage(AARAV_CONV, SEED.aarav, 'Unread ping');
    const messages = await chatService.getMessages(AARAV_CONV);
    const unread = messages.filter((m: any) => !m.is_read && m.sender_id !== SEED.me);
    // 1 seeded unread ("Bhai mock data ready...") + the one just sent.
    expect(unread).toHaveLength(2);
    expect(unread[unread.length - 1].text).toBe('Unread ping');
  });
});

describe('reply threading', () => {
  it('resolves the reply_to self-join the message bubble renders', async () => {
    const messages = await chatService.getMessages(AARAV_CONV);
    const reply = messages.find((m: any) => m.text?.startsWith('Perfect. Reels'));
    expect(reply).toBeTruthy();
    expect(reply.reply_to).toBeTruthy();
    expect(reply.reply_to.text).toBe('Bhai mock backend bana diya maine');
    expect(reply.reply_to.sender_id).toBe(SEED.aarav);
  });

  it('leaves reply_to null on messages that are not replies', async () => {
    const messages = await chatService.getMessages(AARAV_CONV);
    const plain = messages.find((m: any) => m.text === 'Sahi hai! Seed data bhi daal dena');
    expect(plain.reply_to).toBeNull();
  });
});
