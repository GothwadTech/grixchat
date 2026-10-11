/**
 * Cloudflare Pages Function — every `/api/*` request.
 *
 * Cloudflare Pages Functions get a Web `Request` and return a Web `Response`,
 * which is exactly the contract `server/api.ts` is written against, so this
 * file is a three-line bridge and nothing else. There is no second
 * implementation to keep in sync.
 *
 * Deployed automatically from this directory. Local development uses the
 * Express adapter (`npm run dev`) instead — either way it is the same routes.
 */
import { handleApiRequest, type ApiEnv } from '../../server/api';

/** Minimal structural typing, so the build does not need workers-types. */
interface PagesContext {
  request: Request;
  env: Record<string, unknown>;
  next: () => Promise<Response>;
  params: Record<string, string | string[]>;
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const env: ApiEnv = {};
  for (const [key, value] of Object.entries(context.env || {})) {
    if (typeof value === 'string') (env as Record<string, string>)[key] = value;
  }
  return handleApiRequest(context.request, env);
};
