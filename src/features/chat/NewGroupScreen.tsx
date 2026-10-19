import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Users, 
  ArrowLeft, 
  Check, 
  Camera, 
  Loader2, 
  Search,
  X
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../providers/AuthProvider.tsx';
import { motion, AnimatePresence } from 'motion/react';
import { ImageService } from '../../services/ImageService.ts';
import Avatar from '../../components/common/Avatar';

interface UserProfile {
  id: string;
  username: string;
  fullName: string;
  photoURL: string;
}

export default function NewGroupScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawType = searchParams.get('type') || 'group';
  const groupType = rawType === 'channel' ? 'channel' : 'group';

  const { user: authUser, userData: currentUserData } = useAuth();
  const [step, setStep] = useState(1);
  const [groupName, setGroupName] = useState('');
  const [groupIcon, setGroupIcon] = useState<File | null>(null);
  const [groupIconPreview, setGroupIconPreview] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<UserProfile[]>([]);
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchFriends = useCallback(async () => {
    const uid = authUser?.id;
    if (!uid || !supabase) return;
    try {
      setLoading(true);
      // Get following and follower IDs to compute mutual friends
      const { data: followRows, error: followError } = await supabase
        .from('follows')
        .select('follower_id, following_id')
        .or(`follower_id.eq.${uid},following_id.eq.${uid}`);
      
      if (followError) throw followError;

      const IFollow = new Set<string>();
      const FollowsMe = new Set<string>();

      followRows?.forEach((row: any) => {
        if (row.follower_id === uid) {
          IFollow.add(row.following_id);
        }
        if (row.following_id === uid) {
          FollowsMe.add(row.follower_id);
        }
      });

      const mutualIds = Array.from(IFollow).filter(id => FollowsMe.has(id));
      
      if (mutualIds.length > 0) {
        const { data: friendsData, error: friendsError } = await supabase
          .from('users')
          .select('*')
          .in('id', mutualIds);
        
        if (friendsError) throw friendsError;

        setFriends(friendsData.map(f => ({
          id: f.id,
          username: f.username,
          fullName: f.full_name,
          photoURL: f.photo_url
        })));
      }
    } catch (error) {
    console.error('Error fetching friends:', error);
    } finally {
    setLoading(false);
    }
  }, [authUser?.id]);

  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setGroupIcon(file);
      const reader = new FileReader();
      reader.onloadend = () => setGroupIconPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const toggleUserSelection = (user: UserProfile) => {
    if (selectedUsers.some(u => u.id === user.id)) {
      setSelectedUsers(prev => prev.filter(u => u.id !== user.id));
    } else {
      setSelectedUsers(prev => [...prev, user]);
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || !authUser?.id || !supabase) return;
    setCreating(true);
    try {
      if (selectedUsers.length === 0) {
        throw new Error('Please select at least one member');
      }

      let iconUrl = '';
      if (groupIcon) {
        try {
          iconUrl = await ImageService.uploadImage(groupIcon);
        } catch (imgErr) {
          console.error('Image upload failed:', imgErr);
          throw new Error(`Avatar upload failed: ${imgErr instanceof Error ? imgErr.message : 'Unknown error'}. Check your API keys in Settings.`);
        }
      }

      // Helper to generate UUID client-side securely
      const generateUUID = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      };

      const newConvId = generateUUID();
      const participants = [authUser.id, ...selectedUsers.map(u => u.id)];
      
      const finalName = groupType === 'channel' 
        ? (groupName.toLowerCase().includes('channel') || groupName.toLowerCase().includes('broadcast') ? groupName : `${groupName} Channel`) 
        : groupName;

      // 1. Create the conversation
      const { error: convError } = await (supabase as any)
        .from('conversations')
        .insert({
          id: newConvId,
          name: finalName,
          photo_url: iconUrl,
          type: 'group',
          admins: [authUser.id]
        });

      if (convError) throw convError;

      // 2. Add participants
      const participantInserts = participants.map(uid => ({
        conversation_id: newConvId,
        user_id: uid
      }));

      const { error: partError } = await (supabase as any)
        .from('conversation_participants')
        .insert(participantInserts);

      if (partError) throw partError;
      
      // 3. Add system message
      try {
        await (supabase as any).from('messages').insert({
          conversation_id: newConvId,
          sender_id: authUser.id, // System messages can be sent by creator or a special sys id?
          text: groupType === 'channel' 
            ? `${currentUserData?.fullName || 'You'} created the channel "${finalName}"` 
            : `${currentUserData?.fullName || 'You'} created the group "${groupName}"`,
          created_at: new Date().toISOString(),
          media_type: 'system'
        });
      } catch (msgErr) {
        console.error('Failed to add system message:', msgErr);
      }

      navigate(`/chat/${newConvId}`);
    } catch (error) {
      console.error('Error creating group:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to create group: ${message}`);
    } finally {
      setCreating(false);
    }
  };

  const filteredFriends = friends.filter(f => 
    f.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    f.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[200] bg-[var(--bg-main)] flex flex-col font-sans">
      {/* Header */}
      <div className="shrink-0 bg-[var(--bg-card)] border-b border-[var(--border-color)] px-4 py-3 flex items-center gap-4">
        <button aria-label="Back" onClick={() => step === 1 ? navigate(-1) : setStep(1)} className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors">
          <ArrowLeft size={24} />
        </button>
        <div className="flex-1">
          <h2 className="text-sm font-black uppercase tracking-widest text-[var(--text-primary)]">
            {step === 1 
              ? (groupType === 'channel' ? 'New Broadcast' : 'New Group') 
              : (groupType === 'channel' ? 'Channel Details' : 'Group Details')
            }
          </h2>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">
            {step === 1 ? `${selectedUsers.length} elements selected` : 'Fill settings'}
          </p>
        </div>
        {step === 1 && selectedUsers.length > 0 && (
          <button aria-label="Confirm" 
            onClick={() => setStep(2)}
            className="p-2 bg-[#0494f4] text-white rounded-full shadow-lg shadow-[#0494f4]/20 active:scale-90 transition-transform"
          >
            <Check size={20} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4">
        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div 
              key="step1"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              {/* Selected Users Pill */}
              {selectedUsers.length > 0 && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
                  {selectedUsers.map(user => (
                    <div key={user.id} className="flex items-center gap-1.5 px-2 py-1 bg-[#0494f4]/10 border border-[#0494f4]/20 rounded-full shrink-0">
                      <Avatar url={user.photoURL} type="direct" size="custom" customSizeClass="w-5 h-5" name={user.fullName} />
                      <span className="text-[9px] font-bold text-[#0494f4] truncate max-w-[60px]">{user.fullName}</span>
                      <button aria-label="Close" onClick={() => toggleUserSelection(user)} className="text-[#0494f4] hover:text-[#0494f4]/80">
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Search */}
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input 
                  type="text" 
                  placeholder="Search followers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2.5 pl-10 pr-4 text-xs font-bold outline-none focus:border-[#0494f4] transition-colors"
                />
              </div>

              {/* Friend List */}
              <div className="space-y-1">
                {loading ? (
                  <div className="flex flex-col items-center py-10 gap-3">
                    <Loader2 size={24} className="animate-spin text-[#0494f4]" />
                    <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase">Finding your circle...</p>
                  </div>
                ) : filteredFriends.length > 0 ? (
                  filteredFriends.map(user => {
                    const isSelected = selectedUsers.some(u => u.id === user.id);
                    return (
                      <div 
                        key={user.id}
                        onClick={() => toggleUserSelection(user)}
                        className={`flex items-center gap-3 p-3 rounded-2xl transition-all cursor-pointer ${isSelected ? 'bg-[#0494f4]/5 ring-1 ring-[#0494f4]/20' : 'hover:bg-black/5'}`}
                      >
                        <div className="relative">
                          <Avatar url={user.photoURL} type="direct" size="custom" customSizeClass="w-11 h-11" name={user.fullName} />
                          {isSelected && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-[#0494f4] rounded-full flex items-center justify-center border-2 border-[var(--bg-main)]">
                              <Check size={10} className="text-white" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-[var(--text-primary)] truncate">{user.fullName}</p>
                          <p className="text-xs text-[var(--text-secondary)] truncate">@{user.username}</p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-10 opacity-50">
                    <Users size={32} className="mx-auto mb-2" />
                    <p className="text-xs font-bold">No friends found</p>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8 flex flex-col items-center pt-8"
            >
              <div className="relative group">
                <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-white shadow-xl bg-[var(--bg-card)]">
                  {groupIconPreview ? (
                    <img src={groupIconPreview} className="w-full h-full object-cover rounded-full" alt="Group Icon" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
                      <Users size={40} />
                    </div>
                  )}
                </div>
                <label className="absolute bottom-1 right-1 p-2 bg-[#0494f4] text-white rounded-full shadow-lg cursor-pointer hover:scale-110 active:scale-95 transition-all">
                  <Camera size={18} />
                  <input type="file" className="hidden" accept="image/*" onChange={handleIconChange} />
                </label>
              </div>

              <div className="w-full max-w-sm space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] px-1">
                    {groupType === 'channel' ? 'Channel Name' : 'Group Name'}
                  </label>
                  <input 
                    type="text"
                    placeholder={groupType === 'channel' ? "Enter channel name..." : "Enter group name..."}
                    autoFocus
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl py-3 px-4 text-sm font-bold outline-none focus:border-[#0494f4] transition-colors shadow-sm"
                  />
                  <p className="text-[8px] font-bold text-[var(--text-secondary)] uppercase px-1">
                    {groupType === 'channel' 
                      ? 'Provide a broadcast channel topic and optional avatar' 
                      : 'Provide a subject and optional group icon'
                    }
                  </p>
                </div>
              </div>

              <div className="w-full max-w-sm">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] px-1 mb-3">
                  {groupType === 'channel' ? 'Subscribers' : 'Members'}: {selectedUsers.length}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {selectedUsers.map(user => (
                    <div key={user.id} className="flex items-center gap-2 p-2 bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] overflow-hidden">
                      <Avatar url={user.photoURL} type="direct" size="custom" customSizeClass="w-6 h-6" name={user.fullName} />
                      <span className="text-[10px] font-bold text-[var(--text-primary)] truncate">{user.fullName}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button 
                onClick={handleCreateGroup}
                disabled={!groupName.trim() || creating}
                className="w-full max-w-sm mt-8 bg-[#0494f4] text-white py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-[#0494f4]/20 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-3"
              >
                {creating ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <span>Create {groupType === 'channel' ? 'Channel' : 'Group'}</span>
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
