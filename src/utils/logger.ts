/**
 * The ONE place in the client that is allowed to call `console` directly.
 *
 * Why a wrapper: `ConsoleLoggerService` intercepts console.* to feed the
 * in-app Developer Console, and the Vite build strips `console` in production
 * (`esbuild.drop`). Routing everything through here keeps that behaviour in one
 * spot and lets us add levels or redaction later without touching call sites.
 */
type Args = unknown[];

export const logger = {
  /** Verbose diagnostics. Dropped from production bundles. */
  debug: (...args: Args): void => { console.info(...args); },
  /** Normal lifecycle / state information. Dropped from production bundles. */
  info: (...args: Args): void => { console.info(...args); },
  /** Recoverable problems. Kept in production builds. */
  warn: (...args: Args): void => { console.warn(...args); },
  /** Failures. Kept in production builds. */
  error: (...args: Args): void => { console.error(...args); },
};
