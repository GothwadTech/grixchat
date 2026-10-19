import React, { useState } from 'react';
import { ChevronLeft, Plus, Trash2, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDialog } from '../../hooks/useDialog';

interface PollBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (pollData: { question: string; options: string[]; multiple: boolean }) => void;
}

export default function PollBuilderModal({ isOpen, onClose, onCreate }: PollBuilderModalProps) {
  useDialog(onClose, isOpen);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiple, setMultiple] = useState(false);

  const handleAddOption = () => {
    if (options.length >= 5) return;
    setOptions([...options, '']);
  };

  const handleRemoveOption = (index: number) => {
    if (options.length <= 2) return;
    setOptions(options.filter((_, i) => i !== index));
  };

  const handleOptionChange = (index: number, val: string) => {
    const updated = [...options];
    updated[index] = val;
    setOptions(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    const filledOptions = options.map(o => o.trim()).filter(Boolean);
    if (filledOptions.length < 2) return;

    onCreate({
      question: question.trim(),
      options: filledOptions,
      multiple
    });
    setQuestion('');
    setOptions(['', '']);
    setMultiple(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div role="dialog" aria-modal="true" aria-label="poll builder modal"
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
            <div className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <HelpCircle size={14} />
            </div>
            <span className="text-[14px] font-black tracking-wider uppercase text-zinc-200">New Poll Workspace</span>
          </div>

          {/* Dummy element for symmetry */}
          <div className="w-16" />
        </div>

        {/* Scrollable Workspace Container */}
        <div className="flex-1 overflow-y-auto px-6 py-8">
          <form onSubmit={handleSubmit} className="max-w-md mx-auto w-full space-y-6">
            
            <div className="space-y-2">
              <label htmlFor="fld-lssqai" className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-1">
                Poll Question
              </label>
              <input id="fld-lssqai"
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What would you like to ask?"
                required
                maxLength={100}
                className="w-full px-4 py-3.5 bg-zinc-900/60 border border-white/10 focus:border-[#0494f4] focus:ring-1 focus:ring-[#0494f4] text-[15px] font-black rounded-2xl focus:outline-none transition-colors placeholder:text-zinc-650 text-white"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between pl-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                  Choices ({options.length} / 5 max)
                </label>
              </div>
              
              <div className="space-y-2.5">
                {options.map((option, index) => (
                  <div key={index} className="flex items-center gap-2.5">
                    <div className="text-xs font-black text-zinc-500 w-5 text-center">
                      {index + 1}
                    </div>
                    <input
                      type="text"
                      value={option}
                      onChange={(e) => handleOptionChange(index, e.target.value)}
                      placeholder={`Enter choice ${index + 1}`}
                      required
                      maxLength={50}
                      className="flex-1 px-4 py-3 bg-zinc-900/40 border border-white/5 focus:border-[#0494f4] text-sm font-bold rounded-xl focus:outline-none transition-colors placeholder:text-zinc-600 text-white"
                    />
                    {options.length > 2 && (
                      <button aria-label="Delete"
                        type="button"
                        onClick={() => handleRemoveOption(index)}
                        className="p-2.5 text-zinc-400 hover:text-rose-450 hover:bg-rose-500/10 rounded-xl transition-all border-none bg-transparent cursor-pointer shrink-0 active:scale-90"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {options.length < 5 && (
                <button
                  type="button"
                  onClick={handleAddOption}
                  className="w-full py-3 bg-zinc-900/20 hover:bg-zinc-900/40 border border-dashed border-white/10 text-xs font-bold text-zinc-300 rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer mt-2"
                >
                  <Plus size={15} />
                  <span>Add another poll choice</span>
                </button>
              )}
            </div>

            {/* Checkbox settings */}
            <div className="flex items-center justify-between bg-zinc-900/30 p-4 rounded-2xl border border-white/5">
              <div className="flex flex-col">
                <span className="text-xs font-black text-zinc-200 tracking-wide">Multiple Choice</span>
                <span className="text-[10px] text-zinc-500 font-medium">Allows voters to choose multiple options</span>
              </div>
              <label htmlFor="fld-wa1ri4" className="relative inline-flex items-center cursor-pointer select-none">
                <span className="sr-only">Multiple choice</span>
                <input id="fld-wa1ri4" 
                  type="checkbox" 
                  checked={multiple} 
                  onChange={(e) => setMultiple(e.target.checked)} 
                  className="sr-only peer"
                />
                <div className="w-10 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0479c2]"></div>
              </label>
            </div>

            <div className="pt-4">
              <button
                type="submit"
                disabled={!question.trim() || options.filter(o => o.trim()).length < 2}
                className="w-full py-4 bg-[#0479c2] hover:bg-[#0382d6] disabled:opacity-30 disabled:cursor-not-allowed text-white font-black text-xs uppercase tracking-wider rounded-2xl transition-all shadow-lg active:scale-98 flex items-center justify-center cursor-pointer"
              >
                Launch Poll onto Chat
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
