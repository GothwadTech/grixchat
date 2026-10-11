import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, 
  ChevronRight, 
  Loader2 
} from 'lucide-react';
import { useAuth } from '../../providers/AuthProvider.tsx';
import { supabase } from '../../lib/supabase';
import Avatar from '../../components/common/Avatar';
import { CommonSearchBar } from '../../components/common/CommonSearchBar';
import { LocalDataCache } from '../../services/LocalDataCache';

/** Stories live for 24 h; the client never shows an older one, even if the
 *  server-side cleanup has not run yet. */
const STORY_TTL_MS = 24 * 60 * 60 * 1000;
/** The cleanup RPC is a global DELETE — once per session is plenty. */
let cleanupRequested = false;

/** Columns the UI actually renders. `views` is read to know what is unseen. */
const STORY_SELECT =
  'id, user_id, type, media_url, text_content, bg_color, music_title, music_artist, music_url, filter_applied, created_at, views, users:user_id(username, full_name, photo_url)';

export default function StoriesTab() {
  const navigate = useNavigate();
  const { user: authUser, userData } = useAuth();
  
  const [stories, setStories] = useState<any[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [hiddenUserIds, setHiddenUserIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch hidden user IDs
  useEffect(() => {
    if (!supabase || !authUser?.id || !userData?.hiddenChats || userData.hiddenChats.length === 0) {
      setHiddenUserIds([]);
      return;
    }
    const fetchHiddenUserIds = async () => {
      try {
        const { data } = await supabase
          .from('conversation_participants')
          .select('conversation_id, user_id')
          .in('conversation_id', userData.hiddenChats)
          .neq('user_id', authUser.id);
        
        if (data) {
          setHiddenUserIds(data.map(d => d.user_id));
        }
      } catch (e) {
        console.warn("Failed to fetch hidden user ids inside stories tab:", e);
      }
    };
    fetchHiddenUserIds();
  }, [userData?.hiddenChats, authUser?.id]);

  const fetchStories = useCallback(async () => {
    if (!supabase || !authUser?.id) return;

    // Paint the cache first — no spinner on a screen you open all the time.
    const cached = LocalDataCache.get<any[]>(`gx_stories_${authUser.id}`);
    if (cached && cached.length > 0) {
      setStories(cached);
      setStoriesLoading(false);
    } else {
      setStoriesLoading(true);
    }

    try {
      // Expired stories are reaped globally, so ask once per session and do not
      // block the fetch on it.
      if (!cleanupRequested) {
        cleanupRequested = true;
        supabase.rpc('cleanup_expired_stories').then(
          () => {},
          (rpcErr: any) => console.warn('cleanup_expired_stories failed (migration not run yet?):', rpcErr),
        );
      }

      // Only people who can plausibly be "your" stories: you, the accounts you
      // follow, and the people you already have a chat with. (The policy allows
      // any authenticated read, so this is a client-side scoping.)
      const audience = new Set<string>([authUser.id]);
      (userData?.following || []).forEach((id: string) => audience.add(id));
      (LocalDataCache.getConversations(authUser.id) || []).forEach((conv: any) => {
        if (conv?.otherUserId) audience.add(conv.otherUserId);
      });
      // Keep the `in.(...)` list sane; beyond that fall back to a wide read.
      const audienceIds = [...audience].slice(0, 200);

      const cutoff = new Date(Date.now() - STORY_TTL_MS).toISOString();
      let query = supabase
        .from('stories')
        .select(STORY_SELECT)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(120);

      if (audienceIds.length > 1) query = query.in('user_id', audienceIds);

      const { data, error } = await query;
      if (!error && data) {
        setStories(data);
        LocalDataCache.set(`gx_stories_${authUser.id}`, data);
      }
    } catch (err) {
      console.error('Error fetching stories:', err);
    } finally {
      setStoriesLoading(false);
    }
  }, [authUser?.id, userData?.following]);

  useEffect(() => {
    fetchStories();
    const onFocus = () => fetchStories();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchStories]);

  const storiesGroupedByUser = useMemo(() => {
    const groups: {
      [key: string]: {
        userId: string;
        username: string;
        fullName: string;
        photoURL: string;
        stories: any[];
        hasUnseen: boolean;
      };
    } = {};

    stories.forEach((story: any) => {
      if (hiddenUserIds.includes(story.user_id)) return;

      const uid = story.user_id;
      const userObj = story.users;
      const username = userObj?.username || 'User';
      const fullName = userObj?.full_name || username;
      const photoURL = userObj?.photo_url || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';

      if (!groups[uid]) {
        groups[uid] = {
          userId: uid,
          username,
          fullName,
          photoURL,
          stories: [],
          hasUnseen: false
        };
      }
      groups[uid].stories.push(story);
      // "Seen" is per story: the owner sees their own view list, everybody else
      // checks whether their own id is already in it.
      const seenByMe =
        uid === authUser?.id ||
        (Array.isArray(story.views) && story.views.some((v: any) => v?.id === authUser?.id));
      if (!seenByMe) groups[uid].hasUnseen = true;
    });

    // Newest story first inside a group; unseen groups on top (Telegram order).
    return Object.values(groups)
      .map((group) => ({
        ...group,
        stories: group.stories.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      }))
      .sort((a, b) => {
        if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
        return (
          new Date(b.stories[0].created_at).getTime() -
          new Date(a.stories[0].created_at).getTime()
        );
      });
  }, [stories, hiddenUserIds, authUser?.id]);

  const myStoriesGroup = storiesGroupedByUser.find(g => g.userId === authUser?.id);
  const otherStoriesGroups = useMemo(() => {
    const list = storiesGroupedByUser.filter(g => g.userId !== authUser?.id);
    if (!searchTerm) return list;
    const query = searchTerm.toLowerCase();
    return list.filter(g => 
      (g.fullName || '').toLowerCase().includes(query) || 
      (g.username || '').toLowerCase().includes(query)
    );
  }, [storiesGroupedByUser, authUser?.id, searchTerm]);

  const formatStoryTime = (createdAtString: string) => {
    if (!createdAtString) return '';
    const date = new Date(createdAtString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const isToday = date.toDateString() === now.toDateString();
    const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: true };
    
    if (isToday) {
      return `Today, ${date.toLocaleTimeString([], options)}`;
    }
    
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    if (isYesterday) {
      return `Yesterday, ${date.toLocaleTimeString([], options)}`;
    }
    
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + date.toLocaleTimeString([], options);
  };

  const myStoryName = userData?.fullName || authUser?.email?.split('@')[0] || "My Story";

  /** Telegram-style ring: a gradient outline while something is unseen. */
  const StoryRing: React.FC<{unseen: boolean; children: React.ReactNode}> = ({unseen, children}) => (
    <div
      className={
        unseen
          ? 'rounded-full p-[2px] bg-gradient-to-tr from-[#0494f4] via-emerald-400 to-[#0494f4]'
          : 'rounded-full p-[2px] bg-[var(--border-color)]/40'
      }
    >
      <div className="rounded-full bg-[var(--bg-card)] p-[2px]">{children}</div>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-[var(--bg-card)] overflow-hidden animate-fade-in touch-pan-y font-sans relative">
      <div className="flex-1 overflow-y-auto no-scrollbar pb-32 bg-[var(--bg-card)]">

        {/* Search bar inside scroll viewport */}
        <CommonSearchBar 
          placeholder="Search stories..."
          value={searchTerm}
          onChange={setSearchTerm}
          onClear={() => setSearchTerm('')}
        />

        {/* Unified Top-to-Bottom List */}
        <div className="flex flex-col mt-1 bg-[var(--bg-card)]">
          
          {/* MY STATUS TILE */}
          <div 
            onClick={() => {
              if (myStoriesGroup) {
                navigate(`/stories/view/${authUser?.id}`);
              } else {
                navigate('/stories/create');
              }
            }}
            className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--border-color)]/5 active:bg-[var(--border-color)]/10 transition-all duration-205 group cursor-pointer select-none border-b border-[var(--border-color)]/5 last:border-b-0 border-l-[4px] border-l-transparent"
          >
            {/* Left: Avatar with dynamic Ring or Plus Overlay */}
            <div className="relative shrink-0">
              {myStoriesGroup ? (
                <StoryRing unseen={false}>
                  <Avatar 
                    url={userData?.photoURL} 
                    type="direct" 
                    name={myStoryName} 
                  />
                </StoryRing>
              ) : (
                <div className="relative">
                  <Avatar 
                    url={userData?.photoURL} 
                    type="direct" 
                    name={myStoryName} 
                  />
                  <div className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] bg-[#0494f4] text-white rounded-full flex items-center justify-center border-2 border-[var(--bg-card)] shadow-md">
                    <Plus size={11} strokeWidth={3.5} />
                  </div>
                </div>
              )}
            </div>

            {/* Middle: Details */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <h3 className="text-[14.5px] truncate font-semibold text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors">
                {myStoryName}
              </h3>
              <p className="text-[13px] text-[var(--text-secondary)] opacity-75 mt-0.5 font-medium">
                {myStoriesGroup 
                  ? formatStoryTime(myStoriesGroup.stories[0].created_at)
                  : 'Tap to publish a status update'
                }
              </p>
            </div>

            {/* Right: navigation chevron */}
            <ChevronRight size={16} className="text-[var(--text-secondary)] opacity-15 group-hover:opacity-60 group-hover:translate-x-0.5 transition-all duration-200 shrink-0" />
          </div>

          {/* FRIENDS' STATUSES (RECENT UPDATES) */}
          {storiesLoading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Loader2 className="animate-spin text-[#0494f4]" size={20} />
              <span className="text-[10px] uppercase font-black tracking-wider text-[var(--text-secondary)]">Loading stories...</span>
            </div>
          ) : otherStoriesGroups.length === 0 ? (
            <div className="px-5 py-8 text-center bg-[var(--bg-card)] border-b border-[var(--border-color)]/5 last:border-b-0">
              <p className="text-xs text-[var(--text-secondary)] opacity-75 italic">No shared status updates from other friends yet.</p>
            </div>
          ) : (
            otherStoriesGroups.map(group => (
              <div 
                key={group.userId}
                onClick={() => navigate(`/stories/view/${group.userId}`)}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--border-color)]/5 active:bg-[var(--border-color)]/10 transition-all duration-205 group cursor-pointer select-none border-b border-[var(--border-color)]/5 last:border-b-0 border-l-[4px] border-l-transparent"
              >
                {/* Left: Avatar with an unseen ring, like Telegram statuses */}
                <div className="relative shrink-0">
                  <StoryRing unseen={group.hasUnseen}>
                    <Avatar 
                      url={group.photoURL} 
                      type="direct" 
                      name={group.username} 
                    />
                  </StoryRing>
                </div>

                {/* Middle: Details */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <h3 className="text-[14.5px] truncate font-semibold text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors">
                    {group.fullName || group.username}
                  </h3>
                  <p className="text-[13px] text-[var(--text-secondary)] opacity-75 mt-0.5 font-medium">
                    {formatStoryTime(group.stories[0].created_at)}
                  </p>
                </div>

                {/* Right: navigation chevron */}
                <ChevronRight size={16} className="text-[var(--text-secondary)] opacity-15 group-hover:opacity-60 group-hover:translate-x-0.5 transition-all duration-200 shrink-0" />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
