import React, { useState } from 'react';
import { ChevronLeft, Calendar, ClipboardList } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface TaskBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (taskData: { title: string; description: string; assignee: string; dueDate: string; status: 'pending' }) => void;
}

export default function TaskBuilderModal({ isOpen, onClose, onCreate }: TaskBuilderModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onCreate({
      title: title.trim(),
      description: description.trim(),
      assignee: assignee.trim(),
      dueDate: dueDate,
      status: 'pending'
    });

    setTitle('');
    setDescription('');
    setAssignee('');
    setDueDate('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 30 }}
        transition={{ type: 'spring', damping: 25, stiffness: 280 }}
        className="fixed inset-0 z-[500] bg-[#1a1b1d] dark:bg-[#121314] flex flex-col w-full h-[100dvh] text-white overflow-hidden pb-[safe]"
      >
        {/* Fullscreen Header */}
        <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-white/5 bg-[#202225] dark:bg-[#17181a]">
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-white/5 rounded-full text-zinc-300 active:scale-95 transition-all border-none bg-transparent cursor-pointer flex items-center gap-1.5"
          >
            <ChevronLeft size={22} />
            <span className="text-sm font-semibold">Back</span>
          </button>
          
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[#0479c2]/20 text-[#0494f4] flex items-center justify-center">
              <ClipboardList size={14} />
            </div>
            <span className="text-[14px] font-black tracking-wider uppercase text-zinc-200">New Task Workspace</span>
          </div>

          {/* Symmetrical spacer */}
          <div className="w-16" />
        </div>

        {/* Scrollable Container */}
        <div className="flex-1 overflow-y-auto px-6 py-8">
          <form onSubmit={handleSubmit} className="max-w-md mx-auto w-full space-y-6">
            
            <div className="space-y-1.5">
              <label htmlFor="fld-d5t3dy" className="block text-[10px] font-black text-zinc-450 uppercase tracking-widest pl-1">
                Task Title
              </label>
              <input id="fld-d5t3dy"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                required
                maxLength={80}
                className="w-full px-4 py-3.5 bg-zinc-900/60 border border-white/10 focus:border-[#0494f4] focus:ring-1 focus:ring-[#0494f4] text-[15px] font-black rounded-2xl focus:outline-none transition-colors placeholder:text-zinc-550 text-white"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="fld-r6a9t5" className="block text-[10px] font-black text-zinc-450 uppercase tracking-widest pl-1">
                Task Info / Remarks (Optional)
              </label>
              <textarea id="fld-r6a9t5"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the task instructions/expectations..."
                maxLength={200}
                rows={3}
                className="w-full px-4 py-3 bg-zinc-900/40 border border-white/10 focus:border-[#0494f4] focus:ring-1 focus:ring-[#0494f4] text-[13px] rounded-2xl focus:outline-none transition-colors placeholder:text-zinc-600 text-white resize-none font-medium leading-relaxed"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="fld-l8vavx" className="block text-[10px] font-black text-zinc-450 uppercase tracking-widest pl-1">
                  Assignee Name
                </label>
                <input id="fld-l8vavx"
                  type="text"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder="name or @username"
                  maxLength={50}
                  className="w-full px-4 py-3.5 bg-[#25282c]/80 border border-white/5 focus:border-[#0494f4] focus:ring-1 focus:ring-[#0494f4] text-xs font-black rounded-2xl focus:outline-none transition-colors placeholder:text-zinc-600 text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="fld-ah9tsm" className="block text-[10px] font-black text-zinc-450 uppercase tracking-widest pl-1">
                  Target Due Date
                </label>
                <div className="relative">
                  <input id="fld-ah9tsm"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full pl-10 pr-3 py-3.5 bg-[#25282c]/80 border border-white/5 focus:border-[#0494f4] focus:ring-1 focus:ring-[#0494f4] text-xs font-black rounded-2xl focus:outline-none transition-colors text-white"
                  />
                  <Calendar size={15} className="absolute left-3.5 top-4 text-zinc-400 pointer-events-none" />
                </div>
              </div>
            </div>

            <div className="pt-6">
              <button
                type="submit"
                disabled={!title.trim()}
                className="w-full py-4 bg-[#0479c2] hover:bg-[#0382d6] disabled:opacity-30 disabled:cursor-not-allowed text-white font-black text-xs uppercase tracking-wider rounded-2xl transition-all shadow-lg active:scale-98 flex items-center justify-center cursor-pointer"
              >
                Launch Task onto Chat
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
