/**
 * GrixChat Mock Supabase — seed dataset.
 *
 * A realistic, multi-user world so every screen has something to render:
 * 8 users, 5 direct chats, 2 groups, ~60 messages, stories, calls,
 * notifications, posts, reels, tube videos, moments and Q&A.
 *
 * IDs are hand-written UUIDs on purpose: tests can reference
 * `SEED.me.id` instead of hunting for a generated value.
 */
import { daysAgo, hoursAgo, minutesAgo, nowISO } from './utils';

export const SEED = {
  me: '00000000-0000-4000-8000-000000000001',
  aarav: '00000000-0000-4000-8000-000000000002',
  sanya: '00000000-0000-4000-8000-000000000003',
  rohit: '00000000-0000-4000-8000-000000000004',
  priya: '00000000-0000-4000-8000-000000000005',
  kabir: '00000000-0000-4000-8000-000000000006',
  meera: '00000000-0000-4000-8000-000000000007',
  official: '00000000-0000-4000-8000-000000000008',
} as const;

const AVATAR = (seed: string) =>
  `https://api.dicebear.com/9.x/avataaars/svg?seed=${seed}&backgroundColor=1e293b`;

const PIC = (id: number) =>
  `https://picsum.photos/seed/grix${id}/900/1200`;

/** The signed-in demo user. Login with `demo@grixchat.app` / `grixchat`. */
export const DEMO_LOGIN = { email: 'demo@grixchat.app', password: 'grixchat' };

export function buildSeed() {
  const users = [
    {
      id: SEED.me,
      email: 'demo@grixchat.app',
      phone: '+91 98765 43210',
      full_name: 'Aryan Verma',
      username: 'aryan_v',
      photo_url: AVATAR('aryan'),
      bio: 'Building GrixChat 🌌 · Kanpur, UP',
      is_verified: true,
      profile_type: 'personal',
      is_online: true,
      last_seen: nowISO(),
      updated_at: nowISO(),
      created_at: daysAgo(200),
      settings: {
        phone: '+91 98765 43210',
        notifications: {
          conversationTones: true,
          highPriority: true,
          reactionNotifications: true,
          groupHighPriority: false,
          vibrate: true,
        },
      },
      lock: null,
      blocked_users: [],
      muted_users: [],
      favorites: [SEED.aarav],
      hidden_chats: [],
      archived_chats: [],
      hidden_chat_settings: { secretCode: null, showMenuEntry: true },
      fcm_tokens: [],
      saved_posts: [],
    },
    {
      id: SEED.aarav,
      email: 'aarav@example.com',
      full_name: 'Aarav Jha',
      username: 'aarav_j',
      photo_url: AVATAR('aarav'),
      bio: 'Frontend dev. Coffee first, code later ☕',
      is_verified: false,
      profile_type: 'personal',
      is_online: true,
      last_seen: nowISO(),
      updated_at: hoursAgo(1),
      created_at: daysAgo(180),
      settings: {},
      lock: null,
      blocked_users: [],
      muted_users: [],
      favorites: [],
      hidden_chats: [],
      archived_chats: [],
      hidden_chat_settings: { secretCode: null, showMenuEntry: true },
      fcm_tokens: [],
      saved_posts: [],
    },
    {
      id: SEED.sanya,
      email: 'sanya@example.com',
      full_name: 'Sanya Gupta',
      username: 'sanya_g',
      photo_url: AVATAR('sanya'),
      bio: 'Photographer 📸 · Delhi',
      is_verified: true,
      profile_type: 'creator',
      is_online: false,
      last_seen: minutesAgo(24),
      updated_at: hoursAgo(3),
      created_at: daysAgo(150),
      settings: {},
      lock: null,
      blocked_users: [],
      muted_users: [],
      favorites: [],
      hidden_chats: [],
      archived_chats: [],
      hidden_chat_settings: { secretCode: null, showMenuEntry: true },
      fcm_tokens: [],
      saved_posts: [],
    },
    {
      id: SEED.rohit,
      email: 'rohit@example.com',
      full_name: 'Rohit Sharma',
      username: 'rohit_s',
      photo_url: AVATAR('rohit'),
      bio: 'Backend & infra. Postgres evangelist.',
      is_verified: false,
      profile_type: 'personal',
      is_online: false,
      last_seen: hoursAgo(6),
      updated_at: hoursAgo(6),
      created_at: daysAgo(120),
      settings: {},
      lock: null,
      blocked_users: [],
      muted_users: [],
      favorites: [],
      hidden_chats: [],
      archived_chats: [],
      hidden_chat_settings: { secretCode: null, showMenuEntry: true },
      fcm_tokens: [],
      saved_posts: [],
    },
    {
      id: SEED.priya,
      email: 'priya@example.com',
      full_name: 'Priya Nair',
      username: 'priya_n',
      photo_url: AVATAR('priya'),
      bio: 'Designer. Minimal everything.',
      is_verified: true,
      profile_type: 'creator',
      is_online: true,
      last_seen: nowISO(),
      updated_at: minutesAgo(10),
      created_at: daysAgo(90),
      settings: {},
      lock: null,
      blocked_users: [],
      muted_users: [],
      favorites: [],
      hidden_chats: [],
      archived_chats: [],
      hidden_chat_settings: { secretCode: null, showMenuEntry: true },
      fcm_tokens: [],
      saved_posts: [],
    },
    {
      id: SEED.kabir,
      email: 'kabir@example.com',
      full_name: 'Kabir Malhotra',
      username: 'kabir_m',
      photo_url: AVATAR('kabir'),
      bio: 'Mumbai 🌆',
      is_verified: false,
      profile_type: 'personal',
      is_online: false,
      last_seen: daysAgo(2),
      updated_at: daysAgo(2),
      created_at: daysAgo(60),
      settings: {},
      lock: null,
      blocked_users: [],
      muted_users: [],
      favorites: [],
      hidden_chats: [],
      archived_chats: [],
      hidden_chat_settings: { secretCode: null, showMenuEntry: true },
      fcm_tokens: [],
      saved_posts: [],
    },
    {
      id: SEED.meera,
      email: 'meera@example.com',
      full_name: 'Meera Iyer',
      username: 'meera_i',
      photo_url: AVATAR('meera'),
      bio: 'Chennai. Music + code.',
      is_verified: false,
      profile_type: 'personal',
      is_online: false,
      last_seen: hoursAgo(30),
      updated_at: hoursAgo(30),
      created_at: daysAgo(45),
      settings: {},
      lock: null,
      blocked_users: [],
      muted_users: [],
      favorites: [],
      hidden_chats: [],
      archived_chats: [],
      hidden_chat_settings: { secretCode: null, showMenuEntry: true },
      fcm_tokens: [],
      saved_posts: [],
    },
    {
      id: SEED.official,
      email: 'team@grixchat.app',
      full_name: 'GrixChat Official',
      username: 'grixchat',
      photo_url: AVATAR('grixchat'),
      bio: 'The official GrixChat account. Product news & tips.',
      is_verified: true,
      profile_type: 'business',
      is_online: true,
      last_seen: nowISO(),
      updated_at: nowISO(),
      created_at: daysAgo(365),
      settings: {},
      lock: null,
      blocked_users: [],
      muted_users: [],
      favorites: [],
      hidden_chats: [],
      archived_chats: [],
      hidden_chat_settings: { secretCode: null, showMenuEntry: true },
      fcm_tokens: [],
      saved_posts: [],
    },
  ];

  const follows: any[] = [];
  const followPairs: Array<[string, string]> = [
    [SEED.me, SEED.aarav], [SEED.me, SEED.sanya], [SEED.me, SEED.priya], [SEED.me, SEED.official],
    [SEED.aarav, SEED.me], [SEED.aarav, SEED.sanya],
    [SEED.sanya, SEED.me], [SEED.sanya, SEED.priya], [SEED.sanya, SEED.aarav],
    [SEED.priya, SEED.me], [SEED.priya, SEED.sanya],
    [SEED.rohit, SEED.me],
    [SEED.meera, SEED.me], [SEED.meera, SEED.sanya],
    [SEED.kabir, SEED.me],
    [SEED.official, SEED.me], [SEED.official, SEED.sanya], [SEED.official, SEED.priya],
  ];
  followPairs.forEach(([follower_id, following_id], i) => {
    follows.push({
      id: `f0000000-0000-4000-8000-00000000000${i}`.slice(0, 36),
      follower_id,
      following_id,
      created_at: daysAgo(100 - i),
    });
  });

  // --- Conversations -------------------------------------------------------
  const conversations = [
    {
      id: 'c0000000-0000-4000-8000-000000000001',
      type: 'direct',
      name: null,
      photo_url: null,
      admins: [],
      watch_video_url: null,
      watch_state: {},
      last_message: 'Bhai mock data ready hai, check kar le 👍',
      last_message_at: minutesAgo(4),
      created_at: daysAgo(30),
      updated_at: minutesAgo(4),
    },
    {
      id: 'c0000000-0000-4000-8000-000000000002',
      type: 'direct',
      name: null,
      photo_url: null,
      admins: [],
      watch_video_url: null,
      watch_state: {},
      last_message: 'Photos bhej deti hoon shaam tak 📸',
      last_message_at: minutesAgo(38),
      created_at: daysAgo(22),
      updated_at: minutesAgo(38),
    },
    {
      id: 'c0000000-0000-4000-8000-000000000003',
      type: 'direct',
      name: null,
      photo_url: null,
      admins: [],
      watch_video_url: null,
      watch_state: {},
      last_message: 'Voice message',
      last_message_at: hoursAgo(5),
      created_at: daysAgo(18),
      updated_at: hoursAgo(5),
    },
    {
      id: 'c0000000-0000-4000-8000-000000000004',
      type: 'direct',
      name: null,
      photo_url: null,
      admins: [],
      watch_video_url: null,
      watch_state: {},
      last_message: 'Design tokens update ho gaye ✅',
      last_message_at: hoursAgo(20),
      created_at: daysAgo(12),
      updated_at: hoursAgo(20),
    },
    {
      id: 'c0000000-0000-4000-8000-000000000005',
      type: 'direct',
      name: null,
      photo_url: null,
      admins: [],
      watch_video_url: null,
      watch_state: {},
      last_message: 'Welcome to GrixChat! 🌌',
      last_message_at: daysAgo(3),
      created_at: daysAgo(3),
      updated_at: daysAgo(3),
    },
    {
      id: 'c0000000-0000-4000-8000-000000000006',
      type: 'group',
      name: 'GrixChat Core Team',
      photo_url: AVATAR('coreteam'),
      admins: [SEED.me],
      watch_video_url: null,
      watch_state: {},
      last_message: 'Kabir: Deploy kar dete hain aaj raat?',
      last_message_at: minutesAgo(12),
      created_at: daysAgo(28),
      updated_at: minutesAgo(12),
    },
    {
      id: 'c0000000-0000-4000-8000-000000000007',
      type: 'group',
      name: 'Weekend Trek 🏔️',
      photo_url: AVATAR('trek'),
      admins: [SEED.sanya],
      watch_video_url: null,
      watch_state: {},
      last_message: 'Meera: Kasol confirm?',
      last_message_at: hoursAgo(9),
      created_at: daysAgo(15),
      updated_at: hoursAgo(9),
    },
  ];

  const participantPairs: Array<[string, string[]]> = [
    ['c0000000-0000-4000-8000-000000000001', [SEED.me, SEED.aarav]],
    ['c0000000-0000-4000-8000-000000000002', [SEED.me, SEED.sanya]],
    ['c0000000-0000-4000-8000-000000000003', [SEED.me, SEED.rohit]],
    ['c0000000-0000-4000-8000-000000000004', [SEED.me, SEED.priya]],
    ['c0000000-0000-4000-8000-000000000005', [SEED.me, SEED.official]],
    ['c0000000-0000-4000-8000-000000000006', [SEED.me, SEED.aarav, SEED.rohit, SEED.priya, SEED.kabir]],
    ['c0000000-0000-4000-8000-000000000007', [SEED.me, SEED.sanya, SEED.meera, SEED.kabir]],
  ];
  const conversation_participants: any[] = [];
  let pIdx = 0;
  participantPairs.forEach(([conversation_id, members]) => {
    members.forEach((user_id) => {
      conversation_participants.push({
        id: `p${String(pIdx++).padStart(35, '0')}`,
        conversation_id,
        user_id,
        created_at: daysAgo(28),
        joined_at: daysAgo(28),
      });
    });
  });

  // --- Messages ------------------------------------------------------------
  const C = {
    aarav: 'c0000000-0000-4000-8000-000000000001',
    sanya: 'c0000000-0000-4000-8000-000000000002',
    rohit: 'c0000000-0000-4000-8000-000000000003',
    priya: 'c0000000-0000-4000-8000-000000000004',
    official: 'c0000000-0000-4000-8000-000000000005',
    team: 'c0000000-0000-4000-8000-000000000006',
    trek: 'c0000000-0000-4000-8000-000000000007',
  };

  type SeedMsg = [string, string, string, number, Record<string, any>?];
  const rawMessages: SeedMsg[] = [
    [C.aarav, SEED.aarav, 'Bhai mock backend bana diya maine', 180],
    [C.aarav, SEED.me, 'Sahi hai! Seed data bhi daal dena', 176],
    [C.aarav, SEED.aarav, 'Haan, 8 users + 7 conversations daal raha hoon', 172],
    [C.aarav, SEED.me, 'Perfect. Reels aur tube bhi cover karna', 168],
    [C.aarav, SEED.aarav, 'Sab cover ho gaya ✅', 20],
    [C.aarav, SEED.me, 'Great work 🙌', 12],
    [C.aarav, SEED.aarav, 'Bhai mock data ready hai, check kar le 👍', 4, { is_read: false }],

    [C.sanya, SEED.sanya, 'Shoot ka location final ho gaya?', 400],
    [C.sanya, SEED.me, 'Haan, Marine Drive wala spot', 395],
    [C.sanya, SEED.sanya, 'Golden hour ke liye best hai 🌇', 390],
    [C.sanya, SEED.sanya, '', 38, {
      media_url: PIC(11), media_type: 'image', is_read: false,
    }],
    [C.sanya, SEED.sanya, 'Photos bhej deti hoon shaam tak 📸', 38, { is_read: false }],

    [C.rohit, SEED.rohit, 'DB migration script review kar lena', 900],
    [C.rohit, SEED.me, 'Dekh liya, RLS policies sahi hain', 880],
    [C.rohit, SEED.rohit, '', 300, { media_type: 'audio', media_url: 'mock://voice-note-1.webm' }],

    [C.priya, SEED.priya, 'Naye colour tokens ka preview bhej rahi hoon', 1300],
    [C.priya, SEED.priya, '', 1290, { media_url: PIC(21), media_type: 'image' }],
    [C.priya, SEED.me, 'Dark cosmic theme ekdum 🔥 hai', 1250],
    [C.priya, SEED.priya, 'Design tokens update ho gaye ✅', 1200],

    [C.official, SEED.official, 'Welcome to GrixChat! 🌌', 4320],
    [C.official, SEED.official, 'Tip: long-press any chat to archive, mute or pin it.', 4300],

    [C.team, SEED.aarav, 'Sprint review ka time fix karna hai', 200],
    [C.team, SEED.rohit, 'Mujhe 5pm chalega', 195],
    [C.team, SEED.priya, 'Same here', 190],
    [C.team, SEED.me, 'Theek hai, 5pm lock', 185],
    [C.team, SEED.kabir, 'Deploy kar dete hain aaj raat?', 12, { is_read: false }],

    [C.trek, SEED.sanya, 'Kasol plan still on for Saturday?', 600],
    [C.trek, SEED.me, 'Haan, main tickets book kar deta hoon', 590],
    [C.trek, SEED.kabir, 'Count me in 🎒', 560],
    [C.trek, SEED.meera, 'Kasol confirm?', 540],
  ];

  const messages = rawMessages.map((row, i) => {
    const [conversation_id, sender_id, text, minsAgo, extra] = row;
    return {
      id: `m${String(i + 1).padStart(35, '0')}`,
      conversation_id,
      sender_id,
      text,
      media_url: null,
      media_type: null,
      reply_to: null,
      reactions: {},
      is_read: true,
      is_edited: false,
      is_deleted: false,
      deleted_by: [],
      created_at: minutesAgo(minsAgo),
      ...(extra || {}),
    };
  });

  // Wire one real reply so the `reply_to:reply_to(...)` self-join that
  // ChatService.getMessages() sends is exercised instead of always null.
  // Referenced by index, never by a hand-written id, so it cannot drift.
  const firstAaravMsg = messages.find(
    (m) => m.conversation_id === C.aarav && m.text === 'Bhai mock backend bana diya maine',
  );
  const replyMsg = messages.find(
    (m) => m.conversation_id === C.aarav && m.text.startsWith('Perfect. Reels'),
  );
  if (firstAaravMsg && replyMsg) replyMsg.reply_to = firstAaravMsg.id;

  // --- Stories -------------------------------------------------------------
  const stories = [
    {
      id: 's0000000-0000-4000-8000-000000000001',
      user_id: SEED.sanya,
      media_url: PIC(31),
      type: 'image',
      text_content: 'Golden hour ✨',
      bg_color: null,
      music_title: 'Kesariya',
      music_artist: 'Arijit Singh',
      music_url: null,
      filter_applied: 'warm',
      created_at: hoursAgo(3),
    },
    {
      id: 's0000000-0000-4000-8000-000000000002',
      user_id: SEED.priya,
      media_url: null,
      type: 'text',
      text_content: 'Shipping a new theme today 🎨',
      bg_color: '#4f46e5',
      music_title: null,
      music_artist: null,
      music_url: null,
      filter_applied: null,
      created_at: hoursAgo(7),
    },
    {
      id: 's0000000-0000-4000-8000-000000000003',
      user_id: SEED.aarav,
      media_url: PIC(32),
      type: 'image',
      text_content: 'Late night debugging 🐛',
      bg_color: null,
      music_title: null,
      music_artist: null,
      music_url: null,
      filter_applied: 'grayscale',
      created_at: hoursAgo(11),
    },
    {
      id: 's0000000-0000-4000-8000-000000000004',
      user_id: SEED.official,
      media_url: null,
      type: 'text',
      text_content: 'GrixChat v1.0 is live 🚀',
      bg_color: '#0ea5e9',
      music_title: null,
      music_artist: null,
      music_url: null,
      filter_applied: null,
      created_at: hoursAgo(18),
    },
  ];

  // --- Calls ---------------------------------------------------------------
  const calls = [
    {
      id: 'k0000000-0000-4000-8000-000000000001',
      caller_id: SEED.me, receiver_id: SEED.aarav, type: 'video', status: 'ended',
      offer: null, answer: null, is_missed: false, duration: 640, created_at: hoursAgo(26),
    },
    {
      id: 'k0000000-0000-4000-8000-000000000002',
      caller_id: SEED.sanya, receiver_id: SEED.me, type: 'audio', status: 'ended',
      offer: null, answer: null, is_missed: true, duration: null, created_at: hoursAgo(50),
    },
    {
      id: 'k0000000-0000-4000-8000-000000000003',
      caller_id: SEED.rohit, receiver_id: SEED.me, type: 'audio', status: 'ended',
      offer: null, answer: null, is_missed: false, duration: 1230, created_at: daysAgo(4),
    },
    {
      id: 'k0000000-0000-4000-8000-000000000004',
      caller_id: SEED.me, receiver_id: SEED.priya, type: 'video', status: 'rejected',
      offer: null, answer: null, is_missed: false, duration: null, created_at: daysAgo(6),
    },
    {
      id: 'k0000000-0000-4000-8000-000000000005',
      caller_id: SEED.kabir, receiver_id: SEED.me, type: 'video', status: 'ended',
      offer: null, answer: null, is_missed: false, duration: 305, created_at: daysAgo(9),
    },
  ];

  // --- Notifications -------------------------------------------------------
  const notifications = [
    {
      id: 'n0000000-0000-4000-8000-000000000001',
      user_id: SEED.me, from_user_id: SEED.sanya, type: 'like',
      title: 'Sanya liked your reel', content: null,
      // NOTE: the app writes and reads `text`, but sql/01 defines `content`.
      // Both are seeded so the mock renders whichever a real DB has. See docs/DATA_MODEL.md.
      text: 'liked your reel', is_read: false,
      post_id: 'r0000000-0000-4000-8000-000000000001', created_at: minutesAgo(22),
    },
    {
      id: 'n0000000-0000-4000-8000-000000000002',
      user_id: SEED.me, from_user_id: SEED.aarav, type: 'follow',
      title: 'Aarav started following you', content: null,
      text: 'started following you', is_read: false,
      post_id: null, created_at: hoursAgo(4),
    },
    {
      id: 'n0000000-0000-4000-8000-000000000003',
      user_id: SEED.me, from_user_id: SEED.priya, type: 'comment',
      title: 'Priya commented on your post', content: 'Love the styling 💯',
      text: 'commented on your post', is_read: true,
      post_id: 'po000000-0000-4000-8000-000000000001', created_at: hoursAgo(30),
    },
    {
      id: 'n0000000-0000-4000-8000-000000000004',
      user_id: SEED.me, from_user_id: SEED.official, type: 'system',
      title: 'GrixChat v1.0 released', content: 'Reels, Tube and Stories are live.',
      text: 'GrixChat v1.0 is live', is_read: true, post_id: null, created_at: daysAgo(2),
    },
  ];

  // --- Posts / likes / comments -------------------------------------------
  const posts = [
    {
      id: 'po000000-0000-4000-8000-000000000001',
      user_id: SEED.sanya, image_url: PIC(41),
      caption: 'Marine Drive, 6:42pm. No filter needed. 🌇',
      likes_count: 128, comments_count: 2, created_at: hoursAgo(28),
    },
    {
      id: 'po000000-0000-4000-8000-000000000002',
      user_id: SEED.priya, image_url: PIC(42),
      caption: 'New dark cosmic palette. Thoughts? 🌌',
      likes_count: 264, comments_count: 1, created_at: hoursAgo(52),
    },
    {
      id: 'po000000-0000-4000-8000-000000000003',
      user_id: SEED.me, image_url: PIC(43),
      caption: 'Desk setup for the weekend build session ⚡',
      likes_count: 47, comments_count: 1, created_at: daysAgo(4),
    },
  ];

  const post_likes = [
    { post_id: 'po000000-0000-4000-8000-000000000001', user_id: SEED.me, created_at: hoursAgo(20) },
    { post_id: 'po000000-0000-4000-8000-000000000002', user_id: SEED.me, created_at: hoursAgo(40) },
    { post_id: 'po000000-0000-4000-8000-000000000003', user_id: SEED.sanya, created_at: daysAgo(3) },
  ];

  const post_comments = [
    {
      id: 'pc000000-0000-4000-8000-000000000001',
      post_id: 'po000000-0000-4000-8000-000000000001', user_id: SEED.me,
      text: 'Kya shot hai yaar 🔥', created_at: hoursAgo(19),
    },
    {
      id: 'pc000000-0000-4000-8000-000000000002',
      post_id: 'po000000-0000-4000-8000-000000000002', user_id: SEED.me,
      text: 'The contrast is perfect.', created_at: hoursAgo(35),
    },
  ];

  // --- Reels / Tube / Moments / Q&A (tables the app queries but the SQL
  //     migrations never create — see docs/DATA_MODEL.md) --------------------
  const reels = [
    {
      id: 'r0000000-0000-4000-8000-000000000001',
      user_id: SEED.sanya, video_url: 'https://cdn.coverr.co/videos/coverr-city-at-night-4485/1080p.mp4',
      thumbnail_url: PIC(51), caption: 'City lights 🌃 #nightlife #mumbai',
      likes_count: 1840, comments_count: 62, views_count: 24300,
      music_title: 'Levitating', music_artist: 'Dua Lipa', created_at: daysAgo(1),
    },
    {
      id: 'r0000000-0000-4000-8000-000000000002',
      user_id: SEED.priya, video_url: 'https://cdn.coverr.co/videos/coverr-design-studio-1122/1080p.mp4',
      thumbnail_url: PIC(52), caption: 'Behind the scenes of a design system ✏️',
      likes_count: 903, comments_count: 28, views_count: 11200,
      music_title: null, music_artist: null, created_at: daysAgo(3),
    },
    {
      id: 'r0000000-0000-4000-8000-000000000003',
      user_id: SEED.aarav, video_url: 'https://cdn.coverr.co/videos/coverr-coding-setup-3311/1080p.mp4',
      thumbnail_url: PIC(53), caption: 'POV: shipping on a Friday 😅 #devlife',
      likes_count: 412, comments_count: 19, views_count: 5600,
      music_title: null, music_artist: null, created_at: daysAgo(5),
    },
  ];

  const tube_videos = [
    {
      id: 't0000000-0000-4000-8000-000000000001',
      user_id: SEED.rohit, video_url: 'https://cdn.coverr.co/videos/coverr-server-room-7788/1080p.mp4',
      thumbnail_url: PIC(61), title: 'Postgres RLS explained in 10 minutes',
      description: 'Row Level Security, policies, and how GrixChat uses them.',
      likes_count: 1240, comments_count: 88, views_count: 45200,
      duration: '10:12', is_live: false, created_at: daysAgo(7),
    },
    {
      id: 't0000000-0000-4000-8000-000000000002',
      user_id: SEED.me, video_url: 'https://cdn.coverr.co/videos/coverr-workspace-2211/1080p.mp4',
      thumbnail_url: PIC(62), title: 'Building a WhatsApp-clone PWA from scratch',
      description: 'Full walkthrough of the GrixChat chat stack.',
      likes_count: 806, comments_count: 51, views_count: 19800,
      duration: '30:40', is_live: false, created_at: daysAgo(12),
    },
  ];

  const tube_live_chat = [
    {
      id: 'tl000000-0000-4000-8000-000000000001',
      video_id: 't0000000-0000-4000-8000-000000000001', user_id: SEED.me,
      message: 'Timestamp 4:20 is gold 🙌', created_at: daysAgo(7),
    },
    {
      id: 'tl000000-0000-4000-8000-000000000002',
      video_id: 't0000000-0000-4000-8000-000000000001', user_id: SEED.sanya,
      message: 'Finally someone explained this properly.', created_at: daysAgo(7),
    },
  ];

  const moments = [
    {
      id: 'mo000000-0000-4000-8000-000000000001',
      user_id: SEED.me, image_url: PIC(71), caption: 'First commit of the new module',
      likes_count: 12, comments_count: 3, created_at: daysAgo(2),
    },
    {
      id: 'mo000000-0000-4000-8000-000000000002',
      user_id: SEED.sanya, image_url: PIC(72), caption: 'Sunrise from the terrace',
      likes_count: 34, comments_count: 5, created_at: daysAgo(6),
    },
  ];

  const likes = [
    {
      id: 'l0000000-0000-4000-8000-000000000001',
      user_id: SEED.me, target_id: 'r0000000-0000-4000-8000-000000000002',
      target_type: 'reel', created_at: daysAgo(2),
    },
    {
      id: 'l0000000-0000-4000-8000-000000000002',
      user_id: SEED.sanya, target_id: 'r0000000-0000-4000-8000-000000000003',
      target_type: 'reel', created_at: daysAgo(1),
    },
  ];

  const comments = [
    {
      id: 'cm000000-0000-4000-8000-000000000001',
      target_id: 'r0000000-0000-4000-8000-000000000001', target_type: 'reel',
      user_id: SEED.me, text: 'Transitions are so smooth!', created_at: daysAgo(1),
    },
    {
      id: 'cm000000-0000-4000-8000-000000000002',
      target_id: 't0000000-0000-4000-8000-000000000001', target_type: 'tube',
      user_id: SEED.priya, text: 'Saved for later 📌', created_at: daysAgo(5),
    },
  ];

  const qna_questions = [
    {
      id: 'q0000000-0000-4000-8000-000000000001',
      user_id: SEED.rohit, question: 'What is the best way to index a chat table?',
      answer: 'Composite index on (conversation_id, created_at DESC).',
      upvotes: 42, is_answered: true, created_at: daysAgo(8),
    },
    {
      id: 'q0000000-0000-4000-8000-000000000002',
      user_id: SEED.priya, question: 'How do you handle safe-area insets on Android WebView?',
      answer: null, upvotes: 17, is_answered: false, created_at: daysAgo(3),
    },
  ];

  const chat_settings = [
    {
      id: 'cs000000-0000-4000-8000-000000000001',
      user_id: SEED.me, receiver_id: SEED.aarav, nickname: 'Aaru',
      custom_photo_url: null, is_muted: false, created_at: daysAgo(20),
    },
    {
      id: 'cs000000-0000-4000-8000-000000000002',
      user_id: SEED.me, receiver_id: SEED.sanya, nickname: null,
      custom_photo_url: null, is_muted: true, created_at: daysAgo(10),
    },
  ];

  return {
    users,
    follows,
    conversations,
    conversation_participants,
    messages,
    stories,
    calls,
    call_candidates: [],
    chat_settings,
    notifications,
    posts,
    post_likes,
    post_comments,
    reels,
    tube_videos,
    tube_live_chat,
    moments,
    likes,
    comments,
    qna_questions,
    support_tickets: [],
  };
}

export type MockDatabase = ReturnType<typeof buildSeed>;

/** Convenience export so tests can talk about "the last seeded message". */
export const FIRST_MESSAGE_TIME = minutesAgo(180);
