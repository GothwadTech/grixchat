import { useState, useEffect } from 'react';
import { X, Clock, CalendarDays, Ban } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface ChatTimeRestrictions {
  enabled: boolean;
  neverAllowed: boolean;
  allowedDays: number[]; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  startTime: string; // "HH:MM" format
  endTime: string; // "HH:MM" format
}

interface ChatTimeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRestrictions: ChatTimeRestrictions | null | undefined;
  onSave: (restrictions: ChatTimeRestrictions) => void;
  title?: string;
}

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun', full: 'Sunday' },
  { value: 1, label: 'Mon', full: 'Monday' },
  { value: 2, label: 'Tue', full: 'Tuesday' },
  { value: 3, label: 'Wed', full: 'Wednesday' },
  { value: 4, label: 'Thu', full: 'Thursday' },
  { value: 5, label: 'Fri', full: 'Friday' },
  { value: 6, label: 'Sat', full: 'Saturday' }
];

export default function ChatTimeModal({
  isOpen,
  onClose,
  currentRestrictions,
  onSave,
  title
}: ChatTimeModalProps) {
  const [enabled, setEnabled] = useState(false);
  const [neverAllowed, setNeverAllowed] = useState(false);
  const [allowedDays, setAllowedDays] = useState<number[]>([1, 2, 3, 4, 5]); // default Mon-Fri
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');

  useEffect(() => {
    if (isOpen) {
      if (currentRestrictions) {
        setEnabled(currentRestrictions.enabled ?? false);
        setNeverAllowed(currentRestrictions.neverAllowed ?? false);
        setAllowedDays(currentRestrictions.allowedDays ?? [1, 2, 3, 4, 5]);
        setStartTime(currentRestrictions.startTime || '09:00');
        setEndTime(currentRestrictions.endTime || '17:00');
      } else {
        setEnabled(false);
        setNeverAllowed(false);
        setAllowedDays([1, 2, 3, 4, 5]);
        setStartTime('09:00');
        setEndTime('17:00');
      }
    }
  }, [isOpen, currentRestrictions]);

  const toggleDay = (dayValue: number) => {
    if (allowedDays.includes(dayValue)) {
      setAllowedDays(allowedDays.filter(d => d !== dayValue));
    } else {
      setAllowedDays([...allowedDays, dayValue].sort());
    }
  };

  const handleSave = () => {
    onSave({
      enabled,
      neverAllowed,
      allowedDays: allowedDays.length > 0 ? allowedDays : [0, 1, 2, 3, 4, 5, 6],
      startTime,
      endTime
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
        {/* Backdrop overlay */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/70 backdrop-blur-md"
        />

        {/* Modal Panel */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 15 }}
          className="relative bg-[#1e2022] dark:bg-[#1a1b1d] border border-white/10 rounded-3xl shadow-2xl p-6 w-full max-w-md text-white overflow-hidden z-10 font-sans"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#0479c2]/20 text-[#0494f4] flex items-center justify-center">
                <Clock size={18} />
              </div>
              <h3 className="text-lg font-black tracking-wide text-zinc-100">{title || 'Chat Time Scheduler'}</h3>
            </div>
            <button aria-label="Close" 
              onClick={onClose}
              className="p-1.5 hover:bg-white/10 rounded-full text-zinc-400 transition-colors border-none bg-transparent cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>

          <div className="space-y-5">
            {/* Master Toggle */}
            <div className="flex items-center justify-between bg-zinc-900/40 p-3.5 rounded-2xl border border-white/5">
              <div>
                <p className="text-sm font-black text-zinc-200">Enable Limits</p>
                <p className="text-[11px] font-medium text-zinc-500">Restricts when users can send messages</p>
              </div>
              <label htmlFor="fld-kaicr1" className="relative inline-flex items-center cursor-pointer select-none">
                <span className="sr-only">Enable limits</span>
                <input id="fld-kaicr1" 
                  type="checkbox" 
                  checked={enabled} 
                  onChange={(e) => setEnabled(e.target.checked)} 
                  className="sr-only peer"
                />
                <div className="w-10 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0479c2]" />
              </label>
            </div>

            {enabled && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4"
              >
                {/* Block Entirely Toggle */}
                <div className="flex items-center justify-between bg-zinc-900/20 p-3 rounded-xl border border-white/5">
                  <div className="flex items-center gap-2.5">
                    <Ban size={15} className="text-pink-400" />
                    <div>
                      <p className="text-xs font-black text-zinc-200">Never Allowed (Kabhi Nahi)</p>
                      <p className="text-[10px] font-medium text-zinc-500 font-hindi">चैट को पूर्णतः बंद करें</p>
                    </div>
                  </div>
                  <label htmlFor="fld-xwi99p" className="relative inline-flex items-center cursor-pointer select-none">
                    <span className="sr-only">Never allowed (Kabhi Nahi)</span>
                    <input id="fld-xwi99p" 
                      type="checkbox" 
                      checked={neverAllowed} 
                      onChange={(e) => setNeverAllowed(e.target.checked)} 
                      className="sr-only peer"
                    />
                    <div className="w-8 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-pink-500" />
                  </label>
                </div>

                {!neverAllowed && (
                  <div className="space-y-4 pt-1">
                    {/* Days Selection */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-2.5 pl-1">
                        <CalendarDays size={13} className="text-[#0494f4]" />
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                          Allowed Days
                        </span>
                      </div>
                      <div className="flex justify-between gap-1">
                        {DAYS_OF_WEEK.map((day) => {
                          const isSelected = allowedDays.includes(day.value);
                          return (
                            <button
                              key={day.value}
                              type="button"
                              onClick={() => toggleDay(day.value)}
                              className={`flex-1 py-2 text-center text-xs font-bold rounded-xl transition-all cursor-pointer border-none ${
                                isSelected 
                                  ? 'bg-[#0479c2] text-white shadow-md active:scale-95' 
                                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-750'
                              }`}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Time Window Row */}
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label htmlFor="fld-b2w5me" className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-1 mb-1.5">
                          Start Time
                        </label>
                        <input id="fld-b2w5me"
                          type="time"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900/60 border border-white/5 focus:border-[var(--primary)] text-sm font-bold text-center rounded-xl focus:outline-none text-white cursor-pointer"
                        />
                      </div>

                      <div>
                        <label htmlFor="fld-g7yb5b" className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-1 mb-1.5">
                          End Time
                        </label>
                        <input id="fld-g7yb5b"
                          type="time"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900/60 border border-white/5 focus:border-[var(--primary)] text-sm font-bold text-center rounded-xl focus:outline-none text-white cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* Bottom Actions */}
            <div className="pt-4 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-750 text-sm font-black text-zinc-400 rounded-2xl transition-all cursor-pointer border-none"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex-1 py-3 bg-[#0479c2] hover:bg-[#0382d6] text-sm font-black text-white rounded-2xl transition-all cursor-pointer border-none shadow-lg"
              >
                Save Schedule
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
