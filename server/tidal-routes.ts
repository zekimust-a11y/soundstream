import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type TidalTokens = {
  accessToken: string;
  refreshToken?: string;
  userId?: string;
  obtainedAt?: number;
};

type TidalAuthSession = {
  createdAt: number;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  state: string;
  platform: "web" | "mobile";
};

const TIDAL_TOKENS_FILE = path.resolve(process.cwd(), ".tidal-tokens.json");

// Fallback client IDs (these must be valid TIDAL developer client IDs)
const TIDAL_FALLBACK_IDS = [
  "pUlCxd80DuDSem4J",
  "7m7Ap0JC9j1cOM3n",
  "zU4XHVVkc2tDP8X",
  "OmDtrzFZSg8Ff2e",
  "KMZrGg3rJQJcZz9",
];

let currentClientIdIndex = 0;
let tokens: TidalTokens | null = null;
const sessionsByState = new Map<string, TidalAuthSession>();

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function generateCodeVerifier(): string {
  return base64Url(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64Url(hash);
}

function getClientId(): string {
  // Allow override via env if you have a single canonical client id.
  const envId = process.env.TIDAL_CLIENT_ID;
  if (envId && envId.trim()) return envId.trim();
  return TIDAL_FALLBACK_IDS[currentClientIdIndex] || TIDAL_FALLBACK_IDS[0];
}

function clampClientIdIndex(idx: number): number {
  if (!Number.isFinite(idx)) return 0;
  const max = TIDAL_FALLBACK_IDS.length - 1;
  return Math.max(0, Math.min(max, Math.floor(idx)));
}

function cycleClientId(): { clientId: string; index: number } {
  currentClientIdIndex = (currentClientIdIndex + 1) % TIDAL_FALLBACK_IDS.length;
  return { clientId: getClientId(), index: currentClientIdIndex };
}

function resolveClientIdFromRequest(req: Request): { clientId: string; index: number } {
  // If env var is set, always use it (no rotation).
  const envId = process.env.TIDAL_CLIENT_ID;
  if (envId && envId.trim()) return { clientId: envId.trim(), index: -1 };

  const q: any = req.query || {};
  const idxRaw = q.clientIdIndex;
  if (idxRaw !== undefined) {
    const idx = clampClientIdIndex(parseInt(String(idxRaw), 10));
    return { clientId: TIDAL_FALLBACK_IDS[idx], index: idx };
  }

  const idRaw = q.clientId;
  if (typeof idRaw === "string" && idRaw.trim()) {
    const wanted = idRaw.trim();
    const idx = TIDAL_FALLBACK_IDS.indexOf(wanted);
    if (idx >= 0) return { clientId: wanted, index: idx };
  }

  return { clientId: getClientId(), index: currentClientIdIndex };
}

function loadTokensFromDisk(): void {
  try {
    if (!fs.existsSync(TIDAL_TOKENS_FILE)) return;
    const raw = fs.readFileSync(TIDAL_TOKENS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as TidalTokens;
    if (parsed?.accessToken) {
      // Backfill userId if missing (common when TIDAL doesn't return it in token response).
      const derivedUserId = parsed.userId || deriveUserIdFromAccessToken(parsed.accessToken);
      tokens = derivedUserId ? { ...parsed, userId: derivedUserId } : parsed;
      if (derivedUserId && derivedUserId !== parsed.userId) {
        saveTokensToDisk();
        console.log("[Tidal] Loaded tokens from disk (derived userId from access token)");
      } else {
        console.log("[Tidal] Loaded tokens from disk");
      }
    }
  } catch (e) {
    console.warn("[Tidal] Failed to load tokens:", e instanceof Error ? e.message : String(e));
  }
}

function saveTokensToDisk(): void {
  try {
    if (!tokens?.accessToken) return;
    fs.writeFileSync(TIDAL_TOKENS_FILE, JSON.stringify(tokens, null, 2), "utf-8");
  } catch (e) {
    console.warn("[Tidal] Failed to save tokens:", e instanceof Error ? e.message : String(e));
  }
}

function clearTokensOnDisk(): void {
  try {
    if (fs.existsSync(TIDAL_TOKENS_FILE)) fs.unlinkSync(TIDAL_TOKENS_FILE);
  } catch (e) {
    // ignore
  }
}

async function fetchTidalUserId(accessToken: string): Promise<string | undefined> {
  // api.tidal.com v1 endpoint is a convenient way to get the user id
  try {
    const resp = await fetch("https://api.tidal.com/v1/users/me?countryCode=US", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return undefined;
    const data: any = await resp.json();
    const id = data?.id ?? data?.userId ?? data?.user?.id;
    return id ? String(id) : undefined;
  } catch {
    return undefined;
  }
}

function deriveUserIdFromAccessToken(accessToken: string): string | undefined {
  // TIDAL access tokens are often JWTs. We can decode (without verifying) to extract the `uid` claim,
  // which is the user id required by TIDAL OpenAPI v2 userCollections endpoints.
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return undefined;
    const payloadB64 = parts[1];
    const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
    const json = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    const payload: any = JSON.parse(json);
    const uid = payload?.uid ?? payload?.user_id ?? payload?.userId ?? payload?.id;
    return uid !== undefined && uid !== null ? String(uid) : undefined;
  } catch {
    return undefined;
  }
}

async function exchangeCodeForTokens(session: TidalAuthSession, code: string): Promise<TidalTokens> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: session.clientId,
    redirect_uri: session.redirectUri,
    code_verifier: session.codeVerifier,
  });

  const resp = await fetch("https://login.tidal.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(15000),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Token exchange failed: ${resp.status} - ${text.substring(0, 200)}`);
  }

  const tokenData: any = JSON.parse(text);
  const accessToken = tokenData?.access_token;
  const refreshToken = tokenData?.refresh_token;
  const userId = tokenData?.user?.id ? String(tokenData.user.id) : undefined;
  if (!accessToken) throw new Error("Token exchange succeeded but no access_token returned");

  const finalUserId = userId || deriveUserIdFromAccessToken(accessToken) || (await fetchTidalUserId(accessToken));

  return {
    accessToken,
    refreshToken,
    userId: finalUserId,
    obtainedAt: Date.now(),
  };
}

function requireTokens(res: Response): TidalTokens | null {
  if (!tokens?.accessToken) {
    res.status(401).json({ error: "Not authenticated with Tidal" });
    return null;
  }
  return tokens;
}

// NOTE: OpenAPI endpoints (openapi.tidal.com) use a JSON:API-ish schema with `data` + `included`.
// We return simplified shapes matching the existing Soundstream client usage.
async function openApiGet(url: string, accessToken: string): Promise<any> {
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Tidal OpenAPI error: ${resp.status} - ${text.substring(0, 200)}`);
  return JSON.parse(text);
}

function deriveCountryCodeFromAccessToken(accessToken: string): string | undefined {
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return undefined;
    const payloadB64 = parts[1];
    const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
    const json = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    const payload: any = JSON.parse(json);
    const cc = payload?.cc;
    return typeof cc === "string" && cc.trim() ? cc.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function tidalApiGet(
  pathWithQuery: string,
  accessToken: string,
  countryCode: string
): Promise<{ status: number; json?: any; text: string }> {
  const baseUrl = "https://api.tidal.com";
  const url = `${baseUrl}${pathWithQuery}${pathWithQuery.includes("?") ? "&" : "?"}countryCode=${encodeURIComponent(
    countryCode
  )}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.tidal.v1+json",
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await resp.text();
  let json: any | undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: resp.status, json, text };
}

function isMissingRUsrScope(body: any): boolean {
  const s = typeof body === "string" ? body : JSON.stringify(body || {});
  return s.includes("missing_scope") && s.includes("r_usr");
}

function pickArtworkUrl(artwork: any, preferred = "320x320"): string | null {
  const files: any[] = artwork?.attributes?.files;
  if (!Array.isArray(files)) return null;
  const preferredFile = files.find((f) => typeof f?.href === "string" && f.href.includes(preferred));
  const first = files.find((f) => typeof f?.href === "string");
  return (preferredFile?.href || first?.href || null) as string | null;
}

export function registerTidalRoutes(app: Express): void {
  loadTokensFromDisk();

  app.get("/api/tidal/client-id", (_req: Request, res: Response) => {
    res.json({
      clientId: getClientId(),
      clientIdIndex: process.env.TIDAL_CLIENT_ID ? null : currentClientIdIndex,
      usingEnv: !!process.env.TIDAL_CLIENT_ID,
      fallbackIds: process.env.TIDAL_CLIENT_ID ? null : TIDAL_FALLBACK_IDS,
    });
  });

  app.post("/api/tidal/client-id/cycle", (_req: Request, res: Response) => {
    const rotated = cycleClientId();
    res.json({
      clientId: rotated.clientId,
      clientIdIndex: process.env.TIDAL_CLIENT_ID ? null : rotated.index,
      usingEnv: !!process.env.TIDAL_CLIENT_ID,
    });
  });

  // Generate OAuth authorization URL (PKCE)
  app.get("/api/tidal/auth-url", (req: Request, res: Response) => {
    const platform = (String(req.query.platform || "").toLowerCase() === "web" ? "web" : "mobile") as
      | "web"
      | "mobile";

    const cycle = String((req.query as any).cycle || "").toLowerCase();
    if (cycle === "1" || cycle === "true" || cycle === "yes") {
      cycleClientId();
    }
    const { clientId, index: clientIdIndex } = resolveClientIdFromRequest(req);
    const redirectUri =
      platform === "web"
        ? `${req.protocol}://${req.get("host")}/api/tidal/callback`
        : "soundstream://callback";

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString("hex");

    const preset = String(req.query.preset || "modern").toLowerCase();
    // `preset=legacy` opts into the legacy scope that some api.tidal.com endpoints require.
    // Warning: some client IDs may cause OAuth error 1002 when requesting legacy scopes.
    const scope =
      preset === "legacy"
        ? "r_usr"
        : "user.read collection.read collection.write playlists.read playlists.write search.read search.write playback recommendations.read entitlements.read";

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });

    sessionsByState.set(state, {
      createdAt: Date.now(),
      clientId,
      redirectUri,
      codeVerifier,
      state,
      platform,
    });

    const authUrl = `https://login.tidal.com/authorize?${params.toString()}`;
    res.json({ authUrl, redirectUri, state, platform, preset, clientId, clientIdIndex });
  });

  // Convenience endpoint: redirect directly to TIDAL authorize URL (useful for manual browser flows).
  app.get("/api/tidal/authorize", (req: Request, res: Response) => {
    const platform = (String(req.query.platform || "").toLowerCase() === "web" ? "web" : "mobile") as
      | "web"
      | "mobile";

    const cycle = String((req.query as any).cycle || "").toLowerCase();
    if (cycle === "1" || cycle === "true" || cycle === "yes") {
      cycleClientId();
    }
    const { clientId } = resolveClientIdFromRequest(req);
    const redirectUri =
      platform === "web"
        ? `${req.protocol}://${req.get("host")}/api/tidal/callback`
        : "soundstream://callback";

    const preset = String(req.query.preset || "modern").toLowerCase();
    const scope =
      preset === "legacy"
        ? "r_usr"
        : "user.read collection.read collection.write playlists.read playlists.write search.read search.write playback recommendations.read entitlements.read";

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString("hex");

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });

    sessionsByState.set(state, {
      createdAt: Date.now(),
      clientId,
      redirectUri,
      codeVerifier,
      state,
      platform,
    });

    const authUrl = `https://login.tidal.com/authorize?${params.toString()}`;
    return res.redirect(authUrl);
  });

  // Web callback handler — exchanges code for tokens and posts them back to opener.
  app.get("/api/tidal/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const error = typeof req.query.error === "string" ? req.query.error : undefined;

    if (error) {
      return res.status(400).send(`<html><body><h2>Tidal auth error</h2><p>${error}</p></body></html>`);
    }
    if (!code) {
      return res.status(400).send(`<html><body><h2>Tidal auth error</h2><p>Missing code</p></body></html>`);
    }
    if (!state || !sessionsByState.has(state)) {
      return res
        .status(400)
        .send(`<html><body><h2>Tidal auth error</h2><p>Invalid or missing state</p></body></html>`);
    }

    try {
      const session = sessionsByState.get(state)!;
      const newTokens = await exchangeCodeForTokens(session, code);
      tokens = newTokens;
      saveTokensToDisk();

      return res.status(200).send(`<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Tidal Connected</title></head>
  <body>
    <h2>Connected to Tidal</h2>
    <p>You can close this window and return to Soundstream.</p>
    <script>
      try {
        if (window.opener && window.opener.postMessage) {
          window.opener.postMessage({ type: 'TIDAL_AUTH_SUCCESS', tokens: ${JSON.stringify(newTokens)} }, '*');
        }
      } catch (e) {}
      setTimeout(() => { try { window.close(); } catch (e) {} }, 500);
    </script>
  </body>
</html>`);
    } catch (e) {
      return res
        .status(500)
        .send(`<html><body><h2>Tidal auth error</h2><pre>${e instanceof Error ? e.message : String(e)}</pre></body></html>`);
    }
  });

  // Mobile (or manual) code exchange endpoint
  app.post("/api/tidal/authenticate", async (req: Request, res: Response) => {
    const body: any = req.body || {};
    const code = typeof body.code === "string" ? body.code : undefined;
    const state = typeof body.state === "string" ? body.state : undefined;

    if (!code) return res.status(400).json({ success: false, error: "Authorization code required" });

    // Prefer state-based session lookup; fallback to most recent session if not provided (legacy clients).
    let session: TidalAuthSession | undefined;
    if (state && sessionsByState.has(state)) {
      session = sessionsByState.get(state);
    } else {
      // Find most recent session (best-effort)
      const newest = Array.from(sessionsByState.values()).sort((a, b) => b.createdAt - a.createdAt)[0];
      session = newest;
    }
    if (!session) return res.status(400).json({ success: false, error: "No OAuth session available. Get auth-url first." });

    try {
      const newTokens = await exchangeCodeForTokens(session, code);
      tokens = newTokens;
      saveTokensToDisk();
      return res.json({ success: true, tokens: newTokens });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Set tokens directly (used by client rehydration)
  app.post("/api/tidal/set-tokens", (req: Request, res: Response) => {
    const body: any = req.body || {};
    const accessToken = typeof body.accessToken === "string" ? body.accessToken : undefined;
    const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : undefined;
    const userId = body.userId !== undefined ? String(body.userId) : undefined;
    if (!accessToken) return res.status(400).json({ success: false, error: "accessToken required" });
    const finalUserId = userId || deriveUserIdFromAccessToken(accessToken);
    tokens = { accessToken, refreshToken, userId: finalUserId, obtainedAt: Date.now() };
    saveTokensToDisk();
    return res.json({ success: true });
  });

  app.get("/api/tidal/status", (_req: Request, res: Response) => {
    const hasTokens = !!tokens?.accessToken;
    res.json({
      authenticated: hasTokens,
      hasTokens,
      userId: tokens?.userId ?? null,
    });
  });

  app.post("/api/tidal/disconnect", (_req: Request, res: Response) => {
    tokens = null;
    clearTokensOnDisk();
    res.json({ success: true });
  });

  // Content endpoints (browse via TIDAL API; playback is handled by sending tidal:// URIs to LMS)
  app.get("/api/tidal/mixes", async (_req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });
    // TODO: Implement via api.tidal.com once we confirm the correct mixes endpoint for THIRD_PARTY tokens.
    return res.json({ items: [], total: 0 });
  });

  app.get("/api/tidal/albums", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });

    const limit = Math.min(5000, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10));
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const resp = await tidalApiGet(
        `/v2/users/${encodeURIComponent(t.userId)}/favorites/albums?limit=${limit}&offset=${offset}`,
        t.accessToken,
        countryCode
      );
      if (resp.status === 403 && isMissingRUsrScope(resp.json || resp.text)) {
        return res.status(409).json({
          error: "Tidal token missing required legacy scope r_usr. Reconnect using preset=legacy.",
          needsReauth: true,
          preset: "legacy",
        });
      }
      if (resp.status < 200 || resp.status >= 300) {
        return res.status(500).json({ error: `Tidal API error: ${resp.status} - ${resp.text.substring(0, 200)}` });
      }
      const list: any[] = Array.isArray(resp.json?.items) ? resp.json.items : Array.isArray(resp.json?.data) ? resp.json.data : [];
      const items = list.map((a: any) => {
        const artist = a?.artist?.name || a?.artists?.[0]?.name || "Unknown Artist";
        const artistId = a?.artist?.id ? String(a.artist.id) : a?.artists?.[0]?.id ? String(a.artists[0].id) : "";
        const cover = a?.cover || a?.image || null;
        return {
          id: String(a?.id),
          title: a?.title || "Album",
          artist,
          artistId,
          year: a?.releaseDate ? new Date(a.releaseDate).getFullYear() : undefined,
          numberOfTracks: a?.numberOfTracks,
          artwork_url: cover,
          lmsUri: `tidal://album:${a?.id}`,
          source: "tidal",
        };
      });
      res.json({ items, total: resp.json?.totalNumberOfItems || resp.json?.total || items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/artists", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });

    const limit = Math.min(5000, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10));
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const resp = await tidalApiGet(
        `/v2/users/${encodeURIComponent(t.userId)}/favorites/artists?limit=${limit}&offset=${offset}`,
        t.accessToken,
        countryCode
      );
      if (resp.status === 403 && isMissingRUsrScope(resp.json || resp.text)) {
        return res.status(409).json({
          error: "Tidal token missing required legacy scope r_usr. Reconnect using preset=legacy.",
          needsReauth: true,
          preset: "legacy",
        });
      }
      if (resp.status < 200 || resp.status >= 300) {
        return res.status(500).json({ error: `Tidal API error: ${resp.status} - ${resp.text.substring(0, 200)}` });
      }
      const list: any[] = Array.isArray(resp.json?.items) ? resp.json.items : Array.isArray(resp.json?.data) ? resp.json.data : [];
      const items = list.map((a: any) => {
        const picture = a?.picture || a?.image || null;
        return {
          id: String(a?.id),
          name: a?.name || "Artist",
          picture,
          imageUrl: picture,
          lmsUri: `tidal://artist:${a?.id}`,
          source: "tidal",
        };
      });
      res.json({ items, total: resp.json?.totalNumberOfItems || resp.json?.total || items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/playlists", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });

    const limit = Math.min(5000, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10));
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const resp = await tidalApiGet(
        `/v2/users/${encodeURIComponent(t.userId)}/playlists?limit=${limit}&offset=${offset}`,
        t.accessToken,
        countryCode
      );
      if (resp.status === 403 && isMissingRUsrScope(resp.json || resp.text)) {
        return res.status(409).json({
          error: "Tidal token missing required legacy scope r_usr. Reconnect using preset=legacy.",
          needsReauth: true,
          preset: "legacy",
        });
      }
      if (resp.status < 200 || resp.status >= 300) {
        return res.status(500).json({ error: `Tidal API error: ${resp.status} - ${resp.text.substring(0, 200)}` });
      }
      const list: any[] = Array.isArray(resp.json?.items) ? resp.json.items : Array.isArray(resp.json?.data) ? resp.json.data : [];
      const items = list.map((p: any) => {
        const cover = p?.squareImage || p?.image || p?.cover || null;
        const pid = String(p?.uuid || p?.id);
        return {
          id: pid,
          title: p?.title || "Playlist",
          description: p?.description || "",
          numberOfTracks: p?.numberOfTracks,
          artwork_url: cover,
          lmsUri: `tidal://playlist:${pid}`,
          source: "tidal",
        };
      });
      res.json({ items, total: resp.json?.totalNumberOfItems || resp.json?.total || items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/tracks", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });

    const limit = Math.min(5000, Math.max(1, parseInt(String(req.query.limit || "200"), 10)));
    const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10));
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const resp = await tidalApiGet(
        `/v2/users/${encodeURIComponent(t.userId)}/favorites/tracks?limit=${limit}&offset=${offset}`,
        t.accessToken,
        countryCode
      );
      if (resp.status === 403 && isMissingRUsrScope(resp.json || resp.text)) {
        return res.status(409).json({
          error: "Tidal token missing required legacy scope r_usr. Reconnect using preset=legacy.",
          needsReauth: true,
          preset: "legacy",
        });
      }
      if (resp.status < 200 || resp.status >= 300) {
        return res.status(500).json({ error: `Tidal API error: ${resp.status} - ${resp.text.substring(0, 200)}` });
      }
      const list: any[] = Array.isArray(resp.json?.items) ? resp.json.items : Array.isArray(resp.json?.data) ? resp.json.data : [];
      const items = list.map((tr: any) => {
        const artist = tr?.artist?.name || tr?.artists?.[0]?.name || "Unknown Artist";
        const artistId = tr?.artist?.id ? String(tr.artist.id) : tr?.artists?.[0]?.id ? String(tr.artists[0].id) : "";
        const album = tr?.album?.title || tr?.album?.name || "Unknown Album";
        const albumId = tr?.album?.id ? String(tr.album.id) : "";
        const cover = tr?.album?.cover || tr?.cover || tr?.image || null;
        const trackId = String(tr?.id);
        return {
          id: trackId,
          title: tr?.title || "Track",
          artist,
          artistId,
          album,
          albumId,
          duration: tr?.duration || 0,
          artwork_url: cover,
          uri: `tidal://track:${trackId}`,
          lmsUri: `tidal://track:${trackId}`,
          source: "tidal",
        };
      });
      res.json({ items, total: resp.json?.totalNumberOfItems || resp.json?.total || items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/albums/:albumId/tracks", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    const albumId = String(req.params.albumId);
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const resp = await tidalApiGet(`/v2/albums/${encodeURIComponent(albumId)}/tracks`, t.accessToken, countryCode);
      if (resp.status === 403 && isMissingRUsrScope(resp.json || resp.text)) {
        return res.status(409).json({
          error: "Tidal token missing required legacy scope r_usr. Reconnect using preset=legacy.",
          needsReauth: true,
          preset: "legacy",
        });
      }
      if (resp.status < 200 || resp.status >= 300) {
        return res.status(500).json({ error: `Tidal API error: ${resp.status} - ${resp.text.substring(0, 200)}` });
      }
      return res.json(resp.json);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/playlists/:playlistId/tracks", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    const playlistId = String(req.params.playlistId);
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const resp = await tidalApiGet(
        `/v2/playlists/${encodeURIComponent(playlistId)}/tracks`,
        t.accessToken,
        countryCode
      );
      if (resp.status === 403 && isMissingRUsrScope(resp.json || resp.text)) {
        return res.status(409).json({
          error: "Tidal token missing required legacy scope r_usr. Reconnect using preset=legacy.",
          needsReauth: true,
          preset: "legacy",
        });
      }
      if (resp.status < 200 || resp.status >= 300) {
        return res.status(500).json({ error: `Tidal API error: ${resp.status} - ${resp.text.substring(0, 200)}` });
      }
      return res.json(resp.json);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/totals", async (_req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const [albums, artists, tracks, playlists] = await Promise.all([
        tidalApiGet(`/v2/users/${encodeURIComponent(t.userId)}/favorites/albums?limit=1&offset=0`, t.accessToken, countryCode),
        tidalApiGet(`/v2/users/${encodeURIComponent(t.userId)}/favorites/artists?limit=1&offset=0`, t.accessToken, countryCode),
        tidalApiGet(`/v2/users/${encodeURIComponent(t.userId)}/favorites/tracks?limit=1&offset=0`, t.accessToken, countryCode),
        tidalApiGet(`/v2/users/${encodeURIComponent(t.userId)}/playlists?limit=1&offset=0`, t.accessToken, countryCode),
      ]);

      const anyMissing = [albums, artists, tracks, playlists].some((r) => r.status === 403 && isMissingRUsrScope(r.json || r.text));
      if (anyMissing) {
        return res.status(409).json({
          error: "Tidal token missing required legacy scope r_usr. Reconnect using preset=legacy.",
          needsReauth: true,
          preset: "legacy",
        });
      }

      res.json({
        albums: albums.json?.totalNumberOfItems || albums.json?.total || 0,
        artists: artists.json?.totalNumberOfItems || artists.json?.total || 0,
        tracks: tracks.json?.totalNumberOfItems || tracks.json?.total || 0,
        playlists: playlists.json?.totalNumberOfItems || playlists.json?.total || 0,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}


