/**
 * `notificationService` is the only write path into the `notifications` table
 * (see docs/KNOWN_ISSUES.md #4). These tests pin the column contract the
 * reader screens depend on: the action phrase lives in `content`, never in a
 * `text` column that the SQL schema does not define (#5).
 */
import {beforeEach, describe, expect, it} from 'vitest';
import {notificationService} from '../services/db/notificationService';
import {mockAuth} from '../../dev/mock/auth';
import {store} from '../../dev/mock/store';
import {SEED} from '../../dev/mock/seed';

type NotificationRow = {
  id: string;
  user_id: string;
  from_user_id: string | null;
  type: string;
  title: string | null;
  content: string | null;
  is_read: boolean;
};

const rows = (userId: string) =>
  (store.table('notifications') as unknown as NotificationRow[]).filter(
    (n) => n.user_id === userId
  );

describe('notificationService.notifyFollow', () => {
  beforeEach(async () => {
    // Sign in as the actor so RLS-shaped behaviour is realistic.
    await mockAuth.signInWithPassword({email: 'demo@grixchat.app', password: 'grixchat'});
  });

  it('writes a row the notifications inbox can render', async () => {
    const before = rows(SEED.aarav).length;

    const ok = await notificationService.notifyFollow(SEED.me, SEED.aarav);
    expect(ok).toBe(true);

    const written = rows(SEED.aarav);
    expect(written.length).toBe(before + 1);

    const row = written[written.length - 1];
    expect(row.user_id).toBe(SEED.aarav);
    expect(row.from_user_id).toBe(SEED.me);
    expect(row.type).toBe('follow');
    // The reader screens read `content`; `title` is the full sentence.
    expect(row.content).toBe('started following you');
    expect(row.title).toContain('started following you');
    expect(row.is_read).toBe(false);
  });

  it('reuses the existing row instead of stacking duplicates on re-follow', async () => {
    await notificationService.notifyFollow(SEED.me, SEED.kabir);
    const afterFirst = rows(SEED.kabir).length;

    await notificationService.notifyFollow(SEED.me, SEED.kabir);
    expect(rows(SEED.kabir).length).toBe(afterFirst);
  });

  it('bumps a stale row back to unread', async () => {
    await notificationService.notifyFollow(SEED.me, SEED.priya);
    const row = rows(SEED.priya).find((n) => n.from_user_id === SEED.me);
    expect(row).toBeTruthy();

    store.table('notifications').find((n) => n.id === row.id)!.is_read = true;

    await notificationService.notifyFollow(SEED.me, SEED.priya);
    const refreshed = (store.table('notifications') as unknown as NotificationRow[]).filter(
      (n) => n.id === row.id
    );
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0].is_read).toBe(false);
  });

  it('refuses to notify yourself', async () => {
    const before = rows(SEED.me).length;
    expect(await notificationService.notifyFollow(SEED.me, SEED.me)).toBe(false);
    expect(rows(SEED.me).length).toBe(before);
  });
});

describe('notificationService.create', () => {
  it('stores a system notification without an actor', async () => {
    const ok = await notificationService.notifySystem(SEED.me, 'GrixChat v1.0', 'Stories are live');
    expect(ok).toBe(true);

    const row = rows(SEED.me).find((n) => n.type === 'system' && n.title === 'GrixChat v1.0');
    expect(row).toBeTruthy();
    expect(row.content).toBe('Stories are live');
    expect(row.from_user_id).toBeNull();
  });
});

describe('the notifications inbox query', () => {
  it('returns seeded rows whose content the UI can join against users', async () => {
    const {supabase} = await import('../lib/supabase');

    const {data, error} = await supabase!
      .from('notifications')
      .select('*, from_user:from_user_id(username, full_name, photo_url)')
      .eq('user_id', SEED.me)
      .in('type', ['follow', 'system'])
      .order('created_at', {ascending: false})
      .limit(50);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);

    data!.forEach((n) => {
      expect(n).toHaveProperty('content');
      expect(n.from_user).toBeTruthy();
      expect(typeof n.from_user.username).toBe('string');
    });
  });
});
