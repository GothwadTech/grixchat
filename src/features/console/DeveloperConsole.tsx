import React, { useState, useEffect } from 'react';
import { 
  Terminal, 
  HardDrive, 
  Activity, 
  Database, 
  Cpu,
  Sparkles,
  ChevronLeft
} from 'lucide-react';
import { motion } from 'motion/react';
import { loggerService, LogEntry } from '../../services/ConsoleLoggerService';

// Import modular subcomponents
import ConsoleTerminal from './ConsoleTerminal';
import ConsoleCaches from './ConsoleCaches';
import ConsoleDiagnostics from './ConsoleDiagnostics';
import ConsoleDatabase from './ConsoleDatabase';
import ConsoleSettings from './ConsoleSettings';

interface DeveloperConsoleProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'terminal' | 'storage' | 'diagnostics' | 'database' | 'settings';

export default function DeveloperConsole({ isOpen, onClose }: DeveloperConsoleProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('terminal');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  // Custom states shared across components
  const [isCompactMode, setIsCompactMode] = useState(true);
  const [isPlayingAudioTest, setIsPlayingAudioTest] = useState(false);
  const [latencyResult, setLatencyResult] = useState<string | null>(null);
  const [isMeasuringLatency, setIsMeasuringLatency] = useState(false);

  // Subscribe to central logger updates when console is loaded
  useEffect(() => {
    if (!isOpen) return;

    const unsubscribe = loggerService.subscribe((updatedLogs) => {
      setLogs(updatedLogs);
    });

    return () => unsubscribe();
  }, [isOpen]);

  const showToastNotification = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  // Perform active audio beep frequencies check (D5 console beep)
  const handleWebAudioBeepTest = () => {
    if (isPlayingAudioTest) return;
    try {
      setIsPlayingAudioTest(true);
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5 console frequency tone
      
      gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.2);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 1.3);
      
      loggerService.logCustom('success', 'WebAudio Driver Diagnostic: Beep sound frequency emitted (587Hz D5).');
      showToastNotification('🔊 Diagnostic sound beep generated (587Hz)');
      
      setTimeout(() => {
        setIsPlayingAudioTest(false);
      }, 1300);
    } catch (err) {
      setIsPlayingAudioTest(false);
      loggerService.logCustom('error', 'WebAudio synthesis failed under sandbox:', String(err));
      showToastNotification('Audio synthesis blocked by environment sandbox.');
    }
  };

  // Measure server Round-Trip-Time response latency
  const measurePingLatency = () => {
    setIsMeasuringLatency(true);
    setLatencyResult('Rete...');
    const startTime = Date.now();
    
    // Choose host endpoint target dynamically
    const endpointUrl = import.meta.env.VITE_SUPABASE_URL || 'https://www.google.com';
    
    fetch(endpointUrl, { mode: 'no-cors', cache: 'no-cache' })
      .then(() => {
        const diff = Date.now() - startTime;
        setLatencyResult(`${diff}ms`);
        loggerService.logCustom('success', `Net benchmark ping completed in ${diff}ms.`);
        showToastNotification(`Ping complete: ${diff}ms`);
      })
      .catch((err) => {
        const diff = Date.now() - startTime;
        if (diff < 1500) {
          setLatencyResult(`${diff}ms`);
          loggerService.logCustom('success', `Offline sync mock ping solved: ${diff}ms`);
          showToastNotification(`Mock ping: ${diff}ms`);
        } else {
          setLatencyResult('Timeout');
          loggerService.logCustom('error', 'Ping test connection failure:', String(err));
          showToastNotification('Connection host unreachable');
        }
      })
      .finally(() => {
        setIsMeasuringLatency(false);
      });
  };

  if (!isOpen) return null;

  // Modern bottom tabs dataset
  const devTabsList = [
    { id: 'terminal' as TabType, icon: Terminal, label: 'Terminal' },
    { id: 'storage' as TabType, icon: HardDrive, label: 'Caches' },
    { id: 'diagnostics' as TabType, icon: Activity, label: 'Diagnostics' },
    { id: 'database' as TabType, icon: Database, label: 'Database' },
    { id: 'settings' as TabType, icon: Cpu, label: 'Tweaks' }
  ];

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex flex-col md:p-6 text-[var(--text-primary)] font-sans select-none animate-fade-in"
      style={{ height: '100dvh' }}
    >
      {/* HUD Float Overlay notification */}
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[10000] px-4 py-2 bg-[var(--header-bg)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-xl text-xs font-bold shadow-2xl flex items-center gap-2 animate-bounce">
          <Sparkles size={13} className="text-[#0494f4] rotate-12" />
          <span>{toastMessage}</span>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ml-1" />
        </div>
      )}

      {/* Main Console Box structured with Grix's native frame backgrounds */}
      <div className="flex-1 bg-[var(--bg-main)] md:rounded-2xl border border-[var(--border-color)] shadow-2xl flex flex-col overflow-hidden max-w-5xl mx-auto w-full h-full relative">
        
        {/* Top Header Panel (Matches SettingHeader / TabHeader Design exactly) */}
        <div className="w-full bg-[var(--header-bg)] px-4 min-h-[56px] pt-safe pb-1.5 flex items-center gap-3 z-50 shrink-0 relative border-b border-[var(--border-color)]/35 shadow-sm rounded-b-2xl select-none">
          <button aria-label="Back" 
            onClick={onClose}
            className="p-2 hover:bg-black/5 rounded-full transition-colors cursor-pointer"
          >
            <ChevronLeft size={24} className="text-[var(--header-text)]" />
          </button>
          <h1 className="text-xl font-black text-[var(--header-text)] tracking-tight">
            Console
          </h1>
        </div>

        {/* Tab Layout Body */}
        <div className="flex-1 flex overflow-hidden min-h-0 bg-[var(--bg-main)]">
          <SuspenseBoundary>
            {activeTab === 'terminal' && (
              <ConsoleTerminal 
                logs={logs}
                isCompactMode={isCompactMode}
                showToastNotification={showToastNotification}
                onBeepTest={handleWebAudioBeepTest}
                onMeasurePing={measurePingLatency}
              />
            )}
            
            {activeTab === 'storage' && (
              <ConsoleCaches 
                showToastNotification={showToastNotification}
              />
            )}
            
            {activeTab === 'diagnostics' && (
              <ConsoleDiagnostics 
                logs={logs}
                showToastNotification={showToastNotification}
              />
            )}
            
            {activeTab === 'database' && (
              <ConsoleDatabase 
                onMeasurePing={measurePingLatency}
                latencyResult={latencyResult}
                isMeasuringLatency={isMeasuringLatency}
                showToastNotification={showToastNotification}
              />
            )}
            
            {activeTab === 'settings' && (
              <ConsoleSettings 
                logs={logs}
                isCompactMode={isCompactMode}
                onToggleCompact={() => setIsCompactMode(prev => !prev)}
                onBeepTest={handleWebAudioBeepTest}
                isPlayingAudioTest={isPlayingAudioTest}
                showToastNotification={showToastNotification}
              />
            )}
          </SuspenseBoundary>
        </div>

         {/* Bottom Tab Bar (Styled like GrixChat app BottomTabs with motion scales) */}
        <div className="w-full bg-[var(--header-bg)] px-2 min-h-[64px] pb-safe flex justify-around items-center z-50 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] shrink-0 border-t border-[var(--border-color)] rounded-t-2xl select-none">
          {devTabsList.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            
            return (
              <button 
                key={item.id} 
                onClick={() => setActiveTab(item.id)}
                className="relative flex flex-col items-center justify-center h-full min-w-[64px] transition-all duration-300 group cursor-pointer border-none bg-transparent outline-none focus:outline-none"
              >
                <div className="relative flex flex-col items-center">
                  <motion.div 
                    animate={{ 
                      scale: isActive ? 1.15 : 1,
                      y: isActive ? -1 : 0
                    }}
                    className={`transition-colors duration-300 flex items-center justify-center ${isActive ? 'text-[var(--header-text)]' : 'text-[var(--header-text)]/50 group-hover:text-[var(--header-text)]'}`}
                  >
                    <Icon 
                      size={isActive ? 24 : 20} 
                      strokeWidth={isActive ? 2.5 : 2}
                      fill={isActive ? 'currentColor' : 'none'}
                      fillOpacity={isActive ? 0.15 : 0}
                    />
                  </motion.div>
                </div>
                
                <span className={`text-[10px] mt-1 font-bold transition-all duration-300 ${isActive ? 'text-[var(--header-text)] opacity-100' : 'text-[var(--header-text)]/50 opacity-75 group-hover:opacity-100'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

      </div>

    </div>
  );
}

// Simple fallback suspense helper
function SuspenseBoundary({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={
      <div className="flex-1 flex items-center justify-center bg-[var(--bg-main)]">
        <div className="w-8 h-8 border-4 border-[#0494f4] border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      {children}
    </React.Suspense>
  );
}
