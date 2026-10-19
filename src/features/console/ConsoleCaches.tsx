import { useState, useEffect } from 'react';
import { 
  Database, 
  Trash2, 
  Copy, 
  RefreshCw, 
  ChevronLeft, 
  Eye, 
  Sparkles,
  Search
} from 'lucide-react';
import { LocalDataCache } from '../../services/LocalDataCache';
import { loggerService } from '../../services/ConsoleLoggerService';

interface ConsoleCachesProps {
  showToastNotification: (msg: string) => void;
}

export default function ConsoleCaches({ showToastNotification }: ConsoleCachesProps) {
  const [cacheKeys, setCacheKeys] = useState<{ key: string; size: number; timestamp: number }[]>([]);
  const [selectedItem, setSelectedItem] = useState<{ key: string; size: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDetailMobile, setShowDetailMobile] = useState(false);

  // Refresh index list from Offline storage cache
  const refreshCacheExplorer = () => {
    try {
      const keys = LocalDataCache.getMemoryCacheKeys();
      setCacheKeys(keys.sort((a, b) => b.timestamp - a.timestamp));
    } catch (err) {
      console.warn('Failed to load storage cache index:', err);
    }
  };

  useEffect(() => {
    refreshCacheExplorer();
  }, []);

  const handleClearKey = (key: string) => {
    try {
      LocalDataCache.remove(key);
      loggerService.logCustom('success', `Cache invalidated for key: "${key}"`);
      showToastNotification(`Cleared key: "${key}"`);
      refreshCacheExplorer();
      if (selectedItem?.key === key) {
        setSelectedItem(null);
        setShowDetailMobile(false);
      }
    } catch (err) {
      loggerService.logCustom('error', `Failed to delete cache key "${key}":`, String(err));
    }
  };

  const handlePurgeAll = () => {
    try {
      const keys = LocalDataCache.getMemoryCacheKeys();
      keys.forEach(k => {
        LocalDataCache.remove(k.key);
      });
      loggerService.logCustom('success', `Entire client database & cache layers purged.`);
      showToastNotification('All system storage caches deleted!');
      refreshCacheExplorer();
      setSelectedItem(null);
      setShowDetailMobile(false);
    } catch (err) {
      loggerService.logCustom('error', 'Purge cache crash trigger:', String(err));
    }
  };

  const filteredKeys = cacheKeys.filter(item => 
    item.key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-grow flex overflow-hidden w-full h-full relative bg-[var(--bg-main)]">
      
      {/* Master Left Side Column: Cache Indices */}
      <div className={`w-full md:w-[260px] lg:w-[320px] border-r border-[var(--border-color)]/20 flex flex-col bg-[var(--bg-card)] overflow-hidden shrink-0 ${
        showDetailMobile ? 'hidden md:flex' : 'flex'
      }`}>
        <div className="p-3 bg-[var(--box-bg)] flex items-center justify-between border-b border-[var(--border-color)]/15 shrink-0 select-none">
          <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Offline Indices</span>
          <button
            onClick={refreshCacheExplorer}
            className="p-1.5 bg-[var(--bg-card)] hover:bg-[var(--border-color)]/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg transition-all cursor-pointer border border-[var(--border-color)]/20"
            title="Refresh cache list"
          >
            <RefreshCw size={12} className="text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Search list query path */}
        <div className="p-2 border-b border-[var(--border-color)]/10 bg-[var(--bg-card)] shrink-0">
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]/50 pointer-events-none" />
            <input
              type="text"
              placeholder="Search keys..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[var(--box-bg)] border border-[var(--border-color)] rounded-lg py-1 px-2.5 pl-8 text-[11px] font-mono text-[var(--text-primary)] w-full placeholder-[var(--text-secondary)]/50 focus:outline-none focus:border-[#0494f4]"
            />
          </div>
        </div>

        {/* Index feed layout */}
        <div className="flex-grow overflow-y-auto p-2 space-y-1.5 custom-scrollbar bg-[var(--bg-main)] min-h-0 select-none">
          {filteredKeys.length === 0 ? (
            <div className="py-20 text-center text-[var(--text-secondary)]/60 font-sans">
              <Database size={28} className="mx-auto text-[var(--text-secondary)]/20 mb-2" />
              <p className="text-xs font-semibold">No storage records</p>
              <p className="text-[9px] mt-0.5 text-[var(--text-secondary)]/50">Active feeds populate indices.</p>
            </div>
          ) : (
            filteredKeys.map(item => (
              <button
                key={item.key}
                onClick={() => {
                  setSelectedItem(item);
                  setShowDetailMobile(true);
                }}
                className={`w-full p-2.5 text-left rounded-xl transition-all border outline-none font-mono text-xs flex flex-col gap-1 cursor-pointer select-none ${
                  selectedItem?.key === item.key
                    ? 'bg-[#0479c2]/10 border-[#0494f4]/35 text-[var(--text-primary)] shadow-md'
                    : 'bg-[var(--bg-card)] border-[var(--border-color)]/30 hover:border-[#0494f4]/20 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <div className="break-all font-semibold font-mono text-[10px] md:text-[11px] leading-snug flex items-start justify-between gap-1.5 w-full">
                  <span>{item.key}</span>
                  <span className="bg-[var(--box-bg)] px-1.5 py-0.5 text-[8px] text-[#0494f4] border border-[#0494f4]/15 rounded shrink-0 uppercase font-bold">
                    {(item.size / 1024).toFixed(2)} KB
                  </span>
                </div>
                <span className="text-[9px] text-[var(--text-secondary)]/50 font-medium">
                  Recent Sync: {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </button>
            ))
          )}
        </div>

        {/* sidebar Purge controls */}
        <div className="p-3 bg-[var(--bg-card)] border-t border-[var(--border-color)]/20 shrink-0">
          <button
            onClick={handlePurgeAll}
            disabled={cacheKeys.length === 0}
            className="w-full bg-rose-500/10 hover:bg-rose-600 text-rose-500 hover:text-white disabled:opacity-30 font-mono text-[10px] uppercase font-bold tracking-wider py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all text-center cursor-pointer border border-rose-500/20 shadow-md h-10 shrink-0"
          >
            <Trash2 size={12} />
            Purge All Caches
          </button>
        </div>
      </div>

      {/* Detail Right Side Window: JSON Data Viewer */}
      <div className={`flex-1 bg-[var(--bg-main)] p-3 md:p-4 flex flex-col overflow-hidden w-full h-full ${
        !showDetailMobile ? 'hidden md:flex' : 'flex'
      }`}>
        {selectedItem ? (
          <div className="h-full flex flex-col overflow-hidden">
            
            {/* Header controls inside Detail inspector */}
            <div className="pb-3 border-b border-[var(--border-color)]/25 flex items-start justify-between gap-2 shrink-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowDetailMobile(false)}
                    className="md:hidden p-1.5 bg-[var(--box-bg)] hover:bg-[var(--border-color)]/10 border border-[var(--border-color)]/20 rounded-lg text-[var(--text-primary)] select-none shrink-0"
                    style={{ minWidth: '32px', minHeight: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title="Back to Keys list"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  
                  <h4 className="font-mono text-xs font-bold text-[var(--text-primary)] break-all truncate">
                    Inspect: {selectedItem.key}
                  </h4>
                </div>
                
                <p className="text-[9px] text-[var(--text-secondary)]/70 font-mono mt-1">
                  Memory Payload: <strong className="text-[#0494f4] font-bold">{selectedItem.size} Bytes</strong> ({((selectedItem.size) / 1024).toFixed(3)} KB)
                </p>
              </div>
              
              <button
                onClick={() => handleClearKey(selectedItem.key)}
                className="py-1 px-2.5 bg-rose-500/10 text-rose-500 hover:bg-rose-600 hover:text-white transition-all text-[10px] font-mono font-bold rounded-lg flex items-center gap-1.5 cursor-pointer border border-rose-500/20 shrink-0"
                style={{ minHeight: '32px' }}
              >
                <Trash2 size={11} />
                Invalidate
              </button>
            </div>

            {/* Decoded structured view area */}
            <div className="flex-1 bg-[var(--bg-card)] border border-[var(--border-color)] p-3 mt-3 overflow-y-auto font-mono text-[10px] text-[var(--text-primary)] selection:bg-[#0479c2]/25 rounded-2xl custom-scrollbar select-text leading-relaxed">
              <div className="flex items-center justify-between mb-2 select-none">
                <span className="text-[var(--text-secondary)] uppercase text-[8px] tracking-wider block font-sans font-black flex items-center gap-1">
                  <Sparkles size={11} className="text-[#0494f4]" />
                  Decoded Cache state JSON
                </span>
                
                <button
                  onClick={() => {
                    try {
                      const val = LocalDataCache.get<any>(selectedItem.key);
                      navigator.clipboard.writeText(JSON.stringify(val, null, 2) || '');
                      showToastNotification('JSON copied to clipboard');
                    } catch (_) { /* intentionally ignored: best-effort, failure is non-fatal */ }
                  }}
                  className="px-2 py-1 bg-[var(--box-bg)] border border-[var(--border-color)] text-[#0494f4] hover:text-[var(--text-primary)] rounded-lg transition-all text-[8px] font-mono flex items-center gap-1 cursor-pointer"
                >
                  <Copy size={9} /> Copy JSON
                </button>
              </div>

              <pre className="whitespace-pre-wrap break-all select-text font-mono selection:bg-[#0479c2]/20">
                {(() => {
                  try {
                    const val = LocalDataCache.get<any>(selectedItem.key);
                    if (val === null) {
                      return '// Stream was invalidated or expired from local store.';
                    }
                    return JSON.stringify(val, null, 2);
                  } catch (e) {
                    return `// Failed to format cached JSON object: ${String(e)}`;
                  }
                })()}
              </pre>
            </div>

          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-[var(--text-secondary)]/50 text-center select-none py-10 bg-[var(--bg-main)]">
            <Eye size={36} className="text-[var(--text-secondary)]/20 mb-2 animate-bounce" />
            <p className="text-xs font-bold font-sans">No cached item selected</p>
            <p className="text-[10px] text-[var(--text-secondary)]/60 max-w-[200px] mt-1">Select any offline cache index from the left sidebar tracker to inspect its content.</p>
          </div>
        )}
      </div>

    </div>
  );
}
