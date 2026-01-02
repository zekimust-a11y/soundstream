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

function pickArtworkUrl(artwork: any, preferred = "320x320"): string | null {
  const files: any[] = artwork?.attributes?.files;
  if (!Array.isArray(files)) return null;
  const preferredFile = files.find((f) => typeof f?.href === "string" && f.href.includes(preferred));
  const first = files.find((f) => typeof f?.href === "string");
  return (preferredFile?.href || first?.href || null) as string | null;
}

export function registerTidalRoutes(app: Express): void {
  loadTokensFromDisk();

  // Generate OAuth authorization URL (PKCE)
  app.get("/api/tidal/auth-url", (req: Request, res: Response) => {
    const platform = (String(req.query.platform || "").toLowerCase() === "web" ? "web" : "mobile") as
      | "web"
      | "mobile";

    const clientId = getClientId();
    const redirectUri =
      platform === "web"
        ? `${req.protocol}://${req.get("host")}/api/tidal/callback`
        : "soundstream://callback";

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString("hex");

    // NOTE: Requesting the legacy `r_usr` scope can trigger TIDAL OAuth error 1002 for some public client IDs.
    // We start with the modern granular scopes; if TIDAL later requires extra scopes, we can revisit with a
    // compatible client id / scope set.
    const scope =
      "user.read collection.read collection.write playlists.read playlists.write search.read search.write playback recommendations.read entitlements.read";

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
    res.json({ authUrl, redirectUri, state, platform });
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
      const url = `https://openapi.tidal.com/v2/userRecommendations/${encodeURIComponent(
        t.userId
      )}/relationships/myMixes?include=mixes,mixes.coverArt&countryCode=US`;
      const data = await openApiGet(url, t.accessToken);
      const included: any[] = Array.isArray(data?.included) ? data.included : [];
      const mixes = included.filter((x) => x?.type === "mixes");
      const artworks = included.filter((x) => x?.type === "artworks");
      const items = mixes.map((mix: any) => {
        const coverRel = mix?.relationships?.coverArt?.data?.[0];
        const artwork = coverRel ? artworks.find((a: any) => a?.id === coverRel.id) : null;
        return {
          id: String(mix.id),
          title: mix?.attributes?.title || "Mix",
          description: mix?.attributes?.subTitle || "",
          artwork_url: pickArtworkUrl(artwork, "320x320"),
          lmsUri: `tidal://mix:${mix.id}`,
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

    const limit = Math.min(5000, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10));
    try {
      const url = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
        t.userId
      )}/relationships/albums?include=albums,albums.artists,albums.coverArt&countryCode=US&limit=${limit}&offset=${offset}`;
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
          numberOfTracks: album?.attributes?.numberOfTracks,
          artwork_url: pickArtworkUrl(artwork, "320x320"),
          lmsUri: `tidal://album:${albumId}`,
          source: "tidal",
        };
      });

      res.json({ items, total: data?.meta?.totalNumberOfItems || items.length });
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
      const url = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
        t.userId
      )}/relationships/artists?include=artists&countryCode=US&limit=${limit}&offset=${offset}`;
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
      res.json({ items, total: data?.meta?.totalNumberOfItems || items.length });
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
      const url = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
        t.userId
      )}/relationships/playlists?include=playlists,playlists.coverArt&countryCode=US&limit=${limit}&offset=${offset}`;
      const data = await openApiGet(url, t.accessToken);
      const included: any[] = Array.isArray(data?.included) ? data.included : [];
      const playlistsById = new Map<string, any>(
        included.filter((x) => x?.type === "playlists").map((x) => [String(x.id), x])
      );
      const artworksById = new Map<string, any>(
        included.filter((x) => x?.type === "artworks").map((x) => [String(x.id), x])
      );

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
          title: playlist?.attributes?.title || "Playlist",
          description: playlist?.attributes?.description || "",
          numberOfTracks: playlist?.attributes?.numberOfTracks,
          artwork_url: pickArtworkUrl(artwork, "320x320"),
          lmsUri: `tidal://playlist:${playlistId}`,
          source: "tidal",
        };
      });

      res.json({ items, total: data?.meta?.totalNumberOfItems || items.length });
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
      const url = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(
        t.userId
      )}/relationships/tracks?include=tracks,tracks.albums,tracks.artists,tracks.albums.coverArt&countryCode=US&limit=${limit}&offset=${offset}`;
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
          duration: track?.attributes?.duration || 0,
          artwork_url: pickArtworkUrl(artwork, "320x320"),
          uri: `tidal://track:${trackId}`,
          lmsUri: `tidal://track:${trackId}`,
          source: "tidal",
        };
      });

      res.json({ items, total: data?.meta?.totalNumberOfItems || items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/albums/:albumId/tracks", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    const albumId = String(req.params.albumId);
    try {
      const url = `https://openapi.tidal.com/v2/albums/${encodeURIComponent(
        albumId
      )}/relationships/tracks?include=tracks,tracks.artists,tracks.albums,tracks.albums.coverArt&countryCode=US`;
      const data = await openApiGet(url, t.accessToken);
      // Reuse track mapping by pretending it’s a tracks relationship list:
      const wrapped = { ...data, meta: { totalNumberOfItems: data?.meta?.totalNumberOfItems } };
      return res.json(wrapped);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/playlists/:playlistId/tracks", async (req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    const playlistId = String(req.params.playlistId);
    try {
      const url = `https://openapi.tidal.com/v2/playlists/${encodeURIComponent(
        playlistId
      )}/relationships/tracks?include=tracks,tracks.artists,tracks.albums,tracks.albums.coverArt&countryCode=US`;
      const data = await openApiGet(url, t.accessToken);
      const wrapped = { ...data, meta: { totalNumberOfItems: data?.meta?.totalNumberOfItems } };
      return res.json(wrapped);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/tidal/totals", async (_req: Request, res: Response) => {
    const t = requireTokens(res);
    if (!t) return;
    if (!t.userId) return res.status(400).json({ error: "Missing userId. Reconnect Tidal." });
    try {
      // Cheapest way: ask each relationship for meta total with limit=1
      const base = `https://openapi.tidal.com/v2/userCollections/${encodeURIComponent(t.userId)}/relationships`;
      const [albums, artists, tracks, playlists] = await Promise.all([
        openApiGet(`${base}/albums?countryCode=US&limit=1&offset=0`, t.accessToken),
        openApiGet(`${base}/artists?countryCode=US&limit=1&offset=0`, t.accessToken),
        openApiGet(`${base}/tracks?countryCode=US&limit=1&offset=0`, t.accessToken),
        openApiGet(`${base}/playlists?countryCode=US&limit=1&offset=0`, t.accessToken),
      ]);
      res.json({
        albums: albums?.meta?.totalNumberOfItems || 0,
        artists: artists?.meta?.totalNumberOfItems || 0,
        tracks: tracks?.meta?.totalNumberOfItems || 0,
        playlists: playlists?.meta?.totalNumberOfItems || 0,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}


