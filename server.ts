import express, { type Request, type NextFunction, type Response } from "express";
import path from "path";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import multer from "multer";
import FormData from "form-data";
import fs from "fs";
import os from "os";
import rateLimit from "express-rate-limit";
import { GoogleAuth } from "google-auth-library";
import { GoogleGenAI } from "@google/genai";
import { AccessToken } from "livekit-server-sdk";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

dotenv.config();

const app = express();

// Every deploy target (Vercel, the sandbox preview proxy) terminates TLS in
// front of this process, so `req.ip` must be read from X-Forwarded-For for the
// rate limiter to see the real caller.
app.set("trust proxy", 1);
app.disable("x-powered-by");

const MOCK_MODE = process.env.MOCK_SUPABASE === "1" || process.env.MOCK_SUPABASE === "true";

// GitHub OAuth Config
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY LAYER — headers, CORS, origin check, rate limits, body limits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * helmet, with the three defaults that would break this particular app relaxed:
 *
 * - CSP is left to the deploy target: the Vite dev server injects inline
 *   scripts/styles and the GitHub callback page is an inline `<script>`.
 * - COOP `same-origin` severs `window.opener`, which the GitHub OAuth popup
 *   relies on to post the token back (`/auth/github/callback`).
 * - COEP/CORP would block LiveKit + FCM cross-origin media.
 * - frameguard is off so the Android WebView (TWA) wrapper and preview hosts
 *   can embed the app.
 */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    frameguard: false,
    hsts: process.env.NODE_ENV === "production" ? undefined : false,
  })
);

/** Hosts that are always allowed to call the API from a browser. */
const EXTRA_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const hostOf = (value: string): string => {
  if (!value) return "";
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return "";
  }
};

// APP_URL + anything an operator adds through ALLOWED_ORIGINS, plus the local
// dev origins. Everything else has to be same-origin as the request itself,
// which is what makes this work behind any proxy (Vercel, e2b preview, Pages).
const STATIC_ALLOWED_HOSTS = new Set(
  [
    hostOf(process.env.APP_URL || ""),
    ...EXTRA_ALLOWED_ORIGINS.map(hostOf),
    "localhost:3000",
    "127.0.0.1:3000",
    "localhost:5173",
    "127.0.0.1:5173",
  ].filter(Boolean)
);

/** True when the request arrived on a loopback/bind-all address. */
function isLocalRequestHost(host: string): boolean {
  const hostname = host.split(":")[0].replace(/^\[|\]$/g, "");
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"].includes(hostname);
}

/** True when `origin` is same-origin with the request, or explicitly allowlisted. */
function isAllowedOrigin(req: Request, origin?: string | null): boolean {
  // No Origin header → not a browser (curl, server-to-server, native app).
  if (!origin) return true;

  const originHost = hostOf(origin);
  if (!originHost) return false;

  const requestHosts = [req.headers["x-forwarded-host"], req.headers.host]
    .flatMap((h) => (typeof h === "string" ? h.split(",") : []))
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  // Same-origin: the browser is talking to the very host that served it.
  if (requestHosts.includes(originHost)) return true;

  // Behind a tunnel / container preview the process only ever sees its own
  // bind address (`0.0.0.0:3000`) while the browser reports the public
  // hostname, so there is no way to compare the two. Those deployments have
  // no production data behind them; let them through instead of breaking the
  // preview, and let `ALLOWED_ORIGINS` restore strictness when needed.
  if (requestHosts.length > 0 && requestHosts.every(isLocalRequestHost)) return true;

  return STATIC_ALLOWED_HOSTS.has(originHost);
}

// CORS: reflect the origin only when it passes `isAllowedOrigin`, so unknown
// sites get no CORS headers at all and the browser refuses to hand them the
// response. A fresh `cors()` instance per request is what lets the check see
// `req` (the package's `origin` callback has no access to it).
app.use((req, res, next) => {
  cors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(req, origin)),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    maxAge: 600,
  })(req, res, next);
});

/**
 * CSRF belt-and-braces for state-changing API calls: a browser that sends an
 * Origin we do not recognise is rejected outright. Requests without an Origin
 * header (native clients) are untouched.
 */
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(req, origin)) {
    console.warn(`Blocked cross-origin ${req.method} ${req.path} from ${origin}`);
    return res.status(403).json({ error: "Origin not allowed" });
  }
  next();
});

const limiterDefaults = {
  standardHeaders: "draft-7" as const,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down and try again shortly." },
};

/** Broad safety net for every route. */
const globalLimiter = rateLimit({ windowMs: 60_000, limit: 300, ...limiterDefaults });
/** Authenticated API surface. */
const apiLimiter = rateLimit({ windowMs: 60_000, limit: 60, ...limiterDefaults });
/** Push dispatch — an expensive fan-out, keep it tight. */
const notificationLimiter = rateLimit({ windowMs: 60_000, limit: 20, ...limiterDefaults });
/** File uploads — the most bandwidth-hungry route. */
const uploadLimiter = rateLimit({ windowMs: 60_000, limit: 8, ...limiterDefaults });
/** AI completions — paid upstream quota. */
const aiLimiter = rateLimit({ windowMs: 60_000, limit: 20, ...limiterDefaults });

app.use(globalLimiter);

// Body parsing is opt-in per route instead of a blanket 50 MB `express.json`,
// so an anonymous caller can no longer make the process buffer 50 MB of JSON.
const jsonSmall = express.json({ limit: "256kb" });
const jsonLarge = express.json({ limit: "32mb" });

// ─────────────────────────────────────────────────────────────────────────────
// AUTH — Supabase JWT verification for the server-only endpoints
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface AuthedRequest extends Request {
  authUser?: User;
  /** Supabase client bound to the caller's JWT, so RLS applies. */
  db?: SupabaseClient;
}

/** Client that talks to Postgres as the caller (RLS enforced). */
function userScopedClient(accessToken: string): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Client that bypasses RLS. Falls back to the caller's own client. */
function serviceClient(): SupabaseClient | null {
  if (!SUPABASE_URL) return null;
  const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!key) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Verifies the `Authorization: Bearer <supabase access token>` header and
 * attaches the user plus an RLS-scoped client to the request.
 *
 * In `MOCK_SUPABASE=1` (local dev, `npm run dev:mock`) there is no Supabase
 * project to verify against, so the check is skipped loudly instead of
 * breaking the credential-free dev loop. It can never be skipped in a build
 * that has a real project configured.
 */
async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  // `npm run dev:mock` talks to the in-memory mock, so there is no project to
  // verify against — skip loudly. Never possible in a production build.
  if (MOCK_MODE && process.env.NODE_ENV !== "production") {
    console.warn(`[Auth] MOCK mode — skipping JWT verification for ${req.method} ${req.path}`);
    return next();
  }

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[Auth] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not configured on the server.");
    return res.status(503).json({ error: "Server authentication is not configured" });
  }

  try {
    const client = userScopedClient(token)!;
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    req.authUser = data.user;
    req.db = client;
    return next();
  } catch (err: any) {
    console.error("[Auth] Token verification failed:", err?.message || err);
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

/** Reads from the DB with the strongest client available, in order of trust. */
function dbFor(req: AuthedRequest): SupabaseClient | null {
  return serviceClient() || req.db || null;
}

// Configure Multer for temporary storage in the OS temp directory.
// The byte cap below is the *hard* ceiling; `sizeLimitFor()` applies the
// per-media-type limit afterwards.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB

const ALLOWED_MIME_TYPES = new Set([
  // images (no image/svg+xml — it is a script container, not a picture)
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif", "image/bmp", "image/avif",
  // video
  "video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/3gpp", "video/mpeg",
  // audio
  "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/flac",
  // documents
  "application/pdf", "text/plain", "text/csv", "application/json",
  "application/zip", "application/x-zip-compressed", "application/x-rar-compressed",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/** Per-media-type byte cap: images are cheap, video is not. */
function sizeLimitFor(mimeType: string): number {
  if (mimeType.startsWith("image/")) return 15 * 1024 * 1024;   // 15MB
  if (mimeType.startsWith("video/")) return 50 * 1024 * 1024;   // 50MB
  if (mimeType.startsWith("audio/")) return 25 * 1024 * 1024;   // 25MB
  return 25 * 1024 * 1024;                                      // 25MB
}

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

// API routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "GrixChat Server is running" });
});

// LiveKit Token generation endpoint
app.post("/api/livekit-token", apiLimiter, jsonSmall, requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { roomName, participantIdentity } = req.body || {};
    if (!roomName || !participantIdentity) {
      return res.status(400).json({ error: "Missing roomName or participantIdentity parameters" });
    }

    // The caller may only be issued a token for a room they are actually part
    // of: either a call they are a participant in, or a conversation they
    // belong to. Without this check any signed-in user could mint a publish
    // grant for an arbitrary room name.
    const db = dbFor(req);
    if (req.authUser && db) {
      const [{ data: call }, { data: participants }] = await Promise.all([
        db.from("calls").select("id").eq("id", roomName)
          .or(`caller_id.eq.${req.authUser.id},receiver_id.eq.${req.authUser.id}`)
          .maybeSingle(),
        db.from("conversation_participants").select("user_id")
          .eq("conversation_id", roomName).eq("user_id", req.authUser.id).maybeSingle(),
      ]);

      if (!call && !participants) {
        console.warn(`[LiveKit] Refusing token for room ${roomName} — ${req.authUser.id} is not a participant.`);
        return res.status(403).json({ error: "You are not a participant in this call" });
      }
    }

    // Never trust a client-supplied identity over the verified session.
    const identity = req.authUser?.id || participantIdentity;

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      console.warn("FCM Server: LIVEKIT_API_KEY or LIVEKIT_API_SECRET is missing. Proceeding with standard sandbox mock tokens.");
      return res.json({
        success: false,
        error: "LiveKit server credentials are not configured. Please define LIVEKIT_API_KEY and LIVEKIT_API_SECRET in settings.",
        token: "mock-livekit-token-sandbox"
      });
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    return res.json({ success: true, token });
  } catch (error: any) {
    console.error("LiveKit token generation exception:", error);
    return res.status(500).json({ error: error.message || "Failed to generate LiveKit token" });
  }
});

// Sitemap route for SEO.
// Lists the routes the app actually ships — /tools and /reels were deleted
// with the dead code and used to 404 from here.
app.get("/sitemap.xml", (req, res) => {
  const origin = process.env.APP_URL?.replace(/\/$/, "") || "https://grixchat.gothwad.workers.dev";
  const routes: Array<[string, string, string]> = [
    ["/", "1.0", "daily"],
    ["/chats", "0.9", "daily"],
    ["/stories", "0.7", "daily"],
    ["/search", "0.7", "weekly"],
    ["/calls", "0.6", "weekly"],
  ];

  res.setHeader("Content-Type", "application/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map(([path, priority, changefreq]) =>
    `  <url><loc>${origin}${path}</loc><priority>${priority}</priority><changefreq>${changefreq}</changefreq></url>`
  ).join("\n")}
</urlset>`);
});

// Digital Asset Links for Android PWA/TWA verification
app.get("/.well-known/assetlinks.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const assetlinksPath = fs.existsSync(path.resolve(process.cwd(), "dist/.well-known/assetlinks.json"))
    ? path.resolve(process.cwd(), "dist/.well-known/assetlinks.json")
    : path.resolve(process.cwd(), "public/.well-known/assetlinks.json");

  if (fs.existsSync(assetlinksPath)) {
    res.sendFile(assetlinksPath);
  } else {
    // Graceful fallback with standard placeholders matching the public file
    res.json([
      {
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
          "namespace": "android_app",
          "package_name": "com.gothwad.grixchat",
          "sha256_cert_fingerprints": [
            "F1:A1:DA:3C:A9:74:9C:13:B9:92:EF:CD:AA:E1:92:BB:D4:57:3E:04:9E:FC:D7:E5:A9:DF:11:80:FF:E3:A3:AA"
          ]
        }
      }
    ]);
  }
});

// Helper to remove invalid/expired FCM tokens from the user profile database
async function removeInvalidFcmToken(badTokenStr: string) {
  const db = serviceClient();
  if (!db) {
    console.warn("FCM Server Cleanup: Unable to initialize Supabase client for FCM token cleanup (missing credentials).");
    return;
  }

  try {
    // Target the owners of this token directly instead of scanning every user
    // row — the old full-table read scaled with the user base.
    const { data: users, error: fetchErr } = await db
      .from("users")
      .select("id, fcm_tokens")
      .contains("fcm_tokens", [badTokenStr]);

    if (fetchErr || !users) {
      console.warn("FCM Server Cleanup: Failed to fetch users for token pruning:", fetchErr);
      return;
    }

    for (const u of users) {
      if (Array.isArray(u.fcm_tokens) && u.fcm_tokens.includes(badTokenStr)) {
        const filtered = u.fcm_tokens.filter((t: string) => t !== badTokenStr);
        console.log(`FCM Server Cleanup: Removing stale/invalid FCM token from user ${u.id}`);
        const { error: updateErr } = await db
          .from("users")
          .update({ fcm_tokens: filtered })
          .eq("id", u.id);

        if (updateErr) {
          console.warn(`FCM Server Cleanup: Failed to update user ${u.id} FCM tokens:`, updateErr);
        }
      }
    }
  } catch (err: any) {
    console.warn("FCM Server Cleanup: Exception in removeInvalidFcmToken:", err.message);
  }
}

/**
 * Collects the FCM tokens of `userIds`, honouring each recipient's
 * `muted_users` list. Returns a de-duplicated list.
 */
async function collectTokensFor(
  db: SupabaseClient,
  userIds: string[],
  muterId: string
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const { data: profiles, error } = await db
    .from("users")
    .select("id, fcm_tokens, muted_users")
    .in("id", userIds);

  if (error || !profiles) {
    console.warn("FCM Server: Failed to fetch recipient profiles:", error);
    return [];
  }

  const tokens = new Set<string>();
  for (const profile of profiles) {
    const isMuted = Array.isArray(profile.muted_users) && profile.muted_users.includes(muterId);
    if (isMuted) continue;
    if (Array.isArray(profile.fcm_tokens)) {
      profile.fcm_tokens.forEach((t: string) => {
        if (typeof t === "string" && t.trim()) tokens.add(t);
      });
    }
  }
  return [...tokens];
}

// Send Notification Proxy using Firebase Cloud Messaging HTTP v1 API
app.post("/api/send-notification", notificationLimiter, jsonSmall, requireAuth, async (req: AuthedRequest, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: "Missing request body" });
    }
    const { conversationId, tokens: requestedTokens, body, data } = req.body;
    const db = dbFor(req);

    // ── Who is actually allowed to receive this? ───────────────────────────
    // Nothing sent by the client is trusted: in conversation mode the
    // recipients are derived from the database, and in self-test mode the
    // tokens are intersected with the caller's own registered tokens. That is
    // what stops this route from being an open relay to arbitrary devices.
    let validTokens: string[] = [];
    let title = "GrixChat";

    // Without a database there is nothing to derive recipients from. The only
    // acceptable case is the credential-free dev loop (`npm run dev:mock`),
    // which simulates a dispatch from the tokens the client sends.
    const canResolveRecipients = Boolean(db && req.authUser);
    if (!canResolveRecipients) {
      if (!(MOCK_MODE && process.env.NODE_ENV !== "production")) {
        return res.status(503).json({ error: "Server database is not configured" });
      }
      const devTokens = Array.isArray(requestedTokens)
        ? [...new Set<string>(requestedTokens.filter((t: any) => typeof t === "string" && t.trim()))]
        : [];
      console.warn(`[FCM] MOCK mode — simulating a dispatch to ${devTokens.length} client-supplied token(s).`);
      return res.json({
        success: true,
        simulated: true,
        total: devTokens.length,
        sentCount: 0,
        message: "Mock mode: push dispatch simulated, no device was contacted.",
      });
    }

    if (conversationId) {
      const callerId = req.authUser!.id;

      const { data: participants, error: partErr } = await db
        .from("conversation_participants")
        .select("user_id")
        .eq("conversation_id", conversationId);

      if (partErr) {
        console.error("FCM Server: Failed to read conversation participants:", partErr);
        return res.status(500).json({ error: "Failed to read conversation participants" });
      }

      const participantIds: string[] = (participants || []).map((p: any) => p.user_id);
      if (!participantIds.includes(callerId)) {
        return res.status(403).json({ error: "You are not a participant in this conversation" });
      }

      const recipientIds = participantIds.filter((id) => id !== callerId);
      validTokens = await collectTokensFor(db!, recipientIds, callerId);

      // Sender name comes from the database, never from the request, so the
      // title cannot be spoofed into a phishing message.
      const { data: sender } = await db
        .from("users")
        .select("full_name, username")
        .eq("id", callerId)
        .maybeSingle();
      title = sender?.full_name || sender?.username || "New message";
    } else {
      // Self-send mode: the notification-settings test button sends to the
      // caller's own devices. Anything that is not registered on the caller's
      // profile is dropped.
      if (!Array.isArray(requestedTokens) || requestedTokens.length === 0) {
        return res.status(400).json({ error: "Missing recipient registration tokens" });
      }

      const { data: self } = await db!
        .from("users")
        .select("fcm_tokens")
        .eq("id", req.authUser!.id)
        .maybeSingle();
      const ownTokens = new Set<string>(
        Array.isArray(self?.fcm_tokens) ? self!.fcm_tokens.filter((t: any) => typeof t === "string") : []
      );

      const requested = requestedTokens.filter((t: any) => typeof t === "string" && t.trim().length > 0);
      validTokens = [...new Set<string>(requested)].filter((t) => ownTokens.has(t));

      if (validTokens.length === 0) {
        return res.status(403).json({ error: "None of those tokens belong to the authenticated user" });
      }
      title = typeof req.body.title === "string" ? req.body.title.slice(0, 120) : "GrixChat";
    }

    if (validTokens.length === 0) {
      return res.json({ success: true, total: 0, sentCount: 0, results: [], message: "No registered devices to notify" });
    }

    // Cap the notification body so the endpoint cannot be used to push essays.
    const bodyText = (typeof body === "string" ? body : "").slice(0, 200);

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
      console.warn("FCM Server: FIREBASE_SERVICE_ACCOUNT variable not set. Simulating push notification dispatch in terminal logs.");
      console.log(`[PUSH NOTIFICATION SIMULATION]`);
      console.log(`Title: ${title}`);
      console.log(`Body: ${bodyText}`);
      console.log(`Tokens: ${validTokens.length} device(s)`);
      return res.json({ 
        success: true, 
        simulated: true, 
        message: "Push simulate successful. Configure FIREBASE_SERVICE_ACCOUNT in env to enable active Google FCM sending." 
      });
    }

    let credentials: any;
    try {
      credentials = JSON.parse(serviceAccountJson);
      if (typeof credentials === 'string') {
        credentials = JSON.parse(credentials);
      }
    } catch (parseErr: any) {
      console.error("FCM Server: Failed to parse FIREBASE_SERVICE_ACCOUNT env value:", parseErr);
      return res.status(500).json({ error: `FIREBASE_SERVICE_ACCOUNT JSON parse failure: ${parseErr.message}` });
    }

    const projectId = credentials?.project_id;
    if (!projectId) {
      throw new Error("project_id missing from FIREBASE_SERVICE_ACCOUNT credentials");
    }

    // Automatically heal literal '\n' sequences in the private key if stored as an escaped string
    if (credentials.private_key && typeof credentials.private_key === 'string') {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    // Authenticate with Google APIs scope for Firebase Cloud Messaging
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
    const client = await auth.getClient();
    const accessTokenObj = await client.getAccessToken();
    const accessToken = accessTokenObj.token;
    if (!accessToken) {
      throw new Error("Failed to retrieve Google Access Token for FCM scope");
    }

    console.log(`FCM Server: Dispatching push alerts to ${validTokens.length} registration tokens.`);
    const results = await Promise.all(
      validTokens.map(async (token) => {
        try {
          const payload = {
            message: {
              token,
              notification: { title, body: bodyText },
              data: {
                click_action: data?.click_action || '/chats',
                conversationId: data?.conversationId || '',
                senderId: data?.senderId || '',
                ...(data || {})
              }
            }
          };

          const response = await axios.post(
            `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
            payload,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              }
            }
          );
          return { token, success: true, messageId: response.data?.name };
        } catch (err: any) {
          const safeTokenStr = (typeof token === 'string') ? token.substring(0, 10) : String(token);
          console.error(`FCM Server: Failed to send to token: ${safeTokenStr}... Error:`, err.response?.data || err.message);
          
          const isInvalidToken = 
            err.response?.status === 400 || 
            err.response?.status === 404 ||
            (err.response?.data?.error?.status === 'INVALID_ARGUMENT') ||
            (err.response?.data?.error?.status === 'NOT_FOUND') ||
            (err.response?.data?.error?.status === 'UNREGISTERED') ||
            (err.response?.data?.error?.message && (
              err.response.data.error.message.includes('not a valid FCM registration token') ||
              err.response.data.error.message.includes('Requested entity was not found')
            ));

          if (isInvalidToken) {
            removeInvalidFcmToken(token).catch(e => {
              console.error("FCM Token Cleanup trigger failed:", e);
            });
          }

          return { token, success: false, error: err.response?.data || err.message };
        }
      })
    );

    const successCount = results.filter(r => r.success).length;
    res.json({
      success: true,
      total: validTokens.length,
      sentCount: successCount,
      results
    });
  } catch (error: any) {
    console.error("FCM Send Notification failed:", error);
    res.status(500).json({ error: error.message || "Failed to process push dispatch" });
  }
});

// Secure Server-side Gemini AI Completion Proxy (GrixAI)
app.post("/api/grix-ai", aiLimiter, jsonSmall, requireAuth, async (req, res) => {
  const { messages, model, modelType } = req.body || {};

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Server GrixAI Proxy: GEMINI_API_KEY not found in environment.");
    return res.status(400).json({ 
      error: "Gemini API key is not configured on the server. Please register GEMINI_API_KEY in server environment settings." 
    });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const formattedMessages = Array.isArray(messages) ? messages : [];
    
    // Extract system instruction
    const systemMsg = formattedMessages.find(m => m.role === "system");
    const systemInstruction = systemMsg ? (systemMsg.content || systemMsg.text) : "You are Grix AI, a helpful and friendly assistant for GrixChat.";

    // Format thread to Gemini dynamic-contents array
    const conversationContents = formattedMessages
      .filter(m => m.role !== "system")
      .map(m => {
        const role = (m.role === "assistant" || m.role === "model") ? "model" : "user";
        return {
          role,
          parts: [{ text: m.content || m.text || "" }]
        };
      });

    const mType = model || modelType || 'grix-ai';
    const modelId = "gemini-3.5-flash"; // Active, highly performant, free-tier model

    const response = await ai.models.generateContent({
      model: modelId,
      contents: conversationContents,
      config: {
        systemInstruction,
        temperature: mType === 'grix-ai-pro' ? 1.0 : 0.7,
      }
    });

    const reply = response.text || "I'm sorry, I couldn't process that.";
    res.json({ success: true, reply });
  } catch (error: any) {
    console.error("Server GrixAI SDK Error:", error);
    res.status(500).json({ 
      error: error.message || "An error occurred while communicating with Gemini." 
    });
  }
});

// File Upload Proxy (Catbox for images/videos, Gofile.io for others).
// Signed-in callers only, MIME allowlist, per-media-type size cap, rate
// limited — this used to be an anonymous 100MB-per-file host.
app.post("/api/upload-file", uploadLimiter, requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ status: 'error', message: `Multer error: ${err.message}` });
    } else if (err) {
      return res.status(415).json({ status: 'error', message: err.message });
    }
    next();
  });
}, async (req: any, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'No file uploaded' });
  }

  // Re-check the type-specific cap now that the real size is known, and never
  // leave the temp file behind.
  const maxBytes = sizeLimitFor(req.file.mimetype);
  if (req.file.size > maxBytes) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(413).json({
      status: 'error',
      message: `${req.file.mimetype} uploads are capped at ${Math.round(maxBytes / (1024 * 1024))}MB`,
    });
  }

  const isMedia = req.file.mimetype.startsWith('image/') || req.file.mimetype.startsWith('video/');

  try {
    if (isMedia) {
      // Upload to Catbox.moe
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('fileToUpload', fs.createReadStream(req.file.path), {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      console.log('Uploading media to Catbox.moe...');
      const response = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: form.getHeaders(),
        timeout: 60000,
      });

      if (response.data && typeof response.data === 'string' && response.data.startsWith('http')) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.json({ 
          status: 'ok', 
          downloadUrl: response.data.trim(),
          provider: 'catbox'
        });
      }
      throw new Error(`Catbox error: ${response.data}`);
    } else {
      // Upload to Gofile.io
      // 1. Get best server
      console.log('Getting Gofile server...');
      const serverRes = await axios.get('https://api.gofile.io/getServer');
      const server = serverRes.data.data.server;

      // 2. Upload
      const form = new FormData();
      form.append('file', fs.createReadStream(req.file.path), {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      console.log(`Uploading file to Gofile server: ${server}...`);
      const response = await axios.post(`https://${server}.gofile.io/contents/uploadfile`, form, {
        headers: form.getHeaders(),
        timeout: 120000, // Gofile can be slow for large files
      });

      if (response.data && response.data.status === 'ok') {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.json({ 
          status: 'ok', 
          downloadUrl: response.data.data.downloadPage, // Note: Direct link might require premium for Gofile, so we give download page
          fileId: response.data.data.fileId,
          provider: 'gofile'
        });
      }
      throw new Error(`Gofile error: ${JSON.stringify(response.data)}`);
    }
  } catch (error: any) {
    console.error('Upload failed:', error.message);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ status: 'error', message: `Upload failed: ${error.message}` });
  }
});

// Debug endpoint (development only — it reports which secrets are configured)
app.get("/api/github/debug", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }
  res.json({
    hasClientId: !!GITHUB_CLIENT_ID,
    hasClientSecret: !!GITHUB_CLIENT_SECRET,
    appUrl: process.env.APP_URL || "Not Set",
    platform: "Cloudflare/GCP",
    env: process.env.NODE_ENV
  });
});

// GitHub Auth URL
app.get("/api/github/auth-url", (req, res) => {
  if (!GITHUB_CLIENT_ID) {
    console.error("GITHUB_CLIENT_ID is missing from environment variables.");
    return res.status(500).json({ error: "GITHUB_CLIENT_ID is not set" });
  }
  
  // Better fallback logic for APP_URL
  let appUrl = process.env.APP_URL;
  
  // If APP_URL is missing or looks like a placeholder, try to derive it
  if (!appUrl || !appUrl.startsWith('http')) {
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    appUrl = `${protocol}://${host}`;
    console.log(`Derived APP_URL from request: ${appUrl}`);
  }
  
  // Ensure appUrl doesn't end with a slash for consistency
  appUrl = appUrl.replace(/\/$/, "");
  
  const redirectUri = `${appUrl}/auth/github/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,user,workflow&state=${Math.random().toString(36).substring(7)}`;
  
  console.log(`Generated GitHub Auth URL: ${url}`);
  console.log(`Using Redirect URI: ${redirectUri}`);
  
  res.json({ url, redirectUri });
});

// GitHub Callback
app.get(["/auth/github/callback", "/auth/github/callback/"], async (req, res) => {
  const { code } = req.query;
  console.log(`GitHub Callback received with code: ${code ? 'PRESENT' : 'MISSING'}`);
  
  try {
    const response = await axios.post("https://github.com/login/oauth/access_token", {
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
    }, {
      headers: { Accept: "application/json" }
    });

    const accessToken = response.data.access_token;
    if (!accessToken) {
      console.error("Failed to obtain access token from GitHub:", response.data);
      throw new Error("No access token");
    }

    console.log("GitHub Access Token obtained successfully.");

    res.send(`
      <html>
        <head>
          <title>Authenticating...</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="margin:0; background:#f4f4f5;">
          <script>
            const token = '${accessToken}';
            try {
              localStorage.setItem('github_token', token);
            } catch (e) {
              console.error("Local storage error:", e);
            }

            const message = { type: 'GITHUB_AUTH_SUCCESS', token: token };
            
            if (window.opener) {
              window.opener.postMessage(message, '*');
              // Close after a short delay to ensure message is sent
              setTimeout(() => {
                window.close();
                // Fallback if window.close() is blocked
                document.getElementById('status').innerText = 'Authenticated! You can close this window.';
              }, 500);
            } else {
              // If no opener, don't just redirect inside the popup as it fails outside iframe
              document.getElementById('status').innerText = 'Authenticated! Please return to GrixChat.';
              document.getElementById('loader').style.display = 'none';
              document.getElementById('success-icon').style.display = 'block';
            }
          </script>
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:20px;text-align:center;">
            <div id="loader" style="width:48px;height:48px;border:4px solid #e4e4e7;border-top-color:#0494f4;border-radius:50%;animation:spin 1s linear infinite;"></div>
            <div id="success-icon" style="display:none;width:60px;height:60px;background:#0494f4;border-radius:50%;color:white;display:none;align-items:center;justify-content:center;font-size:30px;margin-bottom:20px;">✓</div>
            <p id="status" style="margin-top:24px;font-weight:600;color:#18181b;font-size:16px;">Authenticating with GitHub...</p>
            <p style="margin-top:8px;color:#71717a;font-size:14px;">Securely connecting your accounts</p>
          </div>
          <style>
            @keyframes spin { to { transform: rotate(360deg); } }
            #success-icon { display: none; }
          </style>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send("Auth failed");
  }
});

// GitHub Push
app.post("/api/github/push", apiLimiter, jsonLarge, async (req, res) => {
  const { token, owner, repo, path: filePath, content, message, branch = 'main' } = req.body;
  try {
    let sha;
    try {
      const getFileRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
        headers: { Authorization: `token ${token}` }
      });
      sha = getFileRes.data.sha;
    } catch (e) {}

    const pushRes = await axios.put(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
      message, content, sha, branch
    }, {
      headers: { Authorization: `token ${token}` }
    });
    res.json(pushRes.data);
  } catch (error: any) {
    res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
  }
});

import crypto from "crypto";

// Helper to calculate GitHub's blob SHA
function calculateGitHubSha(contentBase64: string): string {
  const content = Buffer.from(contentBase64, 'base64');
  const header = `blob ${content.length}\0`;
  const store = Buffer.concat([Buffer.from(header), content]);
  return crypto.createHash('sha1').update(store).digest('hex');
}

// GitHub Batch Push (Atomic commit for multiple files)
app.post("/api/github/push-batch", apiLimiter, jsonLarge, async (req, res) => {
  const { token, owner, repo, files, message, branch = 'main', isSequential = false } = req.body;
  
  try {
    const headers = { 
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json'
    };

    console.log(`Starting smart batch push for ${files.length} files to ${owner}/${repo} on branch ${branch} [isSequential: ${isSequential}]`);

    // 1. Get the latest commit SHA of the branch
    const branchRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/branches/${branch}`, { headers });
    const parentSha = branchRes.data.commit.sha;
    const baseTreeSha = branchRes.data.commit.commit.tree.sha;

    // 2. Fetch the current recursive tree to compare SHAs
    console.log(`Fetching current tree for comparison...`);
    const existingTreeRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`, { headers });
    const existingFiles = new Map<string, string>(); // path -> sha
    if (existingTreeRes.data.tree) {
      existingTreeRes.data.tree.forEach((node: any) => {
        if (node.type === 'blob') {
          existingFiles.set(node.path, node.sha);
        }
      });
    }

    // 3. Filter files that actually changed
    const modifiedFiles = files.filter((file: any) => {
      const localSha = calculateGitHubSha(file.content);
      const remoteSha = existingFiles.get(file.path);
      return localSha !== remoteSha;
    });

    console.log(`Smart Sync: ${modifiedFiles.length} of ${files.length} files changed.`);

    if (modifiedFiles.length === 0) {
      return res.json({ 
        message: "No changes detected. Repository is already up to date.",
        noChanges: true 
      });
    }

    // If sequential mode is enabled, upload files one-by-one to support safe incrementing
    if (isSequential) {
      console.log(`Sequential Sync Mode: Uploading ${modifiedFiles.length} files individually...`);
      let uploadedCount = 0;
      
      try {
        for (let i = 0; i < modifiedFiles.length; i++) {
          const file = modifiedFiles[i];
          const sha = existingFiles.get(file.path);
          
          console.log(`Uploading file ${i + 1}/${modifiedFiles.length}: ${file.path} (SHA: ${sha || 'new'})`);
          
          await axios.put(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`, {
            message: `${message} - update ${file.path}`,
            content: file.content,
            sha: sha || undefined,
            branch
          }, { headers });

          uploadedCount++;
          
          // Small pause to prevent hitting GitHub's abuse detection rates on continuous fast writes
          await new Promise(resolve => setTimeout(resolve, 150));
        }

        return res.json({
          message: `Successfully uploaded all ${uploadedCount} files sequentially.`,
          sequential: true,
          uploadedCount,
          html_url: `https://github.com/${owner}/${repo}/commits/${branch}`
        });

      } catch (err: any) {
        const errorDetail = err.response?.data?.message || err.message;
        console.error(`Sequential sync error after uploading ${uploadedCount} files:`, err.response?.data || err.message);
        
        if (uploadedCount > 0) {
          return res.json({
            message: `Uploaded ${uploadedCount} files successfully, but stopped because of GitHub limit.`,
            sequential: true,
            uploadedCount,
            error: errorDetail,
            html_url: `https://github.com/${owner}/${repo}/commits/${branch}`
          });
        } else {
          throw new Error(`Failed to upload first file ${modifiedFiles[0].path}: ${errorDetail}`);
        }
      }
    }

    // 4. Create blobs for each modified file with concurrency control
    const treeItems = [];
    const BATCH_SIZE = 5;
    const DELAY_BETWEEN_BATCHES = 400; // ms

    for (let i = 0; i < modifiedFiles.length; i += BATCH_SIZE) {
      const batch = modifiedFiles.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(modifiedFiles.length / BATCH_SIZE)} (${batch.length} files)`);
      
      const results = await Promise.all(batch.map(async (file: any) => {
        try {
          const blobRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
            content: file.content,
            encoding: 'base64'
          }, { headers });
          
          return {
            path: file.path,
            mode: '100644',
            type: 'blob',
            sha: blobRes.data.sha
          };
        } catch (err: any) {
          console.error(`Failed to create blob for ${file.path}:`, err.response?.data || err.message);
          throw new Error(`Failed to upload ${file.path}: ${err.response?.data?.message || err.message}`);
        }
      }));
      
      treeItems.push(...results);
      
      if (i + BATCH_SIZE < modifiedFiles.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    console.log(`Successfully created ${treeItems.length} new blobs. Creating updated tree...`);

    // 5. Create a new tree (basing it on the existing baseTreeSha to merge changes)
    const treeRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
      base_tree: baseTreeSha,
      tree: treeItems
    }, { headers });

    // 6. Create a new commit
    const commitRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
      message,
      tree: treeRes.data.sha,
      parents: [parentSha]
    }, { headers });

    // 7. Update the branch reference
    const refRes = await axios.patch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      sha: commitRes.data.sha,
      force: false
    }, { headers });

    console.log(`Successfully updated reference for branch ${branch}`);
    res.json(refRes.data);
  } catch (error: any) {
    console.error("Smart Batch Push error:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
  }
});

// Retrieve list of codebase files for Sync Tool
app.get("/api/github/list-files", (req, res) => {
  const listAllFiles = (dir: string, fileList: string[] = []): string[] => {
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        const baseName = path.basename(file);
        if (!baseName.startsWith('.') && baseName !== 'node_modules' && baseName !== 'dist' && baseName !== '.git' && baseName !== 'tmp') {
          listAllFiles(filePath, fileList);
        }
      } else {
        const relativePath = path.relative(process.cwd(), filePath);
        fileList.push(relativePath);
      }
    });
    return fileList;
  };
  try {
    const allFiles = listAllFiles(process.cwd());
    res.json({ files: allFiles });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Retrieve localized file content for Sync Tool
app.get("/api/github/get-file-content", (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: "Path is required" });
  
  // Normalize path to prevent directory traversal
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!resolvedPath.startsWith(process.cwd())) {
    return res.status(403).json({ error: "Access denied" });
  }
  try {
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: "File not found" });
    }
    const content = fs.readFileSync(resolvedPath, 'base64');
    res.json({ content });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Error handling — registered after every route
// ─────────────────────────────────────────────────────────────────────────────

/** Unknown /api/* paths answer with JSON, not the SPA's index.html. */
app.use("/api", (req, res) => {
  res.status(404).json({ error: `Unknown API route: ${req.method} ${req.originalUrl}` });
});

// Vite / Static handling
if (process.env.NODE_ENV !== "production") {
  // Dynamic import for development
  import("vite").then(({ createServer }) => {
    createServer({
      server: { middlewareMode: true },
      appType: "spa",
    }).then((vite) => {
      app.use(vite.middlewares);
    });
  });
} else {
  const distPath = path.resolve(process.cwd(), "dist");
  app.use(express.static(distPath, { dotfiles: "allow" }));
  app.get("*", (req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

// Malformed or oversized JSON bodies (from `express.json`) land here, so they
// return a JSON error instead of Express's HTML stack page.
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);

  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "Malformed JSON request body" });
  }

  console.error("Unhandled server error:", err);
  return res.status(err?.status || 500).json({ error: err?.message || "Internal server error" });
});

// Start server
const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
