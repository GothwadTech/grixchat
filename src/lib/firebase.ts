import { initializeApp, getApp, getApps } from '@firebase/app';
import { getMessaging, isSupported } from '@firebase/messaging';

// Firebase Web Config from Environment Variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Check if we have minimum config required to initialize
const isFirebaseConfigured = !!(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.messagingSenderId &&
  firebaseConfig.appId
);

let app: any = null;
let messaging: any = null;

if (isFirebaseConfigured) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  } catch (error) {
    console.warn('Firebase SDK initialization failed:', error);
  }
}

export const getFirebaseApp = () => app;

export const getFirebaseMessaging = async () => {
  if (!app) return null;
  try {
    // Gracefully handle iframe or blockages
    const supported = await isSupported();
    if (!supported) {
      console.warn('FCM is not supported in this user agent/environment.');
      return null;
    }
    if (!messaging) {
      messaging = getMessaging(app);
    }
    return messaging;
  } catch (err) {
    console.warn('FCM support check failed (likely blocked or in restrictive iframe group):', err);
    return null;
  }
};
