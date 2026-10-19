import { useState } from 'react';
import { X, MapPin, Navigation, Compass, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDialog } from '../../hooks/useDialog';

interface LocationSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (locationData: { latitude: number; longitude: number; name: string }) => void;
}

const PRESET_PLACES = [
  { name: '📍 Current Location (GPS)', coords: null },
  { name: 'Silicon Valley, California', coords: { latitude: 37.7749, longitude: -122.4194 } },
  { name: 'Manhattan, New York', coords: { latitude: 40.7128, longitude: -74.0060 } },
  { name: 'City of London, UK', coords: { latitude: 51.5074, longitude: -0.1278 } },
  { name: 'Paris Saint-Germain, France', coords: { latitude: 48.8566, longitude: 2.3522 } },
  { name: 'Shibuya, Tokyo, Japan', coords: { latitude: 35.6895, longitude: 139.6917 } },
  { name: 'Downtown Dubai, UAE', coords: { latitude: 25.2048, longitude: 55.2708 } },
];

export default function LocationSelectModal({ isOpen, onClose, onSend }: LocationSelectModalProps) {
  useDialog(onClose, isOpen);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSelectPreset = (place: typeof PRESET_PLACES[0]) => {
    if (place.coords) {
      onSend({
        latitude: place.coords.latitude,
        longitude: place.coords.longitude,
        name: place.name
      });
      onClose();
    } else {
      // Fetch GPS Location
      setLoading(true);
      setErrorMsg(null);
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            onSend({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              name: 'My GPS Location'
            });
            setLoading(false);
            onClose();
          },
          (err) => {
            console.warn('Geolocation Error:', err);
            setErrorMsg('GPS Permission Denied. Selecting New York as default.');
            setTimeout(() => {
              onSend({
                latitude: 40.7128,
                longitude: -74.0060,
                name: 'Manhattan, New York'
              });
              setLoading(false);
              onClose();
            }, 1500);
          },
          { enableHighAccuracy: true, timeout: 5000 }
        );
      } else {
        setErrorMsg('GPS is not supported by your browser. Using London.');
        setTimeout(() => {
          onSend({
            latitude: 51.5074,
            longitude: -0.1278,
            name: 'City of London, UK'
          });
          setLoading(false);
          onClose();
        }, 1500);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div role="dialog" aria-modal="true" aria-label="location select modal" className="fixed inset-0 z-[500] flex items-center justify-center p-4 animate-fade-in">
        {/* Backdrop */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/60 backdrop-blur-md"
        />

        {/* Modal body */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 15 }}
          className="relative bg-[#1e2022] dark:bg-[#1a1b1d] border border-white/10 rounded-3xl shadow-2xl p-6 w-full max-w-md text-white overflow-hidden z-10"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <Compass className="animate-spin-slow w-4 h-4" />
              </div>
              <h3 className="text-lg font-black tracking-wide text-zinc-100 font-sans">Share Location</h3>
            </div>
            <button aria-label="Close" 
              onClick={onClose}
              className="p-1.5 hover:bg-white/10 rounded-full text-zinc-400 transition-colors border-none bg-transparent cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>

          <div className="text-xs text-zinc-400 font-bold mb-4 flex items-center gap-1">
            <Globe size={12} className="text-[var(--primary)]" />
            <span>Select preset map destination or live GPS</span>
          </div>

          {errorMsg && (
            <div className="mb-3 px-3.5 py-2.5 rounded-xl bg-orange-550/10 border border-orange-500/20 text-amber-500 text-xs font-semibold">
              ⚠️ {errorMsg}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-10 h-10 rounded-full border-3 border-emerald-500/30 border-t-emerald-400 animate-spin" />
              <p className="text-sm font-black text-emerald-400 uppercase tracking-widest animate-pulse">
                Fetching GPS Coords...
              </p>
            </div>
          ) : (
            <div className="max-h-[280px] overflow-y-auto space-y-1 bg-zinc-900/40 p-1.5 rounded-2xl border border-white/5 scrollbar-thin">
              {PRESET_PLACES.map((place, idx) => (
                <button
                  type="button"
                  key={idx}
                  onClick={() => handleSelectPreset(place)}
                  className="w-full flex items-center gap-3.5 px-3 py-3 rounded-xl hover:bg-white/5 active:bg-white/10 text-left border-none bg-transparent text-white transition-colors cursor-pointer select-none"
                >
                  <div className={`w-8.5 h-8.5 rounded-full flex items-center justify-center shrink-0 shadow ${
                    place.coords ? 'bg-zinc-800 text-zinc-400' : 'bg-emerald-500/20 text-emerald-400'
                  }`}>
                    {place.coords ? <MapPin size={16} /> : <Navigation size={15} className="rotate-45" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-bold truncate text-zinc-200">
                      {place.name}
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">
                      {place.coords ? `${place.coords.latitude.toFixed(4)}, ${place.coords.longitude.toFixed(4)}` : 'Click to authorize browser geolocation'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-750 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
