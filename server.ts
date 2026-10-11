/**
 * Node adapter for the GrixChat API.
 *
 * All route logic lives in `server/api.ts` and is shared byte-for-byte with the
 * Cloudflare Pages Functions in `functions/`. This file only does the plumbing
 * a Node host needs:
 *
 *   - `npm run dev` / `dev:mock`  → Vite middleware mode + the API
 *   - `npm run start`             → serves `dist/` + the API
 *
 * Production runs on **Cloudflare Pages** (static `dist/` + `functions/api`),
 * so treat this as the development and self-hosting path.
 */
import express, { type Request as ExpressRequest, type Response as ExpressResponse } from 'express';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { handleApiRequest, SECURITY_HEADERS, type ApiEnv, type RepoFsCapability } from './server/api';

dotenv.config();

const app = express();
app.disable('x-powered-by');
// Behind Cloudflare/tunnels TLS terminates upstream, so `req.protocol` has to
// read `x-forwarded-proto` to build correct absolute URLs.
app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────────────────────────
// Environment + the one Node-only capability the API uses
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = process.cwd();

/** Repository Sync Tool support — reads the checked-out source tree. */
const REPO_FS: RepoFsCapability = {
  root: REPO_ROOT,
  listFiles() {
    const skipDir = new Set(['.git', 'node_modules', 'dist', 'tmp', '.next', 'coverage']);
    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || skipDir.has(entry.name)) continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(absolute, acc);
        else acc.push(path.relative(REPO_ROOT, absolute));
      }
      return acc;
    };
    return walk(REPO_ROOT);
  },
  readFileBase64(relativePath: string) {
    // Resolve first, then verify — that is what stops `../../etc/passwd`.
    const resolved = path.resolve(REPO_ROOT, relativePath);
    if (resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + path.sep)) return null;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
    return fs.readFileSync(resolved, 'base64');
  },
};

function buildEnv(): ApiEnv {
  return {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT,
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    APP_URL: process.env.APP_URL,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    MOCK_SUPABASE: process.env.MOCK_SUPABASE,
    NODE_ENV: process.env.NODE_ENV,
    REPO_FS,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Express → Fetch adapter
// ─────────────────────────────────────────────────────────────────────────────

/** Paths owned by the shared API. Everything else falls through to Vite/dist. */
const API_PREFIXES = ['/api', '/auth/github'];

const ownsPath = (url: string) =>
  API_PREFIXES.some((prefix) => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`));

/**
 * Raw bodies for the API paths only: the shared core needs the untouched bytes
 * (multipart uploads included) and does its own size checking per route.
 */
const rawBody = express.raw({ type: () => true, limit: '32mb' });

app.use(async (req: ExpressRequest, res: ExpressResponse, next) => {
  if (!ownsPath(req.originalUrl)) return next();

  rawBody(req, res, async (err: any) => {
    if (err) {
      const tooLarge = err?.type === 'entity.too.large';
      res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'Request body too large' : 'Invalid request body' });
      return;
    }

    // Same code path as Cloudflare: one Fetch `Request` in, one `Response` out.
    const url = `${req.protocol}://${req.get('host') || req.headers.host || 'localhost'}${req.originalUrl}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value);
      else if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    }

    const init: RequestInit = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD' && Buffer.isBuffer(req.body) && req.body.length > 0) {
      init.body = req.body as unknown as BodyInit;
    }

    try {
      const response = await handleApiRequest(new Request(url, init), buildEnv());

      res.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value);
      });

      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    } catch (error: any) {
      console.error('API adapter error:', error);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// Security headers for anything this process serves directly. Production is on
// Cloudflare Pages, where `public/_headers` does the same job for static files.
app.use((_req, res, next) => {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Frontend
// ─────────────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  import('vite').then(({ createServer }) => {
    createServer({ server: { middlewareMode: true }, appType: 'spa' }).then((vite) => {
      app.use(vite.middlewares);
    });
  });
} else {
  const distPath = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distPath, { dotfiles: 'allow' }));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
}

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GrixChat dev server on http://localhost:${PORT}`);
  console.log('  API routes: /api/*  ·  GitHub OAuth: /auth/github/callback');
  console.log('  Production target: Cloudflare Pages (see docs/DEV_SETUP.md)');
});

export default app;
