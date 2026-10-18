import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  ArrowLeft, 
  Settings, 
  Edit3, 
  UserPlus, 
  LogOut, 
  Trash2,
  Check,
  X,
  Camera,
  Loader2,
  ShieldCheck,
  MoreVertical
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../providers/AuthProvider.tsx';
import { ImageService } from '../../services/ImageService.ts';
import Avatar from '../../components/common/Avatar';

export default function GroupSettingsScreen() {
  const { id: chatId } = useParams();
  const navigate = useNavigate();
  const { user: authUser, userData: currentUserData } = useAuth();
  const authUserId = authUser?.id || authUser?.uid || '';

  const [group, setGroup] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [showEditName, setShowEditName] = useState(false);
  const [newName, setNewName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!chatId || !authUserId || !supabase) return;

    const fetchGroupData = async () => {
      setLoading(true);
      try {
        const { data: conv, error: convError } = await supabase
          .from('conversations')
          .select('*')
          .eq('id', chatId)
          .single();

        if (convError) throw convError;

        setGroup(conv);
        setNewName(conv.name);
        setIsAdmin(conv.admins?.includes(authUserId) || conv.created_by === authUserId);

        // Fetch member details
        const { data: participants, error: partError } = await (supabase as any)
          .from('conversation_participants')
          .select(`
            user:users(*)
          `)
          .eq('conversation_id', chatId);

        if (partError) throw partError;

        setMembers((participants as any[]).map(p => ({
          uid: p.user.id,
          username: p.user.username,
          fullName: p.user.full_name,
          photoURL: p.user.photo_url
        })));
      } catch (err) {
        console.error("Error fetching group details:", err);
        navigate('/chats');
      } finally {
        setLoading(false);
      }
    };

    fetchGroupData();

    // Subscribe to changes
    const channel = supabase.channel(`group_settings_${chatId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `id=eq.${chatId}` }, () => fetchGroupData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants', filter: `conversation_id=eq.${chatId}` }, () => fetchGroupData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId, authUserId]);

  const handleUpdateIcon = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && chatId && isAdmin && supabase) {
      setUpdating(true);
      try {
        const iconUrl = await ImageService.uploadImage(file);
        await supabase.from('conversations').update({ photo_url: iconUrl } as any).eq('id', chatId);
        
        await supabase.from('messages').insert({
          conversation_id: chatId,
          sender_id: authUserId,
          text: `${currentUserData?.fullName || 'Admin'} changed group icon`,
          created_at: new Date().toISOString(),
          media_type: 'system'
        });
      } catch (err) {
        console.error(err);
      } finally {
        setUpdating(false);
      }
    }
  };

  const handleUpdateName = async () => {
    if (!newName.trim() || newName === group.name || !chatId || !isAdmin || !supabase) return;
    setUpdating(true);
    try {
      await supabase.from('conversations').update({ name: newName } as any).eq('id', chatId);
      await (supabase as any).from('messages').insert({
        conversation_id: chatId,
        sender_id: authUserId,
        text: `${currentUserData?.fullName || 'Admin'} changed group name to "${newName}"`,
        created_at: new Date().toISOString(),
        media_type: 'system'
      });
      setShowEditName(false);
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(false);
    }
  };

  const removeMember = async (uid: string) => {
    if (!chatId || !isAdmin || uid === authUserId || !supabase) return;
    if (!window.confirm("Remove this member from the group?")) return;
    
    try {
      await supabase.from('conversation_participants').delete().eq('conversation_id', chatId).eq('user_id', uid);
      
      const removedUser = (members as any[]).find(m => m.uid === uid);
      await (supabase as any).from('messages').insert({
        conversation_id: chatId,
        sender_id: authUserId,
        text: `${currentUserData?.fullName || 'Admin'} removed ${removedUser?.fullName || 'a user'}`,
        created_at: new Date().toISOString(),
        media_type: 'system'
      });
    } catch (err) {
      console.error(err);
    }
  };

  const makeAdmin = async (uid: string) => {
    if (!chatId || !isAdmin || (group.admins || []).includes(uid) || !supabase) return;
    try {
      const newAdmins = [...(group.admins || []), uid];
      await supabase.from('conversations').update({ admins: newAdmins } as any).eq('id', chatId);
      const user = (members as any[]).find(m => m.uid === uid);
      await (supabase as any).from('messages').insert({
        conversation_id: chatId,
        sender_id: authUserId,
        text: `${user?.fullName || 'User'} is now an admin`,
        created_at: new Date().toISOString(),
        media_type: 'system'
      });
    } catch (err) { console.error(err); }
  };

  const leaveGroup = async () => {
    if (!chatId || !authUserId || !supabase) return;
    if (!window.confirm("Are you sure you want to leave this group?")) return;
    
    try {
      await supabase.from('conversation_participants').delete().eq('conversation_id', chatId).eq('user_id', authUserId);
      
      await (supabase as any).from('messages').insert({
        conversation_id: chatId,
        sender_id: authUserId,
        text: `${currentUserData?.fullName || 'User'} left the group`,
        created_at: new Date().toISOString(),
        media_type: 'system'
      });
      
      navigate('/chats');
    } catch (err) { console.error(err); }
  };

  const deleteGroup = async () => {
    if (!chatId || !isAdmin || !supabase) return;
    if (!window.confirm("DELETE this group? This will remove all messages and group data for everyone. This cannot be undone.")) return;
    
    try {
      await supabase.from('conversations').delete().eq('id', chatId);
      navigate('/chats');
    } catch (err) { console.error(err); }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[200] bg-[var(--bg-main)] flex flex-col items-center justify-center gap-4">
        <Loader2 size={40} className="animate-spin text-blue-500" />
        <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">Synchronizing Group...</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] bg-[var(--bg-main)] flex flex-col font-sans">
      {/* Header */}
      <div className="shrink-0 bg-[var(--bg-card)] border-b border-[var(--border-color)] px-4 py-3 flex items-center gap-4">
        <button aria-label="Back" onClick={() => navigate(-1)} className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors">
          <ArrowLeft size={24} />
        </button>
        <div className="flex-1">
          <h2 className="text-sm font-black uppercase tracking-widest text-[var(--text-primary)]">Group Info</h2>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">{members.length} participants</p>
        </div>
        {isAdmin && (
          <button aria-label="More options" className="p-2 hover:bg-black/5 rounded-full transition-colors">
            <MoreVertical size={20} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar">
        {/* Info Card */}
        <div className="flex flex-col items-center py-10 px-6 space-y-6 text-center border-b border-[var(--border-color)]">
          <div className="relative group">
            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-white shadow-2xl bg-[var(--bg-card)]">
              {updating ? (
                <div className="w-full h-full flex items-center justify-center">
                  <Loader2 size={32} className="animate-spin text-blue-500" />
                </div>
              ) : (
                <Avatar url={group.photo_url} type="group" size="custom" customSizeClass="w-full h-full" name={group.name} />
              )}
            </div>
            {isAdmin && (
              <label className="absolute bottom-0 right-0 p-2.5 bg-blue-500 text-white rounded-full shadow-lg cursor-pointer hover:scale-110 transition-all border-4 border-[var(--bg-main)]">
                <Camera size={20} />
                <input type="file" className="hidden" accept="image/*" onChange={handleUpdateIcon} />
              </label>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-center gap-2">
              {showEditName ? (
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={newName} 
                    onChange={e => setNewName(e.target.value)}
                    className="bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg px-3 py-1 text-lg font-black outline-none focus:border-blue-500"
                    autoFocus
                  />
                  <button aria-label="Confirm" onClick={handleUpdateName} className="p-2 bg-emerald-500 text-white rounded-lg"><Check size={16} /></button>
                  <button aria-label="Close" onClick={() => { setShowEditName(false); setNewName(group.name); }} className="p-2 bg-rose-500 text-white rounded-lg"><X size={16} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">{group.name}</h1>
                  {isAdmin && <button aria-label="Edit" onClick={() => setShowEditName(true)} className="p-1.5 text-blue-500 hover:bg-blue-500/10 rounded-full"><Edit3 size={18} /></button>}
                </div>
              )}
            </div>
            <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Created • {group.created_at ? new Date(group.created_at).toLocaleDateString() : 'N/A'}</p>
          </div>
        </div>

        {/* Member Management */}
        <div className="p-4 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between px-2">
              <h3 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">Participants</h3>
              {isAdmin && (
                <button className="flex items-center gap-1.5 text-[10px] font-black text-blue-500 uppercase tracking-widest bg-blue-500/10 px-3 py-1.5 rounded-full">
                  <UserPlus size={14} /> Add Member
                </button>
              )}
            </div>

            <div className="bg-[var(--bg-card)] rounded-3xl border border-[var(--border-color)] divide-y divide-[var(--border-color)] overflow-hidden">
              {members.map(member => {
                const memberIsAdmin = (group.admins || []).includes(member.uid);
                const isMe = member.uid === authUserId;
                return (
                  <div key={member.uid} className="flex items-center gap-3 p-4">
                    <Avatar url={member.photoURL} type="direct" size="custom" customSizeClass="w-11 h-11" name={member.fullName} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-[var(--text-primary)] truncate">{member.fullName}</p>
                        {memberIsAdmin && (
                          <div className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 text-emerald-500 rounded text-[8px] font-black uppercase tracking-tighter border border-emerald-500/20">
                            <ShieldCheck size={8} /> Admin
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] truncate">@{member.username}</p>
                    </div>
                    
                    {isAdmin && !isMe && (
                      <div className="flex items-center gap-1">
                        {!memberIsAdmin && (
                          <button 
                            onClick={() => makeAdmin(member.uid)}
                            className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-full transition-colors"
                            title="Make Group Admin"
                          >
                            <ShieldCheck size={18} />
                          </button>
                        )}
                        <button 
                          onClick={() => removeMember(member.uid)}
                          className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-full transition-colors"
                          title="Remove Member"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Danger Zone */}
          <div className="space-y-4 pt-4">
             <div className="flex items-center gap-2 px-2">
               <Settings size={14} className="text-rose-500" />
               <h3 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">Danger Zone</h3>
             </div>

             <div className="space-y-2">
               <button 
                 onClick={leaveGroup}
                 className="w-full flex items-center gap-4 p-5 bg-rose-500/5 hover:bg-rose-500/10 text-rose-500 rounded-3xl border border-rose-500/10 transition-all font-bold group"
               >
                 <div className="p-2 bg-rose-500 text-white rounded-xl group-hover:scale-110 transition-transform">
                   <LogOut size={20} />
                 </div>
                 <div className="text-left flex-1">
                   <p className="text-sm font-black uppercase tracking-wider">Leave Group</p>
                   <p className="text-[10px] font-bold opacity-60">Exit conversation and clear data</p>
                 </div>
               </button>

               {isAdmin && (
                 <button 
                   onClick={deleteGroup}
                   className="w-full flex items-center gap-4 p-5 bg-rose-900/5 hover:bg-rose-900/10 text-rose-900 rounded-3xl border border-rose-900/10 transition-all font-bold group"
                 >
                   <div className="p-2 bg-rose-900 text-white rounded-xl group-hover:scale-110 transition-transform">
                     <Trash2 size={20} />
                   </div>
                   <div className="text-left flex-1">
                     <p className="text-sm font-black uppercase tracking-wider">Delete Group</p>
                     <p className="text-[10px] font-bold opacity-60">Permanently remove this group for all members</p>
                   </div>
                 </button>
               )}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
