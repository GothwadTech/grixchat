import React from 'react';
import { storage } from '../../services/StorageService';
import { 
  Sliders, 
  Smartphone, 
  Cpu, 
  Activity, 
  ShieldAlert, 
  Users, 
  CopyCheck
} from 'lucide-react';
import { LogEntry, loggerService } from '../../services/ConsoleLoggerService';

interface ConsoleDiagnosticsProps {
  logs: LogEntry[];
  showToastNotification: (msg: string) => void;
}

export default function ConsoleDiagnostics({ logs, showToastNotification }: ConsoleDiagnosticsProps) {
  
  // Safe helper to grab keys from localStorage
  const safeGetLocalStorage = (key: string): string => {
    try {
      return storage.readRawForDiagnostics(key) || 'None';
    } catch (_) {
      return 'Access Denied';
    }
  };

  const connectionHealth = navigator.onLine ? 'Connected' : 'Disconnected';
  const hasSupabaseUrl = !!import.meta.env.VITE_SUPABASE_URL;
  const hasSupabaseAnonKey = !!import.meta.env.VITE_SUPABASE_ANON_KEY;
  const cachedUser = safeGetLocalStorage('grix_cached_user');
  const cachedUserData = safeGetLocalStorage('grix_cached_userdata');
  const multiAccountsStr = safeGetLocalStorage('grix_multi_accounts');
  const totalAccounts = multiAccountsStr !== 'None' && multiAccountsStr !== 'Access Denied' 
    ? JSON.parse(multiAccountsStr).length 
    : 0;

  const handleCopyDiagnosticsDump = () => {
    const reportHeader = `===========================================
GRIXCHAT DEV CONSOLE DIAGNOSTICS REPORT
Generated: ${new Date().toLocaleString()}
Connection Quality: ${connectionHealth}
Supabase Host Environment: ${hasSupabaseUrl ? 'Configured' : 'Bypassed / Mock Mode'}
Decrypted Key Presence: ${hasSupabaseAnonKey ? 'Active' : 'Unset'}
Registered Login Profiles: ${totalAccounts}
Logged Session ID: ${cachedUser !== 'None' ? 'Cached Profile' : 'Unauthenticated'}
Hardware Threads (CPU Cores): ${navigator.hardwareConcurrency || 'N/A'}
Screen Spec: ${window.screen.width}x${window.screen.height} (DPR: ${window.devicePixelRatio})
User Agent Info: ${navigator.userAgent}
===========================================\n\n`;

    const reportBody = logs
      .map(entry => `[${entry.timestamp}] [${entry.type.toUpperCase()}] ${entry.message}`)
      .join('\n');

    try {
      navigator.clipboard.writeText(reportHeader + reportBody);
      showToastNotification('Full Diagnostics Compiled & Copied!');
      loggerService.logCustom('success', 'Full system diagnostics parameters compiled successfully.');
    } catch (_) {
      showToastNotification('Failed to generate diagnostic report.');
    }
  };

  return (
    <div className="flex-1 p-4 overflow-y-auto bg-[var(--bg-main)] space-y-4 custom-scrollbar select-text">
      
      <div className="flex items-center justify-between border-b border-[var(--border-color)]/25 pb-3">
        <div>
          <h3 className="text-sm font-bold font-sans text-[var(--text-primary)] flex items-center gap-1.5">
            <Sliders size={15} className="text-[#0494f4]" />
            Client Telemetry & Credentials Diagnostics
          </h3>
          <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">Live hardware performance indicators & active session payloads</p>
        </div>

        <button
          onClick={handleCopyDiagnosticsDump}
          className="py-1 px-3 bg-[#0479c2]/15 text-[#0494f4] hover:bg-[#0479c2] hover:text-white transition-all text-xs font-mono font-bold rounded-xl flex items-center gap-1 cursor-pointer border border-[#0494f4]/25 shadow-sm h-9 shrink-0"
        >
          <CopyCheck size={13} />
          <span className="hidden xs:inline">Dump Report</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 select-none">
        
        {/* Hardware Frame */}
        <div className="p-3 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-semibold text-xs border-b border-[var(--border-color)] pb-1.5 mb-1">
            <Cpu size={14} className="text-[#0494f4]" />
            <span>Hardware Dimensions Spec</span>
          </div>
          <div className="space-y-1.5 font-mono text-[10px] text-[var(--text-secondary)]">
            <div className="flex justify-between">
              <span>Logical CPU Cores:</span>
              <strong className="text-[var(--text-primary)]">{navigator.hardwareConcurrency || 'N/A'} threads</strong>
            </div>
            <div className="flex justify-between">
              <span>Screen Resolution:</span>
              <strong className="text-[var(--text-primary)]">{window.screen.width}x{window.screen.height}px</strong>
            </div>
            <div className="flex justify-between">
              <span>Device Pixel Ratio (DPR):</span>
              <strong className="text-[var(--text-primary)]">{window.devicePixelRatio}</strong>
            </div>
            <div className="flex justify-between">
              <span>Viewport Box size:</span>
              <strong className="text-[var(--text-primary)]">{window.innerWidth}x{window.innerHeight}px</strong>
            </div>
          </div>
        </div>

        {/* Network and environment indicators */}
        <div className="p-3 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-semibold text-xs border-b border-[var(--border-color)] pb-1.5 mb-1">
            <Activity size={14} className="text-emerald-500" />
            <span>Link Network Environment</span>
          </div>
          <div className="space-y-1.5 font-mono text-[10px] text-[var(--text-secondary)]">
            <div className="flex justify-between">
              <span>Online Handshake Link:</span>
              <strong className="text-emerald-500">{connectionHealth}</strong>
            </div>
            <div className="flex justify-between">
              <span>Supabase Host endpoint:</span>
              <strong className={hasSupabaseUrl ? "text-emerald-400" : "text-amber-500"}>
                {hasSupabaseUrl ? "Enabled" : "Mock (Local Mode)"}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>API security Handshake:</span>
              <strong className={hasSupabaseAnonKey ? "text-emerald-400" : "text-amber-500"}>
                {hasSupabaseAnonKey ? "Secure Key Ready" : "Bypass Active"}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Device Touch Screen:</span>
              <strong className="text-[var(--text-primary)]">
                {('ontouchstart' in window) ? 'Yes (Mobile Wrapper)' : 'No (Desktop Canvas)'}
              </strong>
            </div>
          </div>
        </div>

        {/* Security Decoded credentials */}
        <div className="p-3 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl flex flex-col gap-2 sm:col-span-2 select-text">
          <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-semibold text-xs border-b border-[var(--border-color)] pb-1.5 mb-1 select-none">
            <ShieldAlert size={14} className="text-purple-500" />
            <span>Decrypted Offline Storage Sessions</span>
          </div>
          <div className="space-y-2 font-mono text-[10px] text-[var(--text-secondary)] pt-1">
            <div className="flex flex-col gap-0.5">
              <span className="font-sans font-bold text-[8px] text-[var(--text-secondary)] uppercase tracking-wider select-none">Cached User UID:</span>
              <pre className="p-1 px-2 border border-[var(--border-color)] rounded-lg bg-[var(--box-bg)] break-all">{cachedUser}</pre>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-sans font-bold text-[8px] text-[var(--text-secondary)] uppercase tracking-wider select-none font-semibold">Cached Decoded UserData Profile Info payload:</span>
              <pre className="p-1 px-2 border border-[var(--border-color)] rounded-lg bg-[var(--box-bg)] overflow-x-auto select-text selection:bg-[#0479c2]/25 max-h-36 custom-scrollbar break-all">
                {cachedUserData !== 'None' ? cachedUserData : '// Session profile unauthenticated.'}
              </pre>
            </div>
          </div>
        </div>

        {/* Accounts Switch catalogs */}
        <div className="p-3 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl flex flex-col gap-2 sm:col-span-2 select-text">
          <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-semibold text-xs border-b border-[var(--border-color)] pb-1.5 mb-1 select-none">
            <Users size={14} className="text-[#0494f4]" />
            <span>Active Switch Accounts Registry Profiles</span>
          </div>
          <div className="space-y-2 font-mono text-[10px] text-[var(--text-secondary)] pt-1">
            <div className="flex justify-between items-center select-none">
              <span>Secondary logins count:</span>
              <strong className="text-[#0494f4] bg-[#0479c2]/10 border border-[#0494f4]/25 px-2 py-0.5 rounded-full text-[9px] font-bold">
                {totalAccounts} Logins Cached
              </strong>
            </div>
            <pre className="p-2 border border-[var(--border-color)] rounded-lg bg-[var(--box-bg)] overflow-x-auto max-h-36 custom-scrollbar select-text selection:bg-[#0479c2]/25 text-[9px] leading-tight break-all">
              {multiAccountsStr !== 'None' && multiAccountsStr !== 'Access Denied' ? multiAccountsStr : '// Register secondary profiles in multilogin page to view list metadata.'}
            </pre>
          </div>
        </div>

      </div>

      {/* User Agent Block and dynamic credit banner */}
      <div className="p-3 bg-[var(--box-bg)] border border-[var(--border-color)] rounded-2xl flex items-center justify-between gap-3 select-none">
        <div className="min-w-0">
          <span className="text-[8px] text-[var(--text-secondary)] uppercase tracking-widest font-black block leading-none mb-1">User Agent Specification String</span>
          <p className="text-[10px] font-mono leading-tight text-[var(--text-secondary)]/80 break-all">{navigator.userAgent}</p>
        </div>
        <div className="p-2 bg-[#0479c2]/15 rounded-xl border border-[#0494f4]/20 shrink-0">
          <Smartphone size={16} className="text-[#0494f4]" />
        </div>
      </div>

    </div>
  );
}
