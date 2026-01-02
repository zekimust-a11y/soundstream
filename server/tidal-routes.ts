import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type TidalTokens = {
  accessToken: string;
  refreshToken?: string;
  userId?: string;
  obtainedAt?: number;
  clientId?: string;
};

type TidalAuthSession = {
  createdAt: number;
  clientId: string;
  // Redirect URI registered with TIDAL (must match the developer console entry exactly).
  oauthRedirectUri: string;
  // Redirect URI the client listens for (web uses the same http callback; mobile uses app deep link).
  appRedirectUri: string;
  codeVerifier: string;
  state: string;
  platform: "web" | "mobile";
};

// Persist state outside the repo so `git reset --hard` deployments don't delete auth state.
const SOUNDSTREAM_STATE_DIR = process.env.SOUNDSTREAM_STATE_DIR || path.join(os.homedir(), ".soundstream");
try {
  fs.mkdirSync(SOUNDSTREAM_STATE_DIR, { recursive: true });
} catch {
  // best-effort; will fail later with a clearer error if we can't write
}

const TIDAL_TOKENS_FILE = path.join(SOUNDSTREAM_STATE_DIR, ".tidal-tokens.json");
const TIDAL_SESSIONS_FILE = path.join(SOUNDSTREAM_STATE_DIR, ".tidal-oauth-sessions.json");

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

function pruneSessions(now: number = Date.now()) {
  // 30 minutes should be plenty for a human login; keeps file small and limits exposure window.
  const MAX_AGE_MS = 30 * 60_000;
  for (const [k, v] of sessionsByState.entries()) {
    if (!v?.createdAt || now - v.createdAt > MAX_AGE_MS) sessionsByState.delete(k);
  }
}

function loadSessionsFromDisk(): void {
  try {
    if (!fs.existsSync(TIDAL_SESSIONS_FILE)) return;
    const raw = fs.readFileSync(TIDAL_SESSIONS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const entries: any[] = Array.isArray(parsed.entries) ? parsed.entries : [];
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      if (typeof e.state !== "string" || !e.state) continue;
      if (typeof e.codeVerifier !== "string" || !e.codeVerifier) continue;
      if (typeof e.clientId !== "string" || !e.clientId) continue;
      if (typeof e.oauthRedirectUri !== "string" || !e.oauthRedirectUri) continue;
      if (typeof e.appRedirectUri !== "string" || !e.appRedirectUri) continue;
      const platform = e.platform === "web" ? "web" : "mobile";
      sessionsByState.set(e.state, {
        createdAt: typeof e.createdAt === "number" ? e.createdAt : Date.now(),
        clientId: e.clientId,
        oauthRedirectUri: e.oauthRedirectUri,
        appRedirectUri: e.appRedirectUri,
        codeVerifier: e.codeVerifier,
        state: e.state,
        platform,
      });
    }
    pruneSessions();
  } catch {
    // ignore
  }
}

function saveSessionsToDisk(): void {
  try {
    pruneSessions();
    const payload = {
      savedAt: Date.now(),
      entries: Array.from(sessionsByState.values()),
    };
    const tmp = `${TIDAL_SESSIONS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
    fs.renameSync(tmp, TIDAL_SESSIONS_FILE);
  } catch {
    // ignore; worst case iOS login needs retry
  }
}


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
    // Prefer the stable path, but also support legacy locations for migration.
    const legacyCwdPath = path.resolve(process.cwd(), ".tidal-tokens.json");
    const legacyRepoPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".tidal-tokens.json");
    const pathToRead = fs.existsSync(TIDAL_TOKENS_FILE)
      ? TIDAL_TOKENS_FILE
      : fs.existsSync(legacyRepoPath)
        ? legacyRepoPath
        : fs.existsSync(legacyCwdPath)
          ? legacyCwdPath
          : null;
    if (!pathToRead) return;

    const raw = fs.readFileSync(pathToRead, "utf-8");
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
      // If we loaded from legacy path, write it back to the stable location for next boot.
      if (pathToRead !== TIDAL_TOKENS_FILE) {
        try {
          saveTokensToDisk();
          console.log("[Tidal] Migrated tokens file to stable location");
        } catch {}
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
    redirect_uri: session.oauthRedirectUri,
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
    clientId: session.clientId,
  };
}

function requireTokens(res: Response): TidalTokens | null {
  if (!tokens?.accessToken) {
    res.status(401).json({ error: "Not authenticated with Tidal" });
    return null;
  }
  return tokens;
}

async function refreshAccessToken(refreshToken: string, clientId: string): Promise<{ accessToken: string; refreshToken?: string; userId?: string }> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const resp = await fetch("https://login.tidal.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(15000),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Token refresh failed: ${resp.status} - ${text.substring(0, 200)}`);
  }

  const tokenData: any = JSON.parse(text);
  const accessToken = tokenData?.access_token;
  const newRefreshToken = tokenData?.refresh_token;
  const userId = tokenData?.user?.id ? String(tokenData.user.id) : undefined;
  if (!accessToken) throw new Error("Token refresh succeeded but no access_token returned");
  return { accessToken, refreshToken: newRefreshToken, userId };
}

// NOTE: OpenAPI endpoints (openapi.tidal.com) use a JSON:API-ish schema with `data` + `included`.
// We return simplified shapes matching the existing Soundstream client usage.
async function openApiGet(url: string, accessToken: string): Promise<any> {
  const doFetch = async (token: string) =>
    fetch(url, {
      headers: {
        // IMPORTANT: For TIDAL OpenAPI v2, GET requests should only include Authorization.
        // Adding Accept/Content-Type can cause unexpected 404/403 behavior.
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(20000),
    });

  const resp = await doFetch(accessToken);
  const text = await resp.text();

  // Auto-refresh expired tokens (common on long-running .21 server).
  if (resp.status === 401 && tokens?.refreshToken) {
    const msg = text || "";
    const looksExpired = msg.includes("Expired token") || msg.includes("AUTHENTICATION_ERROR") || msg.includes("UNAUTHORIZED");
    if (looksExpired) {
      try {
        const clientId = tokens.clientId || process.env.TIDAL_CLIENT_ID || getClientId();
        const refreshed = await refreshAccessToken(tokens.refreshToken, clientId);
        tokens = {
          ...tokens,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken || tokens.refreshToken,
          userId: tokens.userId || refreshed.userId || deriveUserIdFromAccessToken(refreshed.accessToken),
          obtainedAt: Date.now(),
          clientId,
        };
        saveTokensToDisk();
        const resp2 = await doFetch(tokens.accessToken);
        const text2 = await resp2.text();
        if (!resp2.ok) throw new Error(`Tidal OpenAPI error: ${resp2.status} - ${text2.substring(0, 200)}`);
        return JSON.parse(text2);
      } catch (e) {
        // Fall through to original error below.
      }
    }
  }

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
    // LMS TIDAL plugin expects track URIs in the form `tidal://<trackId>`
    uri: `tidal://${id}`,
    lmsUri: `tidal://${id}`,
    source: "tidal",
  };
}


export function registerTidalRoutes(app: Express): void {
  loadTokensFromDisk();
  loadSessionsFromDisk();

  // In-memory cache to avoid hammering Tidal OpenAPI (which rate-limits aggressively).
  // Keyed by userId + endpoint + params. This is per-process (fine for our single `.21` host).
  const tidalCache = new Map<string, { ts: number; payload: any }>();
  const CACHE_TTL_MS = 60_000; // 60s: enough to prevent bursts without making data feel stale.

  function cacheGet(key: string, ttlMs: number = CACHE_TTL_MS) {
    const v = tidalCache.get(key);
    if (!v) return null;
    const fresh = Date.now() - v.ts < ttlMs;
    return { fresh, payload: v.payload };
  }

  function cacheSet(key: string, payload: any) {
    tidalCache.set(key, { ts: Date.now(), payload });
  }

  function isRateLimitedError(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes("Tidal OpenAPI error: 429");
  }

  function toFiniteNumber(v: any): number | undefined {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  }

  // Tidal OpenAPI responses sometimes include a total count in `meta`.
  // We opportunistically use it to avoid cursor-walking (which triggers 429 and returns partial counts).
  function extractOpenApiTotal(page: any): number | undefined {
    if (!page || typeof page !== "object") return undefined;
    const meta: any = (page as any).meta;
    if (!meta || typeof meta !== "object") return undefined;

    // Try common shapes we've seen across APIs.
    return (
      toFiniteNumber(meta.total) ??
      toFiniteNumber(meta.totalNumberOfItems) ??
      toFiniteNumber(meta.totalItems) ??
      toFiniteNumber(meta.totalCount) ??
      toFiniteNumber(meta.totalResults) ??
      toFiniteNumber(meta?.page?.total) ??
      toFiniteNumber(meta?.page?.totalItems)
    );
  }

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
    const httpCallback = `${req.protocol}://${req.get("host")}/api/tidal/callback`;
    // IMPORTANT:
    // - iOS cannot use a custom-scheme redirect_uri unless it's registered in the TIDAL developer console.
    // - Use the HTTP callback (registered) for OAuth, then bounce back into the app via deep link.
    const oauthRedirectUri = platform === "web" ? httpCallback : httpCallback;
    let appRedirectUri = platform === "web" ? httpCallback : "soundstream://callback";
    // Allow the client to tell us what deep link it can actually handle (Expo Go vs dev build vs standalone).
    // Security: only allow known safe schemes.
    const requestedAppRedirectUri = typeof req.query.appRedirectUri === "string" ? req.query.appRedirectUri : "";
    if (platform === "mobile" && requestedAppRedirectUri) {
      const v = requestedAppRedirectUri.trim();
      if (v.startsWith("soundstream://") || v.startsWith("exp://") || v.startsWith("exps://")) {
        appRedirectUri = v;
      }
    }

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
      redirect_uri: oauthRedirectUri,
      scope,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });

    sessionsByState.set(state, {
      createdAt: Date.now(),
      clientId,
      oauthRedirectUri,
      appRedirectUri,
      codeVerifier,
      state,
      platform,
    });
    saveSessionsToDisk();

    const authUrl = `https://login.tidal.com/authorize?${params.toString()}`;
    res.json({ authUrl, redirectUri: appRedirectUri, state, platform, preset, clientId, clientIdIndex });
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
    const httpCallback = `${req.protocol}://${req.get("host")}/api/tidal/callback`;
    const oauthRedirectUri = platform === "web" ? httpCallback : httpCallback;
    let appRedirectUri = platform === "web" ? httpCallback : "soundstream://callback";
    const requestedAppRedirectUri = typeof req.query.appRedirectUri === "string" ? req.query.appRedirectUri : "";
    if (platform === "mobile" && requestedAppRedirectUri) {
      const v = requestedAppRedirectUri.trim();
      if (v.startsWith("soundstream://") || v.startsWith("exp://") || v.startsWith("exps://")) {
        appRedirectUri = v;
      }
    }

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
      redirect_uri: oauthRedirectUri,
      scope,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });

    sessionsByState.set(state, {
      createdAt: Date.now(),
      clientId,
      oauthRedirectUri,
      appRedirectUri,
      codeVerifier,
      state,
      platform,
    });
    saveSessionsToDisk();

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
    if (state && !sessionsByState.has(state)) {
      // Best-effort reload (handles server restarts between auth-url and callback).
      loadSessionsFromDisk();
    }
    if (!state || !sessionsByState.has(state)) {
      // If this is iOS, still try to bounce back into the app so it can show a nicer error.
      if (code) {
        const deepLink = `soundstream://callback?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ""}`;
        return res.status(200).send(`<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Tidal auth error</title></head>
  <body>
    <h2>Tidal auth error</h2>
    <p>Invalid or missing state. Returning to Soundstream…</p>
    <script>
      try { window.location.href = ${JSON.stringify(deepLink)}; } catch (e) {}
    </script>
    <p>If you are not redirected automatically, close this window and try again.</p>
  </body>
</html>`);
      }
      return res.status(400).send(`<html><body><h2>Tidal auth error</h2><p>Invalid or missing state</p></body></html>`);
    }

    try {
      const session = sessionsByState.get(state)!;

      // MOBILE FLOW:
      // Do NOT exchange the code here (the app will call /api/tidal/authenticate).
      // Instead, bounce back into the app via deep link so iOS can complete the flow.
      if (session.platform === "mobile") {
        const deepLink = `${session.appRedirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
        return res.status(200).send(`<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Tidal Connected</title></head>
  <body>
    <h2>Returning to Soundstream…</h2>
    <p>If you are not redirected automatically, you can close this window and return to the app.</p>
    <script>
      try { window.location.href = ${JSON.stringify(deepLink)}; } catch (e) {}
      setTimeout(() => { try { window.close(); } catch (e) {} }, 500);
    </script>
  </body>
</html>`);
      }

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
      // If we restarted between auth-url and callback, reload sessions from disk.
      loadSessionsFromDisk();
      if (state && sessionsByState.has(state)) {
        session = sessionsByState.get(state);
      }
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
      const cacheKey = `mixes:${t.userId}`;
      const cached = cacheGet(cacheKey);
      if (cached?.fresh) {
        return res.json({ ...cached.payload, cached: true });
      }

      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      // NOTE: This OpenAPI endpoint does NOT return `included` even with `include=*`.
      // The items are actually `playlists` of type MIX, and cover art is accessed via a relationship link.
      const listUrl = `https://openapi.tidal.com/v2/userRecommendations/${encodeURIComponent(
        t.userId
      )}/relationships/myMixes?countryCode=${encodeURIComponent(countryCode)}`;
      const listData = await openApiGet(listUrl, t.accessToken);
      const dataArr: any[] = Array.isArray(listData?.data) ? listData.data : [];
      const metaTotal =
        Number(
          listData?.meta?.page?.totalNumberOfItems ??
            listData?.meta?.totalNumberOfItems ??
            listData?.meta?.page?.total ??
            listData?.meta?.total ??
            0
        ) || 0;

      const byId = new Map<string, any>();
      for (const x of dataArr) {
        const id = String(x?.id || "");
        if (id) byId.set(id, x);
      }

      const ids = dataArr
        .map((x: any) => String(x?.id || ""))
        .filter((id: string) => id.length > 0)
        .slice(0, 50);

      async function getPlaylist(id: string): Promise<any | null> {
        try {
          return await openApiGet(
            `https://openapi.tidal.com/v2/playlists/${encodeURIComponent(id)}?countryCode=${encodeURIComponent(countryCode)}`,
            t.accessToken
          );
        } catch (e) {
          return null;
        }
      }

      async function getCoverArtId(playlistId: string): Promise<string | null> {
        try {
          const rel = await openApiGet(
            `https://openapi.tidal.com/v2/playlists/${encodeURIComponent(
              playlistId
            )}/relationships/coverArt?countryCode=${encodeURIComponent(countryCode)}`,
            t.accessToken
          );
          const first = Array.isArray(rel?.data) ? rel.data[0] : null;
          const id = first?.id ? String(first.id) : "";
          return id ? id : null;
        } catch (e) {
          return null;
        }
      }

      async function getArtwork(artworkId: string): Promise<any | null> {
        try {
          const art = await openApiGet(
            `https://openapi.tidal.com/v2/artworks/${encodeURIComponent(artworkId)}?countryCode=${encodeURIComponent(
              countryCode
            )}`,
            t.accessToken
          );
          return art?.data || null;
        } catch (e) {
          return null;
        }
      }

      const items: any[] = [];
      // Keep this sequential to avoid burst rate-limiting.
      for (const id of ids) {
        const playlistResp = await getPlaylist(id);
        const pl = playlistResp?.data;
        const rel = byId.get(id);
        const title = String(pl?.attributes?.name || rel?.attributes?.name || "Mix");
        const description = String(pl?.attributes?.description || rel?.attributes?.description || "");
        const coverArtId = await getCoverArtId(id);
        const artwork = coverArtId ? await getArtwork(coverArtId) : null;
        items.push({
          id,
          title,
          description,
          artwork_url: pickArtworkUrl(artwork, "320x320"),
          lmsUri: `tidal://mix:${id}`,
          source: "tidal",
        });
      }

      const payload = { items, total: metaTotal || items.length };
      cacheSet(cacheKey, payload);
      res.json(payload);
    } catch (e) {
      const cacheKey = `mixes:${t.userId}`;
      const cached = cacheGet(cacheKey);
      if (isRateLimitedError(e)) {
        if (cached?.payload) {
          return res.json({ ...cached.payload, cached: true, stale: !cached.fresh, rateLimited: true });
        }
        return res.json({ items: [], total: 0, rateLimited: true });
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/albums", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10) || 0);
    try {
      // Cache by (limit, offset). Previously we cached only by limit and ignored offset, which caused
      // infinite-scroll to repeat the same first page and produce many duplicates in the UI.
      const cacheKey = `albums:${t.userId}:limit=${limit}:offset=${offset}`;
      const cached = cacheGet(cacheKey);
      if (cached?.fresh) {
        return res.json({ ...cached.payload, cached: true });
      }

      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const doFetch = async (token: string) =>
        tidalApiGet(
          `/v2/users/${encodeURIComponent(t.userId!)}/favorites/albums?limit=${limit}&offset=${offset}`,
          token,
          countryCode
        );

      let resp = await doFetch(t.accessToken);
      // Auto-refresh expired tokens for long-running .21 server.
      if (resp.status === 401 && tokens?.refreshToken) {
        const msg = resp.text || "";
        const looksExpired = msg.includes("Expired token") || msg.includes("AUTHENTICATION_ERROR") || msg.includes("UNAUTHORIZED");
        if (looksExpired) {
          try {
            const clientId = tokens.clientId || process.env.TIDAL_CLIENT_ID || getClientId();
            const refreshed = await refreshAccessToken(tokens.refreshToken, clientId);
            tokens = {
              ...tokens,
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken || tokens.refreshToken,
              userId: tokens.userId || refreshed.userId || deriveUserIdFromAccessToken(refreshed.accessToken),
              obtainedAt: Date.now(),
              clientId,
            };
            saveTokensToDisk();
            resp = await doFetch(tokens.accessToken);
          } catch {
            // fall through to error handling below
          }
        }
      }

      if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`Tidal API error: ${resp.status} - ${String(resp.text || "").substring(0, 200)}`);
      }

      const body = resp.json || {};
      const rawItems: any[] = Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : [];
      const totalNumberOfItems = Number(body?.totalNumberOfItems ?? body?.total ?? 0) || 0;

      const coverUrl = (cover: any, size: string = "320x320") => {
        const c = typeof cover === "string" ? cover : "";
        if (!c) return null;
        // TIDAL cover ids are UUID-ish strings with dashes; resources URL wants path segments.
        return `https://resources.tidal.com/images/${c.replace(/-/g, "/")}/${size}.jpg`;
      };

      const items = rawItems.map((a: any) => {
        const id = String(a?.id || "");
        const artist = a?.artist || (Array.isArray(a?.artists) ? a.artists[0] : null) || {};
        const artistId = String(artist?.id || a?.artistId || "");
        return {
          id,
          title: a?.title || a?.name || "Album",
          artist: artist?.name || a?.artist?.name || a?.artistName || "Unknown Artist",
          artistId,
          year: a?.releaseDate ? new Date(a.releaseDate).getFullYear() : undefined,
          numberOfTracks: a?.numberOfTracks ?? a?.trackCount ?? undefined,
          artwork_url: coverUrl(a?.cover || a?.imageId || a?.coverId, "320x320"),
          lmsUri: `tidal://album:${id}`,
          source: "tidal",
        };
      });

      const payload = { items, total: totalNumberOfItems };
      cacheSet(cacheKey, payload);
      res.json(payload);
    } catch (e) {
      const cacheKey = `albums:${t.userId}:limit=${limit}:offset=${offset}`;
      const cached = cacheGet(cacheKey);
      if (isRateLimitedError(e)) {
        if (cached?.payload) {
          return res.json({ ...cached.payload, cached: true, stale: !cached.fresh, rateLimited: true });
        }
        return res.json({ items: [], total: 0, rateLimited: true });
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/artists", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    try {
      const cacheKey = `artists:${t.userId}:limit=${limit}`;
      const cached = cacheGet(cacheKey);
      if (cached?.fresh) {
        return res.json({ ...cached.payload, cached: true });
      }

      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const url = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
        t.userId
      )}/relationships/artists?include=artists&countryCode=${encodeURIComponent(countryCode)}&page[size]=${limit}`;
      const data = await openApiGet(url, t.accessToken);
      const included: any[] = Array.isArray(data?.included) ? data.included : [];
      const artistsById = new Map<string, any>(included.filter((x) => x?.type === "artists").map((x) => [String(x.id), x]));
      const dataArr: any[] = Array.isArray(data?.data) ? data.data : [];
      const metaTotal =
        Number(
          data?.meta?.page?.totalNumberOfItems ??
            data?.meta?.totalNumberOfItems ??
            data?.meta?.page?.total ??
            data?.meta?.total ??
            0
        ) || 0;
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
      const payload = { items, total: metaTotal || items.length };
      cacheSet(cacheKey, payload);
      res.json(payload);
    } catch (e) {
      const cacheKey = `artists:${t.userId}:limit=${limit}`;
      const cached = cacheGet(cacheKey);
      if (isRateLimitedError(e)) {
        if (cached?.payload) {
          return res.json({ ...cached.payload, cached: true, stale: !cached.fresh, rateLimited: true });
        }
        return res.json({ items: [], total: 0, rateLimited: true });
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/playlists", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    try {
      const cacheKey = `playlists:${t.userId}:limit=${limit}`;
      const cached = cacheGet(cacheKey);
      if (cached?.fresh) {
        return res.json({ ...cached.payload, cached: true });
      }

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
      const metaTotal =
        Number(
          data?.meta?.page?.totalNumberOfItems ??
            data?.meta?.totalNumberOfItems ??
            data?.meta?.page?.total ??
            data?.meta?.total ??
            0
        ) || 0;

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
      const payload = { items, total: metaTotal || items.length };
      cacheSet(cacheKey, payload);
      res.json(payload);
    } catch (e) {
      const cacheKey = `playlists:${t.userId}:limit=${limit}`;
      const cached = cacheGet(cacheKey);
      if (isRateLimitedError(e)) {
        if (cached?.payload) {
          return res.json({ ...cached.payload, cached: true, stale: !cached.fresh, rateLimited: true });
        }
        return res.json({ items: [], total: 0, rateLimited: true });
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/tracks", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "100"), 10)));
    const nextParam = typeof req.query.next === "string" ? req.query.next : "";
    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      const baseUrl = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
        t.userId
      )}/relationships/tracks?include=tracks,tracks.albums,tracks.artists,tracks.albums.coverArt&countryCode=${encodeURIComponent(
        countryCode
      )}&page[size]=${limit}`;

      // Support paging by allowing the client to pass the `links.next` URL back.
      // Validate it is a Tidal OpenAPI URL to avoid turning this into a general proxy.
      let url = baseUrl;
      if (nextParam) {
        const decoded = decodeURIComponent(nextParam);
        try {
          const u = new URL(decoded);
          if (u.hostname !== "openapi.tidal.com") {
            return res.status(400).json({ error: "Invalid next URL (host not allowed)" });
          }
          url = decoded;
        } catch {
          // ignore malformed next
        }
      }

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
          uri: `tidal://${trackId}`,
          lmsUri: `tidal://${trackId}`,
          source: "tidal",
        };
      });
      const next = data?.links?.next;
      const nextUrl = typeof next === "string" && next ? normalizeOpenApiNextLink(next) : null;
      res.json({ items, total: items.length, next: nextUrl });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /**
   * Fetch a larger sample of the user's Tidal track collection (paged via cursor).
   * Note: OpenAPI appears to ignore large page[size] values in some environments (often returning 20),
   * so we follow `links.next` until we reach the requested sample size or hit rate limits.
   */
  app.get("/api/tidal/tracks/sample", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });

    const requested = parseInt(String(req.query.limit || "300"), 10);
    const limit = Math.min(1000, Math.max(1, Number.isFinite(requested) ? requested : 300));
    const maxRequests = Math.min(80, Math.max(1, parseInt(String(req.query.maxRequests || "60"), 10) || 60));

    try {
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";
      let nextUrl: string | null =
        `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
          t.userId
        )}/relationships/tracks?include=tracks,tracks.albums,tracks.artists,tracks.albums.coverArt&countryCode=${encodeURIComponent(
          countryCode
        )}&page[size]=100`;

      const items: any[] = [];
      const seen = new Set<string>();
      let requests = 0;
      let rateLimited = false;

      while (nextUrl && items.length < limit && requests < maxRequests) {
        requests += 1;
        try {
          const data = await openApiGet(nextUrl, t.accessToken);
          const included: any[] = Array.isArray(data?.included) ? data.included : [];
          const tracksById = new Map<string, any>(included.filter((x) => x?.type === "tracks").map((x) => [String(x.id), x]));
          const albumsById = new Map<string, any>(included.filter((x) => x?.type === "albums").map((x) => [String(x.id), x]));
          const artistsById = new Map<string, any>(included.filter((x) => x?.type === "artists").map((x) => [String(x.id), x]));
          const artworksById = new Map<string, any>(included.filter((x) => x?.type === "artworks").map((x) => [String(x.id), x]));
          const dataArr: any[] = Array.isArray(data?.data) ? data.data : [];

          for (const rel of dataArr) {
            const trackId = String(rel?.id || "");
            if (!trackId || seen.has(trackId)) continue;
            seen.add(trackId);
            const track = tracksById.get(trackId);
            const artistId = track?.relationships?.artists?.data?.[0]?.id ? String(track.relationships.artists.data[0].id) : "";
            const artist = artistsById.get(artistId);
            const albumId = track?.relationships?.albums?.data?.[0]?.id ? String(track.relationships.albums.data[0].id) : "";
            const album = albumsById.get(albumId);
            const artworkId = album?.relationships?.coverArt?.data?.[0]?.id ? String(album.relationships.coverArt.data[0].id) : "";
            const artwork = artworksById.get(artworkId);
            items.push({
              id: trackId,
              title: track?.attributes?.title || "Track",
              artist: artist?.attributes?.name || track?.attributes?.artistName || "Unknown Artist",
              artistId,
              album: album?.attributes?.title || track?.attributes?.albumName || "Unknown Album",
              albumId,
              duration: track?.attributes?.duration ? Number(track.attributes.duration) : 0,
              artwork_url: pickArtworkUrl(artwork, "320x320"),
              uri: `tidal://${trackId}`,
              lmsUri: `tidal://${trackId}`,
              source: "tidal",
            });
            if (items.length >= limit) break;
          }

          const next = data?.links?.next;
          nextUrl = typeof next === "string" && next ? normalizeOpenApiNextLink(next) : null;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // If we get rate-limited, return whatever we have so the client can still proceed.
          if (msg.includes("Tidal OpenAPI error: 429")) {
            rateLimited = true;
            break;
          }
          throw err;
        }
      }

      return res.json({ items, total: items.length, rateLimited, requests });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
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
      // Totals are expensive and prone to 429; cache for longer than list endpoints.
      const TOTALS_TTL_MS = 5 * 60_000; // 5 minutes
      const cacheKey = `totals:${t.userId}`;
      const cached = cacheGet(cacheKey, TOTALS_TTL_MS);
      if (cached?.fresh) {
        return res.json({ ...cached.payload, cached: true });
      }

      // Prefer api.tidal.com "favorites" endpoints when possible: they provide totalNumberOfItems cheaply
      // and avoid OpenAPI cursor-walking (which can be slow and prone to next-link quirks / 429s).
      const countryCode = deriveCountryCodeFromAccessToken(t.accessToken) || "US";

      const apiTotal = async (
        pathWithQuery: string
      ): Promise<{ count: number | null; rateLimited: boolean }> => {
        const doFetch = async (token: string) => tidalApiGet(pathWithQuery, token, countryCode);
        let resp = await doFetch(t.accessToken);

        // Auto-refresh expired tokens for long-running .21 server.
        if (resp.status === 401 && tokens?.refreshToken) {
          const msg = resp.text || "";
          const looksExpired = msg.includes("Expired token") || msg.includes("AUTHENTICATION_ERROR") || msg.includes("UNAUTHORIZED");
          if (looksExpired) {
            try {
              const clientId = tokens.clientId || process.env.TIDAL_CLIENT_ID || getClientId();
              const refreshed = await refreshAccessToken(tokens.refreshToken, clientId);
              tokens = {
                ...tokens,
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken || tokens.refreshToken,
                userId: tokens.userId || refreshed.userId || deriveUserIdFromAccessToken(refreshed.accessToken),
                obtainedAt: Date.now(),
                clientId,
              };
              saveTokensToDisk();
              resp = await doFetch(tokens.accessToken);
            } catch {
              // fall through
            }
          }
        }

        if (resp.status === 429) return { count: null, rateLimited: true };
        if (resp.status < 200 || resp.status >= 300) return { count: null, rateLimited: false };

        const body = resp.json || {};
        const n = Number(body?.totalNumberOfItems ?? body?.total ?? NaN);
        return { count: Number.isFinite(n) ? n : null, rateLimited: false };
      };

      // These endpoints map closely to what users expect as "My Collection" counts.
      // IMPORTANT: Never return partial low counts when rate-limited — that is misleading.
      // If we can't get a reliable total for a category, return null (unknown) and let the UI show "—".
      const albumsV2 = await apiTotal(`/v2/users/${encodeURIComponent(t.userId!)}/favorites/albums?limit=1&offset=0`);
      const artistsV2 = await apiTotal(`/v2/users/${encodeURIComponent(t.userId!)}/favorites/artists?limit=1&offset=0`);
      const playlistsV2 = await apiTotal(`/v2/users/${encodeURIComponent(t.userId!)}/playlists?limit=1&offset=0`);
      // Best-effort; not all tokens support this endpoint.
      const tracksV2 = await apiTotal(`/v2/users/${encodeURIComponent(t.userId!)}/favorites/tracks?limit=1&offset=0`);

      // If v2 doesn't support a category, try OpenAPI meta totals (cheap) instead of cursor-walking.
      async function openApiMetaTotal(rel: "albums" | "artists" | "tracks" | "playlists"): Promise<{ count: number | null; rateLimited: boolean }> {
        const baseUrl = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
          t.userId!
        )}/relationships/${rel}?countryCode=${encodeURIComponent(countryCode)}`;
        try {
          const first = await openApiGet(`${baseUrl}&page[size]=1`, t.accessToken);
          const metaTotal = extractOpenApiTotal(first);
          if (metaTotal !== undefined && metaTotal >= 0) return { count: metaTotal, rateLimited: false };
          return { count: null, rateLimited: false };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("Tidal OpenAPI error: 429")) return { count: null, rateLimited: true };
          return { count: null, rateLimited: false };
        }
      }

      const albumsMeta = albumsV2.count === null ? await openApiMetaTotal("albums") : { count: null, rateLimited: false };
      const artistsMeta = artistsV2.count === null ? await openApiMetaTotal("artists") : { count: null, rateLimited: false };
      const tracksMeta = tracksV2.count === null ? await openApiMetaTotal("tracks") : { count: null, rateLimited: false };
      const playlistsMeta = playlistsV2.count === null ? await openApiMetaTotal("playlists") : { count: null, rateLimited: false };

      const rateLimited =
        albumsV2.rateLimited ||
        artistsV2.rateLimited ||
        tracksV2.rateLimited ||
        playlistsV2.rateLimited ||
        albumsMeta.rateLimited ||
        artistsMeta.rateLimited ||
        tracksMeta.rateLimited ||
        playlistsMeta.rateLimited;

      const payload = {
        albums: albumsV2.count ?? albumsMeta.count,
        artists: artistsV2.count ?? artistsMeta.count,
        tracks: tracksV2.count ?? tracksMeta.count,
        playlists: playlistsV2.count ?? playlistsMeta.count,
        rateLimited,
        partial: rateLimited,
        source: "api.tidal.com + openapi(meta)",
      };

      // If we got rate-limited, prefer cached values instead of returning null/partial.
      if (rateLimited && cached?.payload) {
        return res.json({ ...cached.payload, cached: true, stale: !cached.fresh, rateLimited: true, partial: true });
      }

      cacheSet(cacheKey, payload);
      return res.json(payload);

      // OpenAPI doesn’t provide a cheap "total count" field; count by walking cursors (bounded).
      // IMPORTANT: Tidal may rate-limit (429). When that happens, return partial counts with a flag
      // instead of failing (so the client doesn't show 0).
      // NOTE: fallback only if v2 totals aren't available for this token/client.

      async function countRelationship(
        rel: "albums" | "artists" | "tracks" | "playlists",
        opts: { maxItems?: number; maxRequests?: number }
      ): Promise<{ count: number | null; rateLimited: boolean }> {
        const maxItems = opts.maxItems ?? 5000;
        const maxRequests = opts.maxRequests ?? 80;
        let count = 0;
        let requests = 0;
        let rateLimited = false;
        // First try a cheap request and use `meta.total*` if available.
        const baseUrl = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
          t.userId!
        )}/relationships/${rel}?countryCode=${encodeURIComponent(countryCode)}`;
        try {
          const first = await openApiGet(`${baseUrl}&page[size]=1`, t.accessToken);
          const metaTotal = extractOpenApiTotal(first);
          if (metaTotal !== undefined && metaTotal >= 0) {
            return { count: metaTotal, rateLimited: false };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("Tidal OpenAPI error: 429")) {
            return { count: null, rateLimited: true };
          }
          // If meta fetch fails for another reason, fall through to cursor-walk attempt below.
        }

        let nextUrl = `${baseUrl}&page[size]=100`;
        while (nextUrl && count < maxItems && requests < maxRequests) {
          requests += 1;
          try {
            const page = await openApiGet(nextUrl, t.accessToken);
            const dataArr: any[] = Array.isArray(page?.data) ? page.data : [];
            count += dataArr.length;
            const next = page?.links?.next;
            nextUrl = typeof next === "string" && next ? normalizeOpenApiNextLink(next) : "";
            if (!nextUrl) break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("Tidal OpenAPI error: 429")) {
              rateLimited = true;
              break;
            }
            throw err;
          }
        }

        // If we got rate-limited before we could count anything, treat as unknown (null) rather than "0".
        // Otherwise the UI will misleadingly show "0" for that category.
        if (rateLimited && count === 0) {
          return { count: null, rateLimited: true };
        }
        return { count, rateLimited };
      }

      // IMPORTANT: run sequentially to avoid bursting Tidal OpenAPI and triggering 429s.
      const albumsR = await countRelationship("albums", { maxItems: 5000, maxRequests: 80 });
      const artistsR = await countRelationship("artists", { maxItems: 5000, maxRequests: 80 });
      const tracksR = await countRelationship("tracks", { maxItems: 5000, maxRequests: 80 });
      const playlistsR = await countRelationship("playlists", { maxItems: 5000, maxRequests: 80 });

      const rateLimited = albumsR.rateLimited || artistsR.rateLimited || tracksR.rateLimited || playlistsR.rateLimited;
      const partial = rateLimited;

      // If we got rate-limited before we could count anything, return nulls (unknown) instead of 0s.
      // This avoids the UI incorrectly showing "0" across the board.
      const allUnknownOrZero =
        (albumsR.count === null || albumsR.count === 0) &&
        (artistsR.count === null || artistsR.count === 0) &&
        (tracksR.count === null || tracksR.count === 0) &&
        (playlistsR.count === null || playlistsR.count === 0);
      if (rateLimited && allUnknownOrZero) {
        if (cached?.payload) {
          return res.json({ ...cached.payload, cached: true, stale: !cached.fresh, rateLimited: true, partial: true });
        }
        return res.json({ albums: null, artists: null, tracks: null, playlists: null, rateLimited: true, partial: true });
      }

      // If some relationships were rate-limited, prefer cached values for those fields; otherwise return null (unknown).
      const cachedPayload: any = cached?.payload || {};
      const payload = {
        albums: albumsR.count ?? (rateLimited ? cachedPayload.albums ?? null : null),
        artists: artistsR.count ?? (rateLimited ? cachedPayload.artists ?? null : null),
        tracks: tracksR.count ?? (rateLimited ? cachedPayload.tracks ?? null : null),
        playlists: playlistsR.count ?? (rateLimited ? cachedPayload.playlists ?? null : null),
        rateLimited,
        partial,
      };
      cacheSet(cacheKey, payload);
      res.json(payload);
    } catch (e) {
      // If we fail due to rate limit, return cached totals (even if stale) rather than 500.
      const cacheKey = `totals:${t.userId}`;
      const cached = cacheGet(cacheKey, 5 * 60_000);
      if (isRateLimitedError(e)) {
        if (cached?.payload) {
          return res.json({ ...cached.payload, cached: true, stale: !cached.fresh, rateLimited: true, partial: true });
        }
        return res.json({ albums: null, artists: null, tracks: null, playlists: null, rateLimited: true, partial: true });
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

}


