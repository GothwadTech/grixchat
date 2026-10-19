/**
 * Typed view of the error shapes this app meets: JS `Error`, Supabase/PostgREST
 * errors (`message`, `code`, `details`, `hint`), `fetch`/Axios responses (`status`)
 * and DOM exceptions (`name`). Use it to narrow a caught `unknown`.
 */
export interface ErrorLike {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  name?: string;
  stack?: string;
  /** Axios-style HTTP error payload. */
  response?: { status?: number; data?: { message?: string; error?: string } | undefined };
}

/** The message of any thrown value, or `fallback` when there is none. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const message = (error as ErrorLike).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}
