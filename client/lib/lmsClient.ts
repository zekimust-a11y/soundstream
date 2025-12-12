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
}

export interface LmsPlaylist {
  id: string;
  name: string;
  url?: string;
  trackCount?: number;
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
  private requestId: number = 1;

  setServer(host: string, port: number = 9000): void {
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

    return {
      id: String(data.id || data.track_id || `${playlistIndex}`),
      title: String(data.title || 'Unknown'),
      artist: String(data.artist || data.trackartist || 'Unknown Artist'),
      album: String(data.album || 'Unknown Album'),
      albumId: data.album_id ? String(data.album_id) : undefined,
      artistId: data.artist_id ? String(data.artist_id) : undefined,
      duration: durationSec,
      trackNumber: data.tracknum ? Number(data.tracknum) : undefined,
      artwork_url: data.artwork_url ? String(data.artwork_url) : undefined,
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
      artwork_url: a.artwork_track_id ? `/music/${a.artwork_track_id}/cover.jpg` : undefined,
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

  async getArtistsPage(start: number = 0, limit: number = 50): Promise<{ artists: LmsArtist[], total: number }> {
    const result = await this.request('', ['artists', String(start), String(limit), 'tags:s']);
    const artistsLoop = (result.artists_loop || []) as Array<Record<string, unknown>>;
    const total = Number(result.count) || 0;
    
    const artists = artistsLoop.map((a) => ({
      id: String(a.id || ''),
      name: String(a.artist || a.name || 'Unknown Artist'),
      albumCount: a.album_count ? Number(a.album_count) : undefined,
    }));
    
    return { artists, total };
  }

  async getArtists(): Promise<LmsArtist[]> {
    const result = await this.request('', ['artists', '0', '100', 'tags:s']);
    const artistsLoop = (result.artists_loop || []) as Array<Record<string, unknown>>;
    
    return artistsLoop.map((a) => ({
      id: String(a.id || ''),
      name: String(a.artist || 'Unknown Artist'),
      albumCount: a.album_count ? Number(a.album_count) : undefined,
    }));
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
    await this.request(playerId, ['playlistcontrol', 'cmd:load', `playlist_id:${playlistId}`]);
  }

  async getAlbumTracks(albumId: string): Promise<LmsTrack[]> {
    const result = await this.request('', ['titles', '0', '100', `album_id:${albumId}`, 'tags:acdlKNuTsSp', 'sort:tracknum']);
    const titlesLoop = (result.titles_loop || []) as Array<Record<string, unknown>>;
    
    return titlesLoop.map((t, i) => this.parseTrack(t, i));
  }

  async search(query: string): Promise<{ artists: LmsArtist[]; albums: LmsAlbum[]; tracks: LmsTrack[] }> {
    const [artistsResult, albumsResult, tracksResult] = await Promise.all([
      this.request('', ['artists', '0', '50', `search:${query}`]),
      this.request('', ['albums', '0', '50', `search:${query}`, 'tags:aajlyST']),
      this.request('', ['titles', '0', '50', `search:${query}`, 'tags:acdlKNuT']),
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

  async playAlbum(playerId: string, albumId: string): Promise<void> {
    await this.request(playerId, ['playlistcontrol', 'cmd:load', `album_id:${albumId}`]);
  }

  async addAlbumToPlaylist(playerId: string, albumId: string): Promise<void> {
    await this.request(playerId, ['playlistcontrol', 'cmd:add', `album_id:${albumId}`]);
  }

  async playTrack(playerId: string, trackId: string): Promise<void> {
    await this.request(playerId, ['playlistcontrol', 'cmd:load', `track_id:${trackId}`]);
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

  async autoDiscoverServers(onProgress?: (found: number, scanning: number) => void): Promise<LmsServer[]> {
    debugLog.info('Starting auto-discovery of LMS servers...');
    
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
