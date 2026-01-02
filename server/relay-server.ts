import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import dgram from "dgram";

// Import ChromecastService
const chromecastService = require('./chromecast-service.js');

// Configuration file path
const CONFIG_FILE = path.join(process.cwd(), 'server-config.json');

// Load saved configuration
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      console.log('[Relay] Loaded saved configuration:', config);
      return config;
    }
  } catch (e) {
    console.error('[Relay] Failed to load config:', e);
  }
  return {};
}

// Save configuration
function saveConfig(config: any) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('[Relay] Configuration saved');
  } catch (e) {
    console.error('[Relay] Failed to save config:', e);
  }
}

const savedConfig = loadConfig();

// Configuration
let LMS_HOST = savedConfig.lmsHost || process.env.LMS_HOST || '192.168.0.19';
let LMS_PORT = savedConfig.lmsPort || process.env.LMS_PORT || '9000';
// Stop casting shortly after playback stops/pauses.
// Default: 6s (matches user expectation); can be overridden via env.
const PAUSE_TIMEOUT = parseInt(process.env.PAUSE_TIMEOUT || '6000', 10);
const ENABLE_KEYBOARD = process.env.ENABLE_KEYBOARD !== 'false';

// Global state
let isCasting = false;
let pauseTimer: NodeJS.Timeout | null = null;
let currentPlayerId = savedConfig.currentPlayerId || '';
let lastMode = '';
let serverIp = '';

// Chromecast configuration
let chromecastIp = savedConfig.chromecastIp || process.env.CHROMECAST_IP || '';
let chromecastName = savedConfig.chromecastName || '';
let chromecastEnabled = savedConfig.chromecastEnabled !== undefined ? savedConfig.chromecastEnabled : true;

// DAC configuration
const DAC_IP = process.env.DAC_IP || '192.168.0.42';
const DAC_PORT = process.env.DAC_PORT || 80;

// Mosaic volume control
const MOSAIC_VOLUME_SCRIPT = path.join(process.cwd(), 'local-server', 'mosaic-volume.swift');
const MOSAIC_VOLUME_BINARY = path.join(process.cwd(), 'local-server', 'mosaic-volume');
let mosaicVolumeAvailable = false;

// Check if mosaic-volume binary exists
if (fs.existsSync(MOSAIC_VOLUME_BINARY)) {
  mosaicVolumeAvailable = true;
  console.log('[Relay] Mosaic volume control enabled (compiled binary)');
} else if (fs.existsSync(MOSAIC_VOLUME_SCRIPT)) {
  mosaicVolumeAvailable = true;
  console.log('[Relay] Mosaic volume control enabled (Swift script)');
}

// Chromecast is now handled by chromecastService (using castv2-client)
console.log('[Relay] Chromecast support enabled (using castv2-client)');


// LMS communication function
async function lmsRequest(playerId: string, command: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      id: 1,
      method: 'slim.request',
      params: [playerId || '', command]
    });

    const options = {
      hostname: LMS_HOST,
      port: parseInt(LMS_PORT),
      path: '/jsonrpc.js',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.result);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(postData);
    req.end();
  });
}

// Get available players
async function getPlayers(): Promise<any[]> {
  try {
    const result = await lmsRequest('', ['players', '0', '100']);
    return result.players_loop || [];
  } catch (e) {
    return [];
  }
}

// Get player status
async function getPlayerStatus(playerId: string): Promise<any> {
  try {
    return await lmsRequest(playerId, ['status', '-', '1', 'tags:aAlcdegiIKloNrstuwy']);
  } catch (e) {
    return null;
  }
}

// Chromecast functions
async function startCasting(): Promise<void> {
  const status = chromecastService.getStatus();
  if (status.isCasting) {
    console.log('[Relay] Already casting, skipping');
    return;
  }
  if (!chromecastIp) {
    console.log('[Relay] Chromecast not configured');
    return;
  }
  if (!chromecastEnabled) {
    console.log('[Relay] Chromecast disabled');
    return;
  }

  const nowPlayingUrl = `http://${serverIp}:3000/now-playing?host=${LMS_HOST}&port=${LMS_PORT}&player=${encodeURIComponent(currentPlayerId)}&v=${Date.now()}`;

  console.log(`[Relay] Starting cast to ${chromecastIp}: ${nowPlayingUrl}`);

  // Configure and start casting using ChromecastService
  chromecastService.configure(chromecastIp, chromecastName, true);
  const success = await chromecastService.castUrl(nowPlayingUrl);
  
  if (success) {
    isCasting = true;
    console.log('[Relay] Cast started successfully');
  } else {
    console.error('[Relay] Failed to start cast');
    isCasting = false;
  }
}

async function stopCasting(): Promise<void> {
  if (!isCasting) return;

  console.log('[Relay] Stopping cast...');

  await chromecastService.stop();
  isCasting = false;
}

// Format LMS status as NOW_PLAYING message for roon-cast receiver
const AUDIODB_API_KEY = process.env.AUDIODB_API_KEY || '2';
const ARTIST_IMAGE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const artistImageCache: Map<string, { images: string[]; fetchedAt: number }> = new Map();
const artistImageInFlight: Map<string, Promise<string[]>> = new Map();

async function fetchArtistImagesFromAudioDb(artistNameRaw: string): Promise<string[]> {
  const artistName = (artistNameRaw || '').trim();
  if (!artistName) return [];

  try {
    const url = `https://www.theaudiodb.com/api/v1/json/${AUDIODB_API_KEY}/search.php?s=${encodeURIComponent(artistName)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const artist = data?.artists?.[0];
    if (!artist) return [];

    const candidates = [
      artist.strArtistFanart,
      artist.strArtistFanart2,
      artist.strArtistFanart3,
      artist.strArtistFanart4,
      artist.strArtistThumb,
      artist.strArtistWideThumb,
    ].filter((u: any) => typeof u === 'string' && u.length > 0);

    // Deduplicate while preserving order
    const seen = new Set<string>();
    return candidates.filter((u: string) => (seen.has(u) ? false : (seen.add(u), true)));
  } catch (e) {
    console.warn('[Relay] AudioDB artist image fetch failed:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

async function fetchArtistImagesFromDeezer(artistNameRaw: string): Promise<string[]> {
  const artistName = (artistNameRaw || '').trim();
  if (!artistName) return [];
  try {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const hit = data?.data?.[0];
    if (!hit) return [];
    const candidates = [
      hit.picture_xl,
      hit.picture_big,
      hit.picture_medium,
      hit.picture,
      hit.picture_small,
    ].filter((u: any) => typeof u === 'string' && u.length > 0);
    return candidates.map((u: string) => u.replace(/^http:\/\//, 'https://'));
  } catch (e) {
    console.warn('[Relay] Deezer artist image fetch failed:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

async function fetchArtistImagesFromItunes(artistNameRaw: string): Promise<string[]> {
  const artistName = (artistNameRaw || '').trim();
  if (!artistName) return [];
  try {
    // iTunes doesn’t reliably provide artist fanart; use album artwork from search.
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&entity=album&limit=25`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    const candidates: string[] = [];
    for (const r of results) {
      const art = r?.artworkUrl100 || r?.artworkUrl60;
      if (typeof art === 'string' && art.length > 0) {
        candidates.push(
          art
            .replace(/^http:\/\//, 'https://')
            .replace(/100x100bb\.(jpg|png)/i, '600x600bb.$1')
        );
      }
    }
    const seen = new Set<string>();
    return candidates.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
  } catch (e) {
    console.warn('[Relay] iTunes artist image fetch failed:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

function mergeAndLimitArtistImages(primary: string[], ...rest: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const pushAll = (arr: string[]) => {
    for (const u of arr) {
      if (!u) continue;
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
      if (out.length >= 12) return;
    }
  };
  pushAll(primary);
  for (const r of rest) {
    if (out.length >= 12) break;
    pushAll(r);
  }
  return out;
}

async function fetchArtistImages(artistNameRaw: string): Promise<string[]> {
  const artistName = (artistNameRaw || '').trim();
  if (!artistName) return [];

  const cached = artistImageCache.get(artistName);
  if (cached && Date.now() - cached.fetchedAt < ARTIST_IMAGE_CACHE_TTL_MS) {
    return cached.images;
  }

  const inflight = artistImageInFlight.get(artistName);
  if (inflight) return inflight;

  const p = (async () => {
    try {
      const [a, d, i] = await Promise.all([
        fetchArtistImagesFromAudioDb(artistName),
        fetchArtistImagesFromDeezer(artistName),
        fetchArtistImagesFromItunes(artistName),
      ]);
      const images = mergeAndLimitArtistImages(a, d, i);
      artistImageCache.set(artistName, { images, fetchedAt: Date.now() });
      console.log(`[Relay] Artist images (merged): ${artistName} -> ${images.length}`);
      return images;
    } catch (e) {
      console.warn('[Relay] Artist image fetch failed:', e instanceof Error ? e.message : String(e));
      return [];
    } finally {
      artistImageInFlight.delete(artistName);
    }
  })();

  artistImageInFlight.set(artistName, p);
  return p;
}

function normalizePrimaryArtist(artist: string): string {
  if (!artist) return '';
  // LMS sometimes uses "A / B" - take primary artist for background
  if (artist.includes(' / ')) return artist.split(' / ')[0].trim();
  return artist.trim();
}

function formatNowPlayingMessage(status: any, artistImages: string[]): any {
  if (!status || !status.playlist_loop || status.playlist_loop.length === 0) {
    return null;
  }

  const track = status.playlist_loop[0];
  const artist = track.artist || 'Unknown Artist';
  const title = track.title || 'Unknown Track';
  const album = track.album || '';
  const duration = parseFloat(track.duration) || 0;
  const seek = parseFloat(status.time) || 0;
  const rawVolume = (status['mixer volume'] ?? status.mixer_volume ?? status.volume);
  const volumeNumber = typeof rawVolume === 'number' ? rawVolume : parseFloat(String(rawVolume));
  const rawMute = (status['mixer muting'] ?? status.mixer_muting ?? status.muting);
  const muteNumber = typeof rawMute === 'number' ? rawMute : parseInt(String(rawMute), 10);
  const isMuted = muteNumber === 1;
  
  // Build artwork URL
  let imageUrl = null;
  if (track.coverid) {
    imageUrl = `http://${LMS_HOST}:${LMS_PORT}/music/${track.coverid}/cover.jpg`;
  } else if (track.artwork_url) {
    imageUrl = track.artwork_url;
  }

  return {
    type: 'NOW_PLAYING',
    payload: {
      state: status.mode === 'play' ? 'playing' : status.mode === 'pause' ? 'paused' : 'stopped',
      seek_position: seek,
      output: {
        volume: Number.isFinite(volumeNumber)
          ? { type: 'number', min: 0, max: 100, value: volumeNumber, is_muted: isMuted }
          : null,
      },
      now_playing: {
        one_line: {
          line1: title
        },
        two_line: {
          line1: title,
          line2: artist
        },
        three_line: {
          line1: title,
          line2: artist,
          line3: album
        },
        length: duration,
        image_keys: [track.coverid || ''],
      },
      image_url: imageUrl,
      image_data: imageUrl,
      artist_images: artistImages || []
    }
  };
}

// Send NOW_PLAYING message to Chromecast
async function sendNowPlayingToCast(status: any): Promise<void> {
  if (!isCasting || !chromecastService.customChannel) {
    return;
  }

  const track = status?.playlist_loop?.[0];
  const primaryArtist = normalizePrimaryArtist(track?.artist || '');
  const artistImages = primaryArtist ? await fetchArtistImages(primaryArtist) : [];
  const message = formatNowPlayingMessage(status, artistImages);
  if (!message) return;

  try {
    console.log('[Relay] Sending NOW_PLAYING to Cast:', message.payload.now_playing.two_line.line1);
    chromecastService.customChannel.send(message);
  } catch (error) {
    console.error('[Relay] Error sending NOW_PLAYING:', error.message);
  }
}

// Send arbitrary messages to the custom receiver (used for volume overlay updates, etc.)
export function sendCustomMessageToCast(message: any): boolean {
  try {
    if (!isCasting || !chromecastService.customChannel) return false;
    chromecastService.customChannel.send(message);
    return true;
  } catch (error) {
    console.error('[Relay] Error sending custom message to cast:', (error as any)?.message || String(error));
    return false;
  }
}

// LMS status polling
async function pollLmsStatus(): Promise<void> {
  try {
    if (!currentPlayerId) {
      const players = await getPlayers();
      if (players.length > 0) {
        currentPlayerId = players[0].playerid;
        console.log('[Relay] Auto-selected player:', players[0].name);
      } else {
        return;
      }
    }

    const status = await getPlayerStatus(currentPlayerId);
    if (!status) return;

    const mode = status.mode;
    const hasTrack = status.playlist_loop && status.playlist_loop.length > 0;

    // Send NOW_PLAYING updates if casting
    if (hasTrack && isCasting && chromecastEnabled) {
      await sendNowPlayingToCast(status);
    }

    if (mode === 'play' && hasTrack) {
      if (pauseTimer) {
        clearTimeout(pauseTimer);
        pauseTimer = null;
      }

      if (!isCasting && chromecastIp && chromecastEnabled) {
        console.log('[Relay] Play detected, starting cast...');
        await startCasting();
      } else if (!chromecastEnabled) {
        console.log('[Relay] Casting disabled, skipping cast');
      }
    } else if (mode === 'pause' || mode === 'stop') {
      // Send pause state to receiver
      if (isCasting && chromecastService.customChannel) {
        try {
          chromecastService.customChannel.send({
            type: 'PAUSE',
            payload: {}
          });
        } catch (error) {
          console.error('[Relay] Error sending PAUSE:', error.message);
        }
      }
      
      if (isCasting && !pauseTimer) {
        console.log(`[Relay] Pause/stop detected, will stop cast in ${PAUSE_TIMEOUT/1000} seconds...`);
        pauseTimer = setTimeout(() => {
          console.log('[Relay] Pause timeout reached, stopping cast');
          stopCasting();
          pauseTimer = null;
        }, PAUSE_TIMEOUT);
      }
    }

    lastMode = mode;
  } catch (e) {
    console.error('[Relay] Poll error:', e.message);
  }
}

// Get local IP
function getLocalIp(): string {
  try {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return 'localhost';
}

// UPnP volume control
function sendUpnpCommand(ip: string, port: number, action: string, body: string): Promise<{ status: number, data: string }> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: ip,
      port: port,
      path: '/RenderingControl/ctrl',
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'Content-Length': Buffer.byteLength(body),
        'SOAPAction': `"urn:schemas-upnp-org:service:RenderingControl:1#${action}"`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, data }));
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('UPnP request timeout'));
    });
    req.write(body);
    req.end();
  });
}

// Mosaic volume control
function executeMosaicVolume(args: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const command = fs.existsSync(MOSAIC_VOLUME_BINARY)
      ? `"${MOSAIC_VOLUME_BINARY}" ${args}`
      : `swift "${MOSAIC_VOLUME_SCRIPT}" ${args}`;

    exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        try {
          const result = JSON.parse(stdout || stderr);
          reject(new Error(result.error || error.message));
        } catch {
          reject(new Error(error.message));
        }
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        reject(new Error(`Invalid JSON response: ${stdout}`));
      }
    });
  });
}

// Initialize relay server
export function initializeRelayServer(app: express.Application): void {
  serverIp = getLocalIp();
  console.log(`[Relay] Server IP: ${serverIp}`);

  // Configure chromecast service with saved config
  if (chromecastIp) {
    chromecastService.configure(chromecastIp, chromecastName, chromecastEnabled);
    console.log(`[Relay] Restored Chromecast configuration: ${chromecastName || chromecastIp} (${chromecastIp})`);
  }

  // Note: /now-playing route is handled by index.ts, not here

  // LMS proxy endpoint
  app.post('/api/lms/proxy', async (req, res) => {
    const { host, port, playerId, command } = req.body;
    const lmsHost = host || LMS_HOST;
    const lmsPort = port || LMS_PORT;

    try {
      const response = await fetch(`http://${lmsHost}:${lmsPort}/jsonrpc.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          method: 'slim.request',
          params: [playerId || '', command]
        })
      });
      const data = await response.json();
      res.json(data); // Return full JSON-RPC response, not just data.result
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // LMS-derived TIDAL library totals (fast + accurate, avoids TIDAL OpenAPI rate limits)
  // NOTE: Some TIDAL plugin commands require a playerId; we auto-pick the first player if none provided.
  app.get('/api/lms/tidal/totals', async (req, res) => {
    const host = (req.query.host as string) || LMS_HOST;
    const port = parseInt(String(req.query.port || LMS_PORT), 10);
    const requestedPlayerId = typeof req.query.playerId === 'string' ? req.query.playerId : '';

    async function lmsRequest(playerId: string, command: any[]) {
      const response = await fetch(`http://${host}:${port}/jsonrpc.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          method: 'slim.request',
          params: [playerId || '', command],
        }),
      });
      const data = await response.json();
      return data;
    }

    async function pickPlayerId(): Promise<string> {
      if (requestedPlayerId) return requestedPlayerId;
      const playersResp = await lmsRequest('', ['players', '0', '50']);
      const players = playersResp?.result?.players_loop || [];
      const pid = players?.[0]?.playerid;
      return typeof pid === 'string' ? pid : '';
    }

    try {
      const playerId = await pickPlayerId();
      if (!playerId) {
        return res.status(400).json({ error: 'No LMS players found (TIDAL plugin requires a playerId).' });
      }

      // These item_ids come from the TIDAL app menu returned by `tidal items 0 200`.
      // - 3: Playlists (user playlists)
      // - 4: Albums (user collection)
      // - 5: Songs (usually favorite tracks, not the full catalog)
      // - 6: Artists (user artists)
      const [albumsResp, artistsResp, playlistsResp, songsResp] = await Promise.all([
        lmsRequest(playerId, ['tidal', 'items', '0', '1', 'item_id:4']),
        lmsRequest(playerId, ['tidal', 'items', '0', '1', 'item_id:6']),
        lmsRequest(playerId, ['tidal', 'items', '0', '1', 'item_id:3']),
        lmsRequest(playerId, ['tidal', 'items', '0', '1', 'item_id:5']),
      ]);

      const toNum = (v: any) => {
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
        return Number.isFinite(n) ? n : null;
      };

      return res.json({
        albums: toNum(albumsResp?.result?.count),
        artists: toNum(artistsResp?.result?.count),
        playlists: toNum(playlistsResp?.result?.count),
        // IMPORTANT: TIDAL "Songs" in LMS is typically *favorites*, not total track count.
        tracks: toNum(songsResp?.result?.count),
        playerId,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Status endpoint
  app.get('/api/status', async (req, res) => {
    res.json({
      lmsHost: LMS_HOST,
      lmsPort: LMS_PORT,
      chromecastIp: chromecastIp,
      chromecastName: chromecastName,
      isCasting,
      currentPlayerId,
      lastMode,
      serverIp
    });
  });

  // LMS configuration
  app.post('/api/lms', async (req, res) => {
    const { host, port } = req.body;

    if (host !== undefined) {
      if (!host || typeof host !== 'string') {
        return res.status(400).json({ error: 'Valid host/IP address is required' });
      }
      LMS_HOST = host;
      console.log(`[Relay] LMS Host updated to: ${LMS_HOST}`);
    }

    if (port !== undefined) {
      const portNum = parseInt(port);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        return res.status(400).json({ error: 'Valid port number (1-65535) is required' });
      }
      LMS_PORT = String(portNum);
      console.log(`[Relay] LMS Port updated to: ${LMS_PORT}`);
    }

    currentPlayerId = '';
    res.json({
      success: true,
      message: `LMS server updated to ${LMS_HOST}:${LMS_PORT}`,
      lmsHost: LMS_HOST,
      lmsPort: LMS_PORT
    });
  });

  // Players endpoint
  app.get('/api/players', async (req, res) => {
    try {
      const players = await getPlayers();
      res.json({ players });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Chromecast configuration
  app.post('/api/chromecast', async (req, res) => {
    const { ip, name, enabled } = req.body;

    if (ip !== undefined) {
      if (!ip) {
        return res.status(400).json({ error: 'IP address is required' });
      }

      const oldIp = chromecastIp;
      chromecastIp = ip;
      chromecastName = name || '';

      if (isCasting) {
        stopCasting();
      }

      if (chromecastIp) {
        console.log(`[Relay] Chromecast configured: ${chromecastName} (${chromecastIp})`);
      }
    }

    if (enabled !== undefined) {
      chromecastEnabled = enabled;
      console.log(`[Relay] Chromecast enabled set to: ${chromecastEnabled}`);

      if (!chromecastEnabled && isCasting) {
        stopCasting();
      }
    }

    // Save configuration
    saveConfig({
      lmsHost: LMS_HOST,
      lmsPort: LMS_PORT,
      chromecastIp,
      chromecastName,
      chromecastEnabled,
      currentPlayerId
    });

    res.json({
      success: true,
      message: chromecastIp ? `Configured ${chromecastName || chromecastIp}` : 'Chromecast disabled',
      chromecastIp,
      chromecastName,
      chromecastEnabled
    });
  });

  app.delete('/api/chromecast', (req, res) => {
    chromecastIp = '';
    chromecastName = '';

    if (isCasting) {
      stopCasting();
    }

    // Save configuration
    saveConfig({
      lmsHost: LMS_HOST,
      lmsPort: LMS_PORT,
      chromecastIp: '',
      chromecastName: '',
      chromecastEnabled: false,
      currentPlayerId
    });

    res.json({ success: true, message: 'Chromecast disabled' });
  });

  // UPnP volume control
  app.post('/api/upnp/volume', async (req, res) => {
    const { action, ip, port, volume, mute } = req.body;
    const targetIp = ip || DAC_IP;
    const targetPort = port || DAC_PORT;

    try {
      if (action === 'get') {
        const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
    </u:GetVolume>
  </s:Body>
</s:Envelope>`;

        console.log(`[Relay] UPnP GetVolume from ${targetIp}:${targetPort}`);
        const result = await sendUpnpCommand(targetIp, targetPort, 'GetVolume', soapBody);
        console.log('[Relay] UPnP raw response:', result.data);

        const volumeValue = parseVolumeFromResponse(result.data);

        if (volumeValue !== null) {
          res.json({ volume: volumeValue, raw: result.data });
        } else {
          res.json({ volume: 50, raw: result.data, warning: 'Could not parse volume' });
        }

      } else if (action === 'set') {
        const volumeValue = percentToDb(volume);

        const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredVolume>${volumeValue}</DesiredVolume>
    </u:SetVolume>
  </s:Body>
</s:Envelope>`;

        console.log(`[Relay] UPnP SetVolume to ${targetIp}:${targetPort}: ${volume}% (${volumeValue}dB)`);
        const result = await sendUpnpCommand(targetIp, targetPort, 'SetVolume', soapBody);
        console.log('[Relay] UPnP SetVolume response:', result.status);

        res.json({ success: result.status === 200, volumePercent: volume, volumeDb: volumeValue });

      } else if (action === 'mute') {
        const muteValue = mute ? '1' : '0';
        const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetMute xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredMute>${muteValue}</DesiredMute>
    </u:SetMute>
  </s:Body>
</s:Envelope>`;

        console.log(`[Relay] UPnP SetMute to ${targetIp}:${targetPort}: ${mute}`);
        const result = await sendUpnpCommand(targetIp, targetPort, 'SetMute', soapBody);

        res.json({ success: result.status === 200 });

      } else {
        res.status(400).json({ error: 'Invalid action. Use: get, set, or mute' });
      }

    } catch (error) {
      console.error('[Relay] UPnP error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Mosaic volume control
  app.get('/api/mosaic/volume', async (req, res) => {
    if (!mosaicVolumeAvailable) {
      return res.status(503).json({
        success: false,
        error: 'Mosaic volume control not available',
        hint: 'Ensure mosaic-volume.swift exists'
      });
    }

    try {
      const result = await executeMosaicVolume('--get');
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/mosaic/volume', async (req, res) => {
    if (!mosaicVolumeAvailable) {
      return res.status(503).json({
        success: false,
        error: 'Mosaic volume control not available'
      });
    }

    const { action, value } = req.body;

    try {
      let args;
      switch (action) {
        case 'get':
          args = '--get';
          break;
        case 'set':
          if (value === undefined) {
            return res.status(400).json({ success: false, error: 'Volume value required for set action' });
          }
          args = `--set ${value}`;
          break;
        case 'up':
          args = value !== undefined ? `--up ${value}` : '--up';
          break;
        case 'down':
          args = value !== undefined ? `--down ${value}` : '--down';
          break;
        case 'mute':
          args = '--mute';
          break;
        default:
          return res.status(400).json({
            success: false,
            error: 'Invalid action. Use: get, set, up, down, or mute'
          });
      }

      const result = await executeMosaicVolume(args);
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/mosaic/sliders', async (req, res) => {
    if (!mosaicVolumeAvailable) {
      return res.status(503).json({
        success: false,
        error: 'Mosaic volume control not available'
      });
    }

    try {
      const result = await executeMosaicVolume('--list');
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Start LMS polling
  console.log('[Relay] Starting LMS status polling...');
  setInterval(pollLmsStatus, 2000);
  pollLmsStatus();
}

// Helper functions that were defined inline
function parseVolumeFromResponse(xml: string): number | null {
  const match = xml.match(/<CurrentVolume>([^<]+)<\/CurrentVolume>/i);
  if (match) {
    const value = match[1].trim();
    const dbMatch = value.match(/^-?\d+(\.\d+)?$/);
    if (dbMatch) {
      const num = parseFloat(value);
      if (num <= 0 && num >= -80) {
        const percent = Math.round(((num + 80) / 80) * 100);
        console.log(`[Relay] Volume: ${value}dB = ${percent}%`);
        return percent;
      }
      return Math.round(Math.max(0, Math.min(100, num)));
    }
  }
  return null;
}

function percentToDb(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const db = ((clamped / 100) * 80) - 80;
  return db.toFixed(1);
}
