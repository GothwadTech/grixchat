import React, { useState, useEffect, useRef } from 'react';
import { APP_CONFIG } from '../../config/appConfig';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { User as UserIcon, AtSign, Lock, Eye, EyeOff, Mail, ArrowRight, Github, HelpCircle, ArrowLeft, Apple, Twitter, Facebook, Phone } from 'lucide-react';
import { authService } from './services/authService.ts';
import { storage } from '../../services/StorageService';

export default function SignupScreen() {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [twitterLoading, setTwitterLoading] = useState(false);
  const [facebookLoading, setFacebookLoading] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const navigate = useNavigate();

  // Verification states
  const [isVerifying, setIsVerifying] = useState(false);
  const [otp, setOtp] = useState<string[]>(new Array(6).fill(''));
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const inputRefs = useRef<HTMLInputElement[]>([]);

  useEffect(() => {
    if (isVerifying) {
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 100);
    }
  }, [isVerifying]);

  const handleOtpChange = (element: HTMLInputElement, index: number) => {
    const val = element.value;
    if (isNaN(Number(val))) return;

    const newOtp = [...otp];
    newOtp[index] = val;
    setOtp(newOtp);

    if (val !== '' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace') {
      if (otp[index] === '' && index > 0) {
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

  const handleResendOtp = async () => {
    if (!email) return;
    setResendLoading(true);
    setResendMessage('');
    setError('');
    try {
      if (supabase) {
        const { error: resendError } = await supabase.auth.resend({
          type: 'signup',
          email: email
        });
        if (resendError) throw resendError;
        setResendMessage('Verification code resent! Please check your email.');
        setOtp(new Array(6).fill(''));
        setTimeout(() => setResendMessage(''), 4000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resend code');
    } finally {
      setResendLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;

    if (isVerifying) {
      const code = otp.join('');
      if (code.length !== 6) {
        setError('Please enter a 6-digit code');
        return;
      }

      setVerifyLoading(true);
      setError('');

      try {
        const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
          email: email,
          token: code,
          type: 'signup'
        });

        if (verifyError) throw verifyError;

        // If user profile was not created earlier (e.g. user was null in signup because of email enumeration defense),
        // we can create or update it now upon successful verification with the returned secure session.
        const verifiedUser = verifyData?.user;
        if (verifiedUser) {
          try {
            const cleanUsername = username.toLowerCase().trim();
            await supabase
              .from('users')
              .upsert({
                id: verifiedUser.id,
                email: verifiedUser.email,
                full_name: fullName,
                username: cleanUsername,
                photo_url: `https://cdn-icons-png.flaticon.com/512/149/149071.png`,
                updated_at: new Date().toISOString()
              } as any);
          } catch (profileErr) {
            console.warn('Fallback profile creation failed upon verification:', profileErr);
          }
        }

        setVerifySuccess(true);
        setError('');
        setTimeout(() => {
          navigate('/chats');
        }, 1500);
      } catch (err: any) {
        setError(err.message || 'Invalid verification code. Please try again.');
      } finally {
        setVerifyLoading(false);
      }
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      // 1. Validation
      if (password !== confirmPassword) {
        throw new Error("Passwords do not match.");
      }

      const cleanUsername = username.toLowerCase().trim();
      
      // Username validation: small letters, numbers, underscores only, no spaces
      if (!/^[a-z0-9_]+$/.test(cleanUsername)) {
        throw new Error("Username can only contain small letters, numbers, and underscores (_). No spaces allowed.");
      }

      // 2. Check if username, email, or phone is already taken
      const cleanEmail = email.toLowerCase().trim();
      const cleanPhone = phone.trim();

      const { data: duplicateUsers, error: checkError } = await supabase
        .from('users')
        .select('username, email, phone')
        .or(`username.eq.${cleanUsername},email.eq.${cleanEmail},phone.eq.${cleanPhone}`);
      
      if (checkError) throw checkError;
      
      if (duplicateUsers && duplicateUsers.length > 0) {
        for (const dup of duplicateUsers) {
          if (dup.username === cleanUsername) {
            throw new Error("Username is already taken. Please choose another one.");
          }
          if (dup.email && dup.email.toLowerCase() === cleanEmail) {
            throw new Error("Email is already registered. Please go to Log In.");
          }
          if (dup.phone && dup.phone.trim() === cleanPhone) {
            throw new Error("Phone number is already registered. Please use another number or log in.");
          }
        }
      }

      // 3. Create user via authService (Supabase Auth)
      const user = await authService.signup(email, password, fullName, cleanUsername, phone);

      if (!user) {
        // If user is null but no error was thrown, it is because of Supabase email enumeration defense
        // (meaning user already signed up with this email but is unconfirmed).
        // Transition gracefully to verification so they can input/resend their OTP code.
        setIsVerifying(true);
        setLoading(false);
        return;
      }

      // 4. Create/verify user profile in users table (via RPC or direct insert)
      try {
        const { error: profileError } = await supabase
          .from('users')
          .upsert({
            id: user.id,
            email: user.email,
            full_name: fullName,
            username: cleanUsername,
            photo_url: `https://cdn-icons-png.flaticon.com/512/149/149071.png`,
            updated_at: new Date().toISOString()
          } as any);

        if (profileError) {
          console.warn('Fallback profile upsert failed, database trigger might have handled it:', profileError);
        }
      } catch (upsertErr) {
        console.warn('Fallback profile upsert threw, database trigger might have handled it:', upsertErr);
      }

      setIsVerifying(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setGoogleLoading(true);
    setError('');
    try {
      await authService.loginWithGoogle();
    } catch (err: any) {
      setError(err.message);
      setGoogleLoading(false);
    }
  };

  const handleGithubSignUp = async () => {
    setGithubLoading(true);
    setError('');
    try {
      await authService.loginWithGithub();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGithubLoading(false);
    }
  };

  const handleAppleSignUp = async () => {
    setAppleLoading(true);
    setError('');
    try {
      await authService.loginWithApple();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAppleLoading(false);
    }
  };

  const handleTwitterSignUp = async () => {
    setTwitterLoading(true);
    setError('');
    try {
      await authService.loginWithTwitter();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTwitterLoading(false);
    }
  };

  const handleFacebookSignUp = async () => {
    setFacebookLoading(true);
    setError('');
    try {
      await authService.loginWithFacebook();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFacebookLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg-main)] flex flex-col items-center relative font-sans">
      {/* Cancel button for account-adding mode */}
      {storage.getItem('grix_adding_account') === 'true' && (
        <button
          type="button"
          onClick={() => {
            storage.removeItem('grix_adding_account');
            navigate('/chats');
          }}
          className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-wider rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] cursor-pointer hover:bg-[var(--border-color)]/10 active:scale-95 transition-all z-20 shadow-sm"
        >
          Cancel
        </button>
      )}
      <div className="w-full px-8 pt-8 pb-32 pb-safe z-10 flex flex-col items-center min-h-full relative max-w-md mx-auto">
        {/* Header Card */}
        <div className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-6 text-center flex flex-col items-center justify-center mb-5 shadow-sm">
          <div className="w-16 h-16 bg-[var(--bg-main)] rounded-2xl shadow-inner flex items-center justify-center border border-[var(--border-color)] p-0 overflow-hidden mb-3">
            <img 
              src="/assets/icon-512-maskable.png" 
              alt="Logo" 
              className="w-full h-full object-cover scale-110"
              referrerPolicy="no-referrer"
            />
          </div>
          <h2 className="text-[26px] font-black text-[var(--text-primary)] tracking-tight mb-1">GrixChat</h2>
          <p className="text-[var(--text-secondary)] text-xs leading-relaxed max-w-[240px] mx-auto opacity-80 font-medium">
            Connecting you to your world, one message at a time.
          </p>
        </div>

        {/* Auth Switcher Tabs */}
        <div className="w-full flex p-1 gap-2 select-none mb-5 max-w-md">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="flex-1 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-main)]/50"
          >
            Sign In
          </button>
          <button
            type="button"
            className="flex-1 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 bg-[#0494f4] text-white shadow-md shadow-[#0494f4]/15"
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSignup} className="w-full space-y-3">
          {/* Full Name */}
          <div className="relative group">
            <UserIcon size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] group-focus-within:text-[var(--primary)] transition-colors" />
            <input 
              type="text" 
              placeholder="Full Name"
              value={fullName}
              disabled={isVerifying}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full pl-12 pr-5 py-3.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/10 focus:border-[var(--primary)]/40 transition-all placeholder:text-[var(--text-secondary)]/50 text-[var(--text-primary)] disabled:opacity-60 disabled:cursor-not-allowed"
              required
            />
          </div>

          {/* Username */}
          <div className="relative group">
            <AtSign size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] group-focus-within:text-[var(--primary)] transition-colors" />
            <input 
              type="text" 
              placeholder="Choose username"
              value={username}
              disabled={isVerifying}
              onChange={(e) => {
                const val = e.target.value.toLowerCase().replace(/\s/g, '_');
                // Only allow small letters, numbers, and underscores
                if (/^[a-z0-9_]*$/.test(val)) {
                  setUsername(val);
                }
              }}
              className="w-full pl-12 pr-12 py-3.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/10 focus:border-[var(--primary)]/40 transition-all placeholder:text-[var(--text-secondary)]/50 text-[var(--text-primary)] disabled:opacity-60 disabled:cursor-not-allowed"
              required
            />
            <div className="group absolute right-4 top-1/2 -translate-y-1/2">
              <HelpCircle size={14} className="text-[var(--text-secondary)] cursor-help" />
              <span className="hidden group-hover:block absolute right-0 bottom-full mb-2 w-48 p-2 bg-zinc-800 text-white text-[10px] rounded-lg shadow-xl z-50">
                Only small letters (a-z), numbers (0-9), and underscores (_) allowed.
              </span>
            </div>
          </div>

          {/* Email */}
          <div className="relative group">
            <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] group-focus-within:text-[var(--primary)] transition-colors" />
            <input 
              type="email" 
              placeholder="Enter your email"
              value={email}
              disabled={isVerifying}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-12 pr-5 py-3.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/10 focus:border-[var(--primary)]/40 transition-all placeholder:text-[var(--text-secondary)]/50 text-[var(--text-primary)] disabled:opacity-60 disabled:cursor-not-allowed"
              required
            />
          </div>

          {/* Phone Number */}
          <div className="relative group">
            <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] group-focus-within:text-[var(--primary)] transition-colors" />
            <input 
              type="tel" 
              placeholder="Phone Number"
              value={phone}
              disabled={isVerifying}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full pl-12 pr-5 py-3.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/10 focus:border-[var(--primary)]/40 transition-all placeholder:text-[var(--text-secondary)]/50 text-[var(--text-primary)] disabled:opacity-60 disabled:cursor-not-allowed"
              required
            />
          </div>

          {/* Password */}
          <div className="relative group">
            <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] group-focus-within:text-[var(--primary)] transition-colors" />
            <input 
              type={showPassword ? "text" : "password"} 
              placeholder="Password"
              value={password}
              disabled={isVerifying}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-12 pr-12 py-3.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/10 focus:border-[var(--primary)]/40 transition-all placeholder:text-[var(--text-secondary)]/50 text-[var(--text-primary)] disabled:opacity-60 disabled:cursor-not-allowed"
              required
            />
            <button 
              type="button"
              disabled={isVerifying}
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* Confirm Password */}
          <div className="relative group">
            <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] group-focus-within:text-[var(--primary)] transition-colors" />
            <input 
              type={showConfirmPassword ? "text" : "password"} 
              placeholder="Confirm password"
              value={confirmPassword}
              disabled={isVerifying}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full pl-12 pr-12 py-3.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/10 focus:border-[var(--primary)]/40 transition-all placeholder:text-[var(--text-secondary)]/50 text-[var(--text-primary)] disabled:opacity-60 disabled:cursor-not-allowed"
              required
            />
            <button 
              type="button"
              disabled={isVerifying}
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
            >
              {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* Dynamic 6-digit OTP Input Boxes (matching the exact length, height & design scale of registration rows) */}
          {isVerifying && (
            <div className="relative flex items-center justify-between w-full h-[54px] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl px-4 transition-all focus-within:ring-2 focus-within:ring-[var(--primary)]/10 focus-within:border-[var(--primary)]/40">
              <div className="flex w-full justify-between items-center gap-1.5 h-full py-2">
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      if (el) inputRefs.current[idx] = el;
                    }}
                    type="text"
                    maxLength={1}
                    value={digit}
                    disabled={verifySuccess}
                    onChange={(e) => handleOtpChange(e.target, idx)}
                    onKeyDown={(e) => handleKeyDown(e, idx)}
                    onPaste={handlePaste}
                    className="w-[13.5%] h-full text-center text-sm font-extrabold bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#0494f4]/30 focus:border-[#0494f4]/40 transition-all select-none font-mono"
                    placeholder="•"
                  />
                ))}
              </div>
            </div>
          )}

          {isVerifying && (
            <div className="p-3 bg-[#0494f4]/5 border border-[#0494f4]/15 rounded-xl select-none text-center space-y-1">
              <p className="text-[10px] text-[#0494f4] font-bold leading-normal">
                {resendMessage || 'Verification code sent to your email. Check spam folder.'}
              </p>
              {!verifySuccess && (
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={resendLoading}
                  className="text-[10px] font-black text-[#0494f4] hover:underline block mx-auto cursor-pointer border-none bg-transparent"
                >
                  {resendLoading ? 'Resending code...' : 'Resend Code'}
                </button>
              )}
            </div>
          )}

          {verifySuccess && (
            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl select-none text-center">
              <p className="text-[11px] text-green-500 font-extrabold leading-normal">
                Email verified successfully! Welcome to GrixChat.
              </p>
            </div>
          )}

          {/* Button is always visible unless isVerifying is active AND code is incomplete */}
          {(!isVerifying || (otp.every(d => d !== '') && !verifySuccess)) && (
            <button 
              type="submit"
              disabled={loading || verifyLoading || (!isVerifying && (!fullName || !email || !username || password.length < 6 || password !== confirmPassword))}
              className="w-full bg-[var(--primary)] text-white text-sm font-bold py-3.5 rounded-xl transition-all disabled:opacity-75 disabled:cursor-not-allowed active:scale-[0.98] shadow-sm shadow-[var(--primary)]/20 mt-2 flex items-center justify-center gap-2"
            >
              <span>
                {isVerifying ? (
                  verifyLoading ? 'Verifying...' : 'Sign Up'
                ) : (
                  loading ? 'Creating account...' : 'Sign Up'
                )}
              </span>
            </button>
          )}

          {error && (
            <motion.p 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-red-500 text-[10px] font-bold text-center bg-red-500/5 py-2 rounded-lg"
            >
              {error}
            </motion.p>
          )}

          {/* Social Sign Up flow is hidden in verification mode to prioritize OTP input */}
          {!isVerifying && (
            <>
              <div className="flex items-center gap-4 py-1">
                <div className="h-[1px] bg-[var(--border-color)] flex-1"></div>
                <span className="text-[10px] text-[var(--text-secondary)] font-medium">or</span>
                <div className="h-[1px] bg-[var(--border-color)] flex-1"></div>
              </div>

              <div className="space-y-3 w-full">
                <button 
                  type="button"
                  onClick={handleGoogleSignUp}
                  disabled={loading || googleLoading || appleLoading || githubLoading}
                  className="w-full flex items-center justify-center gap-2 bg-[var(--bg-card)] border border-[var(--border-color)] py-3.5 rounded-xl text-[13px] font-bold text-[var(--text-primary)] hover:bg-[var(--bg-main)] hover:border-[var(--text-primary)]/40 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                  </svg>
                  <span>Sign in/Sign up with Google</span>
                </button>

                <button 
                  type="button"
                  onClick={handleAppleSignUp}
                  disabled={loading || googleLoading || appleLoading || githubLoading}
                  className="w-full flex items-center justify-center gap-2 bg-[var(--bg-card)] border border-[var(--border-color)] py-3.5 rounded-xl text-[13px] font-bold text-[var(--text-primary)] hover:bg-[var(--bg-main)] hover:border-[var(--text-primary)]/40 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <Apple size={16} className="text-[var(--text-primary)] shrink-0" />
                  <span>Sign in/Sign up with Apple</span>
                </button>

                <button 
                  type="button"
                  onClick={handleGithubSignUp}
                  disabled={loading || googleLoading || appleLoading || githubLoading}
                  className="w-full flex items-center justify-center gap-2 bg-[var(--bg-card)] border border-[var(--border-color)] py-3.5 rounded-xl text-[13px] font-bold text-[var(--text-primary)] hover:bg-[var(--bg-main)] hover:border-[var(--text-primary)]/40 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <Github size={16} className="text-[var(--text-primary)] shrink-0" />
                  <span>Sign in/Sign up with GitHub</span>
                </button>
              </div>
            </>
          )}

          <div className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5 text-center flex flex-col items-center justify-center mt-6 shadow-sm select-none gap-3.5">
            <p className="text-[10px] text-[var(--text-secondary)]/65 leading-relaxed max-w-[280px] mx-auto">
              By using <a href="https://grixchat.gothwadtech.com" target="_blank" rel="noopener noreferrer" className="font-bold text-[#0494f4] hover:underline cursor-pointer">GrixChat</a>, you agree to our <span onClick={() => navigate('/terms')} className="font-bold text-[var(--primary)] hover:underline cursor-pointer">Terms of Service</span> & <span onClick={() => navigate('/terms')} className="font-bold text-[var(--primary)] hover:underline cursor-pointer">Privacy Policy</span>.
            </p>
            <div className="w-full h-[1px] bg-[var(--border-color)]/50"></div>
            <div className="text-center max-w-[280px] mx-auto">
              <span className="text-[10px] font-semibold text-[var(--text-secondary)]/55 block leading-relaxed">
                <a href="https://grixchat.gothwadtech.com" target="_blank" rel="noopener noreferrer" className="font-bold text-[#0494f4] hover:underline cursor-pointer decoration-[#0494f4] decoration-2">GrixChat</a> is proudly developed and managed by <a href="https://gothwadtechnologies.com" target="_blank" rel="noopener noreferrer" className="font-bold text-[#0494f4] hover:underline cursor-pointer decoration-[#0494f4] decoration-2">Gothwad</a> in support of India's Atmanirbhar Bharat initiative. If you have any concerns, please <a href="mailto:support@gothwadtechnologies.com" className="font-bold text-[#0494f4] hover:underline cursor-pointer decoration-[#0494f4] decoration-2">contact us</a>.
              </span>
            </div>
          </div>
        </form>
        
        {/* Extra bottom spacer to ensure the branding card is well-spaced from the screen edge */}
        <div className="h-14 w-full shrink-0" />
      </div>
    </div>
  );
}
