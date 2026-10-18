import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Lazy initialization to prevent crashes if environment variables are missing initially
let supabaseClient: ReturnType<typeof createClient> | null = null;

// Helper to check if localStorage is available
const isLocalStorageAvailable = () => {
  try {
    const test = 'test';
    window.localStorage.setItem(test, test);
    window.localStorage.removeItem(test);
    return true;
  } catch (_e) {
    return false;
  }
};

/**
 * Gets the Supabase client instance.
 * Throws an error if env variables are missing when called.
 */
export const getSupabase = () => {
  if (!supabaseClient) {
    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn('Supabase URL or Anon Key is missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.');
      return null;
    }
    
    try {
      supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: isLocalStorageAvailable(), // Only persist if storage is available
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    } catch (error) {
      console.error('Failed to initialize Supabase client:', error);
      return null;
    }
  }
  return supabaseClient;
};

// Export a default initialized client (may be null if env vars are missing or if it fails)
export const supabase = getSupabase() as any;
