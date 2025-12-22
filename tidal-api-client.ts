import https from 'https';
import crypto from 'crypto';

export interface TidalConfig {
  clientId: string;
  clientSecret?: string; // Optional for public client IDs
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
}

export interface TidalAlbum {
  id: string;
  title: string;
  artist: {
    id: string;
    name: string;
  };
  cover?: string;
  year?: number;
  numberOfTracks?: number;
  duration?: number;
  lmsUri: string; // LMS playable URI like "tidal://album:233036"
}

export interface TidalTrack {
  id: string;
  title: string;
  artist: {
    id: string;
    name: string;
  };
  album: {
    id: string;
    title: string;
  };
  duration: number;
  trackNumber?: number;
  cover?: string;
  audioQuality?: string;
  lmsUri: string; // LMS playable URI like "tidal://track:12345"
}

export interface TidalArtist {
  id: string;
  name: string;
  picture?: string;
}

export interface TidalPlaylist {
  id: string;
  title: string;
  description?: string;
  creator?: {
    id: string;
    name: string;
  };
  numberOfTracks?: number;
  duration?: number;
  cover?: string;
  lastUpdated?: string;
}

export class TidalApiClient {
  private config: TidalConfig;
  private authenticated: boolean = false;
  private codeVerifier: string | null = null;
  private codeChallenge: string | null = null;

  constructor(config: TidalConfig) {
    this.config = config;
  }

  async authenticate(): Promise<boolean> {
    try {
      if (this.config.accessToken) {
        // Test the token by making a simple API call
        await this.makeRequest('/v2/users/me');
        console.log('[TidalApiClient] Authenticated with stored tokens');
        this.authenticated = true;
        return true;
      } else {
        // Need to authenticate - this would typically require user interaction
        console.log('[TidalApiClient] No access token available');
        this.authenticated = false;
        return false;
      }
    } catch (error) {
      console.error('[TidalApiClient] Authentication failed:', error);
      this.authenticated = false;
      return false;
    }
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  private async makeRequest(endpoint: string, options: { method?: string; body?: any; countryCode?: string } = {}): Promise<any> {
    // Use Tidal OpenAPI v2 endpoints
    const baseUrl = 'https://openapi.tidal.com';
    const countryCode = options.countryCode || 'US';
    const url = `${baseUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}countryCode=${countryCode}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.accessToken}`,
      'accept': 'application/vnd.tidal.v1+json',
      'Content-Type': 'application/vnd.tidal.v1+json',
    };

    const requestOptions = {
      method: options.method || 'GET',
      headers,
      ...options,
    };

    return new Promise((resolve, reject) => {
      const req = https.request(url, requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(new Error(`Tidal API error: ${res.statusCode} - ${json.error || json.message || 'Unknown error'}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse Tidal API response: ${e}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Tidal API request failed: ${error.message}`));
      });

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Tidal API request timeout'));
      });

      req.end();
    });
  }

  async getMyAlbums(limit: number = 50, offset: number = 0): Promise<{ items: TidalAlbum[]; total: number }> {
    if (!this.authenticated || !this.config.accessToken) {
      throw new Error('Not authenticated with Tidal');
    }

    try {
      const result = await this.makeRequest(`/v2/users/${this.config.userId}/favorites/albums?limit=${limit}&offset=${offset}`);
      return {
        items: (result.items || result.data || []).map((item: any) => this.mapAlbum(item)),
        total: result.totalNumberOfItems || result.total || 0,
      };
    } catch (error) {
      console.error('[TidalApiClient] Failed to get albums:', error);
      throw error;
    }
  }

  async getMyPlaylists(limit: number = 50, offset: number = 0): Promise<{ items: TidalPlaylist[]; total: number }> {
    if (!this.authenticated || !this.config.accessToken) {
      throw new Error('Not authenticated with Tidal');
    }

    try {
      const result = await this.makeRequest(`/v2/users/${this.config.userId}/playlists?limit=${limit}&offset=${offset}`);
      return {
        items: (result.items || result.data || []).map((item: any) => this.mapPlaylist(item)),
        total: result.totalNumberOfItems || result.total || 0,
      };
    } catch (error) {
      console.error('[TidalApiClient] Failed to get playlists:', error);
      throw error;
    }
  }

  async getMyArtists(limit: number = 50, offset: number = 0): Promise<{ items: TidalArtist[]; total: number }> {
    if (!this.authenticated || !this.config.accessToken) {
      throw new Error('Not authenticated with Tidal');
    }

    try {
      const result = await this.makeRequest(`/v2/users/${this.config.userId}/favorites/artists?limit=${limit}&offset=${offset}`);
      return {
        items: (result.items || result.data || []).map((item: any) => this.mapArtist(item)),
        total: result.totalNumberOfItems || result.total || 0,
      };
    } catch (error) {
      console.error('[TidalApiClient] Failed to get artists:', error);
      throw error;
    }
  }

  async getAlbumTracks(albumId: string): Promise<TidalTrack[]> {
    if (!this.authenticated || !this.config.accessToken) {
      throw new Error('Not authenticated with Tidal');
    }

    try {
      const result = await this.makeRequest(`/v2/albums/${albumId}/tracks`);
      return (result.items || result.data || []).map((item: any) => this.mapTrack(item));
    } catch (error) {
      console.error(`[TidalApiClient] Failed to get album tracks for ${albumId}:`, error);
      throw error;
    }
  }

  async getPlaylistTracks(playlistId: string): Promise<TidalTrack[]> {
    if (!this.authenticated || !this.config.accessToken) {
      throw new Error('Not authenticated with Tidal');
    }

    try {
      const result = await this.makeRequest(`/v2/playlists/${playlistId}/tracks`);
      return (result.items || result.data || []).map((item: any) => this.mapTrack(item));
    } catch (error) {
      console.error(`[TidalApiClient] Failed to get playlist tracks for ${playlistId}:`, error);
      throw error;
    }
  }

  async searchAlbums(query: string, limit: number = 20): Promise<TidalAlbum[]> {
    if (!this.authenticated || !this.config.accessToken) {
      throw new Error('Not authenticated with Tidal');
    }

    try {
      const result = await this.makeRequest(`/v2/search/albums?query=${encodeURIComponent(query)}&limit=${limit}`);
      return (result.items || result.data || []).map((item: any) => this.mapAlbum(item));
    } catch (error) {
      console.error(`[TidalApiClient] Failed to search albums for "${query}":`, error);
      throw error;
    }
  }

  async searchArtists(query: string, limit: number = 20): Promise<TidalArtist[]> {
    if (!this.authenticated || !this.config.accessToken) {
      throw new Error('Not authenticated with Tidal');
    }

    try {
      const result = await this.makeRequest(`/v2/search/artists?query=${encodeURIComponent(query)}&limit=${limit}`);
      return (result.items || result.data || []).map((item: any) => this.mapArtist(item));
    } catch (error) {
      console.error(`[TidalApiClient] Failed to search artists for "${query}":`, error);
      throw error;
    }
  }

  async searchTracks(query: string, limit: number = 20): Promise<TidalTrack[]> {
    if (!this.authenticated || !this.config.accessToken) {
      throw new Error('Not authenticated with Tidal');
    }

    try {
      const result = await this.makeRequest(`/v2/search/tracks?query=${encodeURIComponent(query)}&limit=${limit}`);
      return (result.items || result.data || []).map((item: any) => this.mapTrack(item));
    } catch (error) {
      console.error(`[TidalApiClient] Failed to search tracks for "${query}":`, error);
      throw error;
    }
  }

  // Helper methods to map Tidal API responses to our internal format
  private mapAlbum(album: any): TidalAlbum {
    // Handle both v1 and v2 API response formats
    const artist = album.artist || (album.artists && album.artists[0]) || { id: '', name: 'Unknown Artist' };
    return {
      id: String(album.id),
      title: album.title || album.name || 'Unknown Album',
      artist: {
        id: String(artist.id),
        name: artist.name || 'Unknown Artist',
      },
      cover: album.cover || album.imageId || album.coverId,
      year: album.releaseDate ? new Date(album.releaseDate).getFullYear() : undefined,
      numberOfTracks: album.numberOfTracks || album.trackCount,
      duration: album.duration,
      lmsUri: `tidal://album:${album.id}`,
    };
  }

  private mapTrack(track: any): TidalTrack {
    // Handle both v1 and v2 API response formats
    const artist = track.artist || (track.artists && track.artists[0]) || { id: '', name: 'Unknown Artist' };
    const album = track.album || { id: '', title: 'Unknown Album', cover: track.cover };
    return {
      id: String(track.id),
      title: track.title || track.name || 'Unknown Track',
      artist: {
        id: String(artist.id),
        name: artist.name || 'Unknown Artist',
      },
      album: {
        id: String(album.id),
        title: album.title || album.name || 'Unknown Album',
      },
      duration: track.duration || track.playbackSeconds || 0,
      trackNumber: track.trackNumber || track.track || track.number,
      cover: album.cover || album.imageId || album.coverId || track.cover,
      audioQuality: track.audioQuality || track.quality,
      lmsUri: `tidal://track:${track.id}`,
    };
  }

  private mapArtist(artist: any): TidalArtist {
    return {
      id: String(artist.id),
      name: artist.name || 'Unknown Artist',
      picture: artist.picture || artist.imageId || artist.coverId,
    };
  }

  private mapPlaylist(playlist: any): TidalPlaylist {
    return {
      id: String(playlist.id),
      title: playlist.title || playlist.name || 'Unknown Playlist',
      description: playlist.description,
      creator: playlist.creator ? {
        id: String(playlist.creator.id),
        name: playlist.creator.name || 'Unknown',
      } : undefined,
      numberOfTracks: playlist.numberOfTracks || playlist.trackCount,
      duration: playlist.duration,
      cover: playlist.cover || playlist.imageId || playlist.coverId,
      lastUpdated: playlist.lastUpdated || playlist.updatedAt,
    };
  }

  // OAuth flow helpers with PKCE
  generateAuthUrl(): string {
    // Generate PKCE code verifier and challenge
    this.codeVerifier = this.generateCodeVerifier();
    this.codeChallenge = this.generateCodeChallenge(this.codeVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: 'soundstream://callback',
      scope: 'r_usr+w_usr+w_sub',
      code_challenge: this.codeChallenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `https://login.tidal.com/authorize?${params.toString()}`;
    return authUrl;
  }

  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(verifier: string): string {
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return hash.toString('base64url');
  }

  async exchangeCodeForTokens(code: string): Promise<{ accessToken: string; refreshToken: string; userId?: string }> {
    if (!this.codeVerifier) {
      throw new Error('No code verifier available. Please generate auth URL first.');
    }

    const tokenUrl = 'https://login.tidal.com/oauth2/token';
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: this.config.clientId,
      redirect_uri: 'soundstream://callback',
      code_verifier: this.codeVerifier,
    });

    // Create Basic Auth header with client credentials
    const auth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret || ''}`).toString('base64');

    return new Promise((resolve, reject) => {
      const req = https.request(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${auth}`,
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const tokenData = JSON.parse(data);
              resolve({
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                userId: tokenData.user?.id,
              });
            } else {
              reject(new Error(`Token exchange failed: ${res.statusCode} - ${data}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse token response: ${e}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Token request failed: ${error.message}`));
      });

      req.write(params.toString());
      req.end();
    });
  }

  setTokens(accessToken: string, refreshToken: string, userId?: string) {
    this.config.accessToken = accessToken;
    this.config.refreshToken = refreshToken;
    this.config.userId = userId;
  }

  getTokens() {
    return {
      accessToken: this.config.accessToken,
      refreshToken: this.config.refreshToken,
      userId: this.config.userId,
    };
  }
}
