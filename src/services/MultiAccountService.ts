import { supabase } from '../lib/supabase';
import { LocalDataCache } from './LocalDataCache';
import { storage } from './StorageService';

import { logger } from '../utils/logger';
export interface StoredAccount {
  userId: string;
  email: string;
  username: string;
  fullName: string;
  photoURL: string;
  session: {
    access_token: string;
    refresh_token: string;
  };
}

class MultiAccountServiceImpl {
  private STORAGE_KEY = 'grix_multi_accounts';
  private ACTIVE_ID_KEY = 'grix_active_account_id';

  /**
   * Retrieves all registered logged-in accounts safely from localStorage.
   */
  public getAccounts(): StoredAccount[] {
    try {
      const data = storage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('[MultiAccount] Failed to read stored accounts:', e);
      return [];
    }
  }

  /**
   * Saves the updated registered accounts registry to localStorage.
   */
  private saveAccounts(accounts: StoredAccount[]): void {
    try {
      storage.setItem(this.STORAGE_KEY, JSON.stringify(accounts));
    } catch (e) {
      console.error('[MultiAccount] Failed to save accounts:', e);
    }
  }

  /**
   * Registers or updates an active account in the list.
   */
  public async addOrUpdateAccount(
    userId: string,
    email: string,
    username: string,
    fullName: string,
    photoURL: string
  ): Promise<void> {
    if (!supabase) return;

    try {
      // Get the current session to extract tokens
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.warn('[MultiAccount] Cannot register/update account: No active Supabase session found.');
        return;
      }

      const freshSession = {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      };

      const accounts = this.getAccounts();
      const existingIndex = accounts.findIndex((a) => a.userId === userId);

      const updatedAccount: StoredAccount = {
        userId,
        email,
        username: username || email.split('@')[0],
        fullName: fullName || 'GrixChat User',
        photoURL: photoURL || 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
        session: freshSession,
      };

      if (existingIndex >= 0) {
        accounts[existingIndex] = updatedAccount;
      } else {
        accounts.push(updatedAccount);
      }

      this.saveAccounts(accounts);
      storage.setItem(this.ACTIVE_ID_KEY, userId);
      logger.info(`[MultiAccount] Registered/Updated account successfully: ${fullName} (@${username})`);
    } catch (err) {
      console.error('[MultiAccount] addOrUpdateAccount error:', err);
    }
  }

  /**
   * Updates the session details of a stored account when tokens are refreshed.
   */
  public updateSession(userId: string, session: { access_token: string; refresh_token: string }): void {
    try {
      const accounts = this.getAccounts();
      const existingIndex = accounts.findIndex((a) => a.userId === userId);
      if (existingIndex >= 0) {
        const account = accounts[existingIndex];
        if (
          account.session.access_token !== session.access_token ||
          account.session.refresh_token !== session.refresh_token
        ) {
          account.session = {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          };
          this.saveAccounts(accounts);
          logger.info(`[MultiAccount] Refreshed/Updated stored session tokens for: ${userId}`);
        }
      }
    } catch (err) {
      console.error('[MultiAccount] updateSession error:', err);
    }
  }

  /**
   * Gets the active account ID.
   */
  public getActiveAccountId(): string | null {
    return storage.getItem(this.ACTIVE_ID_KEY);
  }

  /**
   * Switches the active session to the chosen user.
   */
  public async switchAccount(userId: string): Promise<boolean> {
    if (!supabase) return false;

    try {
      const accounts = this.getAccounts();
      const target = accounts.find((a) => a.userId === userId);
      if (!target) {
        console.error(`[MultiAccount] Account for user ${userId} not found in registry.`);
        return false;
      }

      logger.info(`[MultiAccount] Switching session to: ${target.fullName} (${target.email})`);

      // 1. Temporarily pause status/heartbeats if active
      // 2. Set the active account ID key first so AuthProvider can sync
      storage.setItem(this.ACTIVE_ID_KEY, userId);

      // Set the partition user ID inside LocalDataCache before we restore session
      LocalDataCache.setCurrentUserId(userId);

      // Reload the cached user object so auth provider returns valid state immediately on page flash
      const fakeUser = {
        id: target.userId,
        email: target.email,
        user_metadata: {
          full_name: target.fullName,
          username: target.username,
          avatar_url: target.photoURL,
        },
      };
      storage.setItem('grix_cached_user', JSON.stringify(fakeUser));

      // 3. Inform Supabase auth of the session switch.
      // This will trigger 'SIGNED_IN' / auth state changes in our AuthProvider listeners.
      const { data, error } = await supabase.auth.setSession({
        access_token: target.session.access_token,
        refresh_token: target.session.refresh_token,
      });

      if (error) {
        console.error('[MultiAccount] Failed to restore sessions in Supabase client:', error);
        alert(`Your session for ${target.fullName} has expired or is invalid. Please sign in again.`);
        await this.logoutAccount(userId);
        return false;
      }

      // Update tokens inside storage if they changed during restoration
      if (data.session) {
        target.session.access_token = data.session.access_token;
        target.session.refresh_token = data.session.refresh_token;
        this.saveAccounts(accounts);
      }

      // Do not perform location.reload() to support fast, premium, instant account/profile swapping!
      return true;
    } catch (error) {
      console.error('[MultiAccount] switchAccount crash:', error);
      return false;
    }
  }

  /**
   * Safely logs out / removes a single account without wiping other logged-in accounts.
   */
  public async logoutAccount(userId: string): Promise<void> {
    if (!supabase) return;

    try {
      const accounts = this.getAccounts();
      const remainingAccounts = accounts.filter((a) => a.userId !== userId);
      
      // Wipe only files matching this logged out account's partition from local memory/IndexedDB caches
      await LocalDataCache.clearAccountCache(userId);

      this.saveAccounts(remainingAccounts);

      const activeId = this.getActiveAccountId();
      if (activeId === userId) {
        if (remainingAccounts.length > 0) {
          // Switch to first remaining account
          const nextAccount = remainingAccounts[0];
          storage.setItem(this.ACTIVE_ID_KEY, nextAccount.userId);
          LocalDataCache.setCurrentUserId(nextAccount.userId);
          
          try {
            const { error: sessionErr } = await supabase.auth.setSession({
              access_token: nextAccount.session.access_token,
              refresh_token: nextAccount.session.refresh_token,
            });
            if (sessionErr) {
              console.warn('[MultiAccount] Next account session restore failed, cascade logout:', sessionErr);
              await this.logoutAccount(nextAccount.userId);
              return;
            }
          } catch (e) {
            console.error('[MultiAccount] Error restoring next account session:', e);
            await this.logoutAccount(nextAccount.userId);
            return;
          }
          
          window.location.reload();
        } else {
          // No accounts left. Global signOut.
          storage.removeItem(this.ACTIVE_ID_KEY);
          storage.removeItem('grix_cached_user');
          LocalDataCache.setCurrentUserId(null);
          await supabase.auth.signOut();
          window.location.reload();
        }
      } else {
        // Logging out another account that is inactive, just save list and reload
        logger.info(`[MultiAccount] Removed secondary account: ${userId}`);
      }
    } catch (err) {
      console.error('[MultiAccount] logoutAccount error:', err);
    }
  }
}

export const MultiAccountService = new MultiAccountServiceImpl();
