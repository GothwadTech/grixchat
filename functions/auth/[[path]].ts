/**
 * Cloudflare Pages Function — `/auth/github/callback`.
 *
 * The GitHub OAuth redirect cannot go through the `/api` prefix, so it gets its
 * own root. Both this file and `functions/api/[[path]].ts` hand straight to the
 * shared router in `server/api.ts`.
 */
import { handleApiRequest, type ApiEnv } from '../../server/api';

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
