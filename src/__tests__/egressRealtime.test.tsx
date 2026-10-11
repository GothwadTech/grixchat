/**
 * The regression test for the 5 GB/month bug (docs/EGRESS_AUDIT.md).
 *
 * Mounts the real <App />, lands on the chat list, then delivers an incoming
 * message exactly the way Supabase Realtime would. The list must update — and
 * the client must not issue a single database query to do it.
 *
 * Before this fix, every message triggered `fetchConversations()`: 6 queries
 * and ~127 KB per client, per message.
 */
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import App from '../App';
import {AppProviders} from '../providers/AppProviders';
import {getSupabase} from '../lib/supabase';
import {store} from '../../dev/mock/store';

async function loginToChatList() {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AppProviders>
        <App />
      </AppProviders>
    </MemoryRouter>,
  );

  await waitFor(() => screen.getByPlaceholderText(/Email, Phone or Username/i), {timeout: 8000});
  await user.type(screen.getByPlaceholderText(/Email, Phone or Username/i), 'demo@grixchat.app');
  await user.type(screen.getByPlaceholderText('Password'), 'grixchat');

  const form = screen.getByPlaceholderText('Password').closest('form') as HTMLFormElement;
  const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement;
  await waitFor(() => expect(submit).not.toBeDisabled(), {timeout: 5000});
  await user.click(submit);

  await waitFor(() => expect(screen.getByText(/mock data ready/i)).toBeInTheDocument(), {timeout: 15000});
}

describe('realtime traffic does not refetch the conversation list', () => {
  it('patches the row from the payload instead of querying the database', async () => {
    await loginToChatList();

    const client: any = getSupabase();
    expect(client).toBeTruthy();

    // Count every query the app makes from now on.
    const queriedTables: string[] = [];
    const originalFrom = client.from.bind(client);
    client.from = (table: string, ...rest: any[]) => {
      queriedTables.push(table);
      return originalFrom(table, ...rest);
    };

    try {
      // An incoming message in a chat the demo user is part of.
      const conversation = (store.table('conversations') as any[]).find(
        (c) => c.last_message === 'Bhai mock data ready hai, check kar le 👍',
      );
      expect(conversation).toBeTruthy();

      const otherUser = (store.table('users') as any[]).find((u) => u.username !== 'aryan_v');
      const row = {
        id: `m-egress-${Date.now()}`,
        conversation_id: conversation.id,
        sender_id: otherUser.id,
        text: 'EGRESS PATCH CHECK',
        media_url: null,
        media_type: null,
        reply_to: null,
        reactions: {},
        is_read: false,
        is_edited: false,
        is_deleted: false,
        deleted_by: [],
        created_at: new Date().toISOString(),
      };

      // Same path a real INSERT takes: write, then broadcast.
      store.setTable('messages', [...(store.table('messages') as any[]), row]);
      store.emit('INSERT', 'messages', row);

      // The preview updates…
      await waitFor(() => expect(screen.getAllByText(/EGRESS PATCH CHECK/i).length).toBeGreaterThan(0), {timeout: 5000});

      // …without a single query. (The chat screen may fetch its own message
      // list; the *conversation list* must not.)
      const listRefetches = queriedTables.filter(
        (t) => t === 'conversation_participants' || t === 'conversations' || t === 'follows' || t === 'chat_settings',
      );
      expect(listRefetches).toEqual([]);
    } finally {
      client.from = originalFrom;
    }
  }, 30000);
});
