import { useEffect, useRef } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { supabase } from '../lib/supabase';
import { getFirebaseMessaging } from '../lib/firebase';
import { getToken } from 'firebase/messaging';

import { logger } from '../utils/logger';
export default function NotificationHandler() {
  const { user, userData, refreshUserData } = useAuth();
  // Latest values for the delayed FCM setup. Reading them through a ref (instead of
  // depending on fcmTokens) stops the token save -> profile refresh -> re-run loop.
  const latestRef = useRef({ userData, refreshUserData });
  latestRef.current = { userData, refreshUserData };
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!user || !supabase) return;

    const setupFCM = async () => {
      // 1. Double check environment credentials
      const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
      const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
      const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
      const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET;
      const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID;
      const appId = import.meta.env.VITE_FIREBASE_APP_ID;
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

      if (!apiKey || !projectId || !messagingSenderId || !appId || !vapidKey) {
        logger.info('FCM Setup: Credentials or VAPID key not found in env variables. Skipping FCM setup.');
        return;
      }

      // 2. Register FCM Service Worker with dynamic Search Params config
      if ('serviceWorker' in navigator && typeof Notification !== 'undefined') {
        try {
          const swUrl = `/firebase-messaging-sw.js?apiKey=${encodeURIComponent(apiKey)}&authDomain=${encodeURIComponent(authDomain || '')}&projectId=${encodeURIComponent(projectId)}&storageBucket=${encodeURIComponent(storageBucket || '')}&messagingSenderId=${encodeURIComponent(messagingSenderId)}&appId=${encodeURIComponent(appId)}`;
          
          logger.info('FCM: Registering Service Worker with scope...');
          const reg = await navigator.serviceWorker.register(swUrl, {
            scope: '/firebase-cloud-messaging-push-scope'
          });
          
          logger.info('FCM: Service Worker registered successfully:', reg.scope, 'State:', reg.installing ? 'installing' : reg.waiting ? 'waiting' : reg.active ? 'active' : 'unknown');
          registrationRef.current = reg;

          // Crucial: Wait for the Service Worker to become fully active
          if (reg.installing) {
            const sw = reg.installing;
            logger.info('FCM: SW is installing, waiting for activation...');
            await new Promise<void>((resolve) => {
              sw.addEventListener('statechange', () => {
                logger.info('FCM: SW installing state changed to:', sw.state);
                if (sw.state === 'activated') {
                  resolve();
                }
              });
              // Fallback resolve after 3 seconds to avoid blocking indefinitely
              setTimeout(resolve, 3000);
            });
          } else if (reg.waiting) {
            logger.info('FCM: SW is waiting. Attempting to skip waiting...');
          } else if (reg.active) {
            logger.info('FCM: SW is already active and running.');
          }
        } catch (swErr) {
          console.warn('FCM: Service Worker registration failed (likely iframe or sandbox restriction):', swErr);
        }
      }

      // 3. Request permissions and fetch registration token
      try {
        const messaging = await getFirebaseMessaging();
        if (!messaging) return;

        if (typeof Notification === 'undefined') {
          logger.info('FCM: Notifications not supported in this browser environment.');
          return;
        }

        // Trigger request permission gracefully if default
        if (Notification.permission === 'default') {
          try {
            await Notification.requestPermission();
          } catch (e) {
            console.warn('Could not request notification permission in this environment:', e);
          }
        }

        if (Notification.permission !== 'granted') {
          logger.info('FCM: Notification permission is not granted.');
          return;
        }

        // Try getting token
        const currentToken = await getToken(messaging, {
          vapidKey,
          serviceWorkerRegistration: registrationRef.current || undefined
        });

        if (currentToken) {
          logger.info('FCM: Acquired client token successfully:', currentToken.substring(0, 15) + '...');

          // Sync with profile in Supabase
          const existingTokens = latestRef.current.userData?.fcmTokens || [];
          if (!existingTokens.includes(currentToken)) {
            const updatedTokens = [...existingTokens, currentToken];
            
            logger.info('FCM: Syncing new token to Supabase profile...');
            const { error } = await supabase
              .from('users')
              .update({
                fcm_tokens: updatedTokens
              } as any)
              .eq('id', user.id);

            if (!error) {
              await latestRef.current.refreshUserData();
              logger.info('FCM: Token successfully saved to Supabase profile.');
            } else {
              console.error('FCM: Failed to save token to database:', error);
            }
          }
        } else {
          logger.info('FCM: Obtained blank token.');
        }
      } catch (fcmErr: any) {
        console.warn('FCM: Token retrieval failed details:', {
          message: fcmErr?.message || String(fcmErr),
          code: fcmErr?.code,
          name: fcmErr?.name,
          stack: fcmErr?.stack,
          full: fcmErr
        });
      }
    };

    // Delay setup slightly to ensure UI is interactive and loaded first
    const timer = setTimeout(() => {
      setupFCM();
    }, 2500);

    return () => clearTimeout(timer);
  }, [user, userData?.id]);

  return null;
}
