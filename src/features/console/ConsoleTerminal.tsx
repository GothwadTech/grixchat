import React, { useState, useEffect, useRef } from 'react';
import { storage } from '../../services/StorageService';
import { 
  Terminal, 
  Search, 
  Check, 
  AlertTriangle, 
  AlertCircle, 
  Info, 
  Send, 
  Copy, 
  CopyCheck, 
  ChevronDown, 
  ChevronUp,
  Command
} from 'lucide-react';
import { loggerService, LogEntry } from '../../services/ConsoleLoggerService';

interface ConsoleTerminalProps {
  logs: LogEntry[];
  isCompactMode: boolean;
  showToastNotification: (msg: string) => void;
  onBeepTest: () => void;
  onMeasurePing: () => void;
}

export default function ConsoleTerminal({ 
  logs, 
  isCompactMode, 
  showToastNotification,
  onBeepTest,
  onMeasurePing
}: ConsoleTerminalProps) {
  const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error' | 'success'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [cmdInput, setCmdInput] = useState('');
  const logBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new logs or filter updates
  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length, filter]);

  // Read multi accounts and cached tokens from localStorage
  const safeGetLocalStorage = (key: string): string => {
    try {
      return storage.readRawForDiagnostics(key) || 'Not found';
    } catch (_) {
      return 'Access Denied';
    }
  };

  // Run a direct shell command
  const runDirectCommand = (rawCmd: string) => {
    const trimmed = rawCmd.trim();
    if (!trimmed) return;

    loggerService.logCustom('info', `grix@admin:~$ ${trimmed}`);

    const args = trimmed.split(' ');
    const command = args[0].toLowerCase();

    switch (command) {
      case '/help':
        loggerService.logCustom('success', '💡 Command Prompt Catalog:');
        loggerService.logCustom('info', '  /help - Display console instruction dictionary');
        loggerService.logCustom('info', '  /clear - Purge current terminal screen buffer');
        loggerService.logCustom('info', '  /sysinfo - Display detailed client telemetry logs');
        loggerService.logCustom('info', '  /stats - Summarize database, cache size, network state');
        loggerService.logCustom('info', '  /auth - Dump active auth metadata session status');
        loggerService.logCustom('info', '  /accounts - View multi-account login registry');
        loggerService.logCustom('info', '  /beep - Play diagnostic audio frequencies synthetics');
        loggerService.logCustom('info', '  /ping - Dispatch network test on reactive endpoint');
        loggerService.logCustom('info', '  /throw - Trigger a simulation runtime exception crash');
        break;

      case '/clear':
        loggerService.clearLogs();
        showToastNotification('Terminal entries cleared!');
        break;

      case '/beep':
        onBeepTest();
        break;

      case '/ping':
        onMeasurePing();
        break;

      case '/sysinfo':
        loggerService.logCustom('success', '📟 Runtime System Metadata:');
        loggerService.logCustom('info', `· User Agent: ${navigator.userAgent}`);
        loggerService.logCustom('info', `· Screen Resolution: ${window.screen.width}x${window.screen.height} (DPR: ${window.devicePixelRatio})`);
        loggerService.logCustom('info', `· Viewport Dimension: ${window.innerWidth}x${window.innerHeight}`);
        loggerService.logCustom('info', `· Hardware Threads: ${navigator.hardwareConcurrency || 'N/A'}`);
        loggerService.logCustom('info', `· Connection Status: ${navigator.onLine ? 'Connected' : 'Offline'}`);
        break;

      case '/stats':
        try {
          const keysStr = safeGetLocalStorage('grix_multi_accounts');
          const keysArr = keysStr !== 'Not found' && keysStr !== 'Access Denied' ? JSON.parse(keysStr) : [];
          loggerService.logCustom('success', '📊 GrixChat Telemetry Summary:');
          loggerService.logCustom('info', `· Registered Switch Accounts: ${keysArr.length}`);
          loggerService.logCustom('info', `· Network Status: ${navigator.onLine ? 'Connected (online)' : 'Disconnected (offline)'}`);
        } catch (e) {
          loggerService.logCustom('error', 'Telemetry stats gathering failed:', String(e));
        }
        break;

      case '/auth': {
        const authDat = safeGetLocalStorage('grix_cached_userdata') || safeGetLocalStorage('grix_cached_user');
        if (authDat && authDat !== 'Not found') {
          loggerService.logCustom('success', '🔑 Decoded Token Metadata Found:', authDat);
        } else {
          loggerService.logCustom('warn', '🔑 Database warning: No active cached sessions decoded inside client localStorage.');
        }
        break;
      }

      case '/accounts':
        try {
          const listStr = safeGetLocalStorage('grix_multi_accounts');
          if (listStr !== 'Not found' && listStr !== 'Access Denied') {
            const arr = JSON.parse(listStr);
            loggerService.logCustom('success', `👥 Profiles catalog loaded. Found ${arr.length} multi-login accounts:`, JSON.stringify(arr, null, 2));
          } else {
            loggerService.logCustom('info', 'No secondary switch account profiles registered.');
          }
        } catch (err) {
          loggerService.logCustom('error', 'MultiAccount registry parse failed:', String(err));
        }
        break;

      case '/throw':
        setTimeout(() => {
          throw new Error('Fatal Console Emulator Stack Crash Triggered by Developer Command Input /throw.');
        }, 100);
        break;

      default:
        loggerService.logCustom('error', `Unknown console instruction prefix: "${command}". Enter "/help" to view options list.`);
        break;
    }
  };

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const command = cmdInput.trim();
    if (!command) return;
    runDirectCommand(command);
    setCmdInput('');
  };

  const handleQuickPillClick = (cmd: string) => {
    runDirectCommand(cmd);
    inputRef.current?.focus();
  };

  const toggleLogAccordion = (logId: string) => {
    setExpandedLogId(prev => (prev === logId ? null : logId));
  };

  const handleCopySingleLog = (e: React.MouseEvent, log: LogEntry) => {
    e.stopPropagation();
    try {
      const text = `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}${log.details ? `\nDetails: ${log.details}` : ''}`;
      navigator.clipboard.writeText(text);
      showToastNotification('Single log entry copied!');
    } catch (_) {
      showToastNotification('Copy failed!');
    }
  };

  // Filter logs logic
  const filteredLogs = logs.filter(log => {
    const matchesFilter = filter === 'all' || log.type === filter;
    const matchesSearch = searchQuery === '' || 
      log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.details && log.details.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full">
      {/* Search and Filters Strip */}
      <div className="p-3 bg-[var(--bg-card)] border-b border-[var(--border-color)]/20 flex flex-col gap-2 shrink-0 select-none">
        <div className="flex flex-wrap gap-1 shadow-sm">
          <button
            onClick={() => setFilter('all')}
            className={`px-2 py-1.5 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer border ${filter === 'all' ? 'bg-[#0479c2]/15 border-[#0494f4] text-[#0494f4]' : 'bg-[var(--box-bg)] border-[var(--border-color)]/20 text-[var(--text-secondary)] hover:bg-[var(--border-color)]/10'}`}
            style={{ minHeight: '32px' }}
          >
            All ({logs.length})
          </button>
          <button
            onClick={() => setFilter('info')}
            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-mono transition-all cursor-pointer flex items-center gap-1 border ${filter === 'info' ? 'bg-[#3b82f6]/15 border-blue-500 text-blue-400' : 'bg-[var(--box-bg)] border-[var(--border-color)]/20 text-[var(--text-secondary)] hover:bg-[var(--border-color)]/10'}`}
            style={{ minHeight: '32px' }}
          >
            <Info size={11} /> Info
          </button>
          <button
            onClick={() => setFilter('success')}
            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-mono transition-all cursor-pointer flex items-center gap-1 border ${filter === 'success' ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400' : 'bg-[var(--box-bg)] border-[var(--border-color)]/20 text-[var(--text-secondary)] hover:bg-[var(--border-color)]/10'}`}
            style={{ minHeight: '32px' }}
          >
            <Check size={11} /> Sync Ok
          </button>
          <button
            onClick={() => setFilter('warn')}
            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-mono transition-all cursor-pointer flex items-center gap-1 border ${filter === 'warn' ? 'bg-amber-500/15 border-amber-500 text-amber-500' : 'bg-[var(--box-bg)] border-[var(--border-color)]/20 text-[var(--text-secondary)] hover:bg-[var(--border-color)]/10'}`}
            style={{ minHeight: '32px' }}
          >
            <AlertTriangle size={11} /> Warns
          </button>
          <button
            onClick={() => setFilter('error')}
            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-mono transition-all cursor-pointer flex items-center gap-1 border ${filter === 'error' ? 'bg-rose-500/15 border-rose-500 text-rose-500' : 'bg-[var(--box-bg)] border-[var(--border-color)]/20 text-[var(--text-secondary)] hover:bg-[var(--border-color)]/10'}`}
            style={{ minHeight: '32px' }}
          >
            <AlertCircle size={11} /> Errors
          </button>
        </div>

        <div className="relative w-full">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]/55 pointer-events-none" />
          <input
            type="text"
            placeholder="Search streams buffer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-[var(--box-bg)] border border-[var(--border-color)] rounded-xl px-3 py-2 pl-9 text-[11px] font-mono text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[#0494f4] focus:ring-1 focus:ring-[#0494f4]/25 w-full"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer px-1"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Terminal logs list */}
      <div 
        className={`flex-1 overflow-y-auto p-3 space-y-1.5 bg-[var(--bg-main)] font-mono leading-relaxed custom-scrollbar select-text ${
          isCompactMode ? "text-[10px]" : "text-[12px]"
        }`}
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[var(--text-secondary)]/60 text-center py-20">
            <Terminal size={32} className="text-[var(--text-secondary)]/30 mb-2 animate-pulse" />
            <p className="font-sans text-xs text-[var(--text-secondary)] font-bold">Log buffer is empty</p>
            <p className="font-sans text-[10px] text-[var(--text-secondary)]/70 mt-1 max-w-[240px]">No matches found. Dispatch console actions to populate logs.</p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isExpanded = expandedLogId === log.id;
            let themeClass = 'text-[var(--text-primary)]';
            let iconText = '⚙️';
            let cardBg = 'bg-[var(--bg-card)] border-[var(--border-color)]/20';
            
            if (log.type === 'warn') {
              themeClass = 'text-amber-500';
              cardBg = 'bg-amber-500/5 border-amber-500/20';
              iconText = '⚠️';
            } else if (log.type === 'error') {
              themeClass = 'text-rose-500';
              cardBg = 'bg-rose-500/5 border-rose-500/20';
              iconText = '❌';
            } else if (log.type === 'success') {
              themeClass = 'text-emerald-500';
              cardBg = 'bg-emerald-500/5 border-emerald-500/20';
              iconText = '✓';
            } else if (log.message.startsWith('grix@admin')) {
              themeClass = 'text-cyan-500 font-bold';
              cardBg = 'bg-cyan-500/5 border-cyan-500/20';
              iconText = '⚡';
            }

            return (
              <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } }} 
                key={log.id} 
                onClick={() => toggleLogAccordion(log.id)}
                className={`p-2.5 rounded-xl border ${cardBg} ${themeClass} hover:border-[#0494f4]/45 transition-all cursor-pointer`}
              >
                <div className="flex items-start justify-between gap-2 w-full">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="text-[var(--text-secondary)]/40 text-[9px] pt-0.5 select-none shrink-0">{log.timestamp}</span>
                    <span className="shrink-0 text-center select-none pt-0.5 text-xs">{iconText}</span>
                    <span className="break-all text-[11px] pr-1 select-text selection:bg-[#0479c2]/20">
                      {log.message}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 pt-0.5 select-none">
                    {log.details && (
                      <span className="text-[8px] bg-[var(--box-bg)] text-[#0494f4] border border-[var(--border-color)] px-1 py-0.5 rounded font-mono font-bold">
                        {isExpanded ? 'Hide' : 'Info'}
                      </span>
                    )}
                    <button
                      onClick={(e) => handleCopySingleLog(e, log)}
                      className="p-1 hover:bg-[var(--box-bg)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                      title="Copy single entry"
                    >
                      <Copy size={12} />
                    </button>
                    {log.details && (
                      isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                    )}
                  </div>
                </div>

                {/* Info accordion payload details */}
                {isExpanded && log.details && (
                  <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } }} 
                    className="mt-2.5 p-2.5 bg-[var(--box-bg)] border border-[var(--border-color)] rounded-lg text-[10px] text-[var(--text-primary)] overflow-x-auto select-text font-mono"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-1.5 mb-2">
                      <span className="text-[8px] text-[var(--text-secondary)] font-black uppercase tracking-wider block font-sans">
                        Trace Payload Parameters:
                      </span>
                      <button
                        onClick={() => {
                          try {
                            navigator.clipboard.writeText(log.details || '');
                            showToastNotification('JSON payload copied!');
                          } catch (_) { /* intentionally ignored: best-effort, failure is non-fatal */ }
                        }}
                        className="px-2 py-0.5 bg-[var(--bg-card)] border border-[var(--border-color)] text-[#0494f4] hover:text-[var(--text-primary)] hover:bg-[var(--box-bg)] rounded transition-all text-[8px] font-mono flex items-center gap-0.5 cursor-pointer"
                      >
                        <CopyCheck size={9} /> Copy JSON
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap break-all font-mono">
                      {log.details}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={logBottomRef} />
      </div>

      {/* Terminal shortcut suggestions belt */}
      <div className="bg-[var(--bg-card)] px-3 py-2 border-t border-[var(--border-color)]/20 overflow-x-auto select-none shrink-0 flex gap-2 items-center scrollbar-none h-[42px]">
        <span className="text-[8px] uppercase font-mono font-black tracking-wider text-[var(--text-secondary)] flex items-center gap-1 shrink-0 bg-[var(--box-bg)] px-1.5 py-0.5 rounded border border-[var(--border-color)]">
          <Command size={9} className="text-[#0494f4]" /> Shell pills
        </span>
        <button
          onClick={() => handleQuickPillClick('/help')}
          className="px-2.5 py-1 bg-[var(--box-bg)] border border-[var(--border-color)] hover:border-[#0494f4]/40 text-[#0494f4] rounded-lg text-[9px] font-mono font-bold uppercase transition-all whitespace-nowrap cursor-pointer"
        >
          📡 /help
        </button>
        <button
          onClick={() => handleQuickPillClick('/sysinfo')}
          className="px-2.5 py-1 bg-[var(--box-bg)] border border-[var(--border-color)] hover:border-[#0494f4]/40 text-blue-500 rounded-lg text-[9px] font-mono font-bold uppercase transition-all whitespace-nowrap cursor-pointer"
        >
          📟 /sysinfo
        </button>
        <button
          onClick={() => handleQuickPillClick('/stats')}
          className="px-2.5 py-1 bg-[var(--box-bg)] border border-[var(--border-color)] hover:border-[#0494f4]/40 text-amber-500 rounded-lg text-[9px] font-mono font-bold uppercase transition-all whitespace-nowrap cursor-pointer"
        >
          📊 /stats
        </button>
        <button
          onClick={() => handleQuickPillClick('/accounts')}
          className="px-2.5 py-1 bg-[var(--box-bg)] border border-[var(--border-color)] hover:border-[#0494f4]/40 text-teal-500 rounded-lg text-[9px] font-mono font-bold uppercase transition-all whitespace-nowrap cursor-pointer"
        >
          👥 /accounts
        </button>
        <button
          onClick={() => handleQuickPillClick('/throw')}
          className="px-2.5 py-1 bg-[var(--box-bg)] border border-rose-500/10 hover:border-rose-500 text-rose-500 rounded-lg text-[9px] font-mono font-bold uppercase transition-all whitespace-nowrap cursor-pointer animate-pulse"
        >
          🚨 /throw Exception
        </button>
      </div>

      {/* REPL Executive Input Form */}
      <form onSubmit={handleCommandSubmit} className="bg-[var(--bg-card)] border-t border-[var(--border-color)]/25 p-2 px-3 flex items-center gap-2.5 shrink-0 select-none pb-4">
        <span className="text-[#0494f4] font-mono text-[11px] font-extrabold leading-none shrink-0">grix@admin:~$</span>
        <input
          ref={inputRef}
          type="text"
          value={cmdInput}
          onChange={(e) => setCmdInput(e.target.value)}
          placeholder="Enter log CLI query..."
          className="flex-1 bg-transparent border-none text-[var(--text-primary)] outline-none text-xs font-mono placeholder-[var(--text-secondary)]/40 focus:ring-0 focus:outline-none min-w-0"
        />
        <button
          type="submit"
          className="px-3.5 py-2 bg-[#0479c2] hover:bg-[#0383d8] active:scale-95 text-white font-mono text-[10px] uppercase font-bold tracking-wider rounded-xl flex items-center gap-1.5 transition-all shrink-0 cursor-pointer border-none"
          style={{ minHeight: '36px' }}
        >
          <Send size={11} />
          Run
        </button>
      </form>
    </div>
  );
}
