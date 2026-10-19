import React, { useState, useEffect, useRef } from 'react';
import { APP_CONFIG } from '../../config/appConfig';
import { authService } from './services/authService.ts';
import { useNavigate } from 'react-router-dom';
import { Mail, RefreshCw, LogOut, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../providers/AuthProvider';
import type { ErrorLike } from '../../utils/errors';

export default function VerifyEmailScreen() {
  const [loading, setLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // State for 6-digit code inputs
  const [otp, setOtp] = useState<string[]>(new Array(6).fill(''));
  const inputRefs = useRef<HTMLInputElement[]>([]);

  useEffect(() => {
    // Keep checking if user is confirmed (fallback in case they verified outside)
    const checkVerification = setInterval(async () => {
      if (supabase) {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser && currentUser.email_confirmed_at) {
          clearInterval(checkVerification);
          navigate('/chats');
        }
      }
    }, 4000);

    return () => clearInterval(checkVerification);
  }, [navigate]);

  const handleOtpChange = (element: HTMLInputElement, index: number) => {
    const val = element.value;
    if (isNaN(Number(val))) return; // only numbers

    const newOtp = [...otp];
    newOtp[index] = val;
    setOtp(newOtp);

    // Auto-focus next input
    if (val !== '' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace') {
      if (otp[index] === '' && index > 0) {
        // Move back on backspace if current cell is empty
        inputRefs.current[index - 1]?.focus();
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasteData = e.clipboardData.getData('text').trim();
    if (pasteData.length === 6 && /^\d+$/.test(pasteData)) {
      const pasteOtp = pasteData.split('');
      setOtp(pasteOtp);
      inputRefs.current[5]?.focus();
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }

    if (!user || !user.email) return;

    setVerifyLoading(true);
    setError('');
    setMessage('');

    try {
      if (supabase) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: user.email,
          token: code,
          type: 'signup'
        });

        if (verifyError) throw verifyError;

        setMessage('Email verified successfully! Redirecting...');
        setTimeout(() => {
          navigate('/chats');
        }, 1500);
      }
    } catch (err: unknown) {
      setError((err as ErrorLike).message || 'Invalid verification code. Please try again.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleResend = async () => {
    if (!user || !user.email) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      if (supabase && user.email) {
        await supabase.auth.resend({ type: 'signup', email: user.email });
        setMessage('Verification email sent! Please check your inbox.');
        // Clear OTP inputs on resend
        setOtp(new Array(6).fill(''));
        inputRefs.current[0]?.focus();
      }
    } catch (err: unknown) {
      setError((err as ErrorLike).message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await authService.logout();
    navigate('/login');
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg-main)] flex flex-col items-center relative font-sans">
      <div className="w-full px-8 pt-12 pb-12 z-10 flex flex-col items-center min-h-full relative max-w-sm mx-auto">
        {/* Header Section */}
        <div className="w-full relative flex items-center justify-center mb-10">
          <button 
            onClick={handleLogout}
            className="absolute left-0 w-10 h-10 flex items-center justify-center bg-[var(--bg-card)] rounded-full border border-[var(--border-color)] text-[var(--text-primary)] active:scale-95 transition-all"
            title="Logout"
          >
            <LogOut size={20} />
          </button>

          <div className="w-16 h-16 bg-[var(--bg-card)] rounded-[20px] shadow-sm flex items-center justify-center border border-[var(--border-color)] p-3">
            <img 
              src={APP_CONFIG.LOGO_URL} 
              alt="Logo" 
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>

        {/* Header Area */}
        <div className="text-center mb-8">
          <h2 className="text-[26px] font-bold text-[var(--text-primary)] mb-2">Verify Grix<span className="text-[var(--primary)]">Chat</span></h2>
          <p className="text-[var(--text-secondary)] text-xs leading-relaxed max-w-[280px] mx-auto opacity-80">
            We've sent a 6-digit confirmation code to: <br/>
            <span className="font-bold text-[var(--primary)] text-sm">{user?.email}</span>
          </p>
        </div>

        <div className="w-full space-y-6">
          <form onSubmit={handleVerify} className="bg-[var(--bg-card)] p-6 rounded-3xl border border-[var(--border-color)] text-center shadow-xl">
            <div className="w-12 h-12 bg-[var(--primary)]/10 text-[var(--primary)] rounded-full flex items-center justify-center mx-auto mb-5">
              <Mail size={24} />
            </div>

            {/* Input fields grid */}
            <div className="flex justify-center gap-2 mb-6">
              {otp.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => {
                    if (el) inputRefs.current[idx] = el;
                  }}
                  type="text"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(e.target, idx)}
                  onKeyDown={(e) => handleKeyDown(e, idx)}
                  onPaste={handlePaste}
                  className="w-11 h-12 text-center text-lg font-bold bg-[var(--bg-main)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)]/40 transition-all select-none"
                />
              ))}
            </div>

            {message && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-center gap-2 text-green-500 font-bold mb-5 text-[11px]"
              >
                <CheckCircle2 size={16} />
                {message}
              </motion.div>
            )}
            
            {error && (
              <motion.p 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-red-500 text-[10px] font-bold text-center bg-red-500/5 py-3 rounded-xl mb-5"
              >
                {error}
              </motion.p>
            )}

            <button 
              type="submit"
              disabled={verifyLoading || otp.some(d => !d)}
              className="w-full bg-[var(--primary)] text-white text-sm font-bold py-3.5 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98] shadow-sm shadow-[var(--primary)]/20 mb-4"
            >
              {verifyLoading ? <RefreshCw className="animate-spin" size={18} /> : (
                <span>Confirm Code</span>
              )}
            </button>

            <div className="w-[1px] h-4 bg-[var(--border-color)] mx-auto opacity-30 my-2"></div>

            <button 
              type="button"
              onClick={handleResend}
              disabled={loading || verifyLoading}
              className="text-[12px] font-bold text-[var(--primary)] hover:underline active:scale-95 transition-all text-center"
            >
              {loading ? 'Resending...' : 'Resend Code'}
            </button>
          </form>

          <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl">
            <p className="text-[10px] text-amber-500 font-bold text-center leading-relaxed">
              Don't see the email? Check your <span className="uppercase underline">Spam / Junk folder</span>!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
