import React, { useState, useEffect } from 'react';
import { Search, FolderOpen, Trash2, Edit2, RefreshCw } from 'lucide-react';
import { calculateGitHubBlobSha, isFileModifiedLocally } from '../utils/githubSha';
import GithubFileEditorModal from './GithubFileEditorModal';

interface ExtractedFile {
  path: string;
  name: string;
  content: string; // Base64
  sha: string;
  size: number;
}

interface RemoteFileRef {
  path: string;
  sha: string;
}

interface GithubFileListProps {
  files: ExtractedFile[];
  remoteFiles: RemoteFileRef[];
  onUpdateFile: (index: number, updated: ExtractedFile) => void;
  onRemoveFile: (index: number) => void;
  selectedPaths: string[];
  onTogglePath: (path: string) => void;
}

export default function GithubFileList({
  files,
  remoteFiles,
  onUpdateFile,
  onRemoveFile,
  selectedPaths,
  onTogglePath
}: GithubFileListProps) {
  const [fileSearch, setFileSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'changed' | 'new' | 'unchanged'>('all');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [calculatingShas, setCalculatingShas] = useState(true);

  // Cache line count computations to avoid redundant CPU loops on large files
  const linesCache = React.useRef<Record<string, number>>({});

  const getFileLineCount = (file: ExtractedFile) => {
    if (linesCache.current[file.path] !== undefined) {
      return linesCache.current[file.path];
    }
    try {
      const raw = window.atob(file.content);
      // Skip binary content to protect line render
      if (raw.includes('\u0000')) {
        linesCache.current[file.path] = 0;
        return 0;
      }
      const count = raw.split(/\r?\n/).length;
      linesCache.current[file.path] = count;
      return count;
    } catch (_e) {
      linesCache.current[file.path] = 0;
      return 0;
    }
  };

  // Compute local Git SHAs for unzipped files
  useEffect(() => {
    const computeLocalShas = async () => {
      setCalculatingShas(true);
      for (let i = 0; i < files.length; i++) {
        if (!files[i].sha) {
          const sha = await calculateGitHubBlobSha(files[i].content);
          onUpdateFile(i, { ...files[i], sha });
        }
      }
      setCalculatingShas(false);
    };
    computeLocalShas();
  }, [files, onUpdateFile]);

  // Determine status color & label
  const getFileState = (file: ExtractedFile) => {
    const matchingRemote = remoteFiles.find(rf => rf.path === file.path);
    if (!matchingRemote) return { label: 'New', color: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20', isDiff: true };
    
    const isMod = isFileModifiedLocally(file.sha, matchingRemote.sha);
    if (isMod) return { label: 'Modified', color: 'text-amber-500 bg-amber-500/10 border-amber-500/20', isDiff: true };
    
    return { label: 'Up to date', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20', isDiff: false };
  };

  const [showSliders, setShowSliders] = useState(false);
  const [minSize, setMinSize] = useState<string>('');
  const [maxSize, setMaxSize] = useState<string>('');
  const [minLines, setMinLines] = useState<string>('');
  const [maxLines, setMaxLines] = useState<string>('');

  const getFilteredFiles = () => {
    return files.map((file, index) => ({ 
      file, 
      index, 
      state: getFileState(file), 
      linesCount: getFileLineCount(file)
    }))
      .filter(({ file, state, linesCount }) => {
        const matchesSearch = file.path.toLowerCase().includes(fileSearch.toLowerCase());
        if (!matchesSearch) return false;
        
        if (activeFilter === 'changed') {
          if (!state.isDiff) return false;
        } else if (activeFilter === 'new') {
          if (state.label !== 'New') return false;
        } else if (activeFilter === 'unchanged') {
          if (state.isDiff) return false;
        }

        // Apply line count filters
        if (minLines !== '' && linesCount < parseInt(minLines, 10)) return false;
        if (maxLines !== '' && linesCount > parseInt(maxLines, 10)) return false;

        // Apply size filters (input in KB, file.size is in bytes)
        const sizeInKb = file.size / 1024;
        if (minSize !== '' && sizeInKb < parseFloat(minSize)) return false;
        if (maxSize !== '' && sizeInKb > parseFloat(maxSize)) return false;
        
        return true;
      });
  };

  if (calculatingShas) {
    return (
      <div className="bg-[var(--bg-card)] rounded-2xl p-8 border border-[var(--border-color)]/60 text-center flex flex-col items-center justify-center space-y-2">
        <RefreshCw size={22} className="animate-spin text-primary" />
        <p className="text-xs font-bold text-[var(--text-primary)]">Evaluating local repository files...</p>
        <p className="text-[10px] text-[var(--text-secondary)]">Comparing hashes to isolate changed codebase files...</p>
      </div>
    );
  }

  const refinedList = getFilteredFiles();
  const changedCountTotal = files.filter(f => getFileState(f).isDiff).length;

  return (
    <div className="space-y-3">
      {/* Search and Filters */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-color)]/60 p-3 space-y-3 shadow-sm">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search unzipped files..."
              value={fileSearch}
              onChange={(e) => setFileSearch(e.target.value)}
              className="w-full text-xs py-2 pl-8 pr-3 bg-[var(--bg-main)] border border-[var(--border-color)] text-[var(--box-text)] rounded-xl focus:outline-none focus:border-primary/50 font-bold"
            />
            <Search size={12} className="absolute left-2.5 top-2.5 text-gray-400" />
          </div>
          <button 
            onClick={() => setShowSliders(!showSliders)}
            className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border shrink-0 flex items-center gap-1.5 ${
              showSliders || minSize || maxSize || minLines || maxLines
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-[var(--bg-main)]/60 border-[var(--border-color)]/50 text-[var(--text-secondary)]'
            }`}
          >
            <span>Filters</span>
            {(minSize || maxSize || minLines || maxLines) && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
            )}
          </button>
        </div>

        {/* Sliders panel */}
        {showSliders && (
          <div className="p-3 bg-[var(--bg-main)]/50 border border-[var(--border-color)]/40 rounded-xl space-y-3 animate-[fadeIn_0.15s_ease-out]">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-wider">Metrics Filters</span>
              <button 
                onClick={() => {
                  setMinSize('');
                  setMaxSize('');
                  setMinLines('');
                  setMaxLines('');
                }}
                className="text-[9px] font-black uppercase text-amber-500 cursor-pointer"
              >
                Clear Filters
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-3.5">
              {/* File Size Range */}
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-[var(--text-secondary)] block">Min / Max Size (KB)</span>
                <div className="flex items-center gap-1.5">
                  <input 
                    type="number" 
                    placeholder="Min KB"
                    value={minSize}
                    onChange={(e) => setMinSize(e.target.value)}
                    className="w-full text-[10px] p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--box-text)] focus:outline-none text-center font-mono"
                  />
                  <span className="text-[10px] text-[var(--text-secondary)]">-</span>
                  <input 
                    type="number" 
                    placeholder="Max KB"
                    value={maxSize}
                    onChange={(e) => setMaxSize(e.target.value)}
                    className="w-full text-[10px] p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--box-text)] focus:outline-none text-center font-mono"
                  />
                </div>
              </div>

              {/* Lines count Range */}
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-[var(--text-secondary)] block">Min / Max Lines</span>
                <div className="flex items-center gap-1.5">
                  <input 
                    type="number" 
                    placeholder="Min LoC"
                    value={minLines}
                    onChange={(e) => setMinLines(e.target.value)}
                    className="w-full text-[10px] p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--box-text)] focus:outline-none text-center font-mono"
                  />
                  <span className="text-[10px] text-[var(--text-secondary)]">-</span>
                  <input 
                    type="number" 
                    placeholder="Max LoC"
                    value={maxLines}
                    onChange={(e) => setMaxLines(e.target.value)}
                    className="w-full text-[10px] p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--box-text)] focus:outline-none text-center font-mono"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sync Filters Header */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar scroll-smooth">
          {(['all', 'changed', 'new', 'unchanged'] as const).map(f => {
            const isActive = activeFilter === f;
            const count = f === 'all' ? files.length : f === 'changed' ? changedCountTotal : f === 'new' ? files.filter(fl => getFileState(fl).label === 'New').length : files.filter(fl => !getFileState(fl).isDiff).length;
            return (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border shrink-0 ${
                  isActive 
                    ? 'bg-zinc-950 border-zinc-950 text-white dark:bg-white dark:text-black dark:border-white' 
                    : 'bg-[var(--bg-main)]/60 border-[var(--border-color)]/50 text-[var(--text-secondary)] hover:bg-[var(--bg-main)] hover:text-[var(--text-primary)]'
                }`}
              >
                {f} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid of Files */}
      <div className="max-h-64 overflow-y-auto border border-[var(--border-color)]/30 rounded-2xl divide-y divide-[var(--border-color)]/10 bg-[var(--bg-card)] no-scrollbar">
        {refinedList.length === 0 ? (
          <div className="p-8 text-center space-y-1.5">
            <FolderOpen size={20} className="text-zinc-400 mx-auto" />
            <p className="text-xs font-bold text-[var(--text-primary)]">No matching files</p>
            <p className="text-[10px] text-[var(--text-secondary)]">Adjust your search or category filters.</p>
          </div>
        ) : (
          refinedList.map(({ file, index, state, linesCount }) => {
            const isChecked = selectedPaths.includes(file.path);
            return (
              <div 
                key={file.path} 
                className={`flex items-center justify-between p-3 transition-colors ${isChecked ? 'bg-primary/[0.02]' : ''}`}
              >
                <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } }} 
                  onClick={() => onTogglePath(file.path)}
                  className="flex-1 min-w-0 flex items-center gap-2.5 cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}} // Done via div onClick
                    className="rounded border-[var(--border-color)] text-primary h-3.5 w-3.5 focus:ring-0 shrink-0 select-none pointer-events-none"
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-[var(--text-primary)] truncate">
                      {file.path}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className={`text-[8px] font-extrabold uppercase px-1.5 py-0.5 border rounded-md shrink-0 ${state.color}`}>
                        {state.label}
                      </span>
                      <span className="text-[9px] text-[var(--text-secondary)] font-mono font-bold">
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                      {linesCount > 0 && (
                        <span className="text-[9px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-mono font-bold">
                          {linesCount} lines
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* File Action Controls (Edit & Delete) */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditingIndex(index)}
                    className="p-1.5 hover:bg-black/5 text-[var(--text-secondary)] hover:text-primary rounded-lg transition-colors cursor-pointer"
                    title="Edit File"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={() => onRemoveFile(index)}
                    className="p-1.5 hover:bg-rose-500/10 text-[var(--text-secondary)] hover:text-rose-500 rounded-lg transition-colors cursor-pointer"
                    title="Remove from Sync Queue"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Render Editor overlay if active */}
      {editingIndex !== null && files[editingIndex] && (
        <GithubFileEditorModal
          file={files[editingIndex]}
          onClose={() => setEditingIndex(null)}
          onSave={(updated) => onUpdateFile(editingIndex, updated)}
        />
      )}
    </div>
  );
}
