import { Platform } from 'react-native';
import { debugLog } from './debugLog';
import { getApiUrl } from './query-client';

export interface LmsServer {
  id: string;
  name: string;
  host: string;
  port: number;
  version?: string;
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
  private requestId: number = 1;

  setServer(host: string, port: number = 9000): void {
    this.serverHost = host;
    this.serverPort = port;
    this.baseUrl = `http://${host}:${port}`;
    debugLog.info('LMS server set', `${this.baseUrl}`);
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

    // On web platform, use server-side proxy to avoid CORS restrictions
    if (Platform.OS === 'web') {
      try {
        // Ensure we have server host/port - extract from baseUrl if needed
        let host = this.serverHost;
        let port = this.serverPort;
        
        if (!host && this.baseUrl) {
          // Extract host and port from baseUrl (format: http://host:port)
          const urlMatch = this.baseUrl.match(/^https?:\/\/([^:]+)(?::(\d+))?/);
          if (urlMatch) {
            host = urlMatch[1];
            port = urlMatch[2] ? parseInt(urlMatch[2], 10) : 9000;
          }
        }
        
        if (!host) {
          throw new Error('LMS server not configured - no host available');
        }
        
        let domain = process.env.EXPO_PUBLIC_DOMAIN;
        if (!domain) {
          if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
            domain = 'localhost:3000';
          } else {
            domain = 'localhost:3000';
          }
        }
        const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
        const apiUrl = `${protocol}//${domain}`;
        
        const response = await fetch(`${apiUrl}/api/lms/proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            host,
            port,
            playerId,
            command,
            id: requestBody.id,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data: LmsJsonRpcResponse = await response.json();
        
        if (data.error) {
          throw new Error(data.error);
        }

        debugLog.response('LMS', 'OK');
        return data.result || {};
      } catch (error) {
        debugLog.error('LMS request failed', error instanceof Error ? error.message : String(error));
        throw error;
      }
    }

    // On native platforms, use direct connection
    try {
      const response = await fetch(`${this.baseUrl}/jsonrpc.js`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

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
      debugLog.error('LMS request failed', error instanceof Error ? error.message : String(error));
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
    const result = await this.request(playerId, ['status', '0', '100', 'tags:acdlKNuT']);
    
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
    const durationSec = Number(data.duration || 0);
    
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

    if (data.samplesize) {
      bitDepth = `${data.samplesize}-bit`;
    }

    let artworkUrl: string | undefined;
    if (data.artwork_url) {
      const rawUrl = String(data.artwork_url);
      artworkUrl = rawUrl.startsWith('http') ? rawUrl : `${this.baseUrl}${rawUrl}`;
    } else if (data.artwork_track_id) {
      artworkUrl = `${this.baseUrl}/music/${data.artwork_track_id}/cover.jpg`;
    } else if (data.coverid) {
      artworkUrl = `${this.baseUrl}/music/${data.coverid}/cover.jpg`;
    }

    return {
      id: String(data.id || data.track_id || `${playlistIndex}`),
      title: String(data.title || 'Unknown'),
      artist: String(data.artist || data.trackartist || 'Unknown Artist'),
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
    const command = artistId 
      ? ['albums', String(start), String(limit), `artist_id:${artistId}`, 'tags:aajlyST']
      : ['albums', String(start), String(limit), 'tags:aajlyST'];
    
    const result = await this.request('', command);
    const albumsLoop = (result.albums_loop || []) as Array<Record<string, unknown>>;
    const total = Number(result.count) || 0;
    
    const albums = albumsLoop.map((a) => ({
      id: String(a.id || ''),
      title: String(a.album || a.title || ''),
      artist: String(a.artist || ''),
      artistId: a.artist_id ? String(a.artist_id) : undefined,
      artwork_url: a.artwork_track_id ? `${this.baseUrl}/music/${a.artwork_track_id}/cover.jpg` : 
        (a.artwork_url ? (String(a.artwork_url).startsWith('http') ? String(a.artwork_url) : `${this.baseUrl}${a.artwork_url}`) : undefined),
      year: a.year ? Number(a.year) : undefined,
      trackCount: a.track_count ? Number(a.track_count) : undefined,
    }));
    
    return { albums, total };
  }

  async getAlbums(artistId?: string): Promise<LmsAlbum[]> {
    const command = artistId 
      ? ['albums', '0', '100', `artist_id:${artistId}`, 'tags:aajlyST']
      : ['albums', '0', '100', 'tags:aajlyST'];
    
    const result = await this.request('', command);
    const albumsLoop = (result.albums_loop || []) as Array<Record<string, unknown>>;
    
    return albumsLoop.map((a) => ({
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
    
    // Filter to only albums that match the exact artist name
    return albumsLoop
      .filter((a) => {
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

  async getArtistsPage(start: number = 0, limit: number = 50): Promise<{ artists: LmsArtist[], total: number }> {
    try {
      // Get artists from albums in local library (not Qobuz) to ensure we only show artists with actual content
      // Fetch enough albums to get unique artists for pagination
      const albumsToFetch = Math.max((start + limit) * 5, 1000); // Fetch enough to cover pagination
      const result = await this.request('', ['albums', '0', String(albumsToFetch), 'tags:al']);
      const albumsLoop = (result.albums_loop || []) as Array<Record<string, unknown>>;
      
      // Build a map of unique artists with their album counts
      // Use artist name as key since albums don't have artist_id
      const artistMap = new Map<string, { id: string; name: string; albumCount: number }>();
      
      for (const album of albumsLoop) {
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
        // Filter out artists with 0 albums (these are Qobuz-only artists)
        if (albumCount === 0) {
          return null;
        }
        return {
          id: String(a.id || ''),
          name: artistName,
          albumCount,
        } as LmsArtist;
      })
      .filter((a): a is LmsArtist => a !== null);
  }

  async getPlaylists(): Promise<LmsPlaylist[]> {
    const result = await this.request('', ['playlists', '0', '10000', 'tags:u']);
    const playlistsLoop = (result.playlists_loop || []) as Array<Record<string, unknown>>;
    
    return playlistsLoop.map((p) => ({
      id: String(p.id || ''),
      name: String(p.playlist || 'Unknown Playlist'),
      url: p.url ? String(p.url) : undefined,
      trackCount: p.tracks ? Number(p.tracks) : undefined,
    }));
  }

  async getPlaylistTracks(playlistId: string): Promise<LmsTrack[]> {
    const result = await this.request('', ['playlists', 'tracks', '0', '500', `playlist_id:${playlistId}`, 'tags:acdlKNuT']);
    const playlistTracksLoop = (result.playlisttracks_loop || []) as Array<Record<string, unknown>>;
    
    return playlistTracksLoop.map((t, i) => this.parseTrack(t, i));
  }

  async playPlaylist(playerId: string, playlistId: string): Promise<void> {
    // Let LMS handle format/transcoding automatically based on player capabilities
    await this.request(playerId, ['playlistcontrol', 'cmd:load', `playlist_id:${playlistId}`]);
  }

  async getAlbumTracks(albumId: string): Promise<LmsTrack[]> {
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

      const [artistsResult, albumsResult, tracksResult] = await Promise.all([
        this.request('', ['qobuz', 'items', '0', '50', `search:${query}`, 'type:artists', 'want_url:1']).catch(() => ({})),
        this.request('', ['qobuz', 'items', '0', '50', `search:${query}`, 'type:albums', 'want_url:1']).catch(() => ({})),
        this.request('', ['qobuz', 'items', '0', '50', `search:${query}`, 'type:tracks', 'want_url:1']).catch(() => ({})),
      ]);

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
          tracks.push({
            id: String(item.id || item.url || `qobuz_track_${title}`),
            title: title,
            artist: String(item.artist || 'Unknown Artist'),
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

      if (artists.length === 0 && albums.length === 0 && tracks.length === 0) {
        const fallbackResult = await this.request('', [
          'qobuz', 'items', '0', '100',
          `search:${query}`,
          'want_url:1'
        ]);

        const items = (fallbackResult.item_loop || []) as Array<Record<string, unknown>>;
        for (const item of items) {
          const type = String(item.type || '');
          const name = String(item.name || item.text || '');
          const id = String(item.id || item.url || `qobuz_${Date.now()}_${Math.random()}`);

          if (type === 'artist' || item.artist_id) {
            artists.push({
              id: String(item.artist_id || id),
              name: String(item.artist || name),
            });
          } else if (type === 'album' || item.album_id) {
            const artworkUrl = item.image ? String(item.image) : 
              (item.artwork_url ? this.normalizeArtworkUrl(String(item.artwork_url)) : undefined);
            albums.push({
              id: String(item.album_id || id),
              title: String(item.album || item.title || name),
              artist: String(item.artist || item.albumartist || 'Unknown Artist'),
              artwork_url: artworkUrl,
              year: item.year ? Number(item.year) : undefined,
            });
          } else if (type === 'audio' || item.url || item.duration) {
            const artworkUrl = item.image ? String(item.image) : 
              (item.artwork_url ? this.normalizeArtworkUrl(String(item.artwork_url)) : undefined);
            tracks.push({
              id: id,
              title: String(item.title || item.name || name),
              artist: String(item.artist || 'Unknown Artist'),
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

      debugLog.info('Qobuz search results', `${artists.length} artists, ${albums.length} albums, ${tracks.length} tracks`);
      return { artists, albums, tracks };
    } catch (error) {
      debugLog.error('Qobuz search failed', error instanceof Error ? error.message : String(error));
      return { artists: [], albums: [], tracks: [] };
    }
  }

  async globalSearch(query: string): Promise<{ artists: LmsArtist[]; albums: LmsAlbum[]; tracks: LmsTrack[] }> {
    if (!this.baseUrl) {
      throw new Error('LMS server not configured');
    }
    
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

      debugLog.info('Global search results', `${artists.length} artists, ${albums.length} albums, ${tracks.length} tracks`);
      return { artists, albums, tracks };
    } catch (error) {
      debugLog.error('Global search failed', error instanceof Error ? error.message : String(error));
      // Fallback to separate searches if globalsearch is not available
      const [localResult, qobuzResult] = await Promise.all([
        this.search(query).catch(() => ({ artists: [], albums: [], tracks: [] })),
        this.searchQobuz(query).catch(() => ({ artists: [], albums: [], tracks: [] })),
      ]);
      
      return {
        artists: [...localResult.artists, ...qobuzResult.artists],
        albums: [...localResult.albums, ...qobuzResult.albums],
        tracks: [...localResult.tracks, ...qobuzResult.tracks],
      };
    }
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
    await this.request(playerId, ['pause']);
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
   * For other formats (FLAC, WAV, etc.), we let LMS handle transcoding automatically
   * based on the player's reported capabilities. The UPnP bridge should handle
   * format negotiation with the DAC.
   */
  private shouldForceTranscoding(format?: string, sampleRate?: string, bitDepth?: string, playerModel?: string): boolean {
    if (!format) return false;
    
    const f = format.toUpperCase();
    
    // DSD formats often cause white noise if not transcoded
    // Most DACs don't support native DSD via UPnP, so transcode to PCM
    if (f.includes('DSD') || f.includes('DSF')) {
      return true;
    }
    
    // For all other formats (FLAC, WAV, AIFF, etc.), let LMS and UPnP bridge
    // handle format negotiation automatically based on DAC capabilities
    // The UPnP bridge will transcode if needed based on the DAC's reported support
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
    // Check if this format might cause white noise
    // Pass player model to detect UPnP bridge usage
    const needsTranscoding = this.shouldForceTranscoding(format, sampleRate, bitDepth, playerModel);
    
    if (needsTranscoding) {
      // Force transcoding for problematic formats
      try {
        await this.setPlayerPreference(playerId, 'transcode', '1');
        debugLog.info('Forcing transcoding for track', `Format: ${format}, Sample Rate: ${sampleRate}, Bit Depth: ${bitDepth}`);
      } catch (error) {
        debugLog.info('Could not force transcoding', error instanceof Error ? error.message : String(error));
      }
    }
    
    // Load track - LMS will transcode if needed
    await this.request(playerId, ['playlistcontrol', 'cmd:load', `track_id:${trackId}`]);
    
    // Reset transcoding preference after a delay (let LMS handle it automatically for next track)
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

  getArtworkUrl(track: LmsTrack | LmsAlbum): string | undefined {
    if ('artwork_url' in track && track.artwork_url) {
      if (track.artwork_url.startsWith('http')) {
        return track.artwork_url;
      }
      return `${this.baseUrl}${track.artwork_url}`;
    }
    return undefined;
  }

  async discoverServer(host: string, port: number = 9000, timeoutMs: number = 3000): Promise<LmsServer | null> {
    // On web platform, use server-side proxy to avoid CORS restrictions
    if (Platform.OS === 'web') {
      try {
        let domain = process.env.EXPO_PUBLIC_DOMAIN;
        if (!domain) {
          if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
            domain = 'localhost:3000';
          } else {
            domain = 'localhost:3000';
          }
        }
        const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
        const apiUrl = `${protocol}//${domain}`;
        
        const response = await fetch(`${apiUrl}/api/lms/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ host, port }),
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
        debugLog.error('Server connection error', error instanceof Error ? error.message : 'Unknown error');
        return null;
      }
    }
    
    // On native platforms, use direct connection
    const previousBaseUrl = this.baseUrl;
    this.baseUrl = `http://${host}:${port}`;
    
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
            id: `lms-${host}:${port}`,
            name: 'Logitech Media Server',
            host,
            port,
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

  async getLibraryTotals(): Promise<{ albums: number; artists: number; tracks: number; radioStations: number; playlists: number }> {
    const albumsResult = await this.request('', ['info', 'total', 'albums', '?']);
    const songsResult = await this.request('', ['info', 'total', 'songs', '?']);
    
    // Count unique artists from albums (not from artists command which includes Qobuz)
    // Fetch a large sample of albums to count unique artists
    // Use artist name to count unique artists (albums don't have artist_id)
    const albumsSample = await this.request('', ['albums', '0', '5000', 'tags:al']);
    const albumsLoop = (albumsSample.albums_loop || []) as Array<Record<string, unknown>>;
    const uniqueArtists = new Set<string>();
    
    for (const album of albumsLoop) {
      const artistName = String(album.artist || album.albumartist || '').trim();
      // Only count valid artists (non-empty name, not dashes)
      if (artistName && artistName !== '-' && artistName !== '') {
        uniqueArtists.add(artistName);
      }
    }
    
    // If we got a full sample (5000 albums), we likely have most artists
    // Otherwise, this is a lower bound estimate
    const artistCount = uniqueArtists.size;
    
    // Count favorite radio stations
    let radioCount = 0;
    try {
      const radios = await this.getFavoriteRadios();
      radioCount = radios.length;
    } catch (e) {
      debugLog.error('Failed to count radio stations', e instanceof Error ? e.message : String(e));
    }
    
    // Count playlists (includes both LMS and Qobuz playlists)
    let playlistCount = 0;
    try {
      const playlists = await this.getPlaylists();
      playlistCount = playlists.length;
    } catch (e) {
      debugLog.error('Failed to count playlists', e instanceof Error ? e.message : String(e));
    }
    
    return {
      albums: Number(albumsResult._albums || 0),
      artists: artistCount,
      tracks: Number(songsResult._songs || 0),
      radioStations: radioCount,
      playlists: playlistCount,
    };
  }

  async autoDiscoverServers(onProgress?: (found: number, scanning: number) => void): Promise<LmsServer[]> {
    debugLog.info('Starting auto-discovery of LMS servers...');
    
    // On web platform, use server-side discovery endpoint to avoid CORS/security restrictions
    if (Platform.OS === 'web') {
      try {
        // Use the same URL construction as SettingsScreen for web
        // Try to detect the server port from the current location or use default
        let domain = process.env.EXPO_PUBLIC_DOMAIN;
        if (!domain) {
          // If running locally, try to use the same host with port 3000 (or detect from window.location)
          if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
            domain = 'localhost:3000';
          } else {
            domain = 'localhost:3000';
          }
        }
        const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
        const apiUrl = `${protocol}//${domain}`;
        
        const response = await fetch(`${apiUrl}/api/lms/discover`, {
          method: 'GET',
          credentials: 'include',
        });
        
        if (!response.ok) {
          throw new Error(`Discovery failed: ${response.status}`);
        }
        
        const servers = await response.json() as LmsServer[];
        debugLog.info('Auto-discovery complete', `Found ${servers.length} server(s) via API`);
        return servers;
      } catch (error) {
        debugLog.error('Server-side discovery failed', error instanceof Error ? error.message : 'Unknown error');
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
