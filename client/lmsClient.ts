import { Platform } from 'react-native';
import { debugLog } from './debugLog';
import { getApiUrl } from './query-client';

export interface LmsServer {
  id: string;
  name: string;
  host: string;
  port: number;
  version?: string;
  type?: string; // 'lms' | 'upnp' | 'minimserver'
}

export interface LmsPlayer {
  id: string;
  name: string;
  model: string;
  isPlaying: boolean;
  power: boolean;
  volume: number;
  connected: boolean;
  ip?: string;
}

export interface LmsAlbum {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  artwork_url?: string;
  year?: number;
  trackCount?: number;
  url?: string; // URL for source detection (Tidal, Spotify, etc.)
}

export interface LmsArtist {
  id: string;
  name: string;
  albumCount?: number;
  artworkUrl?: string;
}

export interface LmsPlaylist {
  id: string;
  name: string;
  url?: string;
  trackCount?: number;
  artwork_url?: string;
}

export interface LmsRadioStation {
  id: string;
  name: string;
  url?: string;
  image?: string;
}

export interface LmsTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId?: string;
  artistId?: string;
  duration: number;
  trackNumber?: number;
  artwork_url?: string;
  url?: string;
  format?: string;
  bitrate?: string;
  sampleRate?: string;
  bitDepth?: string;
}

export interface LmsPlaylistTrack extends LmsTrack {
  playlist_index: number;
}

export interface LmsPlayerStatus {
  power: boolean;
  mode: 'play' | 'pause' | 'stop';
  volume: number;
  shuffle: number;
  repeat: number;
  time: number;
  duration: number;
  currentTrack?: LmsTrack;
  playlist: LmsPlaylistTrack[];
  playlistLength: number;
}

interface LmsJsonRpcResponse {
  id: number;
  method: string;
  params: [string, string[]];
  result?: Record<string, unknown>;
  error?: string;
}

class LmsClient {
  private baseUrl: string = '';
  private serverHost: string = '';
  private serverPort: number = 9000;
  private serverProtocol: 'http' | 'https' = 'http';
  private requestId: number = 1;

  /**
   * Set LMS server connection
   * Supports both formats:
   * - setServer('192.168.1.100', 9000) - legacy format
   * - setServer('https://lms.example.com:9000') - full URL format for remote access
   */
  setServer(hostOrUrl: string, port?: number): void {
    // Check if it's a full URL (starts with http:// or https://)
    if (hostOrUrl.startsWith('http://') || hostOrUrl.startsWith('https://')) {
      try {
        const url = new URL(hostOrUrl);
        this.serverProtocol = url.protocol === 'https:' ? 'https' : 'http';
        this.serverHost = url.hostname;
        this.serverPort = url.port ? parseInt(url.port, 10) : (this.serverProtocol === 'https' ? 443 : 9000);
        this.baseUrl = `${this.serverProtocol}://${url.hostname}${url.port ? `:${url.port}` : ''}`;
        debugLog.info('LMS server set (remote URL)', `${this.baseUrl}`);
      } catch (error) {
        throw new Error(`Invalid LMS server URL: ${hostOrUrl}`);
      }
    } else {
      // Legacy format: host and port
      this.serverHost = hostOrUrl;
      this.serverPort = port || 9000;
      this.serverProtocol = 'http';
      this.baseUrl = `http://${hostOrUrl}:${this.serverPort}`;
      debugLog.info('LMS server set (local)', `${this.baseUrl}`);
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request(playerId: string, command: string[]): Promise<Record<string, unknown>> {
    if (!this.baseUrl) {
      throw new Error('LMS server not configured');
    }

    const requestBody = {
      id: this.requestId++,
      method: 'slim.request',
      params: [playerId, command],
    };

    debugLog.request('LMS', `${command.join(' ')}`);

      // Direct LMS connection for web platform - bypass proxy issues
      if (Platform.OS === 'web') {
        try {
          const jsonRpcUrl = `${this.baseUrl}/jsonrpc.js`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

          const response = await fetch(jsonRpcUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Connection': 'close',
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
          }

          const data: LmsJsonRpcResponse = await response.json();

          if (data.error) {
            throw new Error(data.error);
          }

          debugLog.response('LMS', 'OK (direct)');
          return data.result || {};
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (error instanceof Error && error.name === 'AbortError') {
            debugLog.error('LMS direct request timeout', 'Request took longer than 10 seconds');
            throw new Error('Direct request timeout - LMS may be unreachable or blocking connections');
          }
          debugLog.error('LMS direct request failed', errorMessage);
          throw error;
        }
      }

    // On native platforms, use direct connection (supports both HTTP and HTTPS)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      // baseUrl now supports both http:// and https:// for remote access
      const jsonRpcUrl = `${this.baseUrl}/jsonrpc.js`;
      const response = await fetch(jsonRpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: LmsJsonRpcResponse = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      debugLog.response('LMS', 'OK');
      return data.result || {};
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.name === 'AbortError') {
        // Timeout errors are expected when server is unreachable - log as info
        debugLog.info('LMS request timeout', 'Request took longer than 10 seconds');
        throw new Error('Request timeout - server may be unreachable');
      }
      // For network errors when no server is configured, log as info instead of error
      // This prevents red error screens when the app starts without a server
      if (errorMessage.includes('Network request failed') || 
          errorMessage.includes('Failed to fetch') ||
          errorMessage.includes('LMS server not configured')) {
        // Only log network errors occasionally to avoid spam
        if (Math.random() < 0.1) { // Log ~10% of network errors
          debugLog.info('LMS request failed (expected when no server configured)', errorMessage);
        }
      } else {
        debugLog.error('LMS request failed', errorMessage);
      }
      throw error;
    }
  }

  async getServerStatus(): Promise<{ name: string; version: string; playerCount: number }> {
    const result = await this.request('', ['serverstatus', '0', '999']);
    return {
      name: String(result.player_count !== undefined ? 'Logitech Media Server' : 'LMS'),
      version: String(result.version || 'unknown'),
      playerCount: Number(result.player_count || 0),
    };
  }

  async getPlayers(): Promise<LmsPlayer[]> {
    const result = await this.request('', ['players', '0', '100']);
    const playersLoop = (result.players_loop || []) as Array<Record<string, unknown>>;
    
    return playersLoop.map((p) => ({
      id: String(p.playerid || ''),
      name: String(p.name || 'Unknown Player'),
      model: String(p.model || 'Unknown'),
      isPlaying: p.isplaying === 1,
      power: p.power === 1,
      volume: Number(p['mixer volume'] || 0),
      connected: p.connected === 1,
      ip: String(p.ip || ''),
    }));
  }

  async getPlayerStatus(playerId: string): Promise<LmsPlayerStatus> {
    // Use '0' to fetch from start so playlist_cur_index aligns with array indices
    // Include 'S' tag for samplesize (bit depth) information
    const result = await this.request(playerId, ['status', '0', '100', 'tags:acdlKNuTS']);
    
    const playlistLoop = (result.playlist_loop || []) as Array<Record<string, unknown>>;
    const playlist = playlistLoop.map((t, index) => this.parseTrack(t, index));

    // Get current track using playlist_cur_index
    const curIndex = Number(result.playlist_cur_index || 0);
    const currentTrack = playlist.length > 0 ? playlist[curIndex] : undefined;

    return {
      power: result.power === 1,
      mode: String(result.mode || 'stop') as 'play' | 'pause' | 'stop',
      volume: Number(result['mixer volume'] || 0),
      shuffle: Number(result.playlist_shuffle || 0),
      repeat: Number(result.playlist_repeat || 0),
      time: Number(result.time || 0),
      duration: Number(result.duration || 0),
      currentTrack,
      playlist,
      playlistLength: Number(result.playlist_tracks || 0),
    };
  }

  private parseTrack(data: Record<string, unknown>, playlistIndex?: number): LmsPlaylistTrack {
    // Check multiple duration fields (Qobuz uses 'duration', LMS uses 'duration' in seconds)
    const durationSec = Number(data.duration || data.secs || data.time || 0);
    
    let format: string | undefined;
    let bitrate: string | undefined;
    let sampleRate: string | undefined;
    let bitDepth: string | undefined;

    const contentType = String(data.type || data.content_type || '');
    if (contentType.includes('flac') || contentType.includes('flc')) format = 'FLAC';
    else if (contentType.includes('wav')) format = 'WAV';
    else if (contentType.includes('mp3')) format = 'MP3';
    else if (contentType.includes('aac') || contentType.includes('m4a')) format = 'AAC';
    else if (contentType.includes('aiff')) format = 'AIFF';
    else if (contentType.includes('dsf') || contentType.includes('dsd')) format = 'DSD';
    else if (contentType.includes('ogg')) format = 'OGG';
    else if (contentType.includes('alac')) format = 'ALAC';

    if (data.bitrate) {
      const br = Number(data.bitrate);
      bitrate = br >= 1000 ? `${(br / 1000).toFixed(0)} kbps` : `${br} bps`;
    }

    if (data.samplerate) {
      const sr = Number(data.samplerate);
      sampleRate = sr >= 1000 ? `${(sr / 1000).toFixed(1)} kHz` : `${sr} Hz`;
    }

    // Check multiple possible field names for bit depth
    if (data.samplesize) {
      bitDepth = `${data.samplesize}-bit`;
    } else if (data.bits_per_sample) {
      bitDepth = `${data.bits_per_sample}-bit`;
    } else if (data.bitdepth) {
      bitDepth = `${data.bitdepth}-bit`;
    } else if (data.bits) {
      bitDepth = `${data.bits}-bit`;
    }

    let artworkUrl: string | undefined;
    // Try multiple field names for artwork URL (LMS uses various field names depending on source)
    // Qobuz/Material Skin uses "image" or "icon" fields
    // Priority order: image > icon > artwork_url > other direct URL fields, then ID-based fields
    if (data.image) {
      artworkUrl = String(data.image);
    } else if (data.icon) {
      artworkUrl = this.normalizeArtworkUrl(String(data.icon));
    } else if (data.artwork_url) {
      artworkUrl = this.normalizeArtworkUrl(String(data.artwork_url));
    } else if (data.cover) {
      const rawUrl = String(data.cover);
      artworkUrl = rawUrl.startsWith('http') ? rawUrl : `${this.baseUrl}${rawUrl}`;
    } else if (data.coverart) {
      const rawUrl = String(data.coverart);
      artworkUrl = rawUrl.startsWith('http') ? rawUrl : `${this.baseUrl}${rawUrl}`;
    } else if (data.artwork_track_id) {
      artworkUrl = `${this.baseUrl}/music/${data.artwork_track_id}/cover.jpg`;
    } else if (data.coverid) {
      artworkUrl = `${this.baseUrl}/music/${data.coverid}/cover.jpg`;
    } else if (data['icon-id']) {
      artworkUrl = `${this.baseUrl}/music/${data['icon-id']}/cover.jpg`;
    }
    
    // Log if no artwork found for debugging (only log first 3 per session to avoid spam)
    if (!artworkUrl && playlistIndex !== undefined && playlistIndex < 3) {
      debugLog.info('parseTrack', `No artwork found for track. Available fields: ${Object.keys(data).join(', ')}`);
    }

    // For Qobuz menu items, extract track info from text field (format: "Title - Artist" or just "Title")
    let trackTitle = String(data.title || 'Unknown');
    let trackArtist = String(data.artist || data.trackartist || 'Unknown Artist');
    
    // Qobuz items often have 'text' field instead of 'title'
    if (!data.title && data.text) {
      const text = String(data.text);
      // Check if text contains " - " separator (common format for "Title - Artist")
      if (text.includes(' - ')) {
        const parts = text.split(' - ');
        trackTitle = parts[0].trim();
        // If no artist field, use the second part as artist
        if (!data.artist && !data.trackartist) {
          trackArtist = parts.slice(1).join(' - ').trim();
        }
      } else {
        trackTitle = text;
      }
    }
    
    // Also check 'name' field as fallback
    if (trackTitle === 'Unknown' && data.name) {
      trackTitle = String(data.name);
    }

    return {
      id: String(data.id || data.track_id || data.item_id || `${playlistIndex}`),
      title: trackTitle,
      artist: trackArtist,
      album: String(data.album || 'Unknown Album'),
      albumId: data.album_id ? String(data.album_id) : undefined,
      artistId: data.artist_id ? String(data.artist_id) : undefined,
      duration: durationSec,
      trackNumber: data.tracknum ? Number(data.tracknum) : undefined,
      artwork_url: artworkUrl,
      url: data.url ? String(data.url) : undefined,
      format,
      bitrate,
      sampleRate,
      bitDepth,
      playlist_index: playlistIndex ?? 0,
    };
  }

  async getAlbumsPage(start: number = 0, limit: number = 50, artistId?: string): Promise<{ albums: LmsAlbum[], total: number }> {
    // Ensure limit is at least 1 to avoid requesting 0 albums
    const actualLimit = Math.max(1, limit);

    // For local library only, we need to browse the music folder specifically
    // Instead of using the global 'albums' command which includes all sources,
    // we'll browse the 'my music' -> 'music folder' section

    debugLog.info('getAlbumsPage', `Requesting LOCAL albums only: start=${start}, limit=${actualLimit}, artistId=${artistId || 'none'}`);

    try {
      // First, get the music folder contents by browsing to the local music folder
      // The music folder is typically at path "music" under "my music"
      const musicFolderCommand = ['browse', 'music', String(start), String(actualLimit), 'tags:aajlyST'];
      if (artistId) {
        musicFolderCommand.push(`artist_id:${artistId}`);
      }

      debugLog.info('getAlbumsPage', `Using music folder command: ${musicFolderCommand.join(' ')}`);
      const result = await this.request('', musicFolderCommand);

      // LMS returns different structures for browse vs albums commands
      const albumsLoop = (result.albums_loop || result.loop_loop || result.items_loop || []) as Array<Record<string, unknown>>;
      const total = Number(result.count) || albumsLoop.length;

      debugLog.info('getAlbumsPage', `Music folder returned ${albumsLoop.length} albums, total=${total}`);

      // If no albums returned from music folder browse, fall back to filtered global albums
      if (albumsLoop.length === 0) {
        debugLog.info('getAlbumsPage', 'Music folder returned no albums, falling back to filtered global albums');
        throw new Error('Music folder browse returned no albums');
      }

      const albums = albumsLoop
        .filter((a) => {
          // Filter out any remaining plugin content (double-check)
          const url = String(a.url || '').toLowerCase();
          const id = String(a.id || '').toLowerCase();
          const artworkUrl = String(a.artwork_url || '').toLowerCase();

          // Skip if it contains plugin identifiers
          const isPluginContent = url.includes('tidal') || id.includes('tidal') || artworkUrl.includes('tidal') ||
                                 url.includes('qobuz') || id.includes('qobuz') || artworkUrl.includes('qobuz') ||
                                 url.includes('spotify') || id.includes('spotify') || artworkUrl.includes('spotify') ||
                                 url.includes('soundcloud') || id.includes('soundcloud') || artworkUrl.includes('soundcloud');

          if (isPluginContent) {
            debugLog.info('getAlbumsPage', `Filtering out plugin content: ${String(a.album || a.title || '')}`);
            return false;
          }

          return true;
        })
        .map((a) => ({
          id: String(a.id || ''),
          title: String(a.album || a.title || ''),
          artist: String(a.artist || ''),
          artistId: a.artist_id ? String(a.artist_id) : undefined,
          artwork_url: a.artwork_track_id ? `${this.baseUrl}/music/${a.artwork_track_id}/cover.jpg` :
            (a.artwork_url ? (String(a.artwork_url).startsWith('http') ? String(a.artwork_url) : `${this.baseUrl}${a.artwork_url}`) : undefined),
          year: a.year ? Number(a.year) : undefined,
          trackCount: a.track_count ? Number(a.track_count) : undefined,
          url: a.url ? String(a.url) : undefined,
        }));

      debugLog.info('getAlbumsPage', `After filtering plugin content: ${albums.length} local albums`);
      return { albums, total: albums.length };

    } catch (error) {
      debugLog.info('getAlbumsPage', `Music folder browse failed: ${error}, falling back to filtered global albums`);

      // Fallback: use global albums command but filter out plugin content
      const command = artistId
        ? ['albums', String(start), String(actualLimit), `artist_id:${artistId}`, 'tags:aajlyST']
        : ['albums', String(start), String(actualLimit), 'tags:aajlyST'];

      const result = await this.request('', command);
      const albumsLoop = (result.albums_loop || []) as Array<Record<string, unknown>>;
      const total = Number(result.count) || 0;

      debugLog.info('getAlbumsPage', `Fallback: Received ${albumsLoop.length} albums from global command, total=${total}`);

      const albums = albumsLoop
        .filter((a) => {
          // Filter out plugin content
          const url = String(a.url || '').toLowerCase();
          const id = String(a.id || '').toLowerCase();
          const artworkUrl = String(a.artwork_url || '').toLowerCase();

          const isPluginContent = url.includes('tidal') || id.includes('tidal') || artworkUrl.includes('tidal') ||
                                 url.includes('qobuz') || id.includes('qobuz') || artworkUrl.includes('qobuz') ||
                                 url.includes('spotify') || id.includes('spotify') || artworkUrl.includes('spotify') ||
                                 url.includes('soundcloud') || id.includes('soundcloud') || artworkUrl.includes('soundcloud');

          return !isPluginContent;
        })
        .map((a) => ({
          id: String(a.id || ''),
          title: String(a.album || a.title || ''),
          artist: String(a.artist || ''),
          artistId: a.artist_id ? String(a.artist_id) : undefined,
          artwork_url: a.artwork_track_id ? `${this.baseUrl}/music/${a.artwork_track_id}/cover.jpg` :
            (a.artwork_url ? (String(a.artwork_url).startsWith('http') ? String(a.artwork_url) : `${this.baseUrl}${a.artwork_url}`) : undefined),
          year: a.year ? Number(a.year) : undefined,
          trackCount: a.track_count ? Number(a.track_count) : undefined,
          url: a.url ? String(a.url) : undefined,
        }));

      debugLog.info('getAlbumsPage', `After filtering: ${albums.length} local albums from ${albumsLoop.length} total`);
      return { albums, total: albums.length };
    }
  }

  async getAlbums(artistId?: string): Promise<LmsAlbum[]> {
    const command = artistId
      ? ['albums', '0', '100', `artist_id:${artistId}`, 'tags:aajlyST']
      : ['albums', '0', '100', 'tags:aajlyST'];

    const result = await this.request('', command);
    const albumsLoop = (result.albums_loop || []) as Array<Record<string, unknown>>;

    // Filter out plugin content (Tidal, Qobuz, Spotify, SoundCloud)
    return albumsLoop
      .filter((a) => {
        const url = String(a.url || '').toLowerCase();
        const id = String(a.id || '').toLowerCase();
        const artworkUrl = String(a.artwork_url || '').toLowerCase();

        const isPluginContent = url.includes('tidal') || id.includes('tidal') || artworkUrl.includes('tidal') ||
                               url.includes('qobuz') || id.includes('qobuz') || artworkUrl.includes('qobuz') ||
                               url.includes('spotify') || id.includes('spotify') || artworkUrl.includes('spotify') ||
                               url.includes('soundcloud') || id.includes('soundcloud') || artworkUrl.includes('soundcloud');

        return !isPluginContent;
      })
      .map((a) => ({
        id: String(a.id || ''),
        title: String(a.album || 'Unknown Album'),
        artist: String(a.artist || a.albumartist || 'Unknown Artist'),
        artistId: a.artist_id ? String(a.artist_id) : undefined,
        artwork_url: a.artwork_url ? String(a.artwork_url) :
          (a.artwork_track_id ? `${this.baseUrl}/music/${a.artwork_track_id}/cover.jpg` : undefined),
        year: a.year ? Number(a.year) : undefined,
        trackCount: a.track_count ? Number(a.track_count) : undefined,
      }));
  }

  /**
   * Helper to get a player ID for Qobuz commands
   * Returns the first available player ID, or empty string if none available
   */
  private async getPlayerIdForQobuz(playerId?: string): Promise<string> {
    if (playerId) {
      return playerId;
    }
    try {
      const players = await this.getPlayers();
      if (players.length > 0) {
        return players[0].id;
      }
    } catch (e) {
      debugLog.info("Could not get players for Qobuz command", e instanceof Error ? e.message : String(e));
    }
    return "";
  }

  private async getPlayerIdForSoundCloud(playerId?: string): Promise<string> {
    if (playerId) {
      return playerId;
    }
    try {
      const players = await this.getPlayers();
      if (players.length > 0) {
        return players[0].id;
      }
    } catch (e) {
      debugLog.info("Could not get players for SoundCloud command", e instanceof Error ? e.message : String(e));
    }
    return "";
  }

  /**
   * Helper to discover Qobuz menu items by browsing the root menu
   * Returns the position/index of the menu item in the browse result
   */
  private async discoverQobuzMenu(menuName: string, playerId: string): Promise<number | null> {
    try {
      // Get the Qobuz root menu items using "items" command
      // Material Skin format: qobuz items 0 <limit> menu:qobuz
      const result = await this.request(playerId, ["qobuz", "items", "0", "30", "menu:qobuz"]);
      const items = (result.loop_loop || result.items_loop || result.item_loop || result.items || []) as Array<Record<string, unknown>>;
      
      // Look for a menu item matching the name (case-insensitive)
      const menuNameLower = menuName.toLowerCase();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemName = String(item.name || item.text || item.title || "").toLowerCase();
        const itemType = String(item.type || "");
        
        // Check if it's a menu item and matches the name
        if ((itemType === "menu" || itemType === "link" || !itemType) && 
            (itemName.includes(menuNameLower) || menuNameLower.includes(itemName))) {
          debugLog.info("Discovered Qobuz menu", `${menuName} -> position ${i}`);
          return i;
        }
      }
    } catch (e) {
      debugLog.info("Failed to discover Qobuz menu", `${menuName}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }

  async getQobuzBestsellerAlbums(limit: number = 50, playerId?: string): Promise<LmsAlbum[]> {
    // Get player ID for Qobuz commands (required by plugin)
    const qobuzPlayerId = await this.getPlayerIdForQobuz(playerId);
    if (!qobuzPlayerId) {
      debugLog.info("Qobuz bestsellers", "No player available for Qobuz commands");
      return [];
    }
    // Use similar parsing logic to searchQobuz for consistency
    const parseAlbums = (items: Array<Record<string, unknown>>): LmsAlbum[] => {
      const albums: LmsAlbum[] = [];
      const seenIds = new Set<string>();
      
      for (const item of items) {
        const type = String(item.type || '').toLowerCase();
        const text = String(item.text || item.name || '');
        const name = text.toLowerCase();
        
        // Skip menu items and navigation items
        if ((type === 'menu' || type === 'link') && !type.includes('playlist')) {
          continue;
        }
        if (name.includes('menu') || name.includes('browse') || name.includes('bestseller')) {
          continue;
        }
        
        // Material Skin format: items with type "playlist" may actually be albums
        // Text format: "Album Title\nArtist Name (Year)" or "Album Title\nArtist Name"
        let title = '';
        let artist = 'Unknown Artist';
        let year: number | undefined;
        
        if (item.album || item.title || item.name) {
          // Standard format
          title = String(item.album || item.title || item.name || '');
          artist = String(item.artist || item.albumartist || 'Unknown Artist');
          year = item.year ? Number(item.year) : undefined;
        } else if (text) {
          // Material Skin format: parse "Album Title\nArtist Name (Year)" or "Album Title\nArtist Name"
          const lines = text.split('\n');
          if (lines.length >= 2) {
            title = lines[0].trim();
            const artistLine = lines[1].trim();
            // Extract year from artist line if present: "Artist Name (Year)"
            const yearMatch = artistLine.match(/\((\d{4})\)/);
            if (yearMatch) {
              year = Number(yearMatch[1]);
              artist = artistLine.replace(/\s*\(\d{4}\)\s*$/, '').trim();
            } else {
              artist = artistLine;
            }
          } else {
            title = text.trim();
          }
        }
        
        // Check if it's an album - Material Skin may return playlists that are actually albums
        if (title && !title.toLowerCase().includes('bestseller') && !title.toLowerCase().includes('menu')) {
          // Get album ID from various possible locations
          const params = item.params as Record<string, unknown> | undefined;
          const albumId = String(
            item.album_id || 
            (params?.item_id ? String(params.item_id) : undefined) ||
            item.id || 
            `qobuz_album_${title}_${artist}`
          );
          
          if (seenIds.has(albumId)) {
            continue;
          }
          seenIds.add(albumId);
          
          // Get artwork URL - Material Skin uses "icon" field
          const artworkUrl = item.image ? String(item.image) : 
            (item.icon ? this.normalizeArtworkUrl(String(item.icon)) : undefined) ||
            (item.artwork_url ? this.normalizeArtworkUrl(String(item.artwork_url)) : undefined);
          
          albums.push({
            id: albumId,
            title: title,
            artist: artist,
            artistId: item.artist_id ? String(item.artist_id) : undefined,
            artwork_url: artworkUrl,
            year: year,
            trackCount: item.track_count ? Number(item.track_count) : undefined,
          });
        }
      }
      
      return albums;
    };

    const commands: string[][] = [];
    
    // Strategy 1: Get root menu items using "items" command (primary method)
    // Material Skin format: qobuz items 0 <limit> menu:qobuz
    try {
      const rootResult = await this.request(qobuzPlayerId, ["qobuz", "items", "0", "30", "menu:qobuz"]);
      // LMS items returns loop_loop for menu items
      const rootItems = (rootResult.loop_loop || rootResult.items_loop || rootResult.item_loop || rootResult.items || []) as Array<Record<string, unknown>>;
      
      debugLog.info("Qobuz root menu items", `Found ${rootItems.length} items`);
      // Log all menu items for debugging
      rootItems.forEach((item, idx) => {
        const name = String(item.name || item.text || item.title || "");
        const type = String(item.type || item.item_type || "");
        debugLog.info(`Qobuz menu item ${idx}`, `${name} (type: ${type})`);
      });
      
      // First, try to find "Bestsellers" directly in root menu
      let bestsellersFound = false;
      for (let i = 0; i < rootItems.length; i++) {
        const item = rootItems[i];
        const name = String(item.name || item.text || item.title || "").toLowerCase();
        if (name.includes("bestseller") || name.includes("bestselling") || name.includes("best-seller") || name.includes("best seller")) {
          // Found bestsellers menu - get items from it using "items" command
          // Material Skin format: qobuz items 0 <limit> item_id:<id> menu:qobuz
          debugLog.info("Found bestsellers menu in root", `At position ${i}: ${String(item.name || item.text || item.title)}`);
          const bestsellersItemId = String(item.id || i);
          commands.push(
            ["qobuz", "items", "0", String(limit), `item_id:${bestsellersItemId}`, "menu:qobuz"],
          );
          bestsellersFound = true;
          break;
        }
      }
      
      // If not found in root, get items from each root menu item to find "Bestsellers" submenu
      if (!bestsellersFound) {
        debugLog.info("Bestsellers not in root menu", "Searching submenus");
        for (let rootIdx = 0; rootIdx < Math.min(10, rootItems.length); rootIdx++) {
          try {
            const rootItem = rootItems[rootIdx];
            const rootItemId = String(rootItem.id || rootIdx);
            // Material Skin format: qobuz items 0 <limit> item_id:<id> menu:qobuz
            const subResult = await this.request(qobuzPlayerId, ["qobuz", "items", "0", "100", `item_id:${rootItemId}`, "menu:qobuz"]);
            const subItems = (subResult.loop_loop || subResult.items_loop || subResult.item_loop || subResult.items || []) as Array<Record<string, unknown>>;
            
            // Look for "Bestsellers" in this submenu
            for (let subIdx = 0; subIdx < subItems.length; subIdx++) {
              const subItem = subItems[subIdx];
              const subName = String(subItem.name || subItem.text || subItem.title || "").toLowerCase();
              if (subName.includes("bestseller") || subName.includes("bestselling") || subName.includes("best-seller") || subName.includes("best seller")) {
                // Found bestsellers in submenu - get items from it using "items" command
                // Material Skin format: qobuz items 0 <limit> item_id:<id> menu:qobuz
                debugLog.info("Found bestsellers in submenu", `Root ${rootIdx}, Sub ${subIdx}: ${String(subItem.name || subItem.text || subItem.title)}`);
                const bestsellersSubId = String(subItem.id || subIdx);
                commands.push(
                  ["qobuz", "items", "0", String(limit), `item_id:${bestsellersSubId}`, "menu:qobuz"],
                );
                bestsellersFound = true;
                break;
              }
            }
            if (bestsellersFound) break;
          } catch (e) {
            debugLog.info(`Failed to browse root menu item ${rootIdx}`, e instanceof Error ? e.message : String(e));
          }
        }
      }
    } catch (e) {
      debugLog.info("Could not browse Qobuz root menu", e instanceof Error ? e.message : String(e));
    }
    
    // Strategy 2: Try getting items from known menu positions (bestsellers is typically around position 3-5)
    // Material Skin format: qobuz items 0 <limit> item_id:<id> menu:qobuz
    for (let pos = 2; pos <= 6; pos++) {
      commands.push(
        ["qobuz", "items", "0", String(limit), `item_id:${pos}`, "menu:qobuz"],
      );
    }
    
    // Strategy 3: Try direct items command (may not work, but worth trying)
    commands.push(
      ["qobuz", "items", "0", String(limit), "type:best-sellers", "want_url:1"],
    );

    for (const cmd of commands) {
      try {
        debugLog.info("Trying Qobuz bestsellers command", `${qobuzPlayerId} ${cmd.join(" ")}`);
        const result = await this.request(qobuzPlayerId, cmd);
        
        // Log the raw result structure for debugging
        debugLog.info("Qobuz bestsellers raw result", `Command: ${cmd.join(" ")}, Keys: ${Object.keys(result).join(", ")}`);
        
        // Plugin returns { items => [...] } structure from QobuzFeaturedAlbums
        // But LMS might wrap it in result.item_loop or result.items
        // Check both structures
        const resultData = result.result as Record<string, unknown> | undefined;
        const items = (result.items ||
          result.item_loop ||
          result.items_loop ||
          result.loop_loop ||
          resultData?.items ||
          resultData?.item_loop ||
          resultData?.items_loop ||
          resultData?.loop_loop ||
          []) as Array<Record<string, unknown>>;
        
        // If we got items, log the structure for debugging
        if (items.length > 0) {
          debugLog.info("Qobuz bestsellers items structure", `First item keys: ${Object.keys(items[0] || {}).join(", ")}`);
        }
        
        debugLog.info("Qobuz bestsellers response", `Command: ${cmd.join(" ")}, Items returned: ${items.length}`);
        
        if (items && items.length > 0) {
          // Log first few items for debugging
          items.slice(0, 3).forEach((item, idx) => {
            const name = String(item.name || item.text || item.title || item.album || "");
            const type = String(item.type || item.item_type || "");
            debugLog.info(`Qobuz bestseller item ${idx}`, `${name} (type: ${type})`);
          });
          
          // Check if we got menu items instead of albums - if so, browse deeper
          const firstItem = items[0];
          const firstItemType = String(firstItem?.type || firstItem?.item_type || '').toLowerCase();
          const isMenuItems = firstItemType === 'menu' || firstItemType === 'link' || 
                              !firstItem?.album_id && !firstItem?.album && 
                              (firstItem?.name || firstItem?.text || firstItem?.title);
          
          if (isMenuItems && items.length > 0) {
            // We got menu items - first try to find "Bestsellers" specifically
            debugLog.info("Qobuz bestsellers got menu items", `Searching ${items.length} menu items for Bestsellers`);
            let bestsellersIndex = -1;
            
            for (let i = 0; i < items.length; i++) {
              const menuItem = items[i];
              const menuName = String(menuItem.name || menuItem.text || menuItem.title || '').toLowerCase();
              if (menuName.includes('bestseller') || menuName.includes('bestselling') || menuName.includes('best-seller') || menuName.includes('best seller')) {
                bestsellersIndex = i;
                debugLog.info("Found Bestsellers submenu", `At index ${i}: ${String(menuItem.name || menuItem.text || menuItem.title)}`);
                break;
              }
            }
            
            // If we found "Bestsellers", browse it specifically
            if (bestsellersIndex >= 0) {
              try {
                const bestsellersMenuItem = items[bestsellersIndex];
                const bestsellersId = String(bestsellersMenuItem.id || bestsellersMenuItem.item_id || bestsellersIndex);
                
                debugLog.info("Attempting to browse into Bestsellers", `Index: ${bestsellersIndex}, ID: ${bestsellersId}, Command: ${cmd.join(" ")}`);
                
                // Check command type - cmd[0] is 'qobuz', cmd[1] is the actual command
                const commandType = cmd[1] || cmd[0];
                
                // Try different browse strategies depending on the command type
                // Use "items" command to get albums from the Bestsellers submenu
                if (commandType === 'items') {
                  // Use "items" command to get albums from the Bestsellers submenu
                  // Material Skin format: qobuz items 0 <limit> item_id:<id> menu:qobuz
                  const itemsCmd = ["qobuz", "items", "0", String(limit), `item_id:${bestsellersId}`, "menu:qobuz"];
                  debugLog.info("Getting Qobuz Bestsellers items (Material Skin format)", `${itemsCmd.join(" ")}`);
                  
                  try {
                    const itemsResult = await this.request(qobuzPlayerId, itemsCmd);
                    const itemsResultData = itemsResult.result as Record<string, unknown> | undefined;
                    // Check result.result first, then top-level properties
                    const itemsSubItems = (itemsResultData?.loop_loop ||
                      itemsResultData?.items_loop ||
                      itemsResultData?.item_loop ||
                      itemsResultData?.items ||
                      itemsResult.loop_loop ||
                      itemsResult.items_loop ||
                      itemsResult.item_loop ||
                      itemsResult.items ||
                      []) as Array<Record<string, unknown>>;
                    
                    debugLog.info("Qobuz Bestsellers items result", `Items returned: ${itemsSubItems.length}, Count: ${itemsResultData?.count || itemsResult.count || 'N/A'}`);
                    
                    if (itemsSubItems.length > 0) {
                      const itemsAlbums = parseAlbums(itemsSubItems);
                      debugLog.info("Qobuz Bestsellers by items", `Found ${itemsAlbums.length} albums`);
                      if (itemsAlbums.length > 0) {
                        return itemsAlbums.slice(0, limit);
                      }
                    } else {
                      // If we got a count but no items, the items might be in a different structure
                      // Try to get items by iterating through pages or using different parameters
                      debugLog.info("Qobuz Bestsellers items returned count but no items array", "Trying alternative approach");
                    }
                  } catch (e) {
                    debugLog.info("Items command for Bestsellers failed", e instanceof Error ? e.message : String(e));
                  }
                }
              } catch (e) {
                debugLog.info("Failed to browse Bestsellers submenu", e instanceof Error ? e.message : String(e));
              }
            }
            
            // If "Bestsellers" not found or browsing failed, try browsing first few menu items
            debugLog.info("Browsing first few menu items as fallback", `Browsing ${Math.min(3, items.length)} menu items`);
            const allAlbums: LmsAlbum[] = [];
            
            for (let menuIdx = 0; menuIdx < Math.min(3, items.length); menuIdx++) {
              try {
                const menuItem = items[menuIdx];
                const menuName = String(menuItem.name || menuItem.text || menuItem.title || '');
                // Skip if it looks like a navigation item or if we already tried this one
                if (menuName.toLowerCase().includes('back') || menuName.toLowerCase().includes('up') || menuIdx === bestsellersIndex) {
                  continue;
                }
                
                // Get items from this menu item using "items" command
                // Material Skin format: qobuz items 0 <limit> item_id:<id> menu:qobuz
                if (cmd[0] === 'items' && cmd.length >= 2) {
                  const menuItemId = String(items[menuIdx].id || menuIdx);
                  const itemsCmd = ["qobuz", "items", "0", String(limit), `item_id:${menuItemId}`, "menu:qobuz"];
                  debugLog.info("Getting Qobuz submenu items (fallback)", `${menuName} -> ${itemsCmd.join(" ")}`);
                  const subResult = await this.request(qobuzPlayerId, itemsCmd);
                  
                  const subResultData = subResult.result as Record<string, unknown> | undefined;
                  const subItems = (subResultData?.loop_loop ||
                    subResultData?.items_loop ||
                    subResultData?.item_loop ||
                    subResultData?.items ||
                    subResult.loop_loop ||
                    subResult.items_loop ||
                    subResult.item_loop ||
                    subResult.items ||
                    []) as Array<Record<string, unknown>>;
                  
                  if (subItems.length > 0) {
                    const subAlbums = parseAlbums(subItems);
                    debugLog.info(`Qobuz submenu ${menuName}`, `Found ${subAlbums.length} albums`);
                    allAlbums.push(...subAlbums);
                    
                    // If we found albums, we can stop getting items from more menus
                    if (subAlbums.length > 0 && allAlbums.length >= limit) {
                      break;
                    }
                  }
                }
              } catch (e) {
                debugLog.info(`Failed to browse Qobuz submenu ${menuIdx}`, e instanceof Error ? e.message : String(e));
              }
            }
            
            if (allAlbums.length > 0) {
              debugLog.info("Qobuz bestsellers loaded from submenus", `Found ${allAlbums.length} albums`);
              return allAlbums.slice(0, limit);
            }
          }
          
          // Only parse albums if we didn't already try to browse into Bestsellers
          // (if we got menu items and found Bestsellers, we should have already returned)
          const albums = parseAlbums(items);
          debugLog.info("Qobuz bestsellers parsed", `Raw items: ${items.length}, Albums after parse: ${albums.length}`);
          
          if (albums.length > 0) {
            // Check if these are actually albums or just menu items incorrectly parsed
            const firstAlbum = albums[0];
            const hasRealAlbumData = firstAlbum.artist !== 'Unknown Artist' || firstAlbum.artwork_url;
            
            if (hasRealAlbumData) {
              debugLog.info(
                "Qobuz bestsellers loaded",
                `Strategy: ${cmd.join(" ")} albums: ${albums.length}`,
              );
              return albums.slice(0, limit);
            } else {
              // These are menu items, not albums - we should have browsed into Bestsellers
              debugLog.info("Qobuz bestsellers parsed menu items as albums", "These are menu items, not actual albums");
            }
          } else if (items.length > 0) {
            // Items returned but filtered out - log why
            debugLog.info("Qobuz bestsellers filtered out", `All ${items.length} items were filtered. First item: ${JSON.stringify(items[0])}`);
          }
        } else {
          debugLog.info("Qobuz bestsellers empty response", `Command: ${cmd.join(" ")}, Result keys: ${Object.keys(result).join(", ")}`);
        }
      } catch (e) {
        debugLog.info(
          "Qobuz bestsellers strategy failed",
          `${cmd.join(" ")} :: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    debugLog.info("Qobuz bestsellers", "No items returned from any strategy");
    return [];
  }

  /**
   * Get Qobuz "Essentials" albums from LMS (requires the Qobuz plugin).
   * Falls back to an empty list if the menu is not available on this server.
   * "Essentials" in the UI is "Editor Picks" in the plugin
   * @param limit Maximum number of albums to return
   * @param playerId Optional player ID. If not provided, will use the first available player.
   */
  async getQobuzEssentialAlbums(limit: number = 50, playerId?: string): Promise<LmsAlbum[]> {
    // Get player ID for Qobuz commands (required by plugin)
    const qobuzPlayerId = await this.getPlayerIdForQobuz(playerId);
    if (!qobuzPlayerId) {
      debugLog.info("Qobuz essentials", "No player available for Qobuz commands");
      return [];
    }
    // Use similar parsing logic to searchQobuz for consistency
    const parseAlbums = (items: Array<Record<string, unknown>>): LmsAlbum[] => {
      const albums: LmsAlbum[] = [];
      const seenIds = new Set<string>();
      
      for (const item of items) {
        const type = String(item.type || '').toLowerCase();
        const text = String(item.text || item.name || '');
        const name = text.toLowerCase();
        
        // Skip menu items and navigation items
        if ((type === 'menu' || type === 'link') && !type.includes('playlist')) {
          continue;
        }
        if (name.includes('menu') || name.includes('browse') || 
            name.includes('editor') || name.includes('essential') || name.includes('pick')) {
          continue;
        }
        
        // Material Skin format: items with type "playlist" may actually be albums
        // Text format: "Album Title\nArtist Name (Year)" or "Album Title\nArtist Name"
        let title = '';
        let artist = 'Unknown Artist';
        let year: number | undefined;
        
        if (item.album || item.title || item.name) {
          // Standard format
          title = String(item.album || item.title || item.name || '');
          artist = String(item.artist || item.albumartist || 'Unknown Artist');
          year = item.year ? Number(item.year) : undefined;
        } else if (text) {
          // Material Skin format: parse "Album Title\nArtist Name (Year)" or "Album Title\nArtist Name"
          const lines = text.split('\n');
          if (lines.length >= 2) {
            title = lines[0].trim();
            const artistLine = lines[1].trim();
            // Extract year from artist line if present: "Artist Name (Year)"
            const yearMatch = artistLine.match(/\((\d{4})\)/);
            if (yearMatch) {
              year = Number(yearMatch[1]);
              artist = artistLine.replace(/\s*\(\d{4}\)\s*$/, '').trim();
            } else {
              artist = artistLine;
            }
          } else {
            title = text.trim();
          }
        }
        
        // Check if it's an album - Material Skin may return playlists that are actually albums
        if (title && !title.toLowerCase().includes('editor') && !title.toLowerCase().includes('essential') && !title.toLowerCase().includes('pick')) {
          // Get album ID from various possible locations
          const params = item.params as Record<string, unknown> | undefined;
          const albumId = String(
            item.album_id || 
            (params?.item_id ? String(params.item_id) : undefined) ||
            item.id || 
            `qobuz_album_${title}_${artist}`
          );
          
          if (seenIds.has(albumId)) {
            continue;
          }
          seenIds.add(albumId);
          
          // Get artwork URL - Material Skin uses "icon" field
          const artworkUrl = item.image ? String(item.image) : 
            (item.icon ? this.normalizeArtworkUrl(String(item.icon)) : undefined) ||
            (item.artwork_url ? this.normalizeArtworkUrl(String(item.artwork_url)) : undefined);
          
          albums.push({
            id: albumId,
            title: title,
            artist: artist,
            artistId: item.artist_id ? String(item.artist_id) : undefined,
            artwork_url: artworkUrl,
            year: year,
            trackCount: item.track_count ? Number(item.track_count) : undefined,
          });
        }
      }
      
      return albums;
    };

    const commands: string[][] = [];
    
    // Strategy 1: Get root menu items using "items" command (primary method)
    // Material Skin format: qobuz items 0 <limit> menu:qobuz
    try {
      const rootResult = await this.request(qobuzPlayerId, ["qobuz", "items", "0", "30", "menu:qobuz"]);
      // LMS items returns item_loop for menu items
      const rootItems = (rootResult.item_loop || rootResult.items_loop || rootResult.loop_loop || rootResult.items || []) as Array<Record<string, unknown>>;
      
      debugLog.info("Qobuz root menu items (essentials)", `Found ${rootItems.length} items`);
      // Log all menu items for debugging
      rootItems.forEach((item, idx) => {
        const name = String(item.name || item.text || item.title || "");
        const type = String(item.type || item.item_type || "");
        debugLog.info(`Qobuz menu item ${idx} (essentials)`, `${name} (type: ${type})`);
      });
      
      // Find editor picks menu item by name
      for (let i = 0; i < rootItems.length; i++) {
        const item = rootItems[i];
        const name = String(item.name || item.text || item.title || "").toLowerCase();
        // Editor Picks is the actual menu name in the plugin
        if (name.includes("editor") && name.includes("pick")) {
          // Found essentials menu - get items from it using "items" command
          // Material Skin format: qobuz items 0 <limit> item_id:<id> menu:qobuz
          debugLog.info("Found essentials menu", `At position ${i}: ${String(item.name || item.text || item.title)}`);
          const essentialsItemId = String(item.id || i);
          commands.push(
            ["qobuz", "items", "0", String(limit), `item_id:${essentialsItemId}`, "menu:qobuz"],
          );
          break;
        }
      }
    } catch (e) {
      debugLog.info("Could not browse Qobuz root menu for essentials", e instanceof Error ? e.message : String(e));
    }
    
    // Strategy 2: Try getting items from known menu positions (editor picks is typically around position 5-7)
    // Material Skin format: qobuz items 0 <limit> item_id:<id> menu:qobuz
    for (let pos = 5; pos <= 8; pos++) {
      commands.push(
        ["qobuz", "items", "0", String(limit), `item_id:${pos}`, "menu:qobuz"],
      );
    }
    
    // Strategy 3: Try direct items command with type parameter (may not work, but worth trying)
    commands.push(
      ["qobuz", "items", "0", String(limit), "type:editor-picks", "menu:qobuz"],
    );

    for (const cmd of commands) {
      try {
        debugLog.info("Trying Qobuz essentials command", `${qobuzPlayerId} ${cmd.join(" ")}`);
        const result = await this.request(qobuzPlayerId, cmd);
        
        debugLog.info("Qobuz essentials raw result", `Command: ${cmd.join(" ")}, Keys: ${Object.keys(result).join(", ")}`);
        
        // Plugin returns { items => [...] } structure from QobuzFeaturedAlbums
        // But LMS might wrap it in result.item_loop or result.items
        // Check both structures
        const resultData = result.result as Record<string, unknown> | undefined;
        const items = (result.items ||
          result.item_loop ||
          result.items_loop ||
          result.loop_loop ||
          resultData?.items ||
          resultData?.item_loop ||
          resultData?.items_loop ||
          resultData?.loop_loop ||
          []) as Array<Record<string, unknown>>;
        
        // If we got items, log the structure for debugging
        if (items.length > 0) {
          debugLog.info("Qobuz essentials items structure", `First item keys: ${Object.keys(items[0] || {}).join(", ")}`);
        }
        
        debugLog.info("Qobuz essentials response", `Command: ${cmd.join(" ")}, Items returned: ${items.length}`);
        
        if (items && items.length > 0) {
          // Log first few items for debugging
          items.slice(0, 3).forEach((item, idx) => {
            const name = String(item.name || item.text || item.title || item.album || "");
            const type = String(item.type || item.item_type || "");
            debugLog.info(`Qobuz essential item ${idx}`, `${name} (type: ${type})`);
          });
          
          // Check if we got menu items instead of albums - if so, browse deeper
          const firstItem = items[0];
          const firstItemType = String(firstItem?.type || firstItem?.item_type || '').toLowerCase();
          const isMenuItems = firstItemType === 'menu' || firstItemType === 'link' || 
                              !firstItem?.album_id && !firstItem?.album && 
                              (firstItem?.name || firstItem?.text || firstItem?.title);
          
          if (isMenuItems && items.length > 0) {
            // We got menu items - browse the first few menu items to get albums
            debugLog.info("Qobuz essentials got menu items", `Browsing ${Math.min(3, items.length)} menu items to find albums`);
            const allAlbums: LmsAlbum[] = [];
            
            for (let menuIdx = 0; menuIdx < Math.min(3, items.length); menuIdx++) {
              try {
                const menuItem = items[menuIdx];
                const menuName = String(menuItem.name || menuItem.text || menuItem.title || '');
                // Skip if it looks like a navigation item
                if (menuName.toLowerCase().includes('back') || menuName.toLowerCase().includes('up')) {
                  continue;
                }
                
                // Get items from this menu item using "items" command
                // Material Skin format: qobuz items 0 <limit> item_id:<id> menu:qobuz
                if (cmd[0] === 'items' && cmd.length >= 2) {
                  const menuItemId = String(items[menuIdx].id || menuIdx);
                  const itemsCmd = ["qobuz", "items", "0", String(limit), `item_id:${menuItemId}`, "menu:qobuz"];
                  debugLog.info("Getting Qobuz submenu items (essentials)", `${menuName} -> ${itemsCmd.join(" ")}`);
                  const subResult = await this.request(qobuzPlayerId, itemsCmd);
                  
                  const subResultData = subResult.result as Record<string, unknown> | undefined;
                  const subItems = (subResultData?.item_loop ||
                    subResultData?.items_loop ||
                    subResultData?.loop_loop ||
                    subResultData?.items ||
                    subResult.item_loop ||
                    subResult.items_loop ||
                    subResult.loop_loop ||
                    subResult.items ||
                    []) as Array<Record<string, unknown>>;
                  
                  if (subItems.length > 0) {
                    const subAlbums = parseAlbums(subItems);
                    debugLog.info(`Qobuz submenu ${menuName} (essentials)`, `Found ${subAlbums.length} albums`);
                    allAlbums.push(...subAlbums);
                    
                    // If we found albums, we can stop getting items from more menus
                    if (subAlbums.length > 0 && allAlbums.length >= limit) {
                      break;
                    }
                  }
                }
              } catch (e) {
                debugLog.info(`Failed to browse Qobuz submenu ${menuIdx} (essentials)`, e instanceof Error ? e.message : String(e));
              }
            }
            
            if (allAlbums.length > 0) {
              debugLog.info("Qobuz essentials loaded from submenus", `Found ${allAlbums.length} albums`);
              return allAlbums.slice(0, limit);
            }
          }
          
          const albums = parseAlbums(items);
          debugLog.info("Qobuz essentials parsed", `Raw items: ${items.length}, Albums after parse: ${albums.length}`);
          
          if (albums.length > 0) {
            debugLog.info(
              "Qobuz essentials loaded",
              `Strategy: ${cmd.join(" ")} albums: ${albums.length}`,
            );
            return albums.slice(0, limit);
          } else if (items.length > 0) {
            // Items returned but filtered out - log why
            debugLog.info("Qobuz essentials filtered out", `All ${items.length} items were filtered. First item: ${JSON.stringify(items[0])}`);
          }
        } else {
          debugLog.info("Qobuz essentials empty response", `Command: ${cmd.join(" ")}, Result keys: ${Object.keys(result).join(", ")}`);
        }
      } catch (e) {
        debugLog.info(
          "Qobuz essentials strategy failed",
          `${cmd.join(" ")} :: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    debugLog.info("Qobuz essentials", "No items returned from any strategy");
    return [];
  }

  async getQobuzSelectionAlbums(limit: number = 50, playerId?: string): Promise<LmsAlbum[]> {
    // Get player ID for Qobuz commands (required by plugin)
    const qobuzPlayerId = await this.getPlayerIdForQobuz(playerId);
    if (!qobuzPlayerId) {
      debugLog.info("Qobuz In the Press", "No player available for Qobuz commands");
      return [];
    }
    // Use similar parsing logic to searchQobuz for consistency
    const parseAlbums = (items: Array<Record<string, unknown>>): LmsAlbum[] => {
      const albums: LmsAlbum[] = [];
      const seenIds = new Set<string>();
      
      for (const item of items) {
        const type = String(item.type || '').toLowerCase();
        const text = String(item.text || item.name || '');
        const name = text.toLowerCase();
        
        // Skip menu items and navigation items
        if ((type === 'menu' || type === 'link') && !type.includes('playlist')) {
          continue;
        }
        if (name.includes('menu') || name.includes('browse') || 
            name.includes('editor') || name.includes('essential') || name.includes('pick') ||
            name.includes('selection') || name.includes('search') ||
            (name.includes('press') && (name.includes('the') || name.includes('in')))) {
          continue;
        }
        
        // Material Skin format: items with type "playlist" may actually be albums
        // Text format: "Album Title\nArtist Name (Year)" or "Album Title\nArtist Name"
        let title = '';
        let artist = 'Unknown Artist';
        let year: number | undefined;
        
        if (item.album || item.title || item.name) {
          // Standard format
          title = String(item.album || item.title || item.name || '');
          artist = String(item.artist || item.albumartist || 'Unknown Artist');
          year = item.year ? Number(item.year) : undefined;
        } else if (text) {
          // Material Skin format: parse "Album Title\nArtist Name (Year)" or "Album Title\nArtist Name"
          const lines = text.split('\n');
          if (lines.length >= 2) {
            title = lines[0].trim();
            const artistLine = lines[1].trim();
            // Extract year from artist line if present: "Artist Name (Year)"
            const yearMatch = artistLine.match(/\((\d{4})\)/);
            if (yearMatch) {
              year = Number(yearMatch[1]);
              artist = artistLine.replace(/\s*\(\d{4}\)\s*$/, '').trim();
            } else {
              artist = artistLine;
            }
          } else {
            // Single line - likely not a valid album format, skip it
            continue;
          }
        }
        
        // Check if it's an album - Material Skin may return playlists that are actually albums
        const titleLower = title.toLowerCase();
        if (title && !titleLower.includes('editor') && !titleLower.includes('essential') && 
            !titleLower.includes('pick') && !titleLower.includes('selection') &&
            !(titleLower.includes('press') && (titleLower.includes('the') || titleLower.includes('in')))) {
          // Get album ID from various possible locations
          const params = item.params as Record<string, unknown> | undefined;
          const albumId = String(
            item.album_id || 
            (params?.item_id ? String(params.item_id) : undefined) ||
            item.id || 
            `qobuz_album_${title}_${artist}`
          );
          
          if (seenIds.has(albumId)) {
            continue;
          }
          seenIds.add(albumId);
          
          // Get artwork URL - Material Skin uses "icon" field
          const artworkUrl = item.image ? String(item.image) : 
            (item.icon ? this.normalizeArtworkUrl(String(item.icon)) : undefined) ||
            (item.artwork_url ? this.normalizeArtworkUrl(String(item.artwork_url)) : undefined);
          
          albums.push({
            id: albumId,
            title: title,
            artist: artist,
            artistId: item.artist_id ? String(item.artist_id) : undefined,
            artwork_url: artworkUrl,
            year: year,
            trackCount: item.track_count ? Number(item.track_count) : undefined,
          });
        }
      }
      
      return albums;
    };

    const commands: string[][] = [];
    
    // Strategy 1: Get root menu items using "items" command (primary method)
    // Material Skin format: qobuz items 0 <limit> menu:qobuz
    try {
      const rootResult = await this.request(qobuzPlayerId, ["qobuz", "items", "0", "30", "menu:qobuz"]);
      // LMS items returns item_loop for menu items
      const rootItems = (rootResult.item_loop || rootResult.items_loop || rootResult.loop_loop || rootResult.items || []) as Array<Record<string, unknown>>;
      
      debugLog.info("Qobuz root menu items (In the Press)", `Found ${rootItems.length} items`);
      // Log all menu items for debugging
      rootItems.forEach((item, idx) => {
        const name = String(item.name || item.text || item.title || "");
        const type = String(item.type || item.item_type || "");
        debugLog.info(`Qobuz menu item ${idx} (In the Press)`, `${name} (type: ${type})`);
      });
      
      // Find "In the Press" menu item by name
      for (let i = 0; i < rootItems.length; i++) {
        const item = rootItems[i];
        const name = String(item.name || item.text || item.title || "").toLowerCase();
        // Search for "press" in the menu name (matches "In the Press")
        if (name.includes("press") && (name.includes("the") || name.includes("in"))) {
          // Found "In the Press" menu - get items from it using "items" command
          // Material Skin format: qobuz items 0 <limit> item_id:<id> menu:qobuz
          debugLog.info("Found In the Press menu", `At position ${i}: ${String(item.name || item.text || item.title)}`);
          // Extract item ID from actions.params.item_id if available, otherwise use index
          const actions = item.actions as Record<string, unknown> | undefined;
          const goAction = actions?.go as Record<string, unknown> | undefined;
          const params = goAction?.params as Record<string, unknown> | undefined;
          const pressItemId = String(params?.item_id || item.id || i);
          debugLog.info("In the Press item ID", `Using item_id: ${pressItemId}`);
          commands.push(
            ["qobuz", "items", "0", String(limit), `item_id:${pressItemId}`, "menu:qobuz"],
          );
          break;
        }
      }
    } catch (e) {
      debugLog.info("Could not browse Qobuz root menu for In the Press", e instanceof Error ? e.message : String(e));
    }
    
    // Strategy 2: Try getting items from known menu position (In the Press is at position 7)
    // Material Skin format: qobuz items 0 <limit> item_id:<id> menu:qobuz
    if (commands.length === 0) {
      // Only try fallback if we didn't find "In the Press" by name
      commands.push(
        ["qobuz", "items", "0", String(limit), "item_id:7", "menu:qobuz"],
      );
    }

    for (const cmd of commands) {
      try {
        debugLog.info("Trying Qobuz In the Press command", `${qobuzPlayerId} ${cmd.join(" ")}`);
        const result = await this.request(qobuzPlayerId, cmd);
        
        debugLog.info("Qobuz In the Press raw result", `Command: ${cmd.join(" ")}, Keys: ${Object.keys(result).join(", ")}`);
        
        // Plugin returns { items => [...] } structure
        // But LMS might wrap it in result.item_loop or result.items
        // Check both structures
        const resultData = result.result as Record<string, unknown> | undefined;
        const items = (result.items ||
          result.item_loop ||
          result.items_loop ||
          result.loop_loop ||
          resultData?.items ||
          resultData?.item_loop ||
          resultData?.items_loop ||
          resultData?.loop_loop ||
          []) as Array<Record<string, unknown>>;
        
        // If we got items, log the structure for debugging
        if (items.length > 0) {
          debugLog.info("Qobuz In the Press items structure", `First item keys: ${Object.keys(items[0] || {}).join(", ")}`);
        }
        
        debugLog.info("Qobuz In the Press response", `Command: ${cmd.join(" ")}, Items returned: ${items.length}`);
        
        if (items && items.length > 0) {
          // Log first few items for debugging
          items.slice(0, 3).forEach((item, idx) => {
            const name = String(item.name || item.text || item.title || item.album || "");
            const type = String(item.type || item.item_type || "");
            debugLog.info(`Qobuz In the Press item ${idx}`, `${name} (type: ${type})`);
          });
          
          // Check if we got menu items instead of albums - if so, browse deeper
          const firstItem = items[0];
          const firstItemType = String(firstItem?.type || firstItem?.item_type || '').toLowerCase();
          const firstItemText = String(firstItem?.text || firstItem?.name || firstItem?.title || '');
          // Items with two-line text format (Album\nArtist) are albums, not menu items
          const hasTwoLineFormat = firstItemText.includes('\n') && firstItemText.split('\n').length >= 2;
          const isMenuItems = (firstItemType === 'menu' || firstItemType === 'link') && !hasTwoLineFormat && 
                              !firstItem?.album_id && !firstItem?.album && 
                              (firstItem?.name || firstItem?.text || firstItem?.title);
          
          if (isMenuItems && items.length > 0) {
            // We got menu items - browse the first few menu items to get albums
            debugLog.info("Qobuz In the Press got menu items", `Browsing ${Math.min(3, items.length)} menu items to find albums`);
            const allAlbums: LmsAlbum[] = [];
            
            for (let menuIdx = 0; menuIdx < Math.min(3, items.length); menuIdx++) {
              try {
                const menuItem = items[menuIdx];
                const menuName = String(menuItem.name || menuItem.text || menuItem.title || '');
                // Skip if it looks like a navigation item
                if (menuName.toLowerCase().includes('back') || menuName.toLowerCase().includes('up')) {
                  continue;
                }
                
                // Get items from this menu item using "items" command
                const menuItemId = String(menuItem.id || menuIdx);
                const subCmd = ["qobuz", "items", "0", String(limit), `item_id:${menuItemId}`, "menu:qobuz"];
                debugLog.info(`Browsing Qobuz In the Press submenu ${menuIdx}`, `${menuName} (id: ${menuItemId})`);
                const subResult = await this.request(qobuzPlayerId, subCmd);
                const subResultData = subResult.result as Record<string, unknown> | undefined;
                const subItems = subResultData?.item_loop ||
                    subResultData?.items_loop ||
                    subResultData?.loop_loop ||
                    subResultData?.items ||
                    subResult.item_loop ||
                    subResult.items_loop ||
                    subResult.loop_loop ||
                    subResult.items
                ;
                
                if (subItems && Array.isArray(subItems) && subItems.length > 0) {
                  const subAlbums = parseAlbums(subItems);
                  debugLog.info(`Qobuz In the Press submenu ${menuIdx} albums`, `Found ${subAlbums.length} albums from ${menuName}`);
                  allAlbums.push(...subAlbums);
                  
                  // If we found albums, we can stop getting items from more menus
                  if (subAlbums.length > 0 && allAlbums.length >= limit) {
                    break;
                  }
                }
              } catch (e) {
                debugLog.info(`Failed to browse Qobuz submenu ${menuIdx} (In the Press)`, e instanceof Error ? e.message : String(e));
              }
            }
            
            if (allAlbums.length > 0) {
              debugLog.info("Qobuz In the Press loaded from submenus", `Found ${allAlbums.length} albums`);
              return allAlbums.slice(0, limit);
            }
          }
          
          const albums = parseAlbums(items);
          debugLog.info("Qobuz In the Press parsed", `Raw items: ${items.length}, Albums after parse: ${albums.length}`);
          
          if (albums.length > 0) {
            debugLog.info(
              "Qobuz In the Press loaded",
              `Strategy: ${cmd.join(" ")} albums: ${albums.length}`,
            );
            return albums.slice(0, limit);
          } else if (items.length > 0) {
            // Items returned but filtered out - log why
            debugLog.info("Qobuz In the Press filtered out", `All ${items.length} items were filtered. First item: ${JSON.stringify(items[0])}`);
          }
        } else {
          debugLog.info("Qobuz In the Press empty response", `Command: ${cmd.join(" ")}, Result keys: ${Object.keys(result).join(", ")}`);
        }
      } catch (e) {
        debugLog.info(
          "Qobuz In the Press strategy failed",
          `${cmd.join(" ")} :: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    debugLog.info("Qobuz In the Press", "No items returned from any strategy");
    return [];
  }

  /**
   * Get albums by artist name (since we use artist name as ID)
   */
  async getAlbumsByArtistName(artistName: string): Promise<LmsAlbum[]> {
    if (!artistName || artistName.trim() === '') {
      return [];
    }
    
    // Search for albums by artist name
    const command = ['albums', '0', '500', `search:${artistName.trim()}`, 'tags:aajlyST'];
    const result = await this.request('', command);
    const albumsLoop = (result.albums_loop || []) as Array<Record<string, unknown>>;
    
    // Filter to only albums that match the exact artist name and are local content (not plugin)
    return albumsLoop
      .filter((a) => {
        // First filter out plugin content
        const url = String(a.url || '').toLowerCase();
        const id = String(a.id || '').toLowerCase();
        const artworkUrl = String(a.artwork_url || '').toLowerCase();

        const isPluginContent = url.includes('tidal') || id.includes('tidal') || artworkUrl.includes('tidal') ||
                               url.includes('qobuz') || id.includes('qobuz') || artworkUrl.includes('qobuz') ||
                               url.includes('spotify') || id.includes('spotify') || artworkUrl.includes('spotify') ||
                               url.includes('soundcloud') || id.includes('soundcloud') || artworkUrl.includes('soundcloud');

        if (isPluginContent) {
          return false;
        }

        // Then filter by artist name
        const albumArtist = String(a.artist || a.albumartist || '').trim();
        return albumArtist.toLowerCase() === artistName.trim().toLowerCase();
      })
      .map((a) => ({
        id: String(a.id || ''),
        title: String(a.album || 'Unknown Album'),
        artist: String(a.artist || a.albumartist || 'Unknown Artist'),
        artistId: a.artist_id ? String(a.artist_id) : undefined,
        artwork_url: a.artwork_url ? String(a.artwork_url) :
          (a.artwork_track_id ? `${this.baseUrl}/music/${a.artwork_track_id}/cover.jpg` : undefined),
        year: a.year ? Number(a.year) : undefined,
        trackCount: a.track_count ? Number(a.track_count) : undefined,
      }));
  }

  async getArtistsPage(start: number = 0, limit: number = 50, includeQobuz: boolean = false): Promise<{ artists: LmsArtist[], total: number }> {
    try {
      // First, get the total number of albums to know how many to fetch
      const totalAlbumsResult = await this.request('', ['info', 'total', 'albums', '?']);
      const totalAlbums = Number(totalAlbumsResult._albums || 0);
      
      // Fetch ALL albums to get accurate album counts per artist
      // Use a large batch size to fetch all albums efficiently
      const batchSize = 10000; // Fetch in large batches
      const albumsToFetch = Math.min(totalAlbums, batchSize);
      
      const result = await this.request('', ['albums', '0', String(albumsToFetch), 'tags:al']);
      const albumsLoop = (result.albums_loop || []) as Array<Record<string, unknown>>;
      
      // If we have more albums than we fetched, fetch the rest in additional batches
      let allAlbums = [...albumsLoop];
      if (totalAlbums > albumsToFetch) {
        // Fetch remaining albums in batches
        for (let offset = albumsToFetch; offset < totalAlbums; offset += batchSize) {
          const remainingCount = Math.min(batchSize, totalAlbums - offset);
          const additionalResult = await this.request('', ['albums', String(offset), String(remainingCount), 'tags:al']);
          const additionalAlbums = (additionalResult.albums_loop || []) as Array<Record<string, unknown>>;
          allAlbums.push(...additionalAlbums);
        }
      }
      
      // Build a map of unique artists with their accurate album counts
      // Use artist name as key since albums don't have artist_id
      const artistMap = new Map<string, { id: string; name: string; albumCount: number }>();

      for (const album of allAlbums) {
        // Filter out plugin content (Tidal, Qobuz, Spotify, SoundCloud)
        const url = String(album.url || '').toLowerCase();
        const id = String(album.id || '').toLowerCase();
        const artworkUrl = String(album.artwork_url || '').toLowerCase();

        const isPluginContent = url.includes('tidal') || id.includes('tidal') || artworkUrl.includes('tidal') ||
                               url.includes('qobuz') || id.includes('qobuz') || artworkUrl.includes('qobuz') ||
                               url.includes('spotify') || id.includes('spotify') || artworkUrl.includes('spotify') ||
                               url.includes('soundcloud') || id.includes('soundcloud') || artworkUrl.includes('soundcloud');

        if (isPluginContent) {
          continue; // Skip plugin content
        }

        const artistName = String(album.artist || album.albumartist || '').trim();

        // Skip invalid artist names
        if (!artistName || artistName === '-' || artistName === '') {
          continue;
        }

        // Use artist name as the key (normalize to handle case differences)
        const artistKey = artistName.toLowerCase();

        if (artistMap.has(artistKey)) {
          artistMap.get(artistKey)!.albumCount++;
        } else {
          // Generate a simple ID from the artist name (or use name as ID)
          artistMap.set(artistKey, {
            id: artistName, // Use name as ID since we don't have artist_id
            name: artistName,
            albumCount: 1,
          });
        }
      }
      
      // Also include artists from Qobuz albums if enabled
      if (includeQobuz) {
        try {
          const qobuzFavs = await this.getQobuzFavoriteAlbums();
          for (const album of qobuzFavs) {
            const artistName = String(album.artist || '').trim();
            if (!artistName || artistName === '-' || artistName === '') {
              continue;
            }

            const artistKey = artistName.toLowerCase();
            if (artistMap.has(artistKey)) {
              artistMap.get(artistKey)!.albumCount++;
            } else {
              artistMap.set(artistKey, {
                id: `qobuz-${artistName}`,
                name: artistName,
                albumCount: 1,
              });
            }
          }
        } catch (e) {
          // If Qobuz isn't available, just use local artists
        }
      }
      
      // Convert map to array, sort by name, and paginate
      const allArtists = Array.from(artistMap.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(a => ({
          id: a.id,
          name: a.name,
          albumCount: a.albumCount,
        } as LmsArtist));
      
      const total = allArtists.length;
      const artists = allArtists.slice(start, start + limit);
    
    return { artists, total };
    } catch (error) {
      debugLog.error('getArtistsPage failed', error instanceof Error ? error.message : String(error));
      return { artists: [], total: 0 };
    }
  }
  
  /**
   * Fetch artist image from TheAudioDB API
   * Returns the artist's thumbnail/portrait image, not album artwork
   */
  async getArtistImage(artistName: string): Promise<string | undefined> {
    if (!artistName || artistName.trim() === '') {
      return undefined;
    }
    
    try {
      // TheAudioDB free API key
      const apiKey = '2';
      const encodedName = encodeURIComponent(artistName.trim());
      const url = `https://www.theaudiodb.com/api/v1/json/${apiKey}/search.php?s=${encodedName}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        return undefined;
      }
      
      const data = await response.json();
      if (data.artists && data.artists.length > 0) {
        const artist = data.artists[0];
        // Prefer thumbnail (portrait) over fanart (background)
        // strArtistThumb is typically a square portrait image
        return artist.strArtistThumb || artist.strArtistWideThumb || artist.strArtistFanart || undefined;
      }
    } catch (error) {
      debugLog.error('Failed to fetch artist image', error instanceof Error ? error.message : String(error));
    }
    
    return undefined;
  }

  /**
   * Fetch artist bio and information from TheAudioDB API
   */
  async getArtistBio(artistName: string): Promise<{ bio?: string; image?: string; formedYear?: string; genre?: string; country?: string } | null> {
    if (!artistName || artistName.trim() === '') {
      return null;
    }
    
    try {
      // TheAudioDB free API key
      const apiKey = '2';
      const encodedName = encodeURIComponent(artistName.trim());
      const url = `https://www.theaudiodb.com/api/v1/json/${apiKey}/search.php?s=${encodedName}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      
      const data = await response.json();
      if (data.artists && data.artists.length > 0) {
        const artist = data.artists[0];
        return {
          bio: artist.strBiographyEN || artist.strBiographyDE || artist.strBiographyFR || artist.strBiographyIT || artist.strBiographyES || undefined,
          image: artist.strArtistThumb || artist.strArtistWideThumb || artist.strArtistFanart || undefined,
          formedYear: artist.intFormedYear || undefined,
          genre: artist.strGenre || undefined,
          country: artist.strCountry || undefined,
        };
      }
    } catch (error) {
      debugLog.error('Failed to fetch artist bio', error instanceof Error ? error.message : String(error));
    }
    
    return null;
  }

  async getArtists(): Promise<LmsArtist[]> {
    // Request album_count tag to get album counts
    const result = await this.request('', ['artists', '0', '1000', 'tags:al']);
    const artistsLoop = (result.artists_loop || []) as Array<Record<string, unknown>>;
    
    return artistsLoop
      .map((a) => {
        const artistName = String(a.artist || a.name || '').trim();
        // Filter out invalid artist names (empty, dashes, etc.)
        if (!artistName || artistName === '-' || artistName === '') {
          return null;
        }
        const albumCount = a.album_count !== undefined ? Number(a.album_count) : (a.albums !== undefined ? Number(a.albums) : 0);
        // Don't filter out artists with 0 albums - they might have Qobuz albums
        // The filtering will be done at a higher level if needed
        return {
      id: String(a.id || ''),
          name: artistName,
          albumCount,
        } as LmsArtist;
      })
      .filter((a): a is LmsArtist => a !== null);
  }

  async getPlaylists(includeQobuz: boolean = false, includeSoundCloud: boolean = false, includeSpotify: boolean = false, includeTidal: boolean = false): Promise<LmsPlaylist[]> {
    // First try the standard playlists command
    const result = await this.request('', ['playlists', '0', '10000', 'tags:u']);
    // LMS can return playlists_loop or playlists (array)
    let playlistsLoop = (result.playlists_loop || result.playlists || []) as Array<Record<string, unknown>>;
    const allPlaylists: LmsPlaylist[] = [];
    
    // Add standard playlists, filtering out plugin content
    if (playlistsLoop && playlistsLoop.length > 0) {
      const filteredPlaylists = playlistsLoop
        .filter((p) => {
          const name = String(p.playlist || p.name || '').toLowerCase();
          const url = String(p.url || '').toLowerCase();
          const id = String(p.id || '').toLowerCase();

          // Filter out plugin playlists
          const isPluginContent = name.includes('tidal') || name.includes('qobuz') || name.includes('spotify') || name.includes('soundcloud') ||
                                 url.includes('tidal') || url.includes('qobuz') || url.includes('spotify') || url.includes('soundcloud') ||
                                 id.includes('tidal') || id.includes('qobuz') || id.includes('spotify') || id.includes('soundcloud');

          return !isPluginContent;
        })
        .map((p) => ({
          id: String(p.id || ''),
          name: String(p.playlist || 'Unknown Playlist'),
          url: p.url ? String(p.url) : undefined,
          trackCount: p.tracks ? Number(p.tracks) : undefined,
        }));

      allPlaylists.push(...filteredPlaylists);
      debugLog.info('getPlaylists', `Standard playlists: ${playlistsLoop.length} total, ${filteredPlaylists.length} after filtering plugin content`);
    }
    
    // Try to get Qobuz playlists using items command to navigate menu
    if (includeQobuz) {
      try {
      const qobuzPlayerId = await this.getPlayerIdForQobuz();
      if (qobuzPlayerId) {
        debugLog.info('getPlaylists', 'Trying to fetch Qobuz playlists');
        
        // Step 1: Get Qobuz main menu using qobuz items command
        try {
          const qobuzMainResult = await this.request(qobuzPlayerId, ['qobuz', 'items', '0', '100', 'menu:qobuz']);
          const qobuzMainItems = (qobuzMainResult.items_loop || qobuzMainResult.item_loop || qobuzMainResult.items || []) as Array<Record<string, unknown>>;
          
          debugLog.info('getPlaylists', `Qobuz main menu returned ${qobuzMainItems.length} items`);
          
          // Step 2: Find "My Playlists" or similar in Qobuz menu
          let myPlaylistsId: string | undefined;
          for (let i = 0; i < qobuzMainItems.length; i++) {
            const item = qobuzMainItems[i];
            const name = String(item.name || item.text || item.title || '').toLowerCase();
            
            // Extract item ID from actions.params.item_id if available, otherwise use index or item.id
            const actions = item.actions as Record<string, unknown> | undefined;
            const goAction = actions?.go as Record<string, unknown> | undefined;
            const actionParams = goAction?.params as Record<string, unknown> | undefined;
            const actionItemId = actionParams?.item_id ? String(actionParams.item_id) : undefined;
            
            const itemId = String(item.id || (item as Record<string, unknown>).item_id || '');
            const params = item.params as Record<string, unknown> | undefined;
            const paramItemId = params?.item_id ? String(params.item_id) : undefined;
            
            if (name.includes('my playlist') && !name.includes('qobuz playlist')) {
              // Prefer actionParams.item_id, then paramItemId, then itemId, then index
              myPlaylistsId = actionItemId || paramItemId || (itemId || String(i));
              debugLog.info('getPlaylists', `Found Qobuz My Playlists with id: ${myPlaylistsId}, name: ${name}`);
              break;
            }
          }
          
          if (myPlaylistsId) {
            // Step 3: Get playlists from My Playlists using qobuz items command
            const playlistsResult = await this.request(qobuzPlayerId, ['qobuz', 'items', '0', '100', `item_id:${myPlaylistsId}`, 'menu:qobuz']);
            const playlistItems = (playlistsResult.items_loop || playlistsResult.item_loop || playlistsResult.items || []) as Array<Record<string, unknown>>;
            
            debugLog.info('getPlaylists', `Qobuz My Playlists returned ${playlistItems.length} items`);
            
            const qobuzPlaylists = playlistItems.map((item: Record<string, unknown>) => {
              const itemParams = item.params as Record<string, unknown> | undefined;
              // Get artwork URL - Qobuz playlists may have icon or image fields
              let artworkUrl: string | undefined;
              if (item.image) {
                artworkUrl = String(item.image);
              } else if (item.icon) {
                artworkUrl = this.normalizeArtworkUrl(String(item.icon));
              } else if (item.artwork_url) {
                artworkUrl = this.normalizeArtworkUrl(String(item.artwork_url));
              }
              return {
                id: String(item.id || (item as Record<string, unknown>).item_id || itemParams?.item_id || ''),
                playlist: `Qobuz: ${String(item.name || item.text || item.title || 'Unknown Playlist')}`,
                url: item.url ? String(item.url) : undefined,
                tracks: item.track_count ? Number(item.track_count) : undefined,
                artwork_url: artworkUrl,
              };
            });
            
            if (qobuzPlaylists.length > 0) {
              debugLog.info('getPlaylists', `Found ${qobuzPlaylists.length} Qobuz playlists`);
              allPlaylists.push(...qobuzPlaylists.map((p) => ({
                id: String(p.id || ''),
                name: String(p.playlist || 'Unknown Playlist'),
                url: p.url ? String(p.url) : undefined,
                trackCount: p.tracks ? Number(p.tracks) : undefined,
                artwork_url: p.artwork_url,
              })));
            }
          } else if (qobuzMainItems.length > 0) {
            // If we couldn't find "My Playlists" but got items, log them for debugging
            debugLog.info('getPlaylists', `Qobuz items (first 5): ${qobuzMainItems.slice(0, 5).map((i: Record<string, unknown>) => String(i.name || i.text || i.title || 'Unknown')).join(', ')}`);
          }
        } catch (browseError) {
          debugLog.info('getPlaylists', `Qobuz browse failed: ${browseError instanceof Error ? browseError.message : String(browseError)}`);
        }
      }
      } catch (e) {
        debugLog.info('getPlaylists', `Qobuz playlists fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    
    // Try to get SoundCloud playlists from apps>soundcloud>my playlists
    if (includeSoundCloud) {
      try {
      // Get player ID (use any player for browsing)
      const playersResult = await this.request('', ['players', '0', '1']);
      const playersLoop = (playersResult.players_loop || []) as Array<Record<string, unknown>>;
      const playerId = playersLoop.length > 0 ? String(playersLoop[0].playerid || '') : '';
      
      if (playerId) {
        debugLog.info('getPlaylists', 'Trying to browse SoundCloud playlists');
        
        // Step 1: Browse SoundCloud directly using squeezecloud items command
        try {
          debugLog.info('getPlaylists', 'Trying to browse SoundCloud playlists');
          const soundcloudResult = await this.request(playerId, ['squeezecloud', 'items', '0', '100', 'menu:squeezecloud']);
          const soundcloudItems = (soundcloudResult.items_loop || soundcloudResult.item_loop || soundcloudResult.items || []) as Array<Record<string, unknown>>;
          
          debugLog.info('getPlaylists', `SoundCloud browse returned ${soundcloudItems.length} items`);
          
          // Step 2: Find "My Playlists" in SoundCloud
          let myPlaylistsIndex: number | undefined;
          for (let i = 0; i < soundcloudItems.length; i++) {
            const item = soundcloudItems[i];
            const name = String(item.name || item.text || item.title || '').toLowerCase();
            if (name.includes('my playlist')) {
              myPlaylistsIndex = i;
              debugLog.info('getPlaylists', `Found SoundCloud My Playlists at index: ${myPlaylistsIndex}`);
              break;
            }
          }
          
          if (myPlaylistsIndex !== undefined) {
            // Step 3: Get playlists from My Playlists using squeezecloud items command with index
            const playlistsResult = await this.request(playerId, ['squeezecloud', 'items', '0', '100', `item_id:${myPlaylistsIndex}`, 'menu:squeezecloud']);
            const playlistItems = (playlistsResult.items_loop || playlistsResult.item_loop || playlistsResult.items || []) as Array<Record<string, unknown>>;
            
            debugLog.info('getPlaylists', `SoundCloud My Playlists returned ${playlistItems.length} items`);
            
            const soundcloudPlaylists = playlistItems.map((item: Record<string, unknown>) => {
              const itemParams = item.params as Record<string, unknown> | undefined;
              return {
                id: String(item.id || (item as Record<string, unknown>).item_id || itemParams?.item_id || ''),
                playlist: `SoundCloud: ${String(item.name || item.text || item.title || 'Unknown Playlist')}`,
                url: item.url ? String(item.url) : undefined,
                tracks: item.track_count ? Number(item.track_count) : undefined,
              };
            });
              
            if (soundcloudPlaylists.length > 0) {
              debugLog.info('getPlaylists', `Found ${soundcloudPlaylists.length} SoundCloud playlists`);
              allPlaylists.push(...soundcloudPlaylists.map((p) => ({
                id: String(p.id || ''),
                name: String(p.playlist || 'Unknown Playlist'),
                url: p.url ? String(p.url) : undefined,
                trackCount: p.tracks ? Number(p.tracks) : undefined,
              })));
            }
          } else if (soundcloudItems.length > 0) {
            // If we couldn't find "My Playlists" but got items, log them for debugging
            debugLog.info('getPlaylists', `SoundCloud items (first 5): ${soundcloudItems.slice(0, 5).map((i: Record<string, unknown>) => String(i.name || i.text || i.title || 'Unknown')).join(', ')}`);
          }
        } catch (browseError) {
          debugLog.info('getPlaylists', `SoundCloud browse failed: ${browseError instanceof Error ? browseError.message : String(browseError)}`);
        }
      }
      } catch (e) {
        debugLog.info('getPlaylists', `SoundCloud browse failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    
    // Try to get Tidal playlists from apps>tidal>my playlists
    if (includeTidal) {
      try {
      // Get player ID (use any player for browsing)
      const playersResult = await this.request('', ['players', '0', '1']);
      const playersLoop = (playersResult.players_loop || []) as Array<Record<string, unknown>>;
      const playerId = playersLoop.length > 0 ? String(playersLoop[0].playerid || '') : '';
      
      if (playerId) {
        debugLog.info('getPlaylists', 'Trying to browse Tidal playlists');
        
        // Step 1: Browse Tidal directly using tidal items command
        try {
          debugLog.info('getPlaylists', 'Trying to browse Tidal playlists');
          const tidalResult = await this.request(playerId, ['tidal', 'items', '0', '100', 'menu:tidal']);
          const tidalItems = (tidalResult.items_loop || tidalResult.item_loop || tidalResult.items || []) as Array<Record<string, unknown>>;
          
          debugLog.info('getPlaylists', `Tidal browse returned ${tidalItems.length} items`);
          
          // Step 2: Find "My Playlists" in Tidal
          let myPlaylistsIndex: number | undefined;
          for (let i = 0; i < tidalItems.length; i++) {
            const item = tidalItems[i];
            const name = String(item.name || item.text || item.title || '').toLowerCase();
            if (name.includes('my playlist')) {
              myPlaylistsIndex = i;
              debugLog.info('getPlaylists', `Found Tidal My Playlists at index: ${myPlaylistsIndex}`);
              break;
            }
          }
          
          if (myPlaylistsIndex !== undefined) {
            // Step 3: Get playlists from My Playlists using tidal items command with index
            const playlistsResult = await this.request(playerId, ['tidal', 'items', '0', '100', `item_id:${myPlaylistsIndex}`, 'menu:tidal']);
            const playlistItems = (playlistsResult.items_loop || playlistsResult.item_loop || playlistsResult.items || []) as Array<Record<string, unknown>>;
            
            debugLog.info('getPlaylists', `Tidal My Playlists returned ${playlistItems.length} items`);
            
            const tidalPlaylists = playlistItems.map((item: Record<string, unknown>) => {
              const itemParams = item.params as Record<string, unknown> | undefined;
              return {
                id: String(item.id || (item as Record<string, unknown>).item_id || itemParams?.item_id || ''),
                playlist: `Tidal: ${String(item.name || item.text || item.title || 'Unknown Playlist')}`,
                url: item.url ? String(item.url) : undefined,
                tracks: item.track_count ? Number(item.track_count) : undefined,
              };
            });
              
            if (tidalPlaylists.length > 0) {
              debugLog.info('getPlaylists', `Found ${tidalPlaylists.length} Tidal playlists`);
              allPlaylists.push(...tidalPlaylists.map((p) => ({
                id: String(p.id || ''),
                name: String(p.playlist || 'Unknown Playlist'),
                url: p.url ? String(p.url) : undefined,
                trackCount: p.tracks ? Number(p.tracks) : undefined,
              })));
            }
          } else if (tidalItems.length > 0) {
            // If we couldn't find "My Playlists" but got items, log them for debugging
            debugLog.info('getPlaylists', `Tidal items (first 5): ${tidalItems.slice(0, 5).map((i: Record<string, unknown>) => String(i.name || i.text || i.title || 'Unknown')).join(', ')}`);
          }
        } catch (browseError) {
          debugLog.info('getPlaylists', `Tidal browse failed: ${browseError instanceof Error ? browseError.message : String(browseError)}`);
        }
      }
      } catch (e) {
        debugLog.info('getPlaylists', `Tidal browse failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    
    if (allPlaylists.length === 0) {
      debugLog.info('getPlaylists', `No playlists found. Count: ${result.count || 0}`);
      return [];
    }
    
    return allPlaylists;
  }

  async getPlaylistTracks(playlistId: string, playlistUrl?: string, playlistName?: string): Promise<LmsTrack[]> {
    // Check if this is a Qobuz, SoundCloud, or Tidal playlist
    // Check URL, ID, and name to detect Qobuz/SoundCloud/Tidal playlists
    const isQobuz = playlistUrl?.includes('qobuz') || 
                    playlistId.includes('qobuz') || 
                    playlistName?.toLowerCase().includes('qobuz') ||
                    playlistName?.startsWith('Qobuz:');
    const isSoundCloud = playlistUrl?.includes('soundcloud') || 
                         playlistId.includes('soundcloud') || 
                         playlistName?.toLowerCase().includes('soundcloud') ||
                         playlistName?.startsWith('SoundCloud:');
    const isTidal = playlistUrl?.includes('tidal') || 
                    playlistId.includes('tidal') || 
                    playlistName?.toLowerCase().includes('tidal') ||
                    playlistName?.startsWith('Tidal:');
    
    if (isQobuz) {
      // For Qobuz playlists, use qobuz items command
      try {
        const playerId = await this.getPlayerIdForQobuz();
        if (playerId) {
          const result = await this.request(playerId, ['qobuz', 'items', '0', '500', `item_id:${playlistId}`, 'menu:qobuz']);
          const items = (result.items_loop || result.item_loop || result.items || []) as Array<Record<string, unknown>>;
          return items.map((t, i) => this.parseTrack(t, i));
        }
      } catch (e) {
        debugLog.info('getPlaylistTracks', `Qobuz playlist tracks failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (isSoundCloud) {
      // For SoundCloud playlists, use squeezecloud items command
      try {
        const playerId = await this.getPlayerIdForSoundCloud();
        if (playerId) {
          const result = await this.request(playerId, ['squeezecloud', 'items', '0', '500', `item_id:${playlistId}`, 'menu:squeezecloud']);
          const items = (result.items_loop || result.item_loop || result.items || []) as Array<Record<string, unknown>>;
          return items.map((t, i) => this.parseTrack(t, i));
        }
      } catch (e) {
        debugLog.info('getPlaylistTracks', `SoundCloud playlist tracks failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (isTidal) {
      // For Tidal playlists, use tidal items command
      try {
        // Get any player ID for browsing
        const playersResult = await this.request('', ['players', '0', '1']);
        const playersLoop = (playersResult.players_loop || []) as Array<Record<string, unknown>>;
        const playerId = playersLoop.length > 0 ? String(playersLoop[0].playerid || '') : '';
        
        if (playerId) {
          const result = await this.request(playerId, ['tidal', 'items', '0', '500', `item_id:${playlistId}`, 'menu:tidal']);
          const items = (result.items_loop || result.item_loop || result.items || []) as Array<Record<string, unknown>>;
          return items.map((t, i) => this.parseTrack(t, i));
        }
      } catch (e) {
        debugLog.info('getPlaylistTracks', `Tidal playlist tracks failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    
    // Default: use standard playlists tracks command
    const result = await this.request('', ['playlists', 'tracks', '0', '500', `playlist_id:${playlistId}`, 'tags:acdlKNuT']);
    const playlistTracksLoop = (result.playlisttracks_loop || []) as Array<Record<string, unknown>>;
    
    return playlistTracksLoop.map((t, i) => this.parseTrack(t, i));
  }

  async playPlaylist(playerId: string, playlistId: string): Promise<void> {
    // Let LMS handle format/transcoding automatically based on player capabilities
    await this.request(playerId, ['playlistcontrol', 'cmd:load', `playlist_id:${playlistId}`]);
  }

  async getAlbumTracks(albumId: string, source?: "qobuz" | "local"): Promise<LmsTrack[]> {
    // Check if this is a Qobuz album
    const isQobuz = source === "qobuz" || albumId.includes('qobuz') || albumId.startsWith('qobuz-');
    
    if (isQobuz) {
      // For Qobuz albums, use qobuz items command
      try {
        const playerId = await this.getPlayerIdForQobuz();
        if (playerId) {
          const result = await this.request(playerId, ['qobuz', 'items', '0', '500', `item_id:${albumId}`, 'menu:qobuz']);
          const items = (result.items_loop || result.item_loop || result.items || []) as Array<Record<string, unknown>>;
          // Filter to only tracks (not albums or other items)
          const tracks = items.filter(item => {
            const type = String(item.type || '').toLowerCase();
            return type === 'track' || type === 'song' || !type || type === '';
          });
          return tracks.map((t, i) => this.parseTrack(t, i));
        }
      } catch (e) {
        debugLog.info('getAlbumTracks', `Qobuz album tracks failed: ${e instanceof Error ? e.message : String(e)}`);
        // Fall through to try standard method
      }
    }
    
    // Default: use standard titles command for local albums
    const result = await this.request('', ['titles', '0', '100', `album_id:${albumId}`, 'tags:acdlKNuTsSp', 'sort:tracknum']);
    const titlesLoop = (result.titles_loop || []) as Array<Record<string, unknown>>;
    
    return titlesLoop.map((t, i) => this.parseTrack(t, i));
  }

  /**
   * Get all tracks from the library (for shuffle all functionality)
   * Fetches tracks in batches to handle large libraries
   */
  async getAllLibraryTracks(limit: number = 10000): Promise<LmsTrack[]> {
    try {
      // Fetch tracks in batches of 1000
      const batchSize = 1000;
      const batches = Math.ceil(Math.min(limit, 10000) / batchSize);
      const allTracks: LmsTrack[] = [];
      
      for (let i = 0; i < batches; i++) {
        const start = i * batchSize;
        const count = Math.min(batchSize, limit - start);
        
        const result = await this.request('', ['titles', String(start), String(count), 'tags:acdlKNuTsSp']);
        const titlesLoop = (result.titles_loop || []) as Array<Record<string, unknown>>;
        
        const tracks = titlesLoop.map((t, index) => this.parseTrack(t, start + index));
        allTracks.push(...tracks);
        
        // If we got fewer tracks than requested, we've reached the end
        if (tracks.length < count) {
          break;
        }
      }
      
      debugLog.info('Fetched all library tracks', `Total: ${allTracks.length}`);
      return allTracks;
    } catch (error) {
      debugLog.error('Failed to get all library tracks', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  async search(query: string): Promise<{ artists: LmsArtist[]; albums: LmsAlbum[]; tracks: LmsTrack[] }> {
    if (!this.baseUrl) {
      throw new Error('LMS server not configured');
    }
    
    debugLog.info('Searching local library', `Query: ${query}`);
    const [artistsResult, albumsResult, tracksResult] = await Promise.all([
      this.request('', ['artists', '0', '50', `search:${query}`]).catch(e => {
        debugLog.error('Artists search failed', e instanceof Error ? e.message : String(e));
        return { artists_loop: [] };
      }),
      this.request('', ['albums', '0', '50', `search:${query}`, 'tags:aajlyST']).catch(e => {
        debugLog.error('Albums search failed', e instanceof Error ? e.message : String(e));
        return { albums_loop: [] };
      }),
      this.request('', ['titles', '0', '50', `search:${query}`, 'tags:acdlKNuT']).catch(e => {
        debugLog.error('Tracks search failed', e instanceof Error ? e.message : String(e));
        return { titles_loop: [] };
      }),
    ]);

    const artists = ((artistsResult.artists_loop || []) as Array<Record<string, unknown>>).map((a) => ({
      id: String(a.id || ''),
      name: String(a.artist || 'Unknown Artist'),
    }));

    const albums = ((albumsResult.albums_loop || []) as Array<Record<string, unknown>>).map((a) => ({
      id: String(a.id || ''),
      title: String(a.album || 'Unknown Album'),
      artist: String(a.artist || a.albumartist || 'Unknown Artist'),
      artistId: a.artist_id ? String(a.artist_id) : undefined,
      artwork_url: a.artwork_url ? String(a.artwork_url) : 
        (a.artwork_track_id ? `${this.baseUrl}/music/${a.artwork_track_id}/cover.jpg` : undefined),
      year: a.year ? Number(a.year) : undefined,
    }));

    const tracks = ((tracksResult.titles_loop || []) as Array<Record<string, unknown>>).map((t, i) => this.parseTrack(t, i));
    
    // Rank and sort tracks by relevance to the search query
    const queryLower = query.toLowerCase();
    tracks.sort((a, b) => {
      const scoreA = this.calculateTrackRelevanceScore(a, queryLower);
      const scoreB = this.calculateTrackRelevanceScore(b, queryLower);
      return scoreB - scoreA; // Sort descending (highest score first)
    });

    return { artists, albums, tracks };
  }

  async searchQobuz(query: string): Promise<{ artists: LmsArtist[]; albums: LmsAlbum[]; tracks: LmsTrack[] }> {
    if (!this.baseUrl) {
      throw new Error('LMS server not configured');
    }
    
    try {
      debugLog.info('Searching Qobuz', `Query: ${query}`);
      const artists: LmsArtist[] = [];
      const albums: LmsAlbum[] = [];
      const tracks: LmsTrack[] = [];

      // Clean and prepare the search query - aggressively remove all special characters
      // This allows matching tracks with or without special characters
      const cleanQuery = query
        .replace(/[()\[\]{}'"?.,!;:]/g, ' ') // Remove all punctuation and special chars
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
      
      debugLog.info('Cleaned Qobuz query', `Original: "${query}", Cleaned: "${cleanQuery}"`);
      
      // Also try searching with just the words (no special chars at all)
      const wordsOnlyQuery = cleanQuery.split(' ').filter(w => w.length > 0).join(' ');
      
      // Try multiple search strategies for better results
      // Search with both cleaned query and words-only query to catch variations
      const searchQueries = [cleanQuery];
      if (wordsOnlyQuery && wordsOnlyQuery !== cleanQuery) {
        searchQueries.push(wordsOnlyQuery);
      }
      
      // Try the first cleaned query - increased limits for better results
      const [artistsResult, albumsResult, tracksResult] = await Promise.all([
        this.request('', ['qobuz', 'items', '0', '200', `search:${cleanQuery}`, 'type:artists', 'want_url:1']).catch(() => ({})),
        this.request('', ['qobuz', 'items', '0', '200', `search:${cleanQuery}`, 'type:albums', 'want_url:1']).catch(() => ({})),
        this.request('', ['qobuz', 'items', '0', '200', `search:${cleanQuery}`, 'type:tracks', 'want_url:1']).catch(() => ({})),
      ]);
      
      // Also try with words-only query if different
      if (wordsOnlyQuery && wordsOnlyQuery !== cleanQuery) {
        const [artistsResult2, albumsResult2, tracksResult2] = await Promise.all([
          this.request('', ['qobuz', 'items', '0', '200', `search:${wordsOnlyQuery}`, 'type:artists', 'want_url:1']).catch(() => ({})),
          this.request('', ['qobuz', 'items', '0', '200', `search:${wordsOnlyQuery}`, 'type:albums', 'want_url:1']).catch(() => ({})),
          this.request('', ['qobuz', 'items', '0', '200', `search:${wordsOnlyQuery}`, 'type:tracks', 'want_url:1']).catch(() => ({})),
        ]);
        
        // Merge results from both searches
        const mergeItems = (result1: any, result2: any) => {
          const items1 = ((result1 as Record<string, unknown>).item_loop || []) as Array<Record<string, unknown>>;
          const items2 = ((result2 as Record<string, unknown>).item_loop || []) as Array<Record<string, unknown>>;
          const merged = [...items1];
          const seenIds = new Set(items1.map((item: any) => String(item.id || item.url || '')));
          for (const item of items2) {
            const id = String(item.id || item.url || '');
            if (!seenIds.has(id)) {
              merged.push(item);
              seenIds.add(id);
            }
          }
          return merged;
        };
        
        const artistItems = mergeItems(artistsResult, artistsResult2);
        const albumItems = mergeItems(albumsResult, albumsResult2);
        const trackItems = mergeItems(tracksResult, tracksResult2);
        
        // Process merged results
        for (const item of artistItems) {
          const name = String(item.name || item.text || item.artist || '');
          if (name && !artists.find(a => a.id === String(item.id || item.artist_id || ''))) {
            artists.push({
              id: String(item.id || item.artist_id || `qobuz_artist_${name}`),
              name: name,
            });
          }
        }
        
        for (const item of albumItems) {
          const title = String(item.album || item.title || item.name || item.text || '');
          if (title && !albums.find(a => a.id === String(item.album_id || item.id || ''))) {
            const artworkUrl = item.image ? String(item.image) : 
              (item.artwork_url ? this.normalizeArtworkUrl(String(item.artwork_url)) : undefined);
            albums.push({
              id: String(item.album_id || item.id || `qobuz_album_${title}`),
              title: title,
              artist: String(item.artist || item.albumartist || 'Unknown Artist'),
              artwork_url: artworkUrl,
              year: item.year ? Number(item.year) : undefined,
            });
          }
        }
        
        for (const item of trackItems) {
          const title = String(item.title || item.name || item.text || '');
          if (title && !tracks.find(t => t.id === String(item.id || item.url || ''))) {
            const artworkUrl = item.image ? String(item.image) : 
              (item.artwork_url ? this.normalizeArtworkUrl(String(item.artwork_url)) : undefined);
            const artist = String(item.artist || 'Unknown Artist');
            tracks.push({
              id: String(item.id || item.url || `qobuz_track_${title}`),
              title: title,
              artist: artist,
              album: String(item.album || ''),
              duration: Number(item.duration || 0),
              artwork_url: artworkUrl,
              url: item.url ? String(item.url) : undefined,
              format: 'FLAC',
              sampleRate: item.samplerate ? String(item.samplerate) : undefined,
              bitDepth: item.bits_per_sample ? String(item.bits_per_sample) : undefined,
            });
          }
        }
      } else {
        // Process results from single query
        const artistItems = ((artistsResult as Record<string, unknown>).item_loop || []) as Array<Record<string, unknown>>;
        for (const item of artistItems) {
          const name = String(item.name || item.text || item.artist || '');
          if (name) {
            artists.push({
              id: String(item.id || item.artist_id || `qobuz_artist_${name}`),
              name: name,
            });
          }
        }

        const albumItems = ((albumsResult as Record<string, unknown>).item_loop || []) as Array<Record<string, unknown>>;
        for (const item of albumItems) {
        const title = String(item.album || item.title || item.name || item.text || '');
        if (title) {
          const artworkUrl = item.image ? String(item.image) : 
            (item.artwork_url ? this.normalizeArtworkUrl(String(item.artwork_url)) : undefined);
          albums.push({
            id: String(item.album_id || item.id || `qobuz_album_${title}`),
            title: title,
            artist: String(item.artist || item.albumartist || 'Unknown Artist'),
            artwork_url: artworkUrl,
            year: item.year ? Number(item.year) : undefined,
          });
          }
        }

        const trackItems = ((tracksResult as Record<string, unknown>).item_loop || []) as Array<Record<string, unknown>>;
        for (const item of trackItems) {
        const title = String(item.title || item.name || item.text || '');
        if (title) {
          const artworkUrl = item.image ? String(item.image) : 
            (item.artwork_url ? this.normalizeArtworkUrl(String(item.artwork_url)) : undefined);
          const artist = String(item.artist || 'Unknown Artist');
          tracks.push({
            id: String(item.id || item.url || `qobuz_track_${title}`),
            title: title,
            artist: artist,
            album: String(item.album || ''),
            duration: Number(item.duration || 0),
            artwork_url: artworkUrl,
            url: item.url ? String(item.url) : undefined,
            format: 'FLAC',
            sampleRate: item.samplerate ? String(item.samplerate) : undefined,
            bitDepth: item.bits_per_sample ? String(item.bits_per_sample) : undefined,
          });
          }
        }
      }
      
      // Rank and sort tracks by relevance to the search query
      const queryLower = cleanQuery.toLowerCase();
      tracks.sort((a, b) => {
        const scoreA = this.calculateTrackRelevanceScore(a, queryLower);
        const scoreB = this.calculateTrackRelevanceScore(b, queryLower);
        return scoreB - scoreA; // Sort descending (highest score first)
      });

      // If no results, try multiple fallback strategies
      if (artists.length === 0 && albums.length === 0 && tracks.length === 0) {
        debugLog.info('No initial Qobuz results, trying fallback strategies');
        
        // Strategy 1: Try broader search without type filter (searches all types together)
        try {
          const fallbackResult = await this.request('', [
            'qobuz', 'items', '0', '500', // Increased limit
            `search:${cleanQuery}`,
            'want_url:1'
          ]);
          
          const fallbackItems = (fallbackResult as Record<string, unknown>).item_loop as Array<Record<string, unknown>> | undefined;
          
          if (fallbackItems && fallbackItems.length > 0) {
            debugLog.info('Found results in fallback search', `${fallbackItems.length} items`);
            const fallbackResults = this.parseQobuzSearchResults(fallbackItems, artists, albums, tracks);
            
            // Rank and sort tracks by relevance
            const queryLower = query.toLowerCase();
            fallbackResults.tracks.sort((a, b) => {
              const scoreA = this.calculateTrackRelevanceScore(a, queryLower);
              const scoreB = this.calculateTrackRelevanceScore(b, queryLower);
              return scoreB - scoreA;
            });
            
            debugLog.info('Qobuz search results (fallback)', `${fallbackResults.artists.length} artists, ${fallbackResults.albums.length} albums, ${fallbackResults.tracks.length} tracks`);
            if (fallbackResults.tracks.length > 0 || fallbackResults.albums.length > 0 || fallbackResults.artists.length > 0) {
              return fallbackResults;
            }
          }
        } catch (e) {
          debugLog.info('Fallback search failed', e instanceof Error ? e.message : String(e));
        }
        
        // Strategy 2: Try searching with individual words - try multiple combinations
        const queryWords = cleanQuery.split(' ').filter(w => w.length >= 2); // Reduced minimum length to 2
        if (queryWords.length > 1) {
          // Try different combinations of words
          const searchCombinations: string[] = [];
          
          // Try first 2-3 words
          if (queryWords.length >= 2) {
            searchCombinations.push(queryWords.slice(0, 2).join(' '));
          }
          if (queryWords.length >= 3) {
            searchCombinations.push(queryWords.slice(0, 3).join(' '));
          }
          
          // Try last 2-3 words
          if (queryWords.length >= 2) {
            searchCombinations.push(queryWords.slice(-2).join(' '));
          }
          if (queryWords.length >= 3) {
            searchCombinations.push(queryWords.slice(-3).join(' '));
          }
          
          // Try most significant words (longest ones)
          const significantWords = queryWords
            .sort((a, b) => b.length - a.length)
            .slice(0, Math.min(3, queryWords.length));
          if (significantWords.length > 0) {
            searchCombinations.push(significantWords.join(' '));
          }
          
          // Try each word individually (for very short queries)
          if (queryWords.length <= 4) {
            for (const word of queryWords) {
              if (word.length >= 3) {
                searchCombinations.push(word);
              }
            }
          }
          
          // Remove duplicates and the original query
          const uniqueCombinations = Array.from(new Set(searchCombinations)).filter(q => q !== cleanQuery && q.length > 0);
          
          debugLog.info('Trying multiple search combinations', `${uniqueCombinations.length} combinations: ${uniqueCombinations.join(', ')}`);
          
          for (const partialQuery of uniqueCombinations) {
            try {
              debugLog.info('Trying search combination', `Query: "${partialQuery}"`);
              const partialResult = await this.request('', [
                'qobuz', 'items', '0', '500', // Increased limit
                `search:${partialQuery}`,
                'want_url:1'
              ]);
              
              const partialItems = (partialResult as Record<string, unknown>).item_loop as Array<Record<string, unknown>> | undefined;
              if (partialItems && partialItems.length > 0) {
                debugLog.info('Found results with combination', `Query: "${partialQuery}", Items: ${partialItems.length}`);
                const partialResults = this.parseQobuzSearchResults(partialItems, artists, albums, tracks);
                
                // Rank by original query
                const queryLower = query.toLowerCase();
                partialResults.tracks.sort((a, b) => {
                  const scoreA = this.calculateTrackRelevanceScore(a, queryLower);
                  const scoreB = this.calculateTrackRelevanceScore(b, queryLower);
                  return scoreB - scoreA;
                });
                
                debugLog.info('Qobuz search results (combination)', `Query: "${partialQuery}", ${partialResults.artists.length} artists, ${partialResults.albums.length} albums, ${partialResults.tracks.length} tracks`);
                if (partialResults.tracks.length > 0 || partialResults.albums.length > 0 || partialResults.artists.length > 0) {
                  return partialResults;
                }
              }
            } catch (e) {
              debugLog.info('Search combination failed', `Query: "${partialQuery}", Error: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
        
        // Strategy 3: Try searching for "whats that sound" or similar phrases if query contains "whats"
        if (cleanQuery.toLowerCase().includes('whats')) {
          const whatsVariations = [
            'whats that sound',
            'what that sound',
            'whats that',
            'that sound',
            'what sound'
          ];
          
          for (const variation of whatsVariations) {
            try {
              debugLog.info('Trying "whats" variation search', `Query: "${variation}"`);
              const variationResult = await this.request('', [
                'qobuz', 'items', '0', '500',
                `search:${variation}`,
                'want_url:1'
              ]);
              
              const variationItems = (variationResult as Record<string, unknown>).item_loop as Array<Record<string, unknown>> | undefined;
              if (variationItems && variationItems.length > 0) {
                debugLog.info('Found results with "whats" variation', `Query: "${variation}", Items: ${variationItems.length}`);
                const variationResults = this.parseQobuzSearchResults(variationItems, artists, albums, tracks);
                
                // Rank by original query
                const queryLower = query.toLowerCase();
                variationResults.tracks.sort((a, b) => {
                  const scoreA = this.calculateTrackRelevanceScore(a, queryLower);
                  const scoreB = this.calculateTrackRelevanceScore(b, queryLower);
                  return scoreB - scoreA;
                });
                
                debugLog.info('Qobuz search results (whats variation)', `Query: "${variation}", ${variationResults.artists.length} artists, ${variationResults.albums.length} albums, ${variationResults.tracks.length} tracks`);
                if (variationResults.tracks.length > 0 || variationResults.albums.length > 0 || variationResults.artists.length > 0) {
                  return variationResults;
                }
              }
            } catch (e) {
              debugLog.info('"whats" variation search failed', `Query: "${variation}", Error: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
        
        // Strategy 4: Try searching for just the first word if query has multiple words
        if (queryWords.length > 1) {
          const firstWord = queryWords[0];
          if (firstWord.length >= 3) {
            try {
              debugLog.info('Trying first word only search', `Query: "${firstWord}"`);
              const firstWordResult = await this.request('', [
                'qobuz', 'items', '0', '500',
                `search:${firstWord}`,
                'want_url:1'
              ]);
              
              const firstWordItems = (firstWordResult as Record<string, unknown>).item_loop as Array<Record<string, unknown>> | undefined;
              if (firstWordItems && firstWordItems.length > 0) {
                const firstWordResults = this.parseQobuzSearchResults(firstWordItems, artists, albums, tracks);
                
                // Rank by original full query
                const queryLower = query.toLowerCase();
                firstWordResults.tracks.sort((a, b) => {
                  const scoreA = this.calculateTrackRelevanceScore(a, queryLower);
                  const scoreB = this.calculateTrackRelevanceScore(b, queryLower);
                  return scoreB - scoreA;
                });
                
                debugLog.info('Qobuz search results (first word)', `${firstWordResults.artists.length} artists, ${firstWordResults.albums.length} albums, ${firstWordResults.tracks.length} tracks`);
                if (firstWordResults.tracks.length > 0 || firstWordResults.albums.length > 0 || firstWordResults.artists.length > 0) {
                  return firstWordResults;
                }
              }
            } catch (e) {
              debugLog.info('First word search failed', e instanceof Error ? e.message : String(e));
            }
          }
        }
      }
      
      debugLog.info('Qobuz search results', `${artists.length} artists, ${albums.length} albums, ${tracks.length} tracks`);
      return { artists, albums, tracks };
    } catch (error) {
      debugLog.error('Qobuz search failed', error instanceof Error ? error.message : String(error));
      return { artists: [], albums: [], tracks: [] };
    }
  }

  /**
   * Parse Qobuz search results from item_loop
   */
  private parseQobuzSearchResults(
    items: Array<Record<string, unknown>>,
    existingArtists: LmsArtist[],
    existingAlbums: LmsAlbum[],
    existingTracks: LmsTrack[]
  ): { artists: LmsArtist[]; albums: LmsAlbum[]; tracks: LmsTrack[] } {
    const artists = [...existingArtists];
    const albums = [...existingAlbums];
    const tracks = [...existingTracks];
    
    for (const item of items) {
      const type = String(item.type || '');
      const name = String(item.name || item.text || '');
      const id = String(item.id || item.url || `qobuz_${Date.now()}_${Math.random()}`);

      if (type === 'artist' || item.artist_id) {
        const artistName = String(item.artist || name);
        if (artistName && !artists.find(a => a.id === id || a.name === artistName)) {
          artists.push({
            id: String(item.artist_id || id),
            name: artistName,
          });
        }
      } else if (type === 'album' || item.album_id) {
        const title = String(item.album || item.title || name);
        if (title) {
          const artworkUrl = item.image ? String(item.image) : 
            (item.artwork_url ? this.normalizeArtworkUrl(String(item.artwork_url)) : undefined);
          const albumId = String(item.album_id || id);
          if (!albums.find(a => a.id === albumId || (a.title === title && a.artist === String(item.artist || item.albumartist || 'Unknown Artist')))) {
            albums.push({
              id: albumId,
              title: title,
              artist: String(item.artist || item.albumartist || 'Unknown Artist'),
              artwork_url: artworkUrl,
              year: item.year ? Number(item.year) : undefined,
            });
          }
        }
      } else if (type === 'audio' || type === 'track' || item.url || item.duration) {
        const title = String(item.title || item.name || name);
        if (title) {
          const artworkUrl = item.image ? String(item.image) : 
            (item.artwork_url ? this.normalizeArtworkUrl(String(item.artwork_url)) : undefined);
          const trackId = String(item.id || id);
          const artist = String(item.artist || 'Unknown Artist');
          if (!tracks.find(t => t.id === trackId || (t.title === title && t.artist === artist))) {
            tracks.push({
              id: trackId,
              title: title,
              artist: artist,
              album: String(item.album || ''),
              duration: Number(item.duration || 0),
              artwork_url: artworkUrl,
              url: item.url ? String(item.url) : undefined,
              format: 'FLAC',
              sampleRate: item.samplerate ? String(item.samplerate) : undefined,
              bitDepth: item.bits_per_sample ? String(item.bits_per_sample) : undefined,
            });
          }
        }
      }
    }
    
    // Rank and sort tracks by relevance (if we have a query to match against)
    // Note: parseQobuzSearchResults doesn't have access to the original query,
    // so we'll rank in the calling function instead
    
    return { artists, albums, tracks };
  }

  async globalSearch(query: string): Promise<{ artists: LmsArtist[]; albums: LmsAlbum[]; tracks: LmsTrack[] }> {
    if (!this.baseUrl) {
      throw new Error('LMS server not configured');
    }
    
    // Try globalsearch first, but fall back gracefully if it's not available or fails
    try {
      debugLog.info('Global search', `Query: ${query}`);
      // Use globalsearch to search both LMS library and Qobuz
      const result = await this.request('', [
        'globalsearch', 'items', '0', '200',
        `search:${query}`,
        'want_url:1'
      ]);

      const items = (result.item_loop || result.loop_loop || []) as Array<Record<string, unknown>>;
      const artists: LmsArtist[] = [];
      const albums: LmsAlbum[] = [];
      const tracks: LmsTrack[] = [];

      for (const item of items) {
        const type = String(item.type || '');
        const hasUrl = Boolean(item.url);
        const url = item.url ? String(item.url) : '';
        // Check if item is from Qobuz (Qobuz URLs typically contain 'qobuz' or are streaming URLs)
        const isQobuz = url.includes('qobuz') || String(item.extid || '').includes('qobuz') || 
                       String(item.id || '').startsWith('qobuz_');

        if (type === 'artist' || item.artist_id) {
          artists.push({
            id: String(item.artist_id || item.id || ''),
            name: String(item.artist || item.name || item.text || 'Unknown Artist'),
          });
        } else if (type === 'album' || item.album_id) {
          const artworkUrl = item.image ? String(item.image) : 
            (item.artwork_url ? this.normalizeArtworkUrl(String(item.artwork_url)) : undefined);
          albums.push({
            id: String(item.album_id || item.id || ''),
            title: String(item.album || item.title || item.name || item.text || 'Unknown Album'),
            artist: String(item.artist || item.albumartist || 'Unknown Artist'),
            artwork_url: artworkUrl,
            year: item.year ? Number(item.year) : undefined,
          });
        } else if (type === 'audio' || type === 'track' || hasUrl) {
          const artworkUrl = item.image ? String(item.image) : 
            (item.artwork_url ? this.normalizeArtworkUrl(String(item.artwork_url)) : undefined);
          tracks.push({
            id: String(item.id || item.url || `track_${Date.now()}`),
            title: String(item.title || item.name || item.text || 'Unknown Track'),
            artist: String(item.artist || 'Unknown Artist'),
            album: String(item.album || ''),
            duration: Number(item.duration || 0),
            artwork_url: artworkUrl,
            url: item.url ? String(item.url) : undefined,
            format: 'FLAC',
          });
        }
      }

      // Rank and sort tracks by relevance
      const queryLower = query.toLowerCase();
      tracks.sort((a, b) => {
        const scoreA = this.calculateTrackRelevanceScore(a, queryLower);
        const scoreB = this.calculateTrackRelevanceScore(b, queryLower);
        return scoreB - scoreA; // Sort descending (highest score first)
      });
      
      debugLog.info('Global search results', `${artists.length} artists, ${albums.length} albums, ${tracks.length} tracks`);
      return { artists, albums, tracks };
    } catch (error) {
      // globalsearch may not be available or may timeout - this is expected, fall back gracefully
      const errorMsg = error instanceof Error ? error.message : String(error);
      debugLog.info('Global search not available, falling back to separate searches', errorMsg);
      
      // Fallback to separate searches if globalsearch is not available
      try {
        debugLog.info('Starting fallback searches', `Query: ${query}`);
        const [localResult, qobuzResult] = await Promise.all([
          this.search(query).catch((e) => {
            debugLog.info('Local search failed in fallback', e instanceof Error ? e.message : String(e));
            return { artists: [], albums: [], tracks: [] };
          }),
          this.searchQobuz(query).catch((e) => {
            debugLog.info('Qobuz search failed in fallback', e instanceof Error ? e.message : String(e));
            return { artists: [], albums: [], tracks: [] };
          }),
        ]);
        
        debugLog.info('Fallback search results', `Local: ${localResult.tracks.length} tracks, Qobuz: ${qobuzResult.tracks.length} tracks`);
        
        // Rank and sort combined tracks by relevance
        const allTracks = [...localResult.tracks, ...qobuzResult.tracks];
        const queryLower = query.toLowerCase();
        allTracks.sort((a, b) => {
          const scoreA = this.calculateTrackRelevanceScore(a, queryLower);
          const scoreB = this.calculateTrackRelevanceScore(b, queryLower);
          return scoreB - scoreA; // Sort descending (highest score first)
        });
        
        debugLog.info('Final fallback results', `${allTracks.length} tracks after ranking`);
        
        return {
          artists: [...localResult.artists, ...qobuzResult.artists],
          albums: [...localResult.albums, ...qobuzResult.albums],
          tracks: allTracks,
        };
      } catch (fallbackError) {
        // If fallback also fails, return empty results
        debugLog.error('Fallback search failed', fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
        return { artists: [], albums: [], tracks: [] };
      }
    }
  }

  /**
   * Calculate relevance score for a track based on search query
   * Higher score = better match
   */
  private calculateTrackRelevanceScore(track: LmsTrack, queryLower: string): number {
    let score = 0;
    const titleLower = track.title.toLowerCase();
    const artistLower = track.artist.toLowerCase();
    const albumLower = (track.album || '').toLowerCase();
    
    // Aggressively clean special characters for matching - remove all punctuation
    const normalizeText = (text: string) => 
      text.replace(/[()\[\]{}'"?.,!;:]/g, ' ').replace(/\s+/g, ' ').trim();
    
    const cleanTitle = normalizeText(titleLower);
    const cleanArtist = normalizeText(artistLower);
    const cleanAlbum = normalizeText(albumLower);
    const cleanQuery = normalizeText(queryLower);
    const queryWords = cleanQuery.split(' ').filter(w => w.length > 0);
    
    // Calculate match percentage (how many query words are found in title/artist, fuzzy-aware)
    const matchedWords = queryWords.filter(word => {
      if (cleanTitle.includes(word) || cleanArtist.includes(word)) return true;
      // Fuzzy match against title as well to catch small typos like "mada" vs "madan"
      return this.fuzzyMatch(word, cleanTitle);
    }).length;
    const matchPercentage = queryWords.length > 0 ? matchedWords / queryWords.length : 0;
    
    // Base score from match percentage (0-100 points)
    score += matchPercentage * 100;
    
    // Exact title match (highest priority) - bonus points
    if (cleanTitle === cleanQuery) {
      score += 200;
    } else if (titleLower === queryLower) {
      score += 150; // Original with special chars also matches
    }
    
    // Title starts with query - high priority
    if (cleanTitle.startsWith(cleanQuery)) {
      score += 150;
    } else if (titleLower.startsWith(queryLower)) {
      score += 120;
    }
    
    // Title contains query as substring
    if (cleanTitle.includes(cleanQuery)) {
      score += 100;
    } else if (titleLower.includes(queryLower)) {
      score += 80;
    }
    
    // Title contains all query words (in any order) - very important
    if (queryWords.length > 0 && queryWords.every(word => cleanTitle.includes(word) || this.fuzzyMatch(word, cleanTitle))) {
      score += 120;
    }
    
    // Title contains most query words (at least 80%)
    const titleMatchedWords = queryWords.filter(word => cleanTitle.includes(word) || this.fuzzyMatch(word, cleanTitle)).length;
    if (queryWords.length > 0 && titleMatchedWords / queryWords.length >= 0.8) {
      score += 80;
    }
    
    // Check for artist match (important for finding correct track)
    if (cleanArtist.includes(cleanQuery) || cleanQuery.includes(cleanArtist)) {
      score += 60;
    } else if (artistLower.includes(queryLower) || queryLower.includes(artistLower)) {
      score += 40;
    }
    
    // Check for artist containing query words (fuzzy match for typos like "rythyms" vs "rythmes")
    const queryWordsInArtist = queryWords.filter(word => {
      // Try exact match first (normalized)
      if (cleanArtist.includes(word)) return true;
      // Try original match
      if (artistLower.includes(word)) return true;
      // Try fuzzy match (allow 1-2 character difference for typos)
      return this.fuzzyMatch(word, artistLower);
    }).length;
    
    if (queryWordsInArtist > 0) {
      score += queryWordsInArtist * 25;
    }
    
    // Bonus for combined title + artist match (both normalized)
    if (queryWords.length > 0 && 
        queryWords.every(word => cleanTitle.includes(word)) && 
        queryWordsInArtist > 0) {
      score += 50;
    }
    
    // Check for album match (lower priority)
    if (cleanAlbum.includes(cleanQuery)) {
      score += 15;
    }
    
    // Partial word matches - prioritize longer words
    queryWords.forEach(qWord => {
      if (qWord.length >= 4) { // Longer words are more significant
        if (cleanTitle.includes(qWord)) score += 10;
        if (cleanArtist.includes(qWord)) score += 8;
      } else if (qWord.length >= 3) {
        if (cleanTitle.includes(qWord)) score += 6;
        if (cleanArtist.includes(qWord)) score += 5;
      }
    });
    
    return score;
  }

  /**
   * Simple fuzzy matching - check if a word is similar to any word in a string
   * Allows for common typos (1-2 character differences)
   */
  private fuzzyMatch(word: string, text: string): boolean {
    const textWords = text.split(/\s+/);
    for (const textWord of textWords) {
      // Exact match
      if (textWord === word) return true;
      
      // Check if words are similar (same length, 1-2 char difference)
      if (Math.abs(textWord.length - word.length) <= 2) {
        // Simple Levenshtein-like check for common typos
        let differences = 0;
        const minLen = Math.min(textWord.length, word.length);
        for (let i = 0; i < minLen; i++) {
          if (textWord[i] !== word[i]) differences++;
        }
        differences += Math.abs(textWord.length - word.length);
        
        // Allow up to 2 character differences (for typos like "rythyms" vs "rythmes")
        if (differences <= 2) return true;
      }
      
      // Check if one word contains the other (for partial matches)
      if (textWord.includes(word) || word.includes(textWord)) {
        return true;
      }
    }
    return false;
  }

  private normalizeArtworkUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  async play(playerId: string): Promise<void> {
    await this.request(playerId, ['play']);
  }

  async pause(playerId: string): Promise<void> {
    await this.request(playerId, ['pause', '1']);
  }

  async stop(playerId: string): Promise<void> {
    await this.request(playerId, ['stop']);
  }

  async togglePlayPause(playerId: string): Promise<void> {
    // Get current status to determine if we should play or pause
    const status = await this.getPlayerStatus(playerId);

    if (status.mode === 'play') {
      // Currently playing, so pause
      await this.request(playerId, ['pause']);
    } else {
      // Currently paused/stopped, so play
      await this.request(playerId, ['play']);
    }
  }

  async next(playerId: string): Promise<void> {
    await this.request(playerId, ['playlist', 'index', '+1']);
  }

  async previous(playerId: string): Promise<void> {
    await this.request(playerId, ['playlist', 'index', '-1']);
  }

  async seek(playerId: string, seconds: number): Promise<void> {
    await this.request(playerId, ['time', String(seconds)]);
  }

  async setVolume(playerId: string, volume: number): Promise<void> {
    const clampedVolume = Math.max(0, Math.min(100, Math.round(volume)));
    await this.request(playerId, ['mixer', 'volume', String(clampedVolume)]);
  }

  async setPower(playerId: string, on: boolean): Promise<void> {
    await this.request(playerId, ['power', on ? '1' : '0']);
  }

  async setPlayerPreference(playerId: string, pref: string, value: string): Promise<void> {
    await this.request(playerId, ['playerpref', pref, value]);
  }

  /**
   * Set server-wide preference (not player-specific)
   */
  async setServerPreference(pref: string, value: string): Promise<void> {
    await this.request('', ['pref', pref, value]);
  }

  /**
   * Configure player to use native format playback (disable transcoding)
   * This prevents white noise issues with high-res audio files
   */
  async configureNativePlayback(playerId: string): Promise<void> {
    try {
      // Disable transcoding - use native format when player supports it
      await this.setPlayerPreference(playerId, 'transcode', '0');
      // Also ensure FLAC/DSD native playback is enabled
      await this.setPlayerPreference(playerId, 'transcodeFLAC', '0');
      await this.setPlayerPreference(playerId, 'transcodeDSD', '0');
    } catch (error) {
      // If setting fails, continue anyway - some players may not support these preferences
      debugLog.info('Could not set native playback preferences', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Configure player buffer settings to prevent audio dropouts
   * Especially important for high-res audio and UPnP bridge scenarios
   * 
   * Note: Buffer settings may need to be configured manually in LMS web UI
   * as preference names vary by player type. This attempts common settings.
   */
  async configureBufferSettings(playerId: string): Promise<void> {
    try {
      // Try to set buffer-related preferences (names may vary by player)
      // These are common Squeezelite buffer settings
      const bufferPrefs = [
        ['bufferSize', '8192'],        // Buffer size in frames
        ['streamBuffer', '100'],       // Streaming buffer percentage
        ['rebufferAt', '0'],           // Rebuffer threshold (0% = only when necessary)
        ['streamBufferSize', '131072'], // Stream buffer size in bytes (128KB)
      ];
      
      for (const [pref, value] of bufferPrefs) {
        try {
          await this.setPlayerPreference(playerId, pref, value);
          debugLog.info('Set buffer preference', `${pref} = ${value}`);
        } catch (e) {
          // Some preferences may not be supported - continue with others
          debugLog.info('Buffer preference not supported', `${pref} (this is normal for some players)`);
        }
      }
      
      debugLog.info('Buffer settings configured', `Player: ${playerId}`);
    } catch (error) {
      // Buffer preferences may not be available via API - user should set manually in LMS
      debugLog.info('Could not set buffer preferences via API', 'Configure manually in LMS web UI - see AUDIO_DROPOUT_TROUBLESHOOTING.md');
    }
  }

  /**
   * Get current player preferences to diagnose white noise issues
   * Returns a diagnostic report of settings that could cause white noise
   */
  async diagnoseWhiteNoise(playerId: string): Promise<{
    issues: string[];
    recommendations: string[];
    currentSettings: Record<string, string>;
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];
    const currentSettings: Record<string, string> = {};

    try {
      // Get player preferences - LMS uses 'playerpref' command to get preferences
      // We'll try to get common preferences that affect audio quality
      const prefsToCheck = [
        'transcode',
        'transcodeFLAC',
        'transcodeDSD',
        'transcodeMP3',
        'streamBuffer',
        'rebufferAt',
        'bufferSize',
        'streamBufferSize',
        'crossfade',
        'replayGain',
        'replayGainMode',
        'gapless',
        'streamingMethod',
      ];

      for (const pref of prefsToCheck) {
        try {
          // Try to get preference value - LMS uses 'playerpref' with preference name
          // LMS playerpref command format: ['playerpref', 'prefname', '?'] to query value
          const result = await this.request(playerId, ['playerpref', pref, '?']);
          
          // LMS returns preferences in different formats:
          // - {_p2: "value"} or {_p2: null} (LMS standard format when using '?')
          // - {_transcode: "0"} (with underscore prefix)
          // - {value: "0"}
          // - {transcode: "0"} (direct key)
          // - Sometimes: just the string value
          // - Sometimes: {playerpref: {_transcode: "0"}} (nested)
          let value: string = 'not available';
          
          // Debug: log the raw result for first preference to understand format
          if (pref === prefsToCheck[0]) {
            debugLog.info('playerpref response format', JSON.stringify(result));
          }
          
          if (typeof result === 'string') {
            value = result;
          } else if (typeof result === 'object' && result !== null) {
            const resultAny = result as any;
            
            // LMS standard format: {_p2: "value"} or {_p2: null}
            if (resultAny._p2 !== undefined) {
              value = resultAny._p2 === null ? 'not set' : String(resultAny._p2);
            } else {
              // Try other possible formats
              const prefKey = `_${pref}`;
              
              // Check nested playerpref object first
              if (resultAny.playerpref && typeof resultAny.playerpref === 'object') {
                value = resultAny.playerpref._p2 !== undefined 
                  ? (resultAny.playerpref._p2 === null ? 'not set' : String(resultAny.playerpref._p2))
                  : resultAny.playerpref[prefKey] ?? 
                    resultAny.playerpref[pref] ?? 
                    resultAny.playerpref.value ??
                    'not available';
              } else {
                // Check top-level keys
                value = resultAny[prefKey] ?? 
                       resultAny[pref] ?? 
                       resultAny.value ?? 
                       resultAny.playerpref ??
                       'not available';
              }
              
              if (value !== 'not available' && value !== 'not set' && typeof value !== 'string') {
                value = String(value);
              }
            }
          }
          
          currentSettings[pref] = value;

          // Check for problematic settings
          // Note: "not set" means using default - we should only flag if explicitly enabled
          if (pref === 'transcode' && value !== 'not set' && value !== 'not available' && value !== '0' && value !== 'never' && value !== 'disabled') {
            issues.push(`Transcoding is enabled (${value}) - this can cause white noise if format conversion is incorrect`);
            recommendations.push('Disable transcoding: Go to Settings → Player → OLADRAplayer → Audio → File Types (or Settings → Advanced → File Types if available)');
          }
          if (pref === 'transcodeFLAC' && value !== 'not set' && value !== 'not available' && value !== '0' && value !== 'never' && value !== 'disabled') {
            issues.push(`FLAC transcoding is enabled (${value}) - FLAC should play natively`);
            recommendations.push('Disable FLAC transcoding: Go to Settings → Player → OLADRAplayer → Audio → File Types → FLAC (or Settings → Advanced → File Types if available)');
          }
          if (pref === 'streamBuffer' && value !== 'not set' && value !== 'not available' && Number(value) < 50) {
            issues.push(`Streaming buffer is too low (${value}%) - can cause audio issues`);
            recommendations.push('Increase streaming buffer to 100%: LMS Player Settings → Audio → Streaming Buffer');
          }
          if (pref === 'crossfade' && value !== 'not set' && value !== 'not available' && value !== '0' && value !== 'off') {
            issues.push(`Crossfade is enabled (${value}) - can cause audio processing issues`);
            recommendations.push('Disable crossfade: LMS Player Settings → Audio → Crossfade');
          }
          if (pref === 'replayGain' && value !== 'not set' && value !== 'not available' && value !== '0' && value !== 'off') {
            issues.push(`Replay Gain is enabled (${value}) - can cause audio processing issues`);
            recommendations.push('Disable Replay Gain: LMS Player Settings → Audio → Replay Gain');
          }
        } catch (e) {
          // Preference might not exist or not be readable - that's okay
          currentSettings[pref] = 'not available';
        }
      }

      // Get player info to check model and capabilities
      try {
        const players = await this.getPlayers();
        const player = players.find(p => p.id === playerId);
        if (player) {
          currentSettings['playerModel'] = player.model;
          currentSettings['playerName'] = player.name;
        }
      } catch (e) {
        // Ignore
      }

      // Get current track info to check format
      try {
        const status = await this.getPlayerStatus(playerId);
        if (status.currentTrack) {
          currentSettings['currentFormat'] = status.currentTrack.format || 'unknown';
          currentSettings['currentSampleRate'] = status.currentTrack.sampleRate || 'unknown';
          currentSettings['currentBitDepth'] = status.currentTrack.bitDepth || 'unknown';
          
          // Check if format might be problematic
          const format = (status.currentTrack.format || '').toUpperCase();
          const sampleRate = status.currentTrack.sampleRate;
          const bitDepth = status.currentTrack.bitDepth;
          
          // Check for high-resolution formats that might cause white noise
          const sampleRateNum = sampleRate ? parseFloat(sampleRate.toString().replace(/[^0-9.]/g, '')) : 0;
          const isHighRes = sampleRateNum > 48000 || (bitDepth && parseInt(bitDepth.toString()) > 16);
          
          if (isHighRes) {
            issues.push(`High-resolution format detected (${sampleRate}${bitDepth ? `/${bitDepth}-bit` : ''}) - white noise suggests DAC may not support this resolution`);
            recommendations.push('SOLUTION: Enable transcoding for high-resolution formats');
            recommendations.push('1. Go to: Settings → Player → OLADRAplayer → Audio');
            recommendations.push('2. Set Sample Rate limit to 48000 Hz (or your DAC\'s max supported rate)');
            recommendations.push('3. OR enable transcoding for FLAC/WAV at high sample rates');
            recommendations.push('4. Alternative: Settings → Advanced → File Types → FLAC → Set to transcode above 48kHz');
          }
          
          if (format.includes('DSD') && currentSettings['transcodeDSD'] === '0') {
            issues.push('DSD format detected but DSD transcoding is disabled - DSD may not be supported natively');
            recommendations.push('Enable DSD transcoding: LMS Player Settings → Audio → DSD Transcoding → Set to "PCM" or "DoP"');
          }
        }
      } catch (e) {
        // Ignore
      }
      
      // Add general hi-res recommendations if transcoding is disabled
      if (currentSettings['transcode'] === '0' && currentSettings['transcodeFLAC'] === '0') {
        recommendations.push('\n⚠️ HIGH-RESOLUTION AUDIO TROUBLESHOOTING:');
        recommendations.push('If high-res formats (96kHz, 192kHz, DSD) cause white noise:');
        recommendations.push('SOLUTION: Limit maximum sample rate to what your DAC supports');
        recommendations.push('1. Go to: Settings → Player → OLADRAplayer → Audio');
        recommendations.push('2. Find "Sample Rate" or "Maximum Sample Rate" setting');
        recommendations.push('3. Set to 48000 Hz (or your DAC\'s max supported rate)');
        recommendations.push('4. This will downsample high-res files to the set limit');
        recommendations.push('5. Standard resolution (44.1/48kHz) will still play natively');
        recommendations.push('\nAlternative: Enable transcoding for high-res only');
        recommendations.push('• Settings → Advanced → File Types → FLAC → Set to transcode above 48kHz');
      }

      if (issues.length === 0) {
        recommendations.push('No obvious issues found in readable settings.');
        recommendations.push('\n⚠️ IMPORTANT: Transcoding settings location varies by LMS version');
        recommendations.push('Try these paths to find transcoding/File Types settings:');
        recommendations.push('1. Settings → Player → OLADRAplayer → Audio → File Types');
        recommendations.push('2. Settings → Player → OLADRAplayer → Audio (look for transcoding options)');
        recommendations.push('3. Direct URL: http://192.168.0.19:9000/html/settings/index.html?player=00:30:18:0d:62:1b&page=player&tab=audio');
        recommendations.push('4. If "Advanced" menu exists: Settings → Advanced → File Types');
        recommendations.push('\nPlayer Audio Settings (Settings → Player → OLADRAplayer → Audio):');
        recommendations.push('   • Streaming Buffer: Should be "100%"');
        recommendations.push('   • Rebuffer at: Should be "0%"');
        recommendations.push('   • Crossfade: Should be "Off"');
        recommendations.push('   • Replay Gain: Should be "Off"');
        recommendations.push('   • Sample Rate: Should match your DAC (e.g., 192000 for 192kHz)');
        recommendations.push('   • Bit Depth: Should match your DAC (e.g., 24-bit)');
      }

      // If we couldn't read any preferences, provide comprehensive manual instructions
      if (Object.keys(currentSettings).length === 0 || 
          Object.values(currentSettings).every(v => v === 'not available')) {
        issues.push('Could not read player preferences via API (server may need restart)');
        recommendations.push('MANUAL CHECK REQUIRED - Please check LMS web interface:');
        recommendations.push('1. Open: http://192.168.0.19:9000');
        recommendations.push('2. For Transcoding/File Types (try these locations):');
        recommendations.push('   • Settings → Player → OLADRAplayer → Audio → File Types');
        recommendations.push('   • Settings → Player → OLADRAplayer → Audio (look for transcoding options)');
        recommendations.push('   • Direct URL: http://192.168.0.19:9000/html/settings/index.html?player=00:30:18:0d:62:1b&page=player&tab=audio');
        recommendations.push('   • If "Advanced" exists: Settings → Advanced → File Types');
        recommendations.push('   Set FLAC, WAV, and other formats to "Disabled" or "Native"');
        recommendations.push('3. For Player Audio Settings:');
        recommendations.push('   Go to: Settings → Player → OLADRAplayer → Audio');
        recommendations.push('   • Streaming Buffer: 100%');
        recommendations.push('   • Rebuffer at: 0%');
        recommendations.push('   • Crossfade: Off');
        recommendations.push('   • Replay Gain: Off');
        recommendations.push('   • Sample Rate: Match your DAC (e.g., 192000)');
        recommendations.push('   • Bit Depth: Match your DAC (e.g., 24-bit)');
        recommendations.push('4. Network Settings (if Advanced menu exists):');
        recommendations.push('   Settings → Advanced → Network');
        recommendations.push('   • Streaming Buffer Size: 131072 bytes (128KB)');
        recommendations.push('   • HTTP Streaming Buffer: 131072 bytes');
      }

      return { issues, recommendations, currentSettings };
    } catch (error) {
      return {
        issues: [`Failed to diagnose: ${error instanceof Error ? error.message : String(error)}`],
        recommendations: [
          'MANUAL CHECK REQUIRED:',
          '1. Open LMS web interface: http://192.168.0.19:9000',
          '2. For Transcoding (may not be visible in Player settings):',
          '   Go to: Settings → Advanced → File Types',
          '   • Set FLAC, WAV, and other formats to "Disabled" or "Native"',
          '3. For Player Audio Settings:',
          '   Go to: Settings → Player → OLADRAplayer → Audio',
          '   • Streaming Buffer: Should be "100%"',
          '   • Crossfade: Should be "Off"',
          '   • Replay Gain: Should be "Off"',
          '4. Also check: Settings → Advanced → Network',
          '   • Streaming Buffer Size: Should be at least 65536 bytes',
        ],
        currentSettings: {},
      };
    }
  }

  /**
   * Configure LMS player and server settings to prevent audio dropouts
   * Optimized for Squeezelite players and UPnP bridge scenarios
   * This focuses on buffer settings and streaming configuration
   */
  async configureForStablePlayback(playerId: string): Promise<void> {
    debugLog.info('Configuring LMS for stable playback (dropout prevention)', `Player: ${playerId}`);
    
    try {
      // 1. Configure buffer settings (most critical for preventing dropouts)
      await this.configureBufferSettings(playerId);
      
      // 2. Set additional player preferences for stable playback
      const playerPrefs = [
        // Streaming buffer settings (critical for preventing dropouts)
        ['streamBuffer', '100'],           // 100% streaming buffer
        ['rebufferAt', '0'],               // Don't rebuffer unless necessary (0% = only when buffer empty)
        ['streamBufferSize', '131072'],     // 128KB stream buffer (larger = more stable)
        
        // Audio buffer settings (for Squeezelite)
        ['bufferSize', '8192'],            // 8192 frame buffer (larger = more stable)
        ['bufferSizeMax', '16384'],        // Max buffer size
        
        // Disable processing that can cause dropouts or add latency
        ['crossfade', '0'],                 // Disable crossfade (can cause dropouts)
        ['replayGain', '0'],               // Disable replay gain (adds processing overhead)
        ['replayGainMode', 'off'],         // Replay gain mode off
        
        // Gapless playback (enabled, but no crossfade)
        ['gapless', '1'],                  // Enable gapless playback
      ];
      
      for (const [pref, value] of playerPrefs) {
        try {
          await this.setPlayerPreference(playerId, pref, value);
          debugLog.info('Set player preference', `${pref} = ${value}`);
        } catch (e) {
          // Some preferences may not be supported - continue with others
          debugLog.info('Player preference not supported', `${pref} (this is normal for some players)`);
        }
      }
      
      // 3. Set server-wide network buffer settings
      const serverPrefs = [
        ['streamBufferSize', '131072'],     // 128KB server stream buffer
        ['httpStreamingBuffer', '131072'],  // 128KB HTTP streaming buffer
        ['streamingTimeout', '30'],         // 30 second timeout
      ];
      
      for (const [pref, value] of serverPrefs) {
        try {
          await this.setServerPreference(pref, value);
          debugLog.info('Set server preference', `${pref} = ${value}`);
        } catch (e) {
          // Some server preferences may not be available
          debugLog.info('Server preference not supported', `${pref} (this is normal)`);
        }
      }
      
      debugLog.info('Stable playback configuration complete', `Player: ${playerId}`);
    } catch (error) {
      debugLog.error('Failed to configure stable playback', error instanceof Error ? error.message : String(error));
      // Don't throw - some preferences may not be available via API
      // User can configure manually in LMS web UI if needed
    }
  }

  /**
   * Comprehensive configuration for LMS server and player to prevent audio dropouts
   * Configures both server-wide and player-specific settings
   * @deprecated Use configureForStablePlayback instead
   */
  async configureForHighResPlayback(playerId: string): Promise<void> {
    return this.configureForStablePlayback(playerId);
  }

  async playAlbum(playerId: string, albumId: string): Promise<void> {
    // For albums, we can't check individual track formats before loading
    // But we can ensure transcoding is enabled as a fallback
    // LMS will handle format/transcoding automatically based on player capabilities
    await this.request(playerId, ['playlistcontrol', 'cmd:load', `album_id:${albumId}`]);
  }

  async addAlbumToPlaylist(playerId: string, albumId: string): Promise<void> {
    await this.request(playerId, ['playlistcontrol', 'cmd:add', `album_id:${albumId}`]);
  }

  /**
   * Check if a track format needs transcoding based on DAC capabilities
   * Returns true if transcoding should be forced
   * 
   * Note: We only force transcoding for formats that are definitely not supported:
   * - DSD formats (not supported natively by most DACs via UPnP)
   * 
   * For all other formats, we let LMS handle transcoding automatically based on
   * the player's and DAC's reported capabilities. This preserves native audio quality.
   */
  private shouldForceTranscoding(format?: string, sampleRate?: string, bitDepth?: string, playerModel?: string): boolean {
    if (!format) return false;
    
    const f = format.toUpperCase();
    
    // DSD formats often cause white noise if not transcoded
    // Most DACs don't support native DSD via UPnP, so transcode to PCM
    if (f.includes('DSD') || f.includes('DSF')) {
      debugLog.info('Forcing transcoding for DSD format', 
        `Format: ${format}, Player: ${playerModel}`);
      return true;
    }
    
    // For all other formats (FLAC, WAV, MP3, etc.), let LMS handle transcoding automatically
    // based on the player's and DAC's reported capabilities
    // This preserves native audio quality when the format is supported
    return false;
  }

  /**
   * Force transcoding for the current track (useful when experiencing white noise)
   */
  async forceTranscodeCurrentTrack(playerId: string): Promise<void> {
    try {
      await this.setPlayerPreference(playerId, 'transcode', '1');
      debugLog.info('Forced transcoding for current track', `Player: ${playerId}`);
      // Reload current track to apply transcoding
      const status = await this.getPlayerStatus(playerId);
      if (status.currentTrack?.id) {
        await this.request(playerId, ['playlistcontrol', 'cmd:load', `track_id:${status.currentTrack.id}`]);
        await this.play(playerId);
      }
    } catch (error) {
      debugLog.error('Failed to force transcoding', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async playTrack(playerId: string, trackId: string, isQobuz: boolean = false, format?: string, sampleRate?: string, bitDepth?: string, playerModel?: string): Promise<void> {
    // Check if this format needs transcoding (only for unsupported formats like DSD)
    const needsTranscoding = this.shouldForceTranscoding(format, sampleRate, bitDepth, playerModel);
    
    if (needsTranscoding) {
      // Force transcoding only for formats that aren't supported natively
      try {
        await this.setPlayerPreference(playerId, 'transcode', '1');
        debugLog.info('Forcing transcoding for unsupported format', `Format: ${format}, Sample Rate: ${sampleRate}, Bit Depth: ${bitDepth}, Player: ${playerModel}`);
      } catch (error) {
        debugLog.info('Could not force transcoding', error instanceof Error ? error.message : String(error));
      }
    } else {
      // Ensure transcoding is disabled to allow native playback
      // LMS will automatically transcode if the format isn't supported by the player/DAC
      try {
        await this.setPlayerPreference(playerId, 'transcode', '0');
        await this.setPlayerPreference(playerId, 'transcodeFLAC', '0');
        await this.setPlayerPreference(playerId, 'transcodeDSD', '0');
        debugLog.info('Native playback enabled', `Format: ${format || 'unknown'}, Player: ${playerModel}`);
      } catch (error) {
        // Some players may not support these preferences - that's okay
        debugLog.info('Could not set native playback preferences', error instanceof Error ? error.message : String(error));
      }
    }
    
    // Load track - LMS will use native format if supported, or transcode automatically if not
    await this.request(playerId, ['playlistcontrol', 'cmd:load', `track_id:${trackId}`]);
    
    // Reset transcoding preference after a delay for formats that needed it
    if (needsTranscoding) {
      setTimeout(async () => {
        try {
          await this.setPlayerPreference(playerId, 'transcode', '0');
        } catch (error) {
          // Ignore errors when resetting
        }
      }, 2000);
    }
  }

  async playUrl(playerId: string, url: string): Promise<void> {
    // Let LMS handle format/transcoding automatically based on player capabilities
    await this.request(playerId, ['playlistcontrol', 'cmd:load', `url:${url}`]);
  }

  /**
   * Play a radio station URL
   * Radio stations should not use high-res buffer settings as they are streaming
   */
  async playRadioUrl(playerId: string, url: string): Promise<void> {
    // For radio streams, we don't want to disable transcoding or set high-res buffers
    // Clear playlist first, then load the URL
    await this.request(playerId, ['playlist', 'clear']);
    await this.request(playerId, ['playlistcontrol', 'cmd:load', `url:${url}`]);
    debugLog.info('Radio URL loaded', `Player: ${playerId}, URL: ${url.substring(0, 100)}...`);
  }

  /**
   * Play a radio station by favorite ID
   * This is the preferred method for playing LMS favorites
   */
  async playRadioFavorite(playerId: string, favoriteId: string): Promise<void> {
    // Clear playlist first
    await this.request(playerId, ['playlist', 'clear']);
    
    // LMS favorites can be played using the favorites command with item_id
    // This is more reliable than using playlistcontrol with favorite_id
    try {
      // Method 1: Use favorites command (most reliable for LMS favorites)
      // The item_id format should match the favorite ID from getFavoriteRadios()
      await this.request(playerId, ['favorites', 'playlist', 'play', `item_id:${favoriteId}`]);
      debugLog.info('Radio favorite loaded via favorites command', `Player: ${playerId}, Favorite ID: ${favoriteId}`);
    } catch (error) {
      // Fallback: Try playlistcontrol with favorite_id
      debugLog.info('Favorites command failed, trying playlistcontrol', error instanceof Error ? error.message : String(error));
      try {
        await this.request(playerId, ['playlistcontrol', 'cmd:load', `favorite_id:${favoriteId}`]);
        debugLog.info('Radio favorite loaded via playlistcontrol', `Player: ${playerId}, Favorite ID: ${favoriteId}`);
      } catch (error2) {
        // Final fallback: Try using the URL if we have it (but we don't have it here)
        debugLog.error('Both favorite playback methods failed', error2 instanceof Error ? error2.message : String(error2));
        throw new Error(`Failed to play favorite: ${error2 instanceof Error ? error2.message : String(error2)}`);
      }
    }
  }

  async addTrackToPlaylist(playerId: string, trackId: string): Promise<void> {
    await this.request(playerId, ['playlistcontrol', 'cmd:add', `track_id:${trackId}`]);
  }

  async addUrlToPlaylist(playerId: string, url: string): Promise<void> {
    await this.request(playerId, ['playlistcontrol', 'cmd:add', `url:${url}`]);
  }

  async playPlaylistIndex(playerId: string, index: number): Promise<void> {
    await this.request(playerId, ['playlist', 'index', String(index)]);
  }

  async clearPlaylist(playerId: string): Promise<void> {
    await this.request(playerId, ['playlist', 'clear']);
  }

  async removeFromPlaylist(playerId: string, index: number): Promise<void> {
    await this.request(playerId, ['playlist', 'delete', String(index)]);
  }

  async moveInPlaylist(playerId: string, fromIndex: number, toIndex: number): Promise<void> {
    await this.request(playerId, ['playlist', 'move', String(fromIndex), String(toIndex)]);
  }

  async setShuffle(playerId: string, mode: 0 | 1 | 2): Promise<void> {
    await this.request(playerId, ['playlist', 'shuffle', String(mode)]);
  }

  async setRepeat(playerId: string, mode: 0 | 1 | 2): Promise<void> {
    await this.request(playerId, ['playlist', 'repeat', String(mode)]);
  }

  get isServerConfigured(): boolean {
    return this.baseUrl !== '';
  }

  getArtworkUrl(track: LmsTrack | LmsAlbum): string | undefined {
    if ('artwork_url' in track && track.artwork_url) {
      if (track.artwork_url.startsWith('http')) {
        return track.artwork_url;
      } else {
        return `${this.baseUrl}${track.artwork_url}`;
      }
    }

    // For tracks/albums with artwork_track_id, construct direct LMS URL
    if ('artwork_track_id' in track && track.artwork_track_id) {
      return `${this.baseUrl}/music/${track.artwork_track_id}/cover.jpg`;
    }

    return undefined;
  }

  async discoverServer(hostOrUrl: string, port: number = 9000, timeoutMs: number = 3000): Promise<LmsServer | null> {
    // Parse input - support both full URL and host:port format
    let host: string;
    let parsedPort: number;
    let protocol: 'http' | 'https' = 'http';
    let fullUrl: string | undefined;
    
    if (hostOrUrl.startsWith('http://') || hostOrUrl.startsWith('https://')) {
      try {
        const url = new URL(hostOrUrl);
        protocol = url.protocol === 'https:' ? 'https' : 'http';
        host = url.hostname;
        parsedPort = url.port ? parseInt(url.port, 10) : (protocol === 'https' ? 443 : 9000);
        fullUrl = `${protocol}://${url.hostname}${url.port ? `:${url.port}` : ''}`;
      } catch (error) {
        throw new Error(`Invalid LMS server URL: ${hostOrUrl}`);
      }
    } else {
      host = hostOrUrl;
      parsedPort = port;
      fullUrl = undefined;
    }
    
    // On web platform, use server-side proxy to avoid CORS restrictions
    if (Platform.OS === 'web') {
      try {
        // On web platform, prioritize localhost detection over EXPO_PUBLIC_DOMAIN
        let domain: string;
        if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
          domain = `${window.location.hostname}:3000`;
        } else {
          domain = process.env.EXPO_PUBLIC_DOMAIN || 'localhost:3000';
        }
        const apiProtocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
        const apiUrl = `${apiProtocol}//${domain}`;
        
        // First check if proxy server is available
        try {
          const healthCheck = await fetch(`${apiUrl}/api/health`, {
            method: 'GET',
            credentials: 'include',
            signal: AbortSignal.timeout(2000),
          });
          if (!healthCheck.ok) {
            throw new Error('Proxy server health check failed');
          }
        } catch (healthError) {
          throw new Error(`Proxy server not running. Please start it with: npm run server:dev (or use: npm run all:dev:local to start both Metro and the proxy server)`);
        }
        
        const response = await fetch(`${apiUrl}/api/lms/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ 
            url: fullUrl, // Send full URL if provided
            host, 
            port: parsedPort,
            protocol 
          }),
        });
        
        if (response.ok) {
          const server = await response.json() as LmsServer;
          return server;
        } else {
          const error = await response.json().catch(() => ({ error: 'Connection failed' }));
          debugLog.error('Server connection failed', error.error || `HTTP ${response.status}`);
          return null;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        // Provide a more helpful error message when proxy server isn't available
        if (errorMessage.includes('Failed to fetch') || 
            errorMessage.includes('ERR_CONNECTION_REFUSED') ||
            errorMessage.includes('Network request failed') ||
            errorMessage.includes('Proxy server not running')) {
          debugLog.error('Server connection error', errorMessage);
          // Throw a more descriptive error that can be caught by the UI
          throw new Error(errorMessage); // Use the specific error message
        }
        debugLog.error('Server connection error', errorMessage);
        return null;
      }
    }
    
    // On native platforms, use direct connection (supports both HTTP and HTTPS)
    const previousBaseUrl = this.baseUrl;
    // Use full URL if provided, otherwise construct from host:port
    this.baseUrl = fullUrl || `http://${host}:${parsedPort}`;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${this.baseUrl}/jsonrpc.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: this.requestId++,
          method: 'slim.request',
          params: ['', ['serverstatus', '0', '0']],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.result) {
          return {
            id: `lms-${host}:${parsedPort}`,
            name: 'Logitech Media Server',
            host,
            port: parsedPort,
            version: String(data.result.version || 'unknown'),
          };
        }
      }
    } catch {
    } finally {
      this.baseUrl = previousBaseUrl;
    }
    
    return null;
  }

  async getFavoriteRadios(): Promise<LmsRadioStation[]> {
    const result = await this.request('', ['favorites', 'items', '0', '500', 'want_url:1', 'tags:stc']);
    // LMS returns favorites in 'loop_loop' or 'favorites_loop' depending on version
    const favoritesLoop = (result.loop_loop || result.favorites_loop || []) as Array<Record<string, unknown>>;

    return favoritesLoop
      .filter((f) => {
        const url = f.url ? String(f.url) : '';
        const type = f.type ? String(f.type) : '';
        const hasFolder = f.hasitems !== undefined && Number(f.hasitems) > 0;
        if (hasFolder) return false;
        if (type === 'audio') return true;
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          const isStream = url.includes('.mp3') || url.includes('.aac') ||
                          url.includes('.m3u') || url.includes('.pls') ||
                          url.includes('stream') || url.includes('radio') ||
                          url.includes('tunein') || url.includes('icecast') ||
                          !url.match(/\.(flac|wav|aiff|ape|alac|m4a)$/i);
          return isStream;
        }
        return false;
      })
      .map((f) => ({
        id: String(f.id || f.favoriteid || ''),
        name: String(f.name || 'Unknown Station'),
        url: f.url ? String(f.url) : undefined,
        image: f.image ? String(f.image) : undefined,
      }));
  }

  async getRadioStations(): Promise<LmsRadioStation[]> {
    const result = await this.request('', ['radios', '0', '100']);
    // LMS returns radio stations in 'radioss_loop' (note the double 's')
    const radiosLoop = (result.radioss_loop || []) as Array<Record<string, unknown>>;

    return radiosLoop
      .filter((r) => {
        // Filter out folders and only include playable stations
        const hasFolder = r.hasitems !== undefined && Number(r.hasitems) > 0;
        return !hasFolder && r.cmd; // Only include stations with commands
      })
      .map((r) => ({
        id: String(r.cmd || ''),
        name: String(r.name || 'Unknown Station'),
        url: undefined, // Radio directory items don't have direct URLs
        image: r.icon ? String(r.icon) : undefined,
        cmd: String(r.cmd || ''), // Store the command for playing
        type: String(r.type || ''),
      }));
  }

  /**
   * Get Qobuz favorites (tracks, albums, artists)
   */
  async getQobuzFavorites(): Promise<{ tracks: string[]; albums: string[]; artists: string[] }> {
    try {
      const result = await this.request('', ['qobuz', 'favorites', 'items', '0', '1000']);
      const items = (result.item_loop || result.loop_loop || []) as Array<Record<string, unknown>>;
      
      const tracks: string[] = [];
      const albums: string[] = [];
      const artists: string[] = [];
      
      for (const item of items) {
        const type = String(item.type || '');
        const id = String(item.id || '');
        
        if (type === 'audio' || type === 'track') {
          tracks.push(id);
        } else if (type === 'album') {
          albums.push(id);
        } else if (type === 'artist') {
          artists.push(id);
        }
      }
      
      return { tracks, albums, artists };
    } catch (error) {
      debugLog.error('Failed to get Qobuz favorites', error instanceof Error ? error.message : String(error));
      return { tracks: [], albums: [], artists: [] };
    }
  }

  /**
   * Get detailed Qobuz favorite albums (mapped to LmsAlbum)
   * Uses the same 'qobuz favorites items' call but returns album metadata
   * so we can display them alongside local albums.
   */
  async getQobuzFavoriteAlbums(): Promise<LmsAlbum[]> {
    try {
      const result = await this.request("", [
        "qobuz",
        "favorites",
        "items",
        "0",
        "1000",
      ]);
      const items = (result.item_loop ||
        result.loop_loop ||
        []) as Array<Record<string, unknown>>;

      const albums: LmsAlbum[] = [];

      for (const item of items) {
        const type = String(item.type || "");
        if (type !== "album") continue;

        const id = String(item.id || item.album_id || "");
        if (!id) continue;

        const title = String(item.album || item.title || "Unknown Album");
        const artist = String(
          item.artist || item.albumartist || "Unknown Artist",
        );

        let artworkUrl: string | undefined;
        const rawArtwork = item.artwork_url || item.cover || item.image;
        if (rawArtwork) {
          const s = String(rawArtwork);
          artworkUrl = s.startsWith("http") ? s : `${this.baseUrl}${s}`;
        }

        const year = item.year ? Number(item.year) : undefined;
        const trackCount = item.track_count
          ? Number(item.track_count)
          : undefined;

        albums.push({
          id,
          title,
          artist,
          artistId: item.artist_id ? String(item.artist_id) : undefined,
          artwork_url: artworkUrl,
          year,
          trackCount,
        });
      }

      return albums;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Log network failures as info since they're expected when server is unavailable
      if (errorMessage.includes('Network request failed') || 
          errorMessage.includes('Failed to fetch') ||
          errorMessage.includes('ERR_CONNECTION_REFUSED')) {
        debugLog.info(
          "Qobuz favorite albums unavailable",
          "Server may be offline or unreachable",
        );
      } else {
        debugLog.error(
          "Failed to get detailed Qobuz favorite albums",
          errorMessage,
        );
      }
      return [];
    }
  }

  /**
   * Get detailed Qobuz favorite tracks (mapped to LmsTrack)
   * Uses the same 'qobuz favorites items' call but returns track metadata
   * so we can display them alongside local tracks.
   */
  async getQobuzFavoriteTracks(): Promise<LmsTrack[]> {
    try {
      const result = await this.request("", [
        "qobuz",
        "favorites",
        "items",
        "0",
        "1000",
      ]);
      const items = (result.item_loop ||
        result.loop_loop ||
        []) as Array<Record<string, unknown>>;

      const tracks: LmsTrack[] = [];

      for (const item of items) {
        const type = String(item.type || "");
        if (type !== "audio" && type !== "track") continue;

        const id = String(item.id || item.track_id || "");
        if (!id) continue;

        const title = String(item.title || item.track || "Unknown Track");
        const artist = String(
          item.artist || item.albumartist || "Unknown Artist",
        );
        const album = String(item.album || "Unknown Album");

        let artworkUrl: string | undefined;
        const rawArtwork = item.artwork_url || item.cover || item.image;
        if (rawArtwork) {
          const s = String(rawArtwork);
          artworkUrl = s.startsWith("http") ? s : `${this.baseUrl}${s}`;
        }

        const duration = item.duration ? Number(item.duration) : 0;
        const trackNumber = item.tracknum ? Number(item.tracknum) : undefined;
        const albumId = item.album_id ? String(item.album_id) : undefined;
        const artistId = item.artist_id ? String(item.artist_id) : undefined;

        // Parse format and quality info
        let format: string | undefined;
        let bitrate: string | undefined;
        let sampleRate: string | undefined;
        let bitDepth: string | undefined;

        const contentType = String(item.type || item.content_type || "");
        if (contentType.includes("flac") || contentType.includes("flc"))
          format = "FLAC";
        else if (contentType.includes("wav")) format = "WAV";
        else if (contentType.includes("mp3")) format = "MP3";
        else if (contentType.includes("aac") || contentType.includes("m4a"))
          format = "AAC";
        else if (contentType.includes("aiff")) format = "AIFF";
        else if (contentType.includes("dsf") || contentType.includes("dsd"))
          format = "DSD";
        else if (contentType.includes("ogg")) format = "OGG";

        if (item.bitrate) bitrate = String(item.bitrate);
        if (item.samplerate || item.sample_rate) {
          sampleRate = String(item.samplerate || item.sample_rate);
        }
        if (item.samplesize || item.bits_per_sample || item.bitdepth || item.bits) {
          bitDepth = String(
            item.samplesize || item.bits_per_sample || item.bitdepth || item.bits
          );
        }

        tracks.push({
          id,
          title,
          artist,
          album,
          albumId,
          artistId,
          duration,
          trackNumber,
          artwork_url: artworkUrl,
          format,
          bitrate,
          sampleRate,
          bitDepth,
        });
      }

      return tracks;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Log network failures as info since they're expected when server is unavailable
      if (
        errorMessage.includes("Network request failed") ||
        errorMessage.includes("Failed to fetch") ||
        errorMessage.includes("ERR_CONNECTION_REFUSED")
      ) {
        debugLog.info(
          "Qobuz favorite tracks unavailable",
          "Server may be offline or unreachable",
        );
      } else {
        debugLog.error(
          "Failed to get detailed Qobuz favorite tracks",
          errorMessage,
        );
      }
      return [];
    }
  }

  /**
   * Get player ID for Tidal browsing (similar to Qobuz)
   */
  private async getPlayerIdForTidal(): Promise<string | null> {
    try {
      const playersResult = await this.request('', ['players', '0', '1']);
      const playersLoop = (playersResult.players_loop || []) as Array<Record<string, unknown>>;
      return playersLoop.length > 0 ? String(playersLoop[0].playerid || '') : null;
    } catch (e) {
      debugLog.info('Failed to get player ID for Tidal', e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /**
   * Get Tidal favorite albums (mapped to LmsAlbum)
   * Browses Tidal menu to find "My Albums" or "Favorites" and returns album metadata
   */
  async getTidalFavoriteAlbums(): Promise<LmsAlbum[]> {
    try {
      const playerId = await this.getPlayerIdForTidal();
      if (!playerId) {
        debugLog.info('getTidalFavoriteAlbums', 'No player available for Tidal browsing');
        return [];
      }

      // Step 1: Browse Tidal main menu
      const tidalResult = await this.request(playerId, ['tidal', 'items', '0', '100', 'menu:tidal']);
      const tidalItems = (tidalResult.items_loop || tidalResult.item_loop || tidalResult.items || []) as Array<Record<string, unknown>>;
      
      debugLog.info('getTidalFavoriteAlbums', `Tidal menu returned ${tidalItems.length} items`);
      
      // Step 2: Find "My Albums", "Favorites", "Albums", or similar
      // Log all menu items for debugging
      debugLog.info('getTidalFavoriteAlbums', `Tidal menu items: ${tidalItems.map((i: Record<string, unknown>) => String(i.name || i.text || i.title || 'Unknown')).join(', ')}`);
      
      let albumsIndex: number | undefined;
      for (let i = 0; i < tidalItems.length; i++) {
        const item = tidalItems[i];
        const name = String(item.name || item.text || item.title || '').toLowerCase();
        // Try multiple patterns to find albums menu
        if (name.includes('my album') || 
            name.includes('favorite') || 
            name.includes('album') ||
            name === 'albums' ||
            name.includes('saved album')) {
          albumsIndex = i;
          debugLog.info('getTidalFavoriteAlbums', `Found Tidal albums menu "${name}" at index: ${albumsIndex}`);
          break;
        }
      }
      
      // If we couldn't find a specific albums menu, try browsing all items and look for albums
      if (albumsIndex === undefined) {
        debugLog.info('getTidalFavoriteAlbums', 'Could not find Tidal albums menu, trying to browse all items for albums');
        // Try to get albums from the root menu items directly
        const albums: LmsAlbum[] = [];
        for (let i = 0; i < tidalItems.length; i++) {
          const item = tidalItems[i];
          const type = String(item.type || '');
          // Check if this item is an album
          if (type === 'album' || (!type && (item.album || item.title))) {
            const id = String(item.id || item.album_id || item.item_id || '');
            if (!id) continue;
            
            const title = String(item.album || item.title || item.name || 'Unknown Album');
            const artist = String(item.artist || item.albumartist || 'Unknown Artist');
            
            let artworkUrl: string | undefined;
            const rawArtwork = item.artwork_url || item.cover || item.image || item.artwork;
            if (rawArtwork) {
              const s = String(rawArtwork);
              artworkUrl = s.startsWith('http') ? s : `${this.baseUrl}${s}`;
            }
            
            albums.push({
              id: `tidal-${id}`,
              title,
              artist,
              artistId: item.artist_id ? String(item.artist_id) : undefined,
              artwork_url: artworkUrl,
              year: item.year ? Number(item.year) : undefined,
              trackCount: item.track_count || item.tracks ? Number(item.track_count || item.tracks) : undefined,
            });
          }
        }
        
        if (albums.length > 0) {
          debugLog.info('getTidalFavoriteAlbums', `Found ${albums.length} albums directly in menu`);
          return albums;
        }
        
        debugLog.info('getTidalFavoriteAlbums', 'Could not find Tidal albums menu or albums in root menu');
        return [];
      }

      // Step 3: Get albums from the albums menu
      // Try using item_id parameter first
      let albumsResult;
      try {
        albumsResult = await this.request(playerId, ['tidal', 'items', '0', '1000', `item_id:${albumsIndex}`, 'menu:tidal']);
      } catch (e) {
        // If item_id doesn't work, try using the index directly
        debugLog.info('getTidalFavoriteAlbums', `item_id parameter failed, trying index directly: ${e instanceof Error ? e.message : String(e)}`);
        try {
          albumsResult = await this.request(playerId, ['tidal', 'items', String(albumsIndex), '0', '1000', 'menu:tidal']);
        } catch (e2) {
          debugLog.info('getTidalFavoriteAlbums', `Direct index also failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
          // Try without menu parameter
          albumsResult = await this.request(playerId, ['tidal', 'items', String(albumsIndex), '0', '1000']);
        }
      }
      
      const albumItems = (albumsResult.items_loop || albumsResult.item_loop || albumsResult.items || albumsResult.loop_loop || []) as Array<Record<string, unknown>>;
      
      debugLog.info('getTidalFavoriteAlbums', `Tidal albums returned ${albumItems.length} items`);

      const albums: LmsAlbum[] = [];

      // Log first few items structure for debugging
      if (albumItems.length > 0) {
        const sample = albumItems.slice(0, 3).map((item, idx) => ({
          index: idx,
          keys: Object.keys(item),
          type: item.type,
          name: item.name,
          title: item.title,
          album: item.album,
          artist: item.artist,
          albumartist: item.albumartist,
          id: item.id,
          item_id: item.item_id,
        }));
        debugLog.info('getTidalFavoriteAlbums', `Sample items (first 3): ${JSON.stringify(sample, null, 2)}`);
      }

      for (const item of albumItems) {
        const type = String(item.type || '').toLowerCase();
        // Tidal items might have ID in params field (which could be a string or object)
        let itemId = String(item.id || item.item_id || '');
        if (!itemId && item.params) {
          // params might be a string or an object with an item_id field
          if (typeof item.params === 'string') {
            itemId = item.params;
          } else if (typeof item.params === 'object' && item.params !== null) {
            const paramsObj = item.params as Record<string, unknown>;
            itemId = String(paramsObj.item_id || paramsObj.id || '');
          }
        }
        
        // If this is a playlist or menu item, browse into it to find albums
        // Tidal "Albums" menu often contains playlists that need to be browsed
        if (type === 'playlist' || type === 'link' || 
            String(item.name || item.text || '').toLowerCase().includes('playlist') ||
            String(item.name || item.text || '').toLowerCase().includes('mix') ||
            String(item.name || item.text || '').toLowerCase().includes('radio')) {
          // Browse into this item to find albums
          if (itemId) {
            try {
              // Try different ways to browse the item
              let subResult;
              try {
                subResult = await this.request(playerId, ['tidal', 'items', '0', '100', `item_id:${itemId}`, 'menu:tidal']);
              } catch (e) {
                // If item_id doesn't work, try using params directly
                if (item.params) {
                  const paramsObj = typeof item.params === 'object' && item.params !== null 
                    ? item.params as Record<string, unknown>
                    : null;
                  if (paramsObj && paramsObj.item_id) {
                    // Try using the item_id from params
                    subResult = await this.request(playerId, ['tidal', 'items', '0', '100', `item_id:${String(paramsObj.item_id)}`, 'menu:tidal']);
                  } else {
                    throw e;
                  }
                } else {
                  throw e;
                }
              }
              const subItems = (subResult.items_loop || subResult.item_loop || subResult.items || []) as Array<Record<string, unknown>>;
              for (const subItem of subItems) {
                const subType = String(subItem.type || '').toLowerCase();
                // Skip playlists and links in submenu too
                if (subType === 'playlist' || subType === 'link') continue;
                
                const subTitle = String(subItem.album || subItem.title || subItem.name || subItem.text || subItem.display_name || '');
                const subArtist = String(subItem.artist || subItem.albumartist || subItem.album_artist || subItem.artist_name || '');
                
                if (subTitle && subArtist && subTitle !== 'Unknown Album' && subArtist !== 'Unknown Artist') {
                  const subId = String(subItem.id || subItem.album_id || subItem.item_id || '');
                  if (!subId) continue;
                  
                  let subArtworkUrl: string | undefined;
                  const subRawArtwork = subItem.artwork_url || subItem.cover || subItem.image || subItem.artwork || subItem.artwork_url_320 || subItem.artwork_url_640;
                  if (subRawArtwork) {
                    const s = String(subRawArtwork);
                    subArtworkUrl = s.startsWith('http') ? s : `${this.baseUrl}${s}`;
                  }
                  
                  albums.push({
                    id: `tidal-${subId}`,
                    title: subTitle,
                    artist: subArtist,
                    artistId: subItem.artist_id ? String(subItem.artist_id) : undefined,
                    artwork_url: subArtworkUrl,
                    year: subItem.year ? Number(subItem.year) : undefined,
                    trackCount: subItem.track_count || subItem.tracks || subItem.num_tracks ? Number(subItem.track_count || subItem.tracks || subItem.num_tracks) : undefined,
                  });
                }
              }
            } catch (e) {
              // Skip items that can't be browsed
            }
          }
          continue;
        }

        // Try to extract album info from various possible field names
        // Tidal might use different field names, so check multiple possibilities
        const title = String(item.album || item.title || item.name || item.text || item.display_name || '');
        const artist = String(item.artist || item.albumartist || item.album_artist || item.artist_name || '');
        
        // If we have both title and artist, this is likely an album
        if (title && artist && title !== 'Unknown Album' && artist !== 'Unknown Artist') {
          const id = String(item.id || item.album_id || item.item_id || item.track_id || '');
          if (!id) continue;
          
          let artworkUrl: string | undefined;
          const rawArtwork = item.artwork_url || item.cover || item.image || item.artwork || item.artwork_url_320 || item.artwork_url_640;
          if (rawArtwork) {
            const s = String(rawArtwork);
            artworkUrl = s.startsWith('http') ? s : `${this.baseUrl}${s}`;
          }
          
          albums.push({
            id: `tidal-${id}`,
            title,
            artist,
            artistId: item.artist_id ? String(item.artist_id) : undefined,
            artwork_url: artworkUrl,
            year: item.year ? Number(item.year) : undefined,
            trackCount: item.track_count || item.tracks || item.num_tracks ? Number(item.track_count || item.tracks || item.num_tracks) : undefined,
          });
          continue;
        }
        
        // If we don't have title or artist, this might be a submenu - try to browse it
        if (itemId && type !== 'audio' && type !== 'track' && type !== 'song') {
          try {
            const subResult = await this.request(playerId, ['tidal', 'items', '0', '100', `item_id:${itemId}`, 'menu:tidal']);
            const subItems = (subResult.items_loop || subResult.item_loop || subResult.items || []) as Array<Record<string, unknown>>;
            for (const subItem of subItems) {
              const subType = String(subItem.type || '').toLowerCase();
              const subTitle = String(subItem.album || subItem.title || subItem.name || subItem.text || subItem.display_name || '');
              const subArtist = String(subItem.artist || subItem.albumartist || subItem.album_artist || subItem.artist_name || '');
              
              if (subTitle && subArtist && subType !== 'link' && subType !== 'playlist' && 
                  subTitle !== 'Unknown Album' && subArtist !== 'Unknown Artist') {
                const subId = String(subItem.id || subItem.album_id || subItem.item_id || '');
                if (!subId) continue;
                
                let subArtworkUrl: string | undefined;
                const subRawArtwork = subItem.artwork_url || subItem.cover || subItem.image || subItem.artwork || subItem.artwork_url_320 || subItem.artwork_url_640;
                if (subRawArtwork) {
                  const s = String(subRawArtwork);
                  subArtworkUrl = s.startsWith('http') ? s : `${this.baseUrl}${s}`;
                }
                
                albums.push({
                  id: `tidal-${subId}`,
                  title: subTitle,
                  artist: subArtist,
                  artistId: subItem.artist_id ? String(subItem.artist_id) : undefined,
                  artwork_url: subArtworkUrl,
                  year: subItem.year ? Number(subItem.year) : undefined,
                  trackCount: subItem.track_count || subItem.tracks || subItem.num_tracks ? Number(subItem.track_count || subItem.tracks || subItem.num_tracks) : undefined,
                });
              }
            }
          } catch (e) {
            // Skip submenu items that can't be browsed
          }
        }
      }

      debugLog.info('getTidalFavoriteAlbums', `Returning ${albums.length} Tidal albums`);
      return albums;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Network request failed') || 
          errorMessage.includes('Failed to fetch') ||
          errorMessage.includes('ERR_CONNECTION_REFUSED')) {
        debugLog.info('Tidal favorite albums unavailable', 'Server may be offline or unreachable');
      } else {
        debugLog.error('Failed to get Tidal favorite albums', errorMessage);
      }
      return [];
    }
  }

  /**
   * Get Tidal favorite tracks (mapped to LmsTrack)
   * Browses Tidal menu to find tracks/favorites
   */
  async getTidalFavoriteTracks(): Promise<LmsTrack[]> {
    try {
      const playerId = await this.getPlayerIdForTidal();
      if (!playerId) {
        debugLog.info('getTidalFavoriteTracks', 'No player available for Tidal browsing');
        return [];
      }

      // Step 1: Browse Tidal main menu
      const tidalResult = await this.request(playerId, ['tidal', 'items', '0', '100', 'menu:tidal']);
      const tidalItems = (tidalResult.items_loop || tidalResult.item_loop || tidalResult.items || []) as Array<Record<string, unknown>>;
      
      // Step 2: Find "My Tracks", "Favorites", "Tracks", or similar
      // Log all menu items for debugging
      debugLog.info('getTidalFavoriteTracks', `Tidal menu items: ${tidalItems.map((i: Record<string, unknown>) => String(i.name || i.text || i.title || 'Unknown')).join(', ')}`);
      
      let tracksIndex: number | undefined;
      for (let i = 0; i < tidalItems.length; i++) {
        const item = tidalItems[i];
        const name = String(item.name || item.text || item.title || '').toLowerCase();
        // Try multiple patterns to find tracks menu
        if (name.includes('my track') || 
            name.includes('favorite') || 
            name.includes('track') ||
            name === 'tracks' ||
            name.includes('saved track')) {
          tracksIndex = i;
          debugLog.info('getTidalFavoriteTracks', `Found Tidal tracks menu "${name}" at index: ${tracksIndex}`);
          break;
        }
      }
      
      // If we couldn't find a specific tracks menu, try browsing all items and look for tracks
      if (tracksIndex === undefined) {
        debugLog.info('getTidalFavoriteTracks', 'Could not find Tidal tracks menu, trying to browse all items for tracks');
        // Try to get tracks from the root menu items directly
        const tracks: LmsTrack[] = [];
        for (let i = 0; i < tidalItems.length; i++) {
          const item = tidalItems[i];
          const type = String(item.type || '');
          // Check if this item is a track
          if (type === 'audio' || type === 'track' || (!type && (item.title || item.track))) {
            const id = String(item.id || item.track_id || item.item_id || '');
            if (!id) continue;
            
            const title = String(item.title || item.track || item.name || 'Unknown Track');
            const artist = String(item.artist || item.albumartist || 'Unknown Artist');
            const album = String(item.album || 'Unknown Album');
            
            let artworkUrl: string | undefined;
            const rawArtwork = item.artwork_url || item.cover || item.image || item.artwork;
            if (rawArtwork) {
              const s = String(rawArtwork);
              artworkUrl = s.startsWith('http') ? s : `${this.baseUrl}${s}`;
            }
            
            tracks.push({
              id: `tidal-${id}`,
              title,
              artist,
              album,
              albumId: item.album_id ? `tidal-${String(item.album_id)}` : undefined,
              artistId: item.artist_id ? `tidal-${String(item.artist_id)}` : undefined,
              duration: item.duration ? Number(item.duration) : 0,
              trackNumber: item.tracknum ? Number(item.tracknum) : undefined,
              artwork_url: artworkUrl,
              url: item.url ? String(item.url) : undefined,
              format: undefined,
              bitrate: undefined,
              sampleRate: undefined,
              bitDepth: undefined,
            });
          }
        }
        
        if (tracks.length > 0) {
          debugLog.info('getTidalFavoriteTracks', `Found ${tracks.length} tracks directly in menu`);
          return tracks;
        }
        
        debugLog.info('getTidalFavoriteTracks', 'Could not find Tidal tracks menu or tracks in root menu');
        return [];
      }

      // Step 3: Get tracks from the tracks menu
      const tracksResult = await this.request(playerId, ['tidal', 'items', '0', '1000', `item_id:${tracksIndex}`, 'menu:tidal']);
      const trackItems = (tracksResult.items_loop || tracksResult.item_loop || tracksResult.items || []) as Array<Record<string, unknown>>;
      
      debugLog.info('getTidalFavoriteTracks', `Tidal tracks returned ${trackItems.length} items`);

      const tracks: LmsTrack[] = [];

      for (const item of trackItems) {
        const type = String(item.type || '');
        if (type && type !== 'audio' && type !== 'track') continue;

        const id = String(item.id || item.track_id || item.item_id || '');
        if (!id) continue;

        const title = String(item.title || item.track || item.name || 'Unknown Track');
        const artist = String(item.artist || item.albumartist || 'Unknown Artist');
        const album = String(item.album || 'Unknown Album');

        let artworkUrl: string | undefined;
        const rawArtwork = item.artwork_url || item.cover || item.image || item.artwork;
        if (rawArtwork) {
          const s = String(rawArtwork);
          artworkUrl = s.startsWith('http') ? s : `${this.baseUrl}${s}`;
        }

        const duration = item.duration ? Number(item.duration) : 0;
        const trackNumber = item.tracknum ? Number(item.tracknum) : undefined;
        const albumId = item.album_id ? String(item.album_id) : undefined;
        const artistId = item.artist_id ? String(item.artist_id) : undefined;

        // Parse format and quality info
        let format: string | undefined;
        let bitrate: string | undefined;
        let sampleRate: string | undefined;
        let bitDepth: string | undefined;

        const contentType = String(item.type || item.content_type || '');
        if (contentType.includes('flac') || contentType.includes('flc')) format = 'FLAC';
        else if (contentType.includes('wav')) format = 'WAV';
        else if (contentType.includes('mp3')) format = 'MP3';
        else if (contentType.includes('aac') || contentType.includes('m4a')) format = 'AAC';
        else if (contentType.includes('aiff')) format = 'AIFF';
        else if (contentType.includes('dsf') || contentType.includes('dsd')) format = 'DSD';
        else if (contentType.includes('ogg')) format = 'OGG';

        if (item.bitrate) bitrate = String(item.bitrate);
        if (item.samplerate || item.sample_rate) {
          sampleRate = String(item.samplerate || item.sample_rate);
        }
        if (item.samplesize || item.bits_per_sample || item.bitdepth || item.bits) {
          bitDepth = String(item.samplesize || item.bits_per_sample || item.bitdepth || item.bits);
        }

        tracks.push({
          id: `tidal-${id}`,
          title,
          artist,
          album,
          albumId: albumId ? `tidal-${albumId}` : undefined,
          artistId: artistId ? `tidal-${artistId}` : undefined,
          duration,
          trackNumber,
          artwork_url: artworkUrl,
          url: item.url ? String(item.url) : undefined,
          format,
          bitrate,
          sampleRate,
          bitDepth,
        });
      }

      return tracks;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Network request failed') || 
          errorMessage.includes('Failed to fetch') ||
          errorMessage.includes('ERR_CONNECTION_REFUSED')) {
        debugLog.info('Tidal favorite tracks unavailable', 'Server may be offline or unreachable');
      } else {
        debugLog.error('Failed to get Tidal favorite tracks', errorMessage);
      }
      return [];
    }
  }

  /**
   * Check if a track is favorited in Qobuz
   */
  async isQobuzTrackFavorite(trackId: string): Promise<boolean> {
    try {
      const favorites = await this.getQobuzFavorites();
      return favorites.tracks.includes(trackId);
    } catch (error) {
      debugLog.error('Failed to check Qobuz track favorite', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Check if an album is favorited in Qobuz
   */
  async isQobuzAlbumFavorite(albumId: string): Promise<boolean> {
    try {
      const favorites = await this.getQobuzFavorites();
      return favorites.albums.includes(albumId);
    } catch (error) {
      debugLog.error('Failed to check Qobuz album favorite', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Check if an artist is favorited in Qobuz
   */
  async isQobuzArtistFavorite(artistId: string): Promise<boolean> {
    try {
      const favorites = await this.getQobuzFavorites();
      return favorites.artists.includes(artistId);
    } catch (error) {
      debugLog.error('Failed to check Qobuz artist favorite', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Add a track to Qobuz favorites
   */
  async addQobuzTrackFavorite(trackId: string): Promise<void> {
    try {
      await this.request('', ['qobuz', 'favorites', 'add', `track_id:${trackId}`]);
      debugLog.info('Added track to Qobuz favorites', trackId);
    } catch (error) {
      debugLog.error('Failed to add Qobuz track favorite', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Add an album to Qobuz favorites
   */
  async addQobuzAlbumFavorite(albumId: string): Promise<void> {
    try {
      await this.request('', ['qobuz', 'favorites', 'add', `album_id:${albumId}`]);
      debugLog.info('Added album to Qobuz favorites', albumId);
    } catch (error) {
      debugLog.error('Failed to add Qobuz album favorite', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Add an artist to Qobuz favorites
   */
  async addQobuzArtistFavorite(artistId: string): Promise<void> {
    try {
      await this.request('', ['qobuz', 'favorites', 'add', `artist_id:${artistId}`]);
      debugLog.info('Added artist to Qobuz favorites', artistId);
    } catch (error) {
      debugLog.error('Failed to add Qobuz artist favorite', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Remove a track from Qobuz favorites
   */
  async removeQobuzTrackFavorite(trackId: string): Promise<void> {
    try {
      await this.request('', ['qobuz', 'favorites', 'remove', `track_id:${trackId}`]);
      debugLog.info('Removed track from Qobuz favorites', trackId);
    } catch (error) {
      debugLog.error('Failed to remove Qobuz track favorite', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Remove an album from Qobuz favorites
   */
  async removeQobuzAlbumFavorite(albumId: string): Promise<void> {
    try {
      await this.request('', ['qobuz', 'favorites', 'remove', `album_id:${albumId}`]);
      debugLog.info('Removed album from Qobuz favorites', albumId);
    } catch (error) {
      debugLog.error('Failed to remove Qobuz album favorite', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Remove an artist from Qobuz favorites
   */
  async removeQobuzArtistFavorite(artistId: string): Promise<void> {
    try {
      await this.request('', ['qobuz', 'favorites', 'remove', `artist_id:${artistId}`]);
      debugLog.info('Removed artist from Qobuz favorites', artistId);
    } catch (error) {
      debugLog.error('Failed to remove Qobuz artist favorite', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async getLibraryTotals(includeQobuz: boolean = false, includeTidal: boolean = false): Promise<{ albums: number; artists: number; tracks: number; radioStations: number; playlists: number }> {
    try {
      console.log("getLibraryTotals called");
      // Get local library counts from serverstatus command
      let localAlbums = 0;
      let localArtists = 0;
      let localTracks = 0;
      try {
        const statusResult = await this.request('', ['serverstatus', '0', '1']);
        localAlbums = Number(statusResult['info total albums'] || 0);
        localArtists = Number(statusResult['info total artists'] || 0);
        localTracks = Number(statusResult['info total songs'] || 0);
        console.log("LMS status result:", {
          albums: localAlbums,
          artists: localArtists,
          tracks: localTracks
        });
      } catch (e) {
        debugLog.info('Failed to get LMS server status', e instanceof Error ? e.message : String(e));
      }
      
    // Count Qobuz favorite albums and tracks if available (fetch once, use for both counts)
    let qobuzAlbums = 0;
    let qobuzTracks = 0;
    let qobuzFavAlbums: LmsAlbum[] = [];
    try {
      qobuzFavAlbums = await this.getQobuzFavoriteAlbums();
      qobuzAlbums = qobuzFavAlbums.length;
    } catch (e) {
      debugLog.info('Qobuz albums not available for counting', e instanceof Error ? e.message : String(e));
    }
    
    try {
      const qobuzFavTracks = await this.getQobuzFavoriteTracks();
      qobuzTracks = qobuzFavTracks.length;
    } catch (e) {
      debugLog.info('Qobuz tracks not available for counting', e instanceof Error ? e.message : String(e));
    }
    
    // Count Tidal albums and tracks from Tidal API if available
    let tidalAlbums = 0;
    let tidalTracks = 0;
    if (includeTidal) {
      try {
        // Fetch Tidal albums count from API
        const tidalAlbumsResponse = await fetch(`${getApiUrl()}/api/tidal/albums?limit=1&offset=0`);
        if (tidalAlbumsResponse.ok) {
          const tidalAlbumsResult = await tidalAlbumsResponse.json();
          tidalAlbums = tidalAlbumsResult.total || 0;
        }
      } catch (e) {
        debugLog.info('Tidal albums count not available', e instanceof Error ? e.message : String(e));
      }

      try {
        // For tracks, we'd need to implement a tracks endpoint or estimate
        // For now, estimate based on albums (rough approximation)
        tidalTracks = tidalAlbums * 10; // Rough estimate of 10 tracks per album
      } catch (e) {
        debugLog.info('Tidal tracks count not available', e instanceof Error ? e.message : String(e));
      }
    }
    
    try {
      // Fetch tracks in batches to count Tidal tracks
      const batchSize = 10000;
      let offset = 0;
      let hasMore = true;
      
      while (hasMore) {
        const tracksBatch = await this.request('', ['tracks', offset.toString(), batchSize.toString(), 'tags:al']);
        const tracksLoop = (tracksBatch.tracks_loop || []) as Array<Record<string, unknown>>;
        
        if (tracksLoop.length === 0) {
          hasMore = false;
          break;
        }
        
        for (const track of tracksLoop) {
          const url = String(track.url || '').toLowerCase();
          const id = String(track.id || '').toLowerCase();
          if (url.includes('tidal') || id.includes('tidal')) {
            tidalTracks++;
          }
        }
        
        if (tracksLoop.length < batchSize) {
          hasMore = false;
        } else {
          offset += batchSize;
        }
      }
    } catch (e) {
      debugLog.info('Tidal tracks not available for counting', e instanceof Error ? e.message : String(e));
    }
      
      // Count unique artists from albums (including Qobuz and Tidal albums)
      const uniqueArtists = new Set<string>();
      
      // Count artists from all albums (local + Tidal) in batches
      try {
        const batchSize = 10000;
        let offset = 0;
        let hasMore = true;
        
        while (hasMore) {
          const albumsBatch = await this.request('', ['albums', offset.toString(), batchSize.toString(), 'tags:al']);
          const albumsLoop = (albumsBatch.albums_loop || []) as Array<Record<string, unknown>>;
          
          if (albumsLoop.length === 0) {
            hasMore = false;
            break;
          }
          
          for (const album of albumsLoop) {
            const artistName = String(album.artist || album.albumartist || '').trim();
            // Only count valid artists (non-empty name, not dashes)
            if (artistName && artistName !== '-' && artistName !== '') {
              uniqueArtists.add(artistName);
            }
          }
          
          if (albumsLoop.length < batchSize) {
            hasMore = false;
          } else {
            offset += batchSize;
          }
        }
      } catch (e) {
        debugLog.info('Failed to get albums for artist counting', e instanceof Error ? e.message : String(e));
      }
      
      // Also count artists from Qobuz albums (use already fetched data)
      for (const album of qobuzFavAlbums) {
        const artistName = String(album.artist || '').trim();
        if (artistName && artistName !== '-' && artistName !== '') {
          uniqueArtists.add(artistName);
        }
      }
      
      const artistCount = uniqueArtists.size;
      
      // Count favorite radio stations
      let radioCount = 0;
      try {
        const radios = await this.getFavoriteRadios();
        radioCount = radios.length;
      } catch (e) {
        debugLog.info('Failed to count radio stations', e instanceof Error ? e.message : String(e));
      }
      
      // Count playlists (includes both LMS and Qobuz/SoundCloud/Tidal playlists)
      let playlistCount = 0;
      try {
        const playlists = await this.getPlaylists(includeQobuz, false, false, includeTidal); // SoundCloud and Spotify not supported yet
        playlistCount = playlists.length;
      } catch (e) {
        debugLog.info('Failed to count playlists', e instanceof Error ? e.message : String(e));
      }
      
      const result = {
        albums: localAlbums + (includeQobuz ? qobuzAlbums : 0) + (includeTidal ? tidalAlbums : 0),
        artists: localArtists, // Use the actual artist count from LMS
        tracks: localTracks + (includeQobuz ? qobuzTracks : 0) + (includeTidal ? tidalTracks : 0),
        radioStations: radioCount,
        playlists: playlistCount,
      };
      console.log("getLibraryTotals returning:", result);
      return result;
    } catch (e) {
      console.error('getLibraryTotals failed:', e instanceof Error ? e.message : String(e));
      debugLog.error('Failed to get library totals', e instanceof Error ? e.message : String(e));
      // Return zeros if everything fails
      return {
        albums: 0,
        artists: 0,
        tracks: 0,
        radioStations: 0,
        playlists: 0,
      };
    }
  }

  async autoDiscoverServers(onProgress?: (found: number, scanning: number) => void): Promise<LmsServer[]> {
    debugLog.info('Starting auto-discovery of LMS servers...');
    
    // On web platform, use server-side discovery endpoint to avoid CORS/security restrictions
    if (Platform.OS === 'web') {
      try {
        // On web platform, prioritize localhost detection over EXPO_PUBLIC_DOMAIN
        // EXPO_PUBLIC_DOMAIN is primarily for native apps
        let domain: string;
        if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
          domain = `${window.location.hostname}:3000`;
        } else {
          domain = process.env.EXPO_PUBLIC_DOMAIN || 'localhost:3000';
        }
        const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
        const apiUrl = `${protocol}//${domain}`;

        console.log('[LMS Client] Web platform detected, window.location:', typeof window !== 'undefined' ? window.location.hostname + ':' + window.location.port + ' protocol:' + window.location.protocol : 'N/A');
        console.log('[LMS Client] EXPO_PUBLIC_DOMAIN:', process.env.EXPO_PUBLIC_DOMAIN);
        console.log('[LMS Client] Using API URL:', apiUrl);

        // First check if proxy server is available
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          console.log('[LMS Client] Checking proxy server health at:', `${apiUrl}/api/health`);
          const healthCheck = await fetch(`${apiUrl}/api/health`, {
            method: 'GET',
            credentials: 'include',
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (!healthCheck.ok) {
            throw new Error('Proxy server health check failed');
          }
        } catch (healthError) {
          const errorMessage = healthError instanceof Error ? healthError.message : String(healthError);
          // Check if it's a timeout or connection error
          if (errorMessage.includes('aborted') || 
              errorMessage.includes('Failed to fetch') || 
              errorMessage.includes('ERR_CONNECTION_REFUSED') ||
              errorMessage.includes('Network request failed')) {
            throw new Error(`Proxy server not running. Please start it with: npm run server:dev (or use: npm run all:dev:local to start both Metro and the proxy server)`);
          }
          throw healthError;
        }
        
        const response = await fetch(`${apiUrl}/api/servers/discover`, {
          method: 'GET',
          credentials: 'include',
        });
        
        if (!response.ok) {
          throw new Error(`Discovery failed: ${response.status}`);
        }
        
        const data = await response.json() as { servers: LmsServer[] };
        const servers = data.servers || [];
        // Filter to only return LMS servers
        const lmsServers = servers.filter(s => !s.type || s.type === 'lms');
        debugLog.info('Auto-discovery complete', `Found ${lmsServers.length} LMS server(s) via API (filtered from ${servers.length} total)`);
        return lmsServers;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        // Provide a more helpful error message when proxy server isn't available
        if (errorMessage.includes('Failed to fetch') || 
            errorMessage.includes('ERR_CONNECTION_REFUSED') ||
            errorMessage.includes('Network request failed') ||
            errorMessage.includes('Proxy server not running')) {
          throw new Error(errorMessage); // Use the more specific error if we detected it
        }
        debugLog.error('Server-side discovery failed', errorMessage);
        throw error;
      }
    }
    
    // On native platforms, use direct network scanning
    const port = 9000;
    const timeoutMs = 2000;
    const previousBaseUrl = this.baseUrl;
    const found: LmsServer[] = [];
    
    // Scan common local IP ranges: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
    const ipRanges = [
      { start: [192, 168, 0], end: [192, 168, 255] },
      { start: [10, 0, 0], end: [10, 255, 255] },
      { start: [172, 16, 0], end: [172, 31, 255] },
    ];
    
    const promises: Promise<void>[] = [];
    let scanned = 0;
    let totalToScan = 0;

    for (const range of ipRanges) {
      for (let i = range.start[2]; i <= Math.min(range.end[2], range.start[2] + 30); i++) {
        totalToScan++;
        const ip = `${range.start[0]}.${range.start[1]}.${i}`;
        
        promises.push(
          (async () => {
            try {
              const server = await this.discoverServer(ip, port, timeoutMs);
              if (server) {
                found.push(server);
                debugLog.response('LMS Found', `${server.host}:${server.port}`);
              }
            } catch {
              // Ignore errors
            } finally {
              scanned++;
              onProgress?.(found.length, scanned);
            }
          })()
        );
      }
    }
    
    await Promise.all(promises);
    this.baseUrl = previousBaseUrl;
    debugLog.info('Auto-discovery complete', `Found ${found.length} server(s)`);
    
    return found;
  }
}

export const lmsClient = new LmsClient();
export default lmsClient;
