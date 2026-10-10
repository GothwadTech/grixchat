/**
 * GrixChat Mock Supabase — RPC functions.
 *
 * Signatures were taken from the actual call sites in src/ so the mock
 * matches what the app sends. `view_story`, `increment_likes`,
 * `increment_comments`, `increment_comments_count` and
 * `increment_video_views` have **no Postgres definition in /sql** — the app
 * already defends against that with try/catch fallbacks. See
 * docs/DATA_MODEL.md § "Schema drift".
 */
import { store } from './store';
import { clone, looseEq, nowISO, Row, uuid } from './utils';

const ok = (data: any) => ({ data, error: null });
const fail = (message: string) => ({
  data: null,
  error: { code: '42883', message, details: '', hint: '' },
});

/** SQL: joins conversation_participants twice and filters conversations.type = 'direct' */
function getDirectConversationId({ u1, u2 }: { u1: string; u2: string }) {
  const participants = store.table('conversation_participants');
  const conversations = store.table('conversations');
  const mine = participants.filter((p) => looseEq(p.user_id, u1)).map((p) => p.conversation_id);
  const theirs = participants.filter((p) => looseEq(p.user_id, u2)).map((p) => p.conversation_id);
  const shared = mine.filter((id) => theirs.some((t) => looseEq(t, id)));
  const hit = conversations.find(
    (c) => c.type === 'direct' && shared.some((id) => looseEq(id, c.id)),
  );
  return ok(hit ? hit.id : null);
}

function incrementLikes({ target_id, target_table = 'posts', amount = 1 }: any) {
  const table = store.table(target_table);
  const row = table.find((r) => looseEq(r.id, target_id));
  if (!row) return fail(`increment_likes: no row ${target_id} in ${target_table}`);
  const before = clone(row);
  row.likes_count = Math.max(0, (Number(row.likes_count) || 0) + Number(amount));
  store.emit('UPDATE', target_table, row, before);
  store.save();
  return ok(row.likes_count);
}

function incrementComments({ target_id, target_table = 'posts', amount = 1 }: any) {
  const table = store.table(target_table);
  const row = table.find((r) => looseEq(r.id, target_id));
  if (!row) return fail(`increment_comments: no row ${target_id} in ${target_table}`);
  const before = clone(row);
  row.comments_count = Math.max(0, (Number(row.comments_count) || 0) + Number(amount));
  store.emit('UPDATE', target_table, row, before);
  store.save();
  return ok(row.comments_count);
}

/** CommentSheet falls back to this name when the RPC is missing. */
function incrementCommentsCount({ row_id }: { row_id: string }) {
  return incrementComments({ target_id: row_id, target_table: 'posts', amount: 1 });
}

function incrementVideoViews({ video_id }: { video_id: string }) {
  const row = store.table('tube_videos').find((r) => looseEq(r.id, video_id));
  if (!row) return fail(`increment_video_views: no tube_video ${video_id}`);
  const before = clone(row);
  row.views_count = (Number(row.views_count) || 0) + 1;
  store.emit('UPDATE', 'tube_videos', row, before);
  store.save();
  return ok(row.views_count);
}

/** Stories expire 24h after creation. */
function cleanupExpiredStories() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const all = store.table('stories');
  const kept = all.filter((s) => {
    const t = Date.parse(String(s.created_at));
    return Number.isNaN(t) ? true : t > cutoff;
  });
  const removed = all.filter((s) => !kept.includes(s));
  store.setTable('stories', kept);
  removed.forEach((s) => store.emit('DELETE', 'stories', s, s));
  return ok(removed.length);
}

function viewStory({
  story_id_param,
  viewer_id_param,
  viewer_username_param,
  viewer_fullname_param,
}: any) {
  const row = store.table('stories').find((r) => looseEq(r.id, story_id_param));
  if (!row) return fail(`view_story: no story ${story_id_param}`);
  const before = clone(row);
  const views: Row[] = Array.isArray(row.views) ? row.views : [];
  if (!views.some((v) => looseEq(v.viewer_id, viewer_id_param))) {
    views.push({
      viewer_id: viewer_id_param,
      username: viewer_username_param,
      full_name: viewer_fullname_param,
      viewed_at: nowISO(),
    });
    row.views = views;
    row.views_count = views.length;
    store.emit('UPDATE', 'stories', row, before);
    store.save();
  }
  return ok(true);
}

const REGISTRY: Record<string, (args: any) => { data: any; error: any }> = {
  get_direct_conversation_id: getDirectConversationId,
  increment_likes: incrementLikes,
  increment_comments: incrementComments,
  increment_comments_count: incrementCommentsCount,
  increment_video_views: incrementVideoViews,
  cleanup_expired_stories: cleanupExpiredStories,
  view_story: viewStory,
};

/** Postgres functions defined in /sql that the app never calls — kept for parity. */
export const DEFINED_BUT_UNUSED = [
  'handle_new_auth_user',
  'update_conversation_timestamp_and_last_message',
  'prune_past_calls',
  'prune_past_messages',
];

export async function callRpc(fn: string, args: any = {}) {
  const impl = REGISTRY[fn];
  if (!impl) {
    // eslint-disable-next-line no-console
    console.warn(`[grixMock] rpc '${fn}' is not implemented — returning null. Add it to dev/mock/rpc.ts`);
    return fail(`function ${fn} does not exist (mock)`);
  }
  try {
    return impl(args ?? {});
  } catch (e: any) {
    return fail(`rpc ${fn} failed: ${e?.message || e}`);
  }
}

export const __mockRpcRegistry = REGISTRY;
export { uuid };
