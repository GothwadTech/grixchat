import React from 'react';

interface RouteErrorFallbackProps {
  error: unknown;
  resetErrorBoundary: () => void;
}

/**
 * Shown INSIDE the app shell when one screen throws. The rest of the app
 * (navigation, other tabs) stays usable. The boundary resets automatically on
 * route change, so "Back to chats" is a real recovery path, not a dead end.
 */
export function RouteErrorFallback({ error, resetErrorBoundary }: RouteErrorFallbackProps) {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  // Raw error text is only useful to developers.
  const showDetails = import.meta.env.DEV;

  return (
    <div
      role="alert"
      className="h-full w-full flex flex-col items-center justify-center bg-[var(--bg-main)] p-6 text-center"
    >
      <h2 className="text-lg font-bold text-[var(--text-primary)] mb-2">This screen ran into a problem</h2>
      <p className="text-sm text-[var(--text-secondary)] mb-6 max-w-xs">
        Your data is safe. Try again, or go back to your chats.
      </p>
      {showDetails && (
        <pre className="text-xs text-red-500 mb-4 max-w-md whitespace-pre-wrap break-words">{message}</pre>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={resetErrorBoundary}
          className="bg-emerald-500 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-emerald-500/20 active:scale-95 transition-all min-h-[44px]"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => {
            resetErrorBoundary();
            window.history.pushState({}, '', '/chats');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          className="bg-[var(--bg-card)] text-[var(--text-primary)] px-6 py-3 rounded-2xl font-bold border border-[var(--border-color)] active:scale-95 transition-all min-h-[44px]"
        >
          Back to chats
        </button>
      </div>
    </div>
  );
}

export default RouteErrorFallback;
