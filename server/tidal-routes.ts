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

function resolveClientIdFromRequest(
  req: Request,
  opts: { ignoreEnv?: boolean } = {}
): { clientId: string; index: number; usingEnv: boolean } {
  const q: any = req.query || {};
  const forceFallback = String(q.forceFallback || "").toLowerCase();
  const ignoreEnv = !!opts.ignoreEnv || forceFallback === "1" || forceFallback === "true" || forceFallback === "yes";

  // If env var is set, use it unless explicitly ignored.
  const envId = process.env.TIDAL_CLIENT_ID;
  if (!ignoreEnv && envId && envId.trim()) return { clientId: envId.trim(), index: -1, usingEnv: true };

  const idxRaw = q.clientIdIndex;
  if (idxRaw !== undefined) {
    const idx = clampClientIdIndex(parseInt(String(idxRaw), 10));
    return { clientId: TIDAL_FALLBACK_IDS[idx], index: idx, usingEnv: false };
  }

  const idRaw = q.clientId;
  if (typeof idRaw === "string" && idRaw.trim()) {
    const wanted = idRaw.trim();
    const idx = TIDAL_FALLBACK_IDS.indexOf(wanted);
    if (idx >= 0) return { clientId: wanted, index: idx, usingEnv: false };
  }

  return { clientId: TIDAL_FALLBACK_IDS[currentClientIdIndex] || TIDAL_FALLBACK_IDS[0], index: currentClientIdIndex, usingEnv: false };
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
      // IMPORTANT: For TIDAL OpenAPI v2, GET requests should only include Authorization.
      // Adding Accept/Content-Type can cause unexpected 404/403 behavior.
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Tidal OpenAPI error: ${resp.status} - ${text.substring(0, 200)}`);
  return JSON.parse(text);
}

function openApiUrlFromPath(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  if (pathOrUrl.startsWith("/v2/")) return `https://openapi.tidal.com${pathOrUrl}`;
  if (pathOrUrl.startsWith("/")) return `https://openapi.tidal.com/v2${pathOrUrl}`;
  return `https://openapi.tidal.com/v2/${pathOrUrl}`;
}

function normalizeOpenApiNextLink(next: string): string {
  // OpenAPI often returns links like "/userCollections/..." (missing "/v2" prefix).
  if (next.startsWith("http://") || next.startsWith("https://")) return next;
  if (next.startsWith("/userCollections") || next.startsWith("/albums") || next.startsWith("/playlists") || next.startsWith("/userRecommendations")) {
    return `https://openapi.tidal.com/v2${next}`;
  }
  if (next.startsWith("/v2/")) return `https://openapi.tidal.com${next}`;
  return `https://openapi.tidal.com${next}`;
}

async function openApiGetByPath(pathOrUrl: string, accessToken: string): Promise<any> {
  return openApiGet(openApiUrlFromPath(pathOrUrl), accessToken);
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

function parseIsoDuration(isoDuration: string): number {
  // e.g. PT3M45S, PT1H2M3S
  const matches = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!matches) return 0;
  const hours = parseInt(matches[1] || "0", 10);
  const minutes = parseInt(matches[2] || "0", 10);
  const seconds = parseInt(matches[3] || "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

function buildIncludedMap(included: any[]): Record<string, Record<string, any>> {
  const map: Record<string, Record<string, any>> = {};
  for (const i of included) {
    const type = String(i?.type || "");
    const id = String(i?.id || "");
    if (!type || !id) continue;
    if (!map[type]) map[type] = {};
    map[type][id] = i;
  }
  return map;
}

function mapOpenApiTrackFromItem(item: any, includedMap: Record<string, Record<string, any>>): any {
  // In relationships/items, the actual resource is in included under 'items' type usually,
  // but TIDAL sometimes maps them to 'tracks'
  const itemId = String(item?.id || "");
  const track = (includedMap.items && includedMap.items[itemId]) || (includedMap.tracks && includedMap.tracks[itemId]) || {
    id: itemId,
    attributes: {},
  };

  const artistRel = track?.relationships?.artists?.data?.[0];
  const artist = artistRel ? includedMap.artists?.[String(artistRel.id)] : null;

  const albumRel = track?.relationships?.albums?.data?.[0];
  const album = albumRel ? includedMap.albums?.[String(albumRel.id)] : null;

  const artworkRel = album?.relationships?.coverArt?.data?.[0];
  const artwork = artworkRel ? includedMap.artworks?.[String(artworkRel.id)] : null;

  const coverUrl = pickArtworkUrl(artwork, "320x320");

  const rawDuration = track?.attributes?.duration;
  const duration =
    typeof rawDuration === "string" ? parseIsoDuration(rawDuration) : typeof rawDuration === "number" ? rawDuration : 0;

  const id = String(track?.id || itemId);

  return {
    id,
    title: track?.attributes?.title || "Unknown Track",
    artist: artist?.attributes?.name || track?.attributes?.artistName || "Unknown Artist",
    artistId: String(artist?.id || ""),
    album: album?.attributes?.title || track?.attributes?.albumName || "Unknown Album",
    albumId: String(album?.id || ""),
    duration,
    trackNumber: item?.meta?.trackNumber || track?.attributes?.trackNumber || 0,
    artwork_url: coverUrl || null,
    uri: `tidal://track:${id}`,
    lmsUri: `tidal://track:${id}`,
    source: "tidal",
  };
}

export function registerTidalRoutes(app: Express): void {
  loadTokensFromDisk();

  app.get("/api/tidal/client-id", (req: Request, res: Response) => {
    const resolved = resolveClientIdFromRequest(req);
    res.json({
      clientId: resolved.clientId,
      clientIdIndex: resolved.usingEnv ? null : resolved.index,
      usingEnv: resolved.usingEnv,
      fallbackIds: resolved.usingEnv ? null : TIDAL_FALLBACK_IDS,
    });
  });

  app.post("/api/tidal/client-id/cycle", (req: Request, res: Response) => {
    const q: any = req.query || {};
    const forceFallback = String(q.forceFallback || "").toLowerCase();
    const ignoreEnv = forceFallback === "1" || forceFallback === "true" || forceFallback === "yes";
    if (ignoreEnv && process.env.TIDAL_CLIENT_ID) {
      // no-op for env, but allow cycling of fallback index anyway
      currentClientIdIndex = (currentClientIdIndex + 1) % TIDAL_FALLBACK_IDS.length;
      return res.json({
        clientId: TIDAL_FALLBACK_IDS[currentClientIdIndex],
        clientIdIndex: currentClientIdIndex,
        usingEnv: false,
      });
    }
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
    const preset = String(req.query.preset || "modern").toLowerCase();
    const resolved = resolveClientIdFromRequest(req, { ignoreEnv: preset === "legacy" });
    const clientId = resolved.clientId;
    const clientIdIndex = resolved.usingEnv ? null : resolved.index;
    const redirectUri =
      platform === "web"
        ? `${req.protocol}://${req.get("host")}/api/tidal/callback`
        : "soundstream://callback";

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString("hex");

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
    const preset = String(req.query.preset || "modern").toLowerCase();
    const resolved = resolveClientIdFromRequest(req, { ignoreEnv: preset === "legacy" });
    const clientId = resolved.clientId;
    const redirectUri =
      platform === "web"
        ? `${req.protocol}://${req.get("host")}/api/tidal/callback`
        : "soundstream://callback";

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
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const url = `https://openapi.tidal.com/v2/userRecommendations/${encodeURIComponent(
        t.userId
      )}/relationships/myMixes?include=mixes,mixes.coverArt&countryCode=${encodeURIComponent(countryCode)}`;
      const data = await openApiGet(url, t.accessToken);
      const dataArr: any[] = Array.isArray(data?.data) ? data.data : [];
      const included: any[] = Array.isArray(data?.included) ? data.included : [];
      const mixesById = new Map<string, any>(included.filter((x) => x?.type === "mixes").map((x) => [String(x.id), x]));
      const artworksById = new Map<string, any>(included.filter((x) => x?.type === "artworks").map((x) => [String(x.id), x]));

      const items = dataArr.map((rel: any) => {
        const mixId = String(rel.id);
        const mix = mixesById.get(mixId);
        const artworkId = mix?.relationships?.coverArt?.data?.[0]?.id ? String(mix.relationships.coverArt.data[0].id) : "";
        const artwork = artworksById.get(artworkId);
        return {
          id: mixId,
          title: mix?.attributes?.title || "Mix",
          description: mix?.attributes?.subTitle || "",
          artwork_url: pickArtworkUrl(artwork, "320x320"),
          lmsUri: `tidal://mix:${mixId}`,
          source: "tidal",
        };
      });

      res.json({ items, total: items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/albums", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    // NOTE: OpenAPI uses cursor pagination, not offset. We currently treat offset as unsupported.
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const url = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
        t.userId
      )}/relationships/albums?include=albums,albums.artists,albums.coverArt&countryCode=${encodeURIComponent(
        countryCode
      )}&page[size]=${limit}`;
      const data = await openApiGet(url, t.accessToken);

      const dataArr: any[] = Array.isArray(data?.data) ? data.data : [];
      const included: any[] = Array.isArray(data?.included) ? data.included : [];
      const albumsById = new Map<string, any>(included.filter((x) => x?.type === "albums").map((x) => [String(x.id), x]));
      const artistsById = new Map<string, any>(included.filter((x) => x?.type === "artists").map((x) => [String(x.id), x]));
      const artworksById = new Map<string, any>(included.filter((x) => x?.type === "artworks").map((x) => [String(x.id), x]));

      const items = dataArr.map((rel: any) => {
        const albumId = String(rel.id);
        const album = albumsById.get(albumId);
        const artistId = album?.relationships?.artists?.data?.[0]?.id ? String(album.relationships.artists.data[0].id) : "";
        const artist = artistsById.get(artistId);
        const artworkId = album?.relationships?.coverArt?.data?.[0]?.id ? String(album.relationships.coverArt.data[0].id) : "";
        const artwork = artworksById.get(artworkId);
        return {
          id: albumId,
          title: album?.attributes?.title || "Album",
          artist: artist?.attributes?.name || album?.attributes?.artistName || "Unknown Artist",
          artistId,
          year: album?.attributes?.releaseDate ? new Date(album.attributes.releaseDate).getFullYear() : undefined,
          numberOfTracks: album?.attributes?.numberOfItems,
          artwork_url: pickArtworkUrl(artwork, "320x320"),
          lmsUri: `tidal://album:${albumId}`,
          source: "tidal",
        };
      });
      res.json({ items, total: items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/artists", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const url = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
        t.userId
      )}/relationships/artists?include=artists&countryCode=${encodeURIComponent(countryCode)}&page[size]=${limit}`;
      const data = await openApiGet(url, t.accessToken);
      const included: any[] = Array.isArray(data?.included) ? data.included : [];
      const artistsById = new Map<string, any>(included.filter((x) => x?.type === "artists").map((x) => [String(x.id), x]));
      const dataArr: any[] = Array.isArray(data?.data) ? data.data : [];
      const items = dataArr.map((rel: any) => {
        const artistId = String(rel.id);
        const artist = artistsById.get(artistId);
        const picture = artist?.attributes?.picture?.[0]?.url || null;
        return {
          id: artistId,
          name: artist?.attributes?.name || "Artist",
          picture,
          imageUrl: picture,
          lmsUri: `tidal://artist:${artistId}`,
          source: "tidal",
        };
      });
      res.json({ items, total: items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/playlists", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const url = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
        t.userId
      )}/relationships/playlists?include=playlists,playlists.coverArt&countryCode=${encodeURIComponent(
        countryCode
      )}&page[size]=${limit}`;
      const data = await openApiGet(url, t.accessToken);
      const included: any[] = Array.isArray(data?.included) ? data.included : [];
      const playlistsById = new Map<string, any>(included.filter((x) => x?.type === "playlists").map((x) => [String(x.id), x]));
      const artworksById = new Map<string, any>(included.filter((x) => x?.type === "artworks").map((x) => [String(x.id), x]));

      const dataArr: any[] = Array.isArray(data?.data) ? data.data : [];
      const items = dataArr.map((rel: any) => {
        const playlistId = String(rel.id);
        const playlist = playlistsById.get(playlistId);
        const artworkId = playlist?.relationships?.coverArt?.data?.[0]?.id
          ? String(playlist.relationships.coverArt.data[0].id)
          : "";
        const artwork = artworksById.get(artworkId);
        return {
          id: playlistId,
          title: playlist?.attributes?.name || playlist?.attributes?.title || "Playlist",
          description: playlist?.attributes?.description || "",
          numberOfTracks: playlist?.attributes?.numberOfItems,
          artwork_url: pickArtworkUrl(artwork, "320x320"),
          lmsUri: `tidal://playlist:${playlistId}`,
          source: "tidal",
        };
      });
      res.json({ items, total: items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/tracks", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "200"), 10)));
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const url = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
        t.userId
      )}/relationships/tracks?include=tracks,tracks.albums,tracks.artists,tracks.albums.coverArt&countryCode=${encodeURIComponent(
        countryCode
      )}&page[size]=${limit}`;
      const data = await openApiGet(url, t.accessToken);
      const included: any[] = Array.isArray(data?.included) ? data.included : [];
      const tracksById = new Map<string, any>(included.filter((x) => x?.type === "tracks").map((x) => [String(x.id), x]));
      const albumsById = new Map<string, any>(included.filter((x) => x?.type === "albums").map((x) => [String(x.id), x]));
      const artistsById = new Map<string, any>(included.filter((x) => x?.type === "artists").map((x) => [String(x.id), x]));
      const artworksById = new Map<string, any>(included.filter((x) => x?.type === "artworks").map((x) => [String(x.id), x]));
      const dataArr: any[] = Array.isArray(data?.data) ? data.data : [];

      const items = dataArr.map((rel: any) => {
        const trackId = String(rel.id);
        const track = tracksById.get(trackId);
        const artistId = track?.relationships?.artists?.data?.[0]?.id ? String(track.relationships.artists.data[0].id) : "";
        const artist = artistsById.get(artistId);
        const albumId = track?.relationships?.albums?.data?.[0]?.id ? String(track.relationships.albums.data[0].id) : "";
        const album = albumsById.get(albumId);
        const artworkId = album?.relationships?.coverArt?.data?.[0]?.id ? String(album.relationships.coverArt.data[0].id) : "";
        const artwork = artworksById.get(artworkId);
        return {
          id: trackId,
          title: track?.attributes?.title || "Track",
          artist: artist?.attributes?.name || track?.attributes?.artistName || "Unknown Artist",
          artistId,
          album: album?.attributes?.title || track?.attributes?.albumName || "Unknown Album",
          albumId,
          duration: track?.attributes?.duration ? Number(track.attributes.duration) : 0,
          artwork_url: pickArtworkUrl(artwork, "320x320"),
          uri: `tidal://track:${trackId}`,
          lmsUri: `tidal://track:${trackId}`,
          source: "tidal",
        };
      });
      res.json({ items, total: items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/albums/:albumId/tracks", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    let albumId = String(req.params.albumId);
    if (albumId.startsWith("tidal-")) albumId = albumId.replace(/^tidal-/, "");
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const url = `https://openapi.tidal.com/v2/albums/${encodeURIComponent(
        albumId
      )}/relationships/items?include=items,items.artists,items.albums,items.albums.coverArt&countryCode=${encodeURIComponent(
        countryCode
      )}&page[size]=100`;
      const data = await openApiGet(url, t.accessToken);
      const itemsArr: any[] = Array.isArray(data?.data) ? data.data : [];
      const included: any[] = Array.isArray(data?.included) ? data.included : [];
      const includedMap = buildIncludedMap(included);
      const items = itemsArr.map((it: any) => mapOpenApiTrackFromItem(it, includedMap));
      return res.json({ items, total: items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/playlists/:playlistId/tracks", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    let playlistId = String(req.params.playlistId);
    if (playlistId.startsWith("tidal-")) playlistId = playlistId.replace(/^tidal-/, "");
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const url = `https://openapi.tidal.com/v2/playlists/${encodeURIComponent(
        playlistId
      )}/relationships/items?include=items,items.artists,items.albums,items.albums.coverArt&countryCode=${encodeURIComponent(
        countryCode
      )}&page[size]=100`;
      const data = await openApiGet(url, t.accessToken);
      const itemsArr: any[] = Array.isArray(data?.data) ? data.data : [];
      const included: any[] = Array.isArray(data?.included) ? data.included : [];
      const includedMap = buildIncludedMap(included);
      const items = itemsArr.map((it: any) => mapOpenApiTrackFromItem(it, includedMap));
      return res.json({ items, total: items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/totals", async (_req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });
    try {
      // OpenAPI doesn’t provide a cheap "total count" field; count by walking cursors (bounded).
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";

      async function countRelationship(rel: "albums" | "artists" | "tracks" | "playlists", maxItems = 5000): Promise<number> {
        let count = 0;
        let nextUrl = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
          t.userId!
        )}/relationships/${rel}?countryCode=${encodeURIComponent(countryCode)}&page[size]=100`;
        while (nextUrl && count < maxItems) {
          const page = await openApiGet(nextUrl, t.accessToken);
          const dataArr: any[] = Array.isArray(page?.data) ? page.data : [];
          count += dataArr.length;
          const next = page?.links?.next;
          nextUrl = typeof next === "string" && next ? normalizeOpenApiNextLink(next) : "";
          if (!nextUrl) break;
        }
        return count;
      }

      const [albums, artists, tracks, playlists] = await Promise.all([
        countRelationship("albums"),
        countRelationship("artists"),
        countRelationship("tracks"),
        countRelationship("playlists"),
      ]);

      res.json({ albums, artists, tracks, playlists });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}


