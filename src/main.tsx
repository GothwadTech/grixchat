import './services/ConsoleLoggerService.ts';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import App from './App.tsx';
import './index.css';
import { AppProviders } from './providers/AppProviders.tsx';
import { MotionConfig } from 'motion/react';

// Handle ChunkLoadError - this happens when a new version of the app is deployed 
// and the old chunk files are removed from the server.
window.addEventListener('error', (e) => {
  if (e.message.includes('ChunkLoadError') || e.message.includes('Loading chunk')) {
    console.warn('New version detected or chunk load failed. Refreshing...');
    window.location.reload();
  }
}, true);

// Fail fast with a readable message instead of a blank or half-working app when a
// production build was made without its required variables (see scripts/check-env.mjs).
const missingRequiredEnv = [
  !import.meta.env.VITE_SUPABASE_URL && 'VITE_SUPABASE_URL',
  !import.meta.env.VITE_SUPABASE_ANON_KEY && 'VITE_SUPABASE_ANON_KEY',
].filter(Boolean) as string[];

if (import.meta.env.PROD && missingRequiredEnv.length > 0) {
  console.error(`GrixChat is misconfigured. Missing build variables: ${missingRequiredEnv.join(', ')}`);
  createRoot(document.getElementById('root')!).render(
    <div role="alert" style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '40px auto' }}>
      <h1 style={{ fontSize: 20 }}>GrixChat is not configured</h1>
      <p>This build is missing required settings: {missingRequiredEnv.join(', ')}.</p>
      <p>Please contact the site owner.</p>
    </div>,
  );
} else createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={<div style={{ padding: '20px', textAlign: 'center' }}><h1>Something went wrong</h1><p>Please refresh the page.</p></div>}>
      <BrowserRouter>
        <MotionConfig reducedMotion="user">
          <AppProviders>
            <App />
          </AppProviders>
        </MotionConfig>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
