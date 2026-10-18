import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { motion } from 'motion/react';
import { Eye, EyeOff, Mail, Lock, Github, Apple } from 'lucide-react';
import { authService } from './services/authService.ts';
import { storage } from '../../services/StorageService';

export default function LoginScreen() {
  const [identifier, setIdentifier] = useState(''); // Can be email or username
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [twitterLoading, setTwitterLoading] = useState(false);
  const [facebookLoading, setFacebookLoading] = useState(false);
  const [_showSocial, _setShowSocial] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // `/forgot-password` renders this same screen, so the route is the source of
  // truth for the reset mode (KNOWN_ISSUES #8). Keeping them in sync in an
  // effect means browser back/forward toggles modes correctly too.
  const [isForgotPassword, setIsForgotPassword] = useState(
    () => location.pathname === '/forgot-password'
  );

  useEffect(() => {
    setIsForgotPassword(location.pathname === '/forgot-password');
  }, [location.pathname]);

  const goToForgotPassword = () => {
    setIsForgotPassword(true);
    setSuccess(false);
    setError('');
    if (location.pathname !== '/forgot-password') navigate('/forgot-password');
  };

  const goToLogin = () => {
    setIsForgotPassword(false);
    setSuccess(false);
    setError('');
    if (location.pathname !== '/login') navigate('/login');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError('');
    
    let loginEmail = identifier;

    try {
      // Check if identifier is email or username/phone
      if (identifier.includes('@')) {
        loginEmail = identifier;
      } else {
        const cleanId = identifier.trim();
        let matchedUser = null;
        
        // Try matching by username first (always exists and safe)
        try {
          const { data, error: uError } = await supabase
            .from('users')
            .select('email')
            .eq('username', cleanId.toLowerCase())
            .maybeSingle();
            
          if (!uError && data) {
            matchedUser = data;
          }
        } catch (uErr) {
          console.error("Username query fallback error", uErr);
        }

        // If not matched by username, try matching by phone number
        if (!matchedUser) {
          try {
            const { data, error: pError } = await supabase
              .from('users')
              .select('email')
              .eq('phone', cleanId)
              .maybeSingle();

            if (!pError && data) {
              matchedUser = data;
            }
          } catch (pErr) {
            console.error("Phone query fallback error", pErr);
          }
        }
        
        if (!matchedUser) {
          throw new Error("No account found with this Phone, Email or Username");
        }
        
        loginEmail = matchedUser.email;
      }

      await authService.login(loginEmail, password);
      navigate('/chats');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      let email = identifier;

      // If identifier is not an email, try to find it via username
      if (!identifier.includes('@')) {
        const { data, error: fetchError } = await supabase
          .from('users')
          .select('email')
          .eq('username', identifier.toLowerCase().trim())
          .maybeSingle();
        
        if (fetchError) throw fetchError;
        if (!data) {
          throw new Error("Username not found");
        }
        
        email = data.email;
      }

      await authService.resetPassword(email);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    if (isForgotPassword) {
      handleResetPassword(e);
    } else {
      handleLogin(e);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setError('');
    try {
      await authService.loginWithGoogle();
    } catch (err: any) {
      setError(err.message);
      setGoogleLoading(false);
    }
  };

  const handleGithubSignIn = async () => {
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

  const handleAppleSignIn = async () => {
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

  const _handleTwitterSignIn = async () => {
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

  const _handleFacebookSignIn = async () => {
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
            {isForgotPassword ? 'Reset password to access your account securely.' : 'Connecting you to your world, one message at a time.'}
          </p>
        </div>

        {/* Auth Switcher Tabs */}
        {!isForgotPassword && (
          <div className="w-full flex p-1 gap-2 select-none mb-5 max-w-md">
            <button
              type="button"
              className="flex-1 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 bg-[#0494f4] text-white shadow-md shadow-[#0494f4]/15"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => navigate('/signup')}
              className="flex-1 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-main)]/50"
            >
              Sign Up
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="w-full space-y-4">
          {!isForgotPassword ? (
            <>
              <div className="relative group">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] group-focus-within:text-[var(--primary)] transition-colors" />
                <input 
                  type="text" 
                  placeholder="Email, Phone or Username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full pl-12 pr-5 py-3.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/10 focus:border-[var(--primary)]/40 transition-all placeholder:text-[var(--text-secondary)]/50 text-[var(--text-primary)]"
                  required
                />
              </div>

              <div className="relative group">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] group-focus-within:text-[var(--primary)] transition-colors" />
                <input 
                  type={showPassword ? "text" : "password"} 
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-3.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/10 focus:border-[var(--primary)]/40 transition-all placeholder:text-[var(--text-secondary)]/50 text-[var(--text-primary)]"
                  required
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <div className="flex justify-between items-center px-1">
                <div 
                  onClick={() => setRememberMe(!rememberMe)}
                  className="flex items-center gap-2.5 cursor-pointer group select-none py-1"
                >
                  <div 
                    className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center transition-all duration-200 ${
                      rememberMe 
                        ? 'bg-[#0494f4] border-[#0494f4] shadow-sm shadow-[#0494f4]/20' 
                        : 'bg-[var(--bg-card)] border-[var(--border-color)] group-hover:border-[var(--primary)]'
                    }`}
                  >
                    {rememberMe && (
                      <svg className="w-3 h-3 text-white stroke-[3.5] animate-[fade-in_0.15s_ease-out]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                  <span className="text-xs font-semibold text-[var(--text-secondary)]/90 group-hover:text-[var(--text-primary)] transition-colors select-none">
                    Remember me
                  </span>
                </div>
                <button 
                  type="button" 
                  onClick={goToForgotPassword}
                  className="text-[11px] font-bold text-[var(--primary)] hover:underline"
                >
                  Forgot Password
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Email / Username field in forgot password mode */}
              <div className="relative group">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] group-focus-within:text-[var(--primary)] transition-colors" />
                <input 
                  type="text" 
                  placeholder="Email, Phone or Username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full pl-12 pr-5 py-3.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/10 focus:border-[var(--primary)]/40 transition-all placeholder:text-[var(--text-secondary)]/50 text-[var(--text-primary)]"
                  required
                />
              </div>
            </>
          )}
          
          <button 
            type="submit"
            disabled={loading || (!isForgotPassword && (googleLoading || githubLoading || appleLoading || twitterLoading || facebookLoading || !identifier || password.length < 6)) || (isForgotPassword && !identifier)}
            className="w-full bg-[var(--primary)] text-white text-sm font-bold py-3.5 rounded-xl transition-all disabled:opacity-70 active:scale-[0.98] shadow-sm shadow-[var(--primary)]/20 mt-2 cursor-pointer"
          >
            <span>
              {isForgotPassword 
                ? (loading ? 'Sending link...' : 'Send Link') 
                : (loading ? 'Logging in...' : 'Login')
              }
            </span>
          </button>

          {success && isForgotPassword && (
            <motion.p 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-emerald-500 text-[11px] font-bold text-center bg-emerald-500/5 py-2.5 px-4 rounded-lg border border-emerald-500/10"
            >
              Reset link sent successfully to your registered email! Check inbox.
            </motion.p>
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

          {/* If in Forgot Password mode, show "Remember your password? Sign in" below button */}
          {isForgotPassword && (
            <div className="text-center pt-2">
              <button 
                type="button"
                onClick={goToLogin}
                className="text-[11px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                Remember your password? <span className="text-[var(--primary)] hover:underline">Sign in</span>
              </button>
            </div>
          )}

          {!isForgotPassword && (
            <>
              <div className="flex items-center gap-4 py-2">
                <div className="h-[1px] bg-[var(--border-color)] flex-1"></div>
                <span className="text-[10px] text-[var(--text-secondary)] font-medium">or</span>
                <div className="h-[1px] bg-[var(--border-color)] flex-1"></div>
              </div>

              <div className="space-y-3 w-full">
                <button 
                  type="button"
                  onClick={handleGoogleSignIn}
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
                  onClick={handleAppleSignIn}
                  disabled={loading || googleLoading || appleLoading || githubLoading}
                  className="w-full flex items-center justify-center gap-2 bg-[var(--bg-card)] border border-[var(--border-color)] py-3.5 rounded-xl text-[13px] font-bold text-[var(--text-primary)] hover:bg-[var(--bg-main)] hover:border-[var(--text-primary)]/40 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <Apple size={16} className="text-[var(--text-primary)] shrink-0" />
                  <span>Sign in/Sign up with Apple</span>
                </button>

                <button 
                  type="button"
                  onClick={handleGithubSignIn}
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
