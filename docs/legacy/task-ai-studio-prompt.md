# Google AI Studio Prompt — GrixChat Telegram-Style Chat List

---

## PROMPT (Copy everything below this line exactly)

---

You are an expert React + TypeScript + Tailwind CSS v4 developer working on **GrixChat** — a Supabase-based social messaging app.

**Your task:** Completely rewrite the `ChatItemRow` component inside `src/features/chat/components/ChatUserList.tsx` to make the chat list look EXACTLY like Telegram's native Android chat list. Reference the design specifications below precisely.

---

## DESIGN SPECIFICATION — Telegram Chat List (Pixel-Perfect)

Study this carefully. Every measurement matters.

### Row Layout
- **Total row height:** `72px` minimum (never less, never cramped)
- **Padding:** `12px` left, `12px` right, `8px` top, `8px` bottom
- **No visible border-bottom between rows** — Telegram uses very subtle separator that starts AFTER the avatar (not full-width). Use: `after:content-[''] after:absolute after:bottom-0 after:left-[72px] after:right-0 after:h-[0.5px] after:bg-[var(--border-color)]/20`
- **Background:** `var(--bg-card)` default, `var(--primary)/10` when selected, `var(--border-color)/8` on active press

### Avatar (Left Side)
- **Size:** exactly `54px × 54px` (w-[54px] h-[54px]) — this is the key fix, current w-12 h-12 (48px) is too small
- **Shape:** perfect circle
- **Online indicator:** `10px × 10px` green dot, bottom-right of avatar, `border-2 border-[var(--bg-card)]`, NO animate-pulse (Telegram dot is static)
- **Fallback (no photo):** colored circle with initials (first letter of name), NOT an icon. Use a deterministic color based on the name's first character:
  ```
  const AVATAR_COLORS = ['#E17076','#7BC862','#65AADD','#E78A2F','#956FE4','#3CAFE5','#F57244','#49A0E9'];
  const colorIndex = name.charCodeAt(0) % AVATAR_COLORS.length;
  ```
  Show the first letter of `chat.user` in white, `font-size: 22px`, `font-weight: 500`
- **Group avatar:** show first 2 initials or use a group icon, same colored background logic

### Content Area (Right of avatar, with 12px gap)
Layout is 2 rows:

**Row 1 (Top):** Name on left, Time on right
- Name: `font-size: 16px`, `font-weight: 500`, `color: var(--text-primary)`, truncate with ellipsis
- Name for unread chats: `font-weight: 600` (slightly bolder, NOT bold)
- Muted icon: if muted, show `VolumeX` lucide icon `14px` in `var(--text-secondary)` right after the name
- Pin icon: if pinned, show `Pin` lucide icon `14px` filled in `var(--text-secondary)` right after name (or muted icon)
- Time: `font-size: 13px`, `color: var(--text-secondary)`, if unread time is `color: var(--primary)` (Telegram blue), no-wrap

**Row 2 (Bottom):** Preview text on left, Status/Unread badge on right
- Preview text: `font-size: 15px`, `color: var(--text-secondary)`, single line, truncate
- If unread: preview text is `color: var(--text-primary)` slightly more visible but NOT bold
- "Sent by me" prefix: if `chat.lastMsgStatus === 'Sent'`, show `You: ` in `var(--text-secondary)` before the message
- Draft prefix: `Draft:` in `#E53935` (red), then message text in `var(--text-primary)`
- Typing indicator: `typing...` in `var(--primary)` color, NO dots animation needed (keep simple)

### Right Side Status Area (aligned to bottom of row 2)
Display ONE of these, stacked vertically, right-aligned:
1. **Unread badge** (blue pill): `min-width: 20px`, `height: 20px`, `border-radius: 10px`, `background: var(--primary)`, white text `font-size: 12px font-weight: 600`. If count > 99 show `99+`
2. **Muted unread badge**: same pill but `background: var(--text-secondary)/50` (gray, not blue) — for muted chats with unread
3. **Pin icon** (no badge): show filled `Pin` icon `16px` in `var(--text-secondary)/60` if pinned and no unread
4. **Read checkmarks**: if `lastMsgStatus === 'Sent'` and no unread count, show double checkmark SVG in `var(--text-secondary)` (like Telegram's grey ticks)
5. **Nothing**: if received message and no unread

### Separator Line (Critical Telegram detail)
The divider line does NOT go full width. It starts after the avatar+gap:
```jsx
<div className="absolute bottom-0 left-[78px] right-0 h-[0.5px] bg-[var(--border-color)]/25" />
```

---

## CURRENT CODE TO REPLACE

Here is the current `ChatItemRow` component. Rewrite ONLY this component. Keep all other code (imports, interfaces, GrixAIRow, ChatUserList) exactly the same:

```tsx
const ChatItemRow: React.FC<{
  chat: ChatItem;
  isChatSelectMode: boolean;
  isSelected: boolean;
  isPinned?: boolean;
  onToggleSelect: (chatId: string) => void;
  setChatSelectMode: (val: boolean) => void;
  setSelectedChatIds: React.Dispatch<React.SetStateAction<string[]>>;
}> = ({
  chat,
  isChatSelectMode,
  isSelected,
  isPinned = false,
  onToggleSelect,
  setChatSelectMode,
  setSelectedChatIds
}) => {
  const navigate = useNavigate();
  const timerRef = React.useRef<any>(null);
  const startXRef = React.useRef<number>(0);
  const startYRef = React.useRef<number>(0);
  const isLongPressActiveRef = React.useRef<boolean>(false);
  const [isTyping, setIsTyping] = React.useState(false);
  const [draft, setDraft] = React.useState<any>(null);

  React.useEffect(() => {
    if (!chat.otherUserId) return;
    setDraft(LocalDataCache.get<any>(`draft_${chat.otherUserId}`));
    
    return LocalDataCache.subscribe(`draft_status_${chat.otherUserId}`, (payload) => {
      setDraft(payload);
    });
  }, [chat.otherUserId]);

  const { isDraft, displayLastMsg } = React.useMemo(() => {
    if (draft && (draft.text?.trim() || (draft.files && draft.files.length > 0))) {
      let msg = '';
      if (draft.text?.trim()) {
        msg = draft.text;
      } else if (draft.files && draft.files.length > 0) {
        const firstFile = draft.files[0];
        if (firstFile.type?.startsWith('image/')) {
          msg = '🖼️ Photo';
        } else if (firstFile.type?.startsWith('video/')) {
          msg = '🎥 Video';
        } else {
          msg = '📁 Attachment';
        }
      }
      return { isDraft: true, displayLastMsg: msg };
    }
    return { isDraft: false, displayLastMsg: chat.lastMsg };
  }, [draft, chat.lastMsg]);

  React.useEffect(() => {
    if (!supabase || !chat.id || !chat.otherUserId) return;
    
    const channel = supabase.channel(`typing:${chat.id}`);
    let timeoutId: any = null;

    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload && payload.userId === chat.otherUserId) {
          setIsTyping(payload.isTyping);
          
          if (timeoutId) clearTimeout(timeoutId);
          if (payload.isTyping) {
            timeoutId = setTimeout(() => {
              setIsTyping(false);
            }, 6000);
          }
        }
      })
      .subscribe();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      supabase.removeChannel(channel);
    };
  }, [chat.id, chat.otherUserId]);

  const startPress = (e: any) => {
    isLongPressActiveRef.current = false;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    startXRef.current = clientX;
    startYRef.current = clientY;

    timerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true;
      setChatSelectMode(true);
      setSelectedChatIds(prev => prev.includes(chat.id) ? prev : [...prev, chat.id]);
      if (navigator.vibrate) navigator.vibrate(40);
    }, 600);
  };

  const handleMove = (e: any) => {
    if (!timerRef.current) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const diffX = Math.abs(clientX - startXRef.current);
    const diffY = Math.abs(clientY - startY.current);
    
    if (diffX > 10 || diffY > 10) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const cancelPress = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isLongPressActiveRef.current) {
      e.preventDefault();
      return;
    }
    cancelPress();
    
    if (isChatSelectMode) {
      onToggleSelect(chat.id);
    } else {
      navigate(`/chat/${chat.otherUserId}`);
    }
  };

  return (
    <div
      onTouchStart={startPress}
      onTouchMove={handleMove}
      onTouchEnd={cancelPress}
      onMouseDown={startPress}
      onMouseMove={handleMove}
      onMouseUp={cancelPress}
      onMouseLeave={cancelPress}
      onClick={handleClick}
      className={`relative flex items-center gap-3 px-3 py-2.5 transition-all duration-205 cursor-pointer select-none border-b border-[var(--border-color)]/5 last:border-b-0 border-l-[4px] border-l-transparent ${
        isSelected 
          ? 'bg-[var(--primary)]/24' 
          : 'bg-[var(--bg-card)] hover:bg-[var(--border-color)]/5 active:bg-[var(--border-color)]/10'
      }`}
    >
      <div className="relative shrink-0">
        <Avatar url={chat.avatar} type={chat.type} name={chat.user} isOnline={chat.isOnline} />
        {isSelected && (
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[var(--primary)] border-2 border-[var(--bg-card)] flex items-center justify-center shadow-md z-20 animate-scale-in">
            <svg 
              className="w-3 h-3 text-white" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="4" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex justify-between items-baseline mb-0.5">
          <h3 className={`text-[14.5px] truncate font-semibold text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors flex items-center gap-1.5 ${chat.unread ? 'font-bold' : ''}`}>
            {isPinned && <Pin size={13} className="text-[#0494f4] fill-[#0494f4] shrink-0" />}
            <span>{chat.user}</span>
          </h3>
          <span className={`text-[10.5px] whitespace-nowrap ${chat.unread ? 'text-[var(--primary)] font-semibold' : 'text-[var(--text-secondary)] opacity-60'}`}>
            {chat.time}
          </span>
        </div>
        <div className="flex justify-between items-center gap-2">
          <div className="flex-1 min-w-0">
            {isTyping ? (
              <span className="text-[var(--primary)] font-bold animate-pulse flex items-center gap-1.5 select-none text-[13px]">
                <span>typing</span>
                <span className="inline-flex gap-[2px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] animate-bounce" />
                </span>
              </span>
            ) : (
              <p className={`text-[13px] truncate flex-1 leading-snug p-0 m-0 ${chat.unread ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] opacity-75'}`}>
                {isDraft ? (
                  <>
                    <span className="text-rose-500 dark:text-rose-400 font-bold mr-1">Draft:</span>
                    <span className="text-[var(--text-primary)] dark:text-zinc-200">{displayLastMsg}</span>
                  </>
                ) : (
                  chat.lastMsg
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {chat.unread && (
              <div className="min-w-[18px] h-[18px] px-1.5 bg-[var(--primary)] rounded-full flex items-center justify-center shadow-sm">
                <span className="text-[9.5px] text-white font-extrabold leading-none">
                  {chat.unreadCount && chat.unreadCount > 4 ? '4+' : chat.unreadCount}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
```

---

## EXACT REQUIREMENTS FOR THE REWRITE

1. **Keep ALL existing logic:** long press, typing detection, draft detection, Supabase channel subscription, navigate, click handler — do NOT remove any of this.

2. **Replace the JSX return** with Telegram-exact layout as described above.

3. **Add this avatar initials helper** inside the component (before the return):
```tsx
const AVATAR_COLORS = ['#E17076','#7BC862','#65AADD','#E78A2F','#956FE4','#3CAFE5','#F57244','#49A0E9'];
const getAvatarColor = (name: string) => AVATAR_COLORS[(name?.charCodeAt(0) || 0) % AVATAR_COLORS.length];
const avatarInitial = (chat.user || chat.fullName || '?')[0].toUpperCase();
```

4. **Replace `<Avatar>` component** with inline avatar that uses initials when no photo (the Avatar component uses an icon, we need initials like Telegram). If `chat.avatar` exists and is not a placeholder, show the image. Otherwise show colored circle with initial.

5. **Row height** must be at least 72px — use `min-h-[72px]` and `py-[8px]`

6. **Avatar size** must be 54px — `w-[54px] h-[54px]`

7. **Separator** must start after avatar, NOT full-width

8. **Unread count badge** must show actual count up to 99+ (currently shows 4+, fix this)

9. **Time color** must be blue (`var(--primary)`) when there are unread messages

10. **No left colored border** — remove the `border-l-[4px] border-l-transparent` (Telegram doesn't have this)

11. **Double checkmark** for sent messages with no unread — implement this SVG:
```tsx
// Grey double tick (sent & delivered)
const DoubleTick = () => (
  <svg width="16" height="11" viewBox="0 0 16 11" className="shrink-0">
    <path d="M11 1L5 9L2 6" stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    <path d="M15 1L9 9L7.5 7.2" stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);
```

12. **Selected state** checkmark should overlay the avatar like Telegram (blue circle on top of avatar, not below)

---

## EXTENSION SPECIFICATION — Contacts, Calls, & Profile (Pixel-Perfect Integration)

### 1. Contacts & Search List (SearchTab.tsx)
- **Component targeted:** `renderUserProfileRow` & `Pending Requests` container row
- **Row Layout:** Matches standard `min-h-[72px]` height, `py-2 px-3` layout. Background of card transitions smoothly on hover and active state with zero side padding/borders.
- **Avatar:** Correct `54px × 54px` size. Employs initials fallback using the exact deterministic name index coloring logic:
  `['#E17076','#7BC862','#65AADD','#E78A2F','#956FE4','#3CAFE5','#F57244','#49A0E9']`.
- **Text Sizing:** Username matches exact `16px font-medium text-[var(--text-primary)]`, subtitle fits `15px text-[var(--text-secondary)]`.
- **Separator:** Starting at `left-[78px]` and full-width to the right with `0.5px h bg-[var(--border-color)]/25`.

### 2. Calls History List (CallsHistoryList.tsx)
- **Component targeted:** Individual `calls.map` items
- **Avatar Integration:** Handled inline to support identical initials-based dynamic color fallbacks of size `54px × 54px`.
- **Subtitle Detail:** Slices call metadata including direction icons, voice/video identifiers, and accurate call timestamps in consistent `15px` fonts.
- **Action Trigger:** Aligned right side call launcher buttons keeping the standard touch boundary box (`12px` / `w-12 h-12`).

### 3. Profile & Settings Cards (ProfileSettingsContent.tsx)
- **Component targeted:** Active User Profile Card, switchable accounts list, and global settings grid action buttons.
- **Uniformity:** Shifted all key lists to conform to the `min-h-[72px]` and `w-[54px] h-[54px]` avatar/icon box dimensions.
- **Design Elements:** Employs absolute separators at `left-[78px]` rather than full grid line separators to achieve a completely uncluttered, highly organized, native Android Telegram app profile layout.

### 4. Stories & Status tab (StoriesTab.tsx)
- **Component targeted:** My Status Tile and Friends' Statuses lists
- **Row & Avatar Layout:** Aligned to the Telegram Android standard of `min-h-[72px]` with a `54px × 54px` avatar space. Includes a deterministic fallback coloring algorithm and direct initials display.
- **Micro-interactions:** Integrated dynamic plus overlays for the user's empty story slot, elegant right chrevrons, and absolute separators positioned at `left-[78px]` for a clean, consistent design hierarchy.
