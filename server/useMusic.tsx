import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Track } from "@/hooks/usePlayback";
import { lmsClient, LmsAlbum, LmsArtist, LmsTrack } from "@/lib/lmsClient";
import { debugLog } from "@/lib/debugLog";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "./useSettings";

export interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  albumCount?: number;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  imageUrl?: string;
  year?: number;
  trackCount?: number;
  source?: "local" | "qobuz" | "soundcloud" | "spotify" | "tidal";
}

export interface Server {
  id: string;
  name: string;
  type: "lms";
  host: string;
  port: number;
  connected: boolean;
  enabled: boolean;
  consecutiveFailures?: number; // Track consecutive connection failures
  lastFailureTime?: number; // Timestamp of last failure
}

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
}

export interface Favorites {
  artists: string[];
  albums: string[];
  tracks: string[];
}

interface SearchFilters {
  source?: "all" | "local" | "qobuz";
  type?: "all" | "artists" | "albums" | "tracks";
}

export interface RecentlyPlayedItem {
  type: 'track' | 'playlist';
  id: string;
  name: string;
  artwork?: string;
  playlistId?: string; // For playlist items
  track?: Track; // For track items (for backward compatibility)
}

interface MusicContextType {
  servers: Server[];
  activeServer: Server | null;
  recentlyPlayed: Track[]; // Keep for backward compatibility, but also support RecentlyPlayedItem[]
  recentlyPlayedItems: RecentlyPlayedItem[]; // New unified format
  qobuzConnected: boolean;
  tidalConnected: boolean;
  isLoading: boolean;
  favorites: Favorites;
  playlists: Playlist[];
  addServer: (server: { name: string; host: string; port: number }) => Promise<void>;
  toggleServerEnabled: (id: string) => void;
  removeServer: (id: string) => void;
  setActiveServer: (server: Server | null) => void;
  updateServerConnectionStatus: () => Promise<void>;
  reconnectServer: (serverId: string) => Promise<boolean>;
  connectQobuz: (email: string, password: string) => Promise<boolean>;
  disconnectQobuz: () => void;
  searchMusic: (query: string, filters?: SearchFilters) => Promise<{ artists: Artist[]; albums: Album[]; tracks: Track[] }>;
  getArtistAlbums: (artistId: string) => Promise<Album[]>;
  getAlbumTracks: (albumId: string, source?: "qobuz" | "local") => Promise<Track[]>;
  refreshLibrary: () => void;
  clearAllData: () => Promise<void>;
  addToRecentlyPlayed: (track: Track) => void;
  addPlaylistToRecentlyPlayed: (playlistId: string, playlistName: string, artwork?: string) => void;
  toggleFavoriteArtist: (artistId: string) => void;
  toggleFavoriteAlbum: (albumId: string) => void;
  toggleFavoriteTrack: (trackId: string) => void;
  isFavoriteArtist: (artistId: string) => boolean;
  isFavoriteAlbum: (albumId: string) => boolean;
  isFavoriteTrack: (trackId: string) => boolean;
  isQobuzFavorite: (trackId?: string, albumId?: string, artistId?: string) => Promise<boolean>;
  toggleQobuzFavorite: (trackId?: string, albumId?: string, artistId?: string) => Promise<void>;
  createPlaylist: (name: string) => Playlist;
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, name: string) => void;
  addToPlaylist: (playlistId: string, track: Track) => void;
  removeFromPlaylist: (playlistId: string, trackId: string) => void;
  reorderPlaylist: (playlistId: string, fromIndex: number, toIndex: number) => void;
}

const MusicContext = createContext<MusicContextType | undefined>(undefined);

const SERVERS_KEY = "@soundstream_servers";
const QOBUZ_KEY = "@soundstream_qobuz";
const TIDAL_KEY = "@soundstream_tidal";
const RECENT_KEY = "@soundstream_recent";
const RECENT_ITEMS_KEY = "@soundstream_recent_items"; // New unified format
const FAVORITES_KEY = "@soundstream_favorites";
const PLAYLISTS_KEY = "@soundstream_playlists";

const DEFAULT_FAVORITES: Favorites = { artists: [], albums: [], tracks: [] };

const convertLmsArtistToArtist = (lmsArtist: LmsArtist): Artist => {
  const artist: Artist = {
    id: lmsArtist.id,
    name: lmsArtist.name,
    albumCount: lmsArtist.albumCount,
  };
  // Preserve artworkUrl if it was added to the lmsArtist
  if ((lmsArtist as any).artworkUrl) {
    artist.imageUrl = (lmsArtist as any).artworkUrl;
  }
  return artist;
};

const convertLmsAlbumToAlbum = (lmsAlbum: LmsAlbum, source: "local" | "qobuz" | "spotify" | "tidal" | "soundcloud" = "local"): Album => ({
  id: lmsAlbum.id,
  name: lmsAlbum.title,
  artist: lmsAlbum.artist,
  artistId: lmsAlbum.artistId || '',
  imageUrl: lmsClient.getArtworkUrl(lmsAlbum),
  year: lmsAlbum.year,
  trackCount: lmsAlbum.trackCount,
  source,
});

const convertLmsTrackToTrack = (lmsTrack: LmsTrack, serverId: string): Track => ({
  id: `${serverId}-${lmsTrack.id}`,
  title: lmsTrack.title,
  artist: lmsTrack.artist,
  album: lmsTrack.album,
  albumId: lmsTrack.albumId,
  albumArt: lmsTrack.artwork_url ? lmsClient.getArtworkUrl(lmsTrack as LmsAlbum) : undefined,
  duration: lmsTrack.duration,
  source: 'local',
  uri: lmsTrack.url,
  format: lmsTrack.format,
  bitrate: lmsTrack.bitrate,
  sampleRate: lmsTrack.sampleRate,
  bitDepth: lmsTrack.bitDepth,
  lmsTrackId: lmsTrack.id,
});

export function MusicProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { qobuzEnabled, spotifyEnabled, tidalEnabled, soundcloudEnabled } = useSettings();
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServer, setActiveServerState] = useState<Server | null>(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>([]);
  const [recentlyPlayedItems, setRecentlyPlayedItems] = useState<RecentlyPlayedItem[]>([]);
  const [qobuzConnected, setQobuzConnected] = useState(false);
  const [tidalConnected, setTidalConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [favorites, setFavorites] = useState<Favorites>(DEFAULT_FAVORITES);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [qobuzFavoritesCache, setQobuzFavoritesCache] = useState<{ tracks: Set<string>; albums: Set<string>; artists: Set<string> }>({
    tracks: new Set(),
    albums: new Set(),
    artists: new Set(),
  });
  
  // Use refs to track latest state for async operations
  const serversRef = useRef<Server[]>([]);
  const activeServerRef = useRef<Server | null>(null);
  
  // Keep refs in sync with state
  useEffect(() => {
    serversRef.current = servers;
  }, [servers]);
  
  useEffect(() => {
    activeServerRef.current = activeServer;
  }, [activeServer]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [serversData, qobuzData, recentData, recentItemsData, favoritesData, playlistsData] = await Promise.all([
        AsyncStorage.getItem(SERVERS_KEY),
        AsyncStorage.getItem(QOBUZ_KEY),
        AsyncStorage.getItem(TIDAL_KEY),
        AsyncStorage.getItem(RECENT_KEY),
        AsyncStorage.getItem(RECENT_ITEMS_KEY),
        AsyncStorage.getItem(FAVORITES_KEY),
        AsyncStorage.getItem(PLAYLISTS_KEY),
      ]);

      if (serversData) {
        const parsed = JSON.parse(serversData);
        // Filter out legacy servers and non-LMS servers, clean up old data
        const loadedServers = (parsed.servers || [])
          .filter((s: Server) => s.type === 'lms') // Only keep LMS servers
          .map((s: Server) => ({
            ...s,
            type: 'lms' as const, // Ensure type is LMS
            enabled: s.enabled !== undefined ? s.enabled : true,
            connected: s.connected !== undefined ? s.connected : true,
          })) as Server[];
        
        // If we filtered out servers, save the cleaned list
        if (loadedServers.length !== (parsed.servers || []).length) {
          const activeId = parsed.activeServerId && loadedServers.find(s => s.id === parsed.activeServerId) 
            ? parsed.activeServerId 
            : undefined;
          await saveServers(loadedServers, activeId);
        }
        
        setServers(loadedServers);
        serversRef.current = loadedServers; // Update ref immediately
        
        if (parsed.activeServerId) {
          const active = loadedServers.find((s: Server) => s.id === parsed.activeServerId);
          if (active) {
            setActiveServerState(active);
            activeServerRef.current = active; // Update ref immediately
            lmsClient.setServer(active.host, active.port);
          }
        }
      }

      if (qobuzData) {
        setQobuzConnected(JSON.parse(qobuzData).connected);
      }

      if (tidalData) {
        const tidalInfo = JSON.parse(tidalData);
        setTidalConnected(tidalInfo.connected);
        // Store tokens in global Tidal client if available
        if (tidalInfo.accessToken) {
          // Note: We'll need to update the server-side client to accept tokens
          // For now, just set the connected state
        }
      }

      if (recentData) {
        setRecentlyPlayed(JSON.parse(recentData));
      }
      
      if (recentItemsData) {
        setRecentlyPlayedItems(JSON.parse(recentItemsData));
      }

      if (favoritesData) {
        setFavorites(JSON.parse(favoritesData));
      }

      if (playlistsData) {
        const loadedPlaylists = JSON.parse(playlistsData);
        
        // Filter out Qobuz, SoundCloud, Spotify, and Tidal playlists if disabled
        let qobuzEnabled = true;
        let soundcloudEnabled = true;
        let spotifyEnabled = true;
        let tidalEnabled = true;
        try {
          const settings = await AsyncStorage.getItem("@soundstream_settings");
          if (settings) {
            const parsed = JSON.parse(settings);
            qobuzEnabled = parsed.qobuzEnabled !== false;
            soundcloudEnabled = parsed.soundcloudEnabled !== false;
            spotifyEnabled = parsed.spotifyEnabled !== false;
            tidalEnabled = parsed.tidalEnabled !== false;
          }
        } catch (e) {
          // Use defaults if settings can't be loaded
        }
        
        const filteredPlaylists = loadedPlaylists.filter((playlist: Playlist) => {
          const name = playlist.name.toLowerCase();
          const isQobuz = name.includes('qobuz:') || name.startsWith('qobuz');
          const isSoundCloud = name.includes('soundcloud:') || name.startsWith('soundcloud');
          const isSpotify = name.includes('spotify:') || name.startsWith('spotify');
          const isTidal = name.includes('tidal:') || name.startsWith('tidal');
          
          if (isQobuz && !qobuzEnabled) return false;
          if (isSoundCloud && !soundcloudEnabled) return false;
          if (isSpotify && !spotifyEnabled) return false;
          if (isTidal && !tidalEnabled) return false;
          return true;
        });
        
        setPlaylists(filteredPlaylists);
      }
      setDataLoaded(true);
    } catch (e) {
      console.error("Failed to load music data:", e);
      setDataLoaded(true);
    }
  };

  const saveServers = async (newServers: Server[], activeId?: string) => {
    console.log('[useMusic] saveServers called:', {
      serverCount: newServers.length,
      activeId,
      dataLoaded,
      serverIds: newServers.map(s => s.id)
    });
    
    // Don't save if data hasn't been loaded yet - prevents wiping stored data
    if (!dataLoaded && newServers.length === 0) {
      console.log('[useMusic] saveServers skipped: data not loaded and no servers');
      return;
    }
    
    try {
      const dataToSave = { servers: newServers, activeServerId: activeId };
      console.log('[useMusic] Saving to AsyncStorage:', JSON.stringify(dataToSave, null, 2));
      await AsyncStorage.setItem(
        SERVERS_KEY,
        JSON.stringify(dataToSave)
      );
      console.log('[useMusic] Successfully saved servers to AsyncStorage');
    } catch (e) {
      console.error("[useMusic] Failed to save servers:", e);
    }
  };

  const saveFavorites = async (newFavorites: Favorites) => {
    try {
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));
    } catch (e) {
      console.error("Failed to save favorites:", e);
    }
  };

  const savePlaylists = async (newPlaylists: Playlist[]) => {
    try {
      await AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(newPlaylists));
    } catch (e) {
      console.error("Failed to save playlists:", e);
    }
  };

  const addServer = useCallback(async (server: { name: string; host: string; port: number }) => {
    const newServer: Server = {
      id: `lms-${server.host}:${server.port}`,
      name: server.name,
      type: 'lms',
      host: server.host,
      port: server.port,
      connected: true,
      enabled: true,
    };
    
    // Get current servers from ref to avoid stale state
    const currentServers = serversRef.current;
    // Remove any existing server with same host:port
    const updated = currentServers.filter(s => !(s.host === newServer.host && s.port === newServer.port));
    updated.push(newServer);
    
    // Update refs immediately
    serversRef.current = updated;
    
    // Update state
    setServers(updated);
    
    // Set as active server
    setActiveServerState(newServer);
    activeServerRef.current = newServer;
    lmsClient.setServer(newServer.host, newServer.port);
    
    // Save to storage
    try {
      await saveServers(updated, newServer.id);
      console.log('[useMusic] Server added and saved:', newServer.id);
    } catch (e) {
      console.error('[useMusic] Failed to save server after adding:', e);
    }
  }, []);

  const removeServer = useCallback(async (id: string) => {
    // Get current state from refs to ensure we have the latest
    const currentServers = serversRef.current;
    const currentActive = activeServerRef.current;
    
    const updated = currentServers.filter((s) => s.id !== id);
    const isRemovingActive = currentActive?.id === id;
    
    // Update refs immediately
    serversRef.current = updated;
    if (isRemovingActive) {
      activeServerRef.current = null;
      setActiveServerState(null);
      lmsClient.setServer('', 0); // Clear LMS client
    }
    
    // Update state synchronously
    setServers(updated);
    
    // Save to storage
    const newActiveId = isRemovingActive ? undefined : currentActive?.id;
    try {
      await saveServers(updated, newActiveId);
    } catch (e) {
      console.error('[useMusic] Failed to save servers after removal:', e);
    }
  }, []);

  const toggleServerEnabled = useCallback((id: string) => {
    setServers((prev) => {
      const updated = prev.map((s) => 
        s.id === id ? { ...s, enabled: !s.enabled } : s
      );
      serversRef.current = updated;
      const currentActive = activeServerRef.current;
      saveServers(updated, currentActive?.id).catch(e => {
        console.error('[useMusic] Failed to save server enabled state:', e);
      });
      return updated;
    });
  }, []);

  const setActiveServer = useCallback((server: Server | null) => {
    setActiveServerState(server);
    activeServerRef.current = server;
    if (server) {
      lmsClient.setServer(server.host, server.port);
    }
    saveServers(serversRef.current, server?.id).catch(e => {
      console.error('[useMusic] Failed to save active server:', e);
    });
  }, []);

  const checkServerConnection = useCallback(async (server: Server, retries: number = 2): Promise<boolean> => {
    // Skip connection check for disabled servers
    if (!server.enabled) {
      return false;
    }
    
    // Store original server settings
    const originalServer = activeServer ? { host: activeServer.host, port: activeServer.port } : null;
    
    let lastError: Error | null = null;
    
    // Retry logic with exponential backoff
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Temporarily switch to this server to check connection
        lmsClient.setServer(server.host, server.port);
        await lmsClient.getServerStatus();
        // Restore original server
        if (originalServer) {
          lmsClient.setServer(originalServer.host, originalServer.port);
        }
        return true;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // On web, if the error is due to proxy server not being available,
        // preserve the existing connection status rather than marking as offline
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (Platform.OS === 'web' && (
          errorMessage.includes('Failed to fetch') ||
          errorMessage.includes('ERR_CONNECTION_REFUSED') ||
          errorMessage.includes('localhost:3000')
        )) {
          // Proxy server not available - preserve existing status
          if (originalServer) {
            lmsClient.setServer(originalServer.host, originalServer.port);
          }
          return server.connected !== undefined ? server.connected : true;
        }
        
        // If not the last attempt, wait before retrying (exponential backoff)
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500)); // 500ms, 1s, 2s
        }
      }
    }
    
    // Restore original server after all retries failed
    if (originalServer) {
      lmsClient.setServer(originalServer.host, originalServer.port);
    }
    
    // All retries failed
    return false;
  }, [activeServer]);

  const updateServerConnectionStatus = useCallback(async () => {
    if (servers.length === 0) return;
    
    // On web, check if proxy server is available before attempting connection checks
    let canCheckConnection = true;
    if (Platform.OS === 'web') {
      try {
        const domain = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
          ? `${window.location.hostname}:3000`
          : process.env.EXPO_PUBLIC_DOMAIN || 'localhost:3000';
        const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
        const apiUrl = `${protocol}//${domain}`;
        
        // Quick check if proxy server is available using health endpoint
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const healthResponse = await fetch(`${apiUrl}/api/health`, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!healthResponse.ok) {
          throw new Error('Proxy server health check failed');
        }
      } catch (error) {
        // Proxy server not available - skip connection checks and preserve existing status
        canCheckConnection = false;
      }
    }
    
    const updatedServers = await Promise.all(
      servers.map(async (server) => {
        if (!canCheckConnection) {
          // When proxy is unavailable on web, assume enabled servers are connected
          // (since they work on iOS where there's no proxy requirement)
          if (Platform.OS === 'web' && server.enabled) {
            return { ...server, connected: true, consecutiveFailures: 0 };
          }
          // Otherwise preserve existing status
          return server;
        }
        const isConnected = await checkServerConnection(server);
        
        // Track consecutive failures - only mark as disconnected after 3 consecutive failures
        const consecutiveFailures = isConnected ? 0 : (server.consecutiveFailures || 0) + 1;
        const lastFailureTime = isConnected ? undefined : Date.now();
        
        // Only mark as disconnected after 3 consecutive failures (to avoid false positives from temporary network issues)
        const shouldMarkDisconnected = consecutiveFailures >= 3;
        
        return { 
          ...server, 
          connected: isConnected || (!shouldMarkDisconnected && server.connected), // Preserve connection if not enough failures
          consecutiveFailures,
          lastFailureTime,
        };
      })
    );
    
    setServers(updatedServers);
    
    // If the active server is no longer connected (after multiple failures), try to reconnect
    if (activeServer) {
      const activeServerUpdated = updatedServers.find(s => s.id === activeServer.id);
      if (activeServerUpdated && !activeServerUpdated.connected && (activeServerUpdated.consecutiveFailures ?? 0) >= 3) {
        // Server has failed multiple times - try to reconnect automatically
        debugLog.info('Server disconnected', `Attempting to reconnect to ${activeServerUpdated.name}`);
        
        // Try to reconnect (with more retries)
        const reconnected = await checkServerConnection(activeServerUpdated, 5);
        if (reconnected) {
          // Reconnection successful - update server status
          const reconnectedServer = { ...activeServerUpdated, connected: true, consecutiveFailures: 0 };
          const finalServers = updatedServers.map(s => s.id === reconnectedServer.id ? reconnectedServer : s);
          setServers(finalServers);
          setActiveServerState(reconnectedServer);
          lmsClient.setServer(reconnectedServer.host, reconnectedServer.port);
          saveServers(finalServers, reconnectedServer.id);
          return;
        } else {
          // Reconnection failed - clear active server but keep it in the list
          setActiveServerState(null);
          saveServers(updatedServers, undefined);
        }
      } else if (activeServerUpdated && activeServerUpdated.connected) {
        // Server is connected - keep it active
        saveServers(updatedServers, activeServer.id);
      } else {
        // Server is still trying to connect - preserve active server
        saveServers(updatedServers, activeServer.id);
      }
    } else {
      // If no active server, automatically set the first connected server as active
      const firstConnected = updatedServers.find(s => s.connected);
      if (firstConnected) {
        setActiveServerState(firstConnected);
        lmsClient.setServer(firstConnected.host, firstConnected.port);
        saveServers(updatedServers, firstConnected.id);
      } else {
        saveServers(updatedServers, undefined);
      }
    }
  }, [servers, activeServer, checkServerConnection]);

  // Manual reconnection function
  const reconnectServer = useCallback(async (serverId: string): Promise<boolean> => {
    const server = servers.find(s => s.id === serverId);
    if (!server || !server.enabled) {
      return false;
    }
    
    debugLog.info('Manual reconnect', `Attempting to reconnect to ${server.name}`);
    
    // Reset failure count and try to connect with more retries
    const isConnected = await checkServerConnection(server, 5);
    
    if (isConnected) {
      // Update server status
      const updatedServers = servers.map(s => 
        s.id === serverId 
          ? { ...s, connected: true, consecutiveFailures: 0, lastFailureTime: undefined }
          : s
      );
      setServers(updatedServers);
      
      // Set as active server if not already active
      if (!activeServer || activeServer.id !== serverId) {
        setActiveServerState(updatedServers.find(s => s.id === serverId)!);
        lmsClient.setServer(server.host, server.port);
        saveServers(updatedServers, serverId);
      } else {
        saveServers(updatedServers, serverId);
      }
      
      return true;
    } else {
      // Update failure count
      const updatedServers = servers.map(s => 
        s.id === serverId 
          ? { ...s, consecutiveFailures: (s.consecutiveFailures || 0) + 1, lastFailureTime: Date.now() }
          : s
      );
      setServers(updatedServers);
      return false;
    }
  }, [servers, activeServer, checkServerConnection]);

  // Check server connection status when servers are loaded
  useEffect(() => {
    if (dataLoaded && servers.length > 0) {
      updateServerConnectionStatus();
    }
  }, [dataLoaded, servers.length, updateServerConnectionStatus]);
  
  // Periodic connection check for enabled servers (every 30 seconds)
  useEffect(() => {
    if (servers.length === 0) return;
    
    const interval = setInterval(() => {
      const enabledServers = servers.filter(s => s.enabled);
      if (enabledServers.length > 0) {
        updateServerConnectionStatus();
      }
    }, 30000); // Check every 30 seconds
    
    return () => clearInterval(interval);
  }, [servers, updateServerConnectionStatus]);

  const connectQobuz = useCallback(async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    if (email && password) {
      setQobuzConnected(true);
      await AsyncStorage.setItem(QOBUZ_KEY, JSON.stringify({ connected: true, email }));
      setIsLoading(false);
      return true;
    }
    setIsLoading(false);
    return false;
  }, []);

  const disconnectQobuz = useCallback(async () => {
    setQobuzConnected(false);
    await AsyncStorage.setItem(QOBUZ_KEY, JSON.stringify({ connected: false }));
  }, []);

  const getTidalAuthUrl = useCallback(async (): Promise<string> => {
    try {
      const response = await fetch(`${getApiUrl()}/api/tidal/auth-url`);
      if (!response.ok) {
        throw new Error('Failed to get Tidal auth URL');
      }
      const data = await response.json();
      return data.authUrl;
    } catch (error) {
      console.error('Failed to get Tidal auth URL:', error);
      throw error;
    }
  }, []);

  const connectTidal = useCallback(async (authCode: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      const response = await fetch(`${getApiUrl()}/api/tidal/authenticate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: authCode }),
      });

      if (!response.ok) {
        throw new Error('Failed to authenticate with Tidal');
      }

      const data = await response.json();
      if (data.success) {
        setTidalConnected(true);
        await AsyncStorage.setItem(TIDAL_KEY, JSON.stringify({
          connected: true,
          accessToken: data.tokens.accessToken,
          refreshToken: data.tokens.refreshToken,
          userId: data.tokens.userId
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to connect Tidal:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const disconnectTidal = useCallback(async () => {
    setTidalConnected(false);
    await AsyncStorage.setItem(TIDAL_KEY, JSON.stringify({ connected: false }));
  }, []);

  const checkTidalStatus = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${getApiUrl()}/api/tidal/status`);
      if (!response.ok) {
        return false;
      }
      const data = await response.json();
      const isConnected = data.authenticated && data.hasTokens;
      setTidalConnected(isConnected);
      return isConnected;
    } catch (error) {
      console.error('Failed to check Tidal status:', error);
      setTidalConnected(false);
      return false;
    }
  }, []);

  const searchMusic = useCallback(async (query: string, filters?: SearchFilters) => {
    if (!activeServer) {
      debugLog.info('No active server for search', 'Returning empty results');
      return { artists: [], albums: [], tracks: [] };
    }
    
    // Get integration settings from AsyncStorage (we can't use useSettings hook here)
    let qobuzEnabled = true;
    let soundcloudEnabled = true;
    let spotifyEnabled = true;
    let tidalEnabled = true;
    try {
      const settings = await AsyncStorage.getItem("@soundstream_settings");
      if (settings) {
        const parsed = JSON.parse(settings);
        qobuzEnabled = parsed.qobuzEnabled !== false;
        soundcloudEnabled = parsed.soundcloudEnabled !== false;
        spotifyEnabled = parsed.spotifyEnabled !== false;
        tidalEnabled = parsed.tidalEnabled !== false;
      }
    } catch (e) {
      // Use defaults if settings can't be loaded
    }
    
    try {
      // Ensure server is set before searching
      lmsClient.setServer(activeServer.host, activeServer.port);
      
      const sourceFilter = filters?.source || "all";
      const typeFilter = filters?.type || "all";
      
      debugLog.info('Starting search', JSON.stringify({ query, sourceFilter, typeFilter, server: `${activeServer.host}:${activeServer.port}` }));
      
      // When "all sources" is selected, try globalSearch first, but always fall back to separate searches
      // This ensures we get results even if globalSearch isn't available
      if (sourceFilter === "all") {
        try {
          const result = await lmsClient.globalSearch(query);
          // Only use globalSearch results if we actually got some results
          if (result.tracks.length > 0 || result.albums.length > 0 || result.artists.length > 0) {
            debugLog.info('Global search returned results', `${result.tracks.length} tracks, ${result.albums.length} albums, ${result.artists.length} artists`);
            // Determine source for tracks based on URL or ID
            const tracksWithSource = result.tracks
              .map(t => {
                const url = t.url || '';
                const id = t.id || '';
                const isQobuz = url.includes('qobuz') || id.startsWith('qobuz_');
                const isSoundCloud = url.includes('soundcloud') || id.includes('soundcloud');
                const isSpotify = url.includes('spotify') || id.includes('spotify');
                const isTidal = url.includes('tidal') || id.includes('tidal');
                const source = isQobuz ? 'qobuz' : (isSoundCloud ? 'soundcloud' : (isSpotify ? 'spotify' : (isTidal ? 'tidal' : 'local')));
                return { ...convertLmsTrackToTrack(t, activeServer.id), source };
              })
              .filter(t => {
                if (t.source === 'qobuz' && !qobuzEnabled) return false;
                if (t.source === 'soundcloud' && !soundcloudEnabled) return false;
                if (t.source === 'spotify' && !spotifyEnabled) return false;
                if (t.source === 'tidal' && !tidalEnabled) return false;
                return true;
              });
            
            const albumsWithSource = result.albums
              .map(album => {
                const url = album.artwork_url || '';
                const id = album.id || '';
                const isQobuz = url.includes('qobuz') || id.startsWith('qobuz_');
                const isSoundCloud = url.includes('soundcloud') || id.includes('soundcloud');
                const isSpotify = url.includes('spotify') || id.includes('spotify');
                const isTidal = url.includes('tidal') || id.includes('tidal');
                const source = isQobuz ? 'qobuz' : (isSoundCloud ? 'soundcloud' : (isSpotify ? 'spotify' : (isTidal ? 'tidal' : 'local')));
                return convertLmsAlbumToAlbum(album, source);
              })
              .filter(album => {
                if (album.source === 'qobuz' && !qobuzEnabled) return false;
                if (album.source === 'soundcloud' && !soundcloudEnabled) return false;
                if (album.source === 'spotify' && !spotifyEnabled) return false;
                if (album.source === 'tidal' && !tidalEnabled) return false;
                return true;
              });
            
            return {
              artists: (typeFilter === "all" || typeFilter === "artists") 
                ? result.artists.map(convertLmsArtistToArtist)
                : [],
              albums: (typeFilter === "all" || typeFilter === "albums") 
                ? albumsWithSource
                : [],
              tracks: (typeFilter === "all" || typeFilter === "tracks") 
                ? tracksWithSource 
                : [],
            };
          } else {
            debugLog.info('Global search returned no results, falling back to separate searches');
            // Fall through to separate searches
          }
        } catch (e) {
          debugLog.info('Global search failed, falling back to separate searches', e instanceof Error ? e.message : String(e));
          // Fall through to separate searches for both local and qobuz
        }
      }
      
      let localResult = { artists: [] as any[], albums: [] as any[], tracks: [] as any[] };
      let qobuzResult = { artists: [] as any[], albums: [] as any[], tracks: [] as any[] };
      
      if (sourceFilter === "local" || sourceFilter === "all") {
        try {
          const result = await lmsClient.search(query);
          localResult = {
            artists: result.artists.map(convertLmsArtistToArtist),
            albums: result.albums
              .filter(album => {
                // Filter out Spotify and Tidal albums if disabled
                if (!spotifyEnabled || !tidalEnabled) {
                  const id = (album.id || '').toLowerCase();
                  const artworkUrl = (album.artwork_url || '').toLowerCase();
                  if (!spotifyEnabled && (id.includes('spotify') || artworkUrl.includes('spotify'))) {
                    return false;
                  }
                  if (!tidalEnabled && (id.includes('tidal') || artworkUrl.includes('tidal'))) {
                    return false;
                  }
                }
                return true;
              })
              .map(album => convertLmsAlbumToAlbum(album, 'local')),
            tracks: result.tracks
              .filter(t => {
                // Filter out Spotify and Tidal tracks if disabled
                if (!spotifyEnabled || !tidalEnabled) {
                  const url = (t.url || '').toLowerCase();
                  const id = (t.id || '').toLowerCase();
                  if (!spotifyEnabled && (url.includes('spotify') || id.includes('spotify'))) {
                    return false;
                  }
                  if (!tidalEnabled && (url.includes('tidal') || id.includes('tidal'))) {
                    return false;
                  }
                }
                return true;
              })
              .map(t => ({ ...convertLmsTrackToTrack(t, activeServer.id), source: 'local' })),
          };
        } catch (e) {
          debugLog.info('Local search failed', e instanceof Error ? e.message : String(e));
        }
      }
      
      if ((sourceFilter === "qobuz" || sourceFilter === "all") && qobuzEnabled) {
        try {
          const result = await lmsClient.searchQobuz(query);
          qobuzResult = {
            artists: result.artists.map(convertLmsArtistToArtist),
            albums: result.albums.map(album => convertLmsAlbumToAlbum(album, 'qobuz')),
            tracks: result.tracks.map(t => ({ ...convertLmsTrackToTrack(t, activeServer.id), source: 'qobuz' })),
          };
        } catch (e) {
          debugLog.info('Qobuz search not available', e instanceof Error ? e.message : String(e));
        }
      }
      
      const mergedArtists = [...localResult.artists, ...qobuzResult.artists];
      const mergedAlbums = [...localResult.albums, ...qobuzResult.albums];
      const mergedTracks = [...localResult.tracks, ...qobuzResult.tracks];
      
      const uniqueArtists = mergedArtists.filter((a, i, arr) => 
        arr.findIndex(x => x.id === a.id || x.name === a.name) === i
      );
      const uniqueAlbums = mergedAlbums.filter((a, i, arr) => 
        arr.findIndex(x => x.id === a.id || (x.name === a.name && x.artist === a.artist)) === i
      );
      
      return {
        artists: (typeFilter === "all" || typeFilter === "artists") ? uniqueArtists : [],
        albums: (typeFilter === "all" || typeFilter === "albums") ? uniqueAlbums : [],
        tracks: (typeFilter === "all" || typeFilter === "tracks") ? mergedTracks : [],
      };
    } catch (error) {
      debugLog.error('Search failed', error instanceof Error ? error.message : String(error));
      return { artists: [], albums: [], tracks: [] };
    }
  }, [activeServer]);

  const getArtistAlbums = useCallback(async (artistId: string): Promise<Album[]> => {
    try {
      const lmsAlbums = await lmsClient.getAlbums(artistId);
      return lmsAlbums.map((album) => convertLmsAlbumToAlbum(album, 'local'));
    } catch (error) {
      debugLog.error('Failed to get artist albums', error instanceof Error ? error.message : String(error));
      return [];
    }
  }, []);

  const getAlbumTracks = useCallback(async (albumId: string, source?: "qobuz" | "local"): Promise<Track[]> => {
    if (!activeServer) {
      return [];
    }
    
    try {
      const lmsTracks = await lmsClient.getAlbumTracks(albumId, source);
      return lmsTracks.map(t => convertLmsTrackToTrack(t, activeServer.id));
    } catch (error) {
      debugLog.error('Failed to get album tracks', error instanceof Error ? error.message : String(error));
      return [];
    }
  }, [activeServer]);

  const refreshLibrary = useCallback(async () => {
    if (!activeServer) {
      debugLog.info('No active server to refresh');
      return;
    }
    
    debugLog.info('Invalidating all library caches');
    // Invalidate all query caches to force fresh data
    queryClient.invalidateQueries({ queryKey: ['albums'] });
    queryClient.invalidateQueries({ queryKey: ['artists'] });
    queryClient.invalidateQueries({ queryKey: ['tracks'] });
    queryClient.invalidateQueries({ queryKey: ['playlists'] });
    queryClient.invalidateQueries({ queryKey: ['radio'] });
    
    // Force refetch of all queries
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['albums'] }),
      queryClient.refetchQueries({ queryKey: ['artists'] }),
      queryClient.refetchQueries({ queryKey: ['radio'] }),
    ]);
    
    // Also refresh playlist count from LMS
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);

      // Filter out Qobuz, SoundCloud, Spotify, and Tidal playlists if disabled
      let qobuzEnabled = true;
      let soundcloudEnabled = true;
      let spotifyEnabled = true;
      let tidalEnabled = true;
      try {
        const settings = await AsyncStorage.getItem("@soundstream_settings");
        if (settings) {
          const parsed = JSON.parse(settings);
          qobuzEnabled = parsed.qobuzEnabled !== false;
          soundcloudEnabled = parsed.soundcloudEnabled !== false;
          spotifyEnabled = parsed.spotifyEnabled !== false;
          tidalEnabled = parsed.tidalEnabled !== false;
        }
      } catch (e) {
        // Use defaults if settings can't be loaded
      }

      const lmsPlaylists = await lmsClient.getPlaylists(qobuzEnabled, soundcloudEnabled, spotifyEnabled, false); // Don't include Tidal from LMS

      // Add Tidal playlists if enabled
      let tidalPlaylists: any[] = [];
      if (tidalEnabled) {
        try {
          const tidalResponse = await fetch(`${getApiUrl()}/api/tidal/playlists?limit=50&offset=0`);
          if (tidalResponse.ok) {
            const tidalResult = await tidalResponse.json();
            if (tidalResult.items) {
              tidalPlaylists = tidalResult.items.map((playlist: any) => ({
                id: `tidal-${playlist.id}`,
                name: playlist.title,
                url: `tidal:playlist:${playlist.id}`,
                artwork: playlist.cover ? `https://resources.tidal.com/images/${playlist.cover.replace(/-/g, '/')}/640x640.jpg` : undefined,
                type: 'playlist',
                creator: playlist.creator?.name || 'Tidal',
              }));
            }
          }
        } catch (e) {
          console.warn('Tidal playlists not available:', e);
        }
      }

      const allPlaylists = [...lmsPlaylists, ...tidalPlaylists];

        const filteredPlaylists = allPlaylists.filter(playlist => {
          const name = playlist.name.toLowerCase();
          const url = (playlist.url || '').toLowerCase();
          const isQobuz = name.includes('qobuz:') || name.startsWith('qobuz') || url.includes('qobuz');
          const isSoundCloud = name.includes('soundcloud:') || name.startsWith('soundcloud') || url.includes('soundcloud');
          const isSpotify = name.includes('spotify:') || name.startsWith('spotify') || url.includes('spotify');
          const isTidal = name.includes('tidal:') || name.startsWith('tidal') || url.includes('tidal') || playlist.id.startsWith('tidal-');

          if (isQobuz && !qobuzEnabled) return false;
          if (isSoundCloud && !soundcloudEnabled) return false;
          if (isSpotify && !spotifyEnabled) return false;
          if (isTidal && !tidalEnabled) return false;
          return true;
        });
      
      // Convert to internal playlist format for count
      const playlistData: Playlist[] = filteredPlaylists.map(p => ({
        id: p.id,
        name: p.name,
        tracks: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));
      setPlaylists(playlistData);
      await AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlistData));
    } catch (e) {
      debugLog.error('Failed to refresh playlists', e instanceof Error ? e.message : String(e));
    }
  }, [activeServer, queryClient]);

  // Watch for integration setting changes and refresh library
  useEffect(() => {
    if (!activeServer || !dataLoaded) return;
    
    // When integration settings change, invalidate all queries and refresh
    debugLog.info('Integration settings changed, refreshing library', JSON.stringify({ qobuzEnabled, spotifyEnabled, tidalEnabled, soundcloudEnabled }));
    queryClient.invalidateQueries({ queryKey: ['albums'] });
    queryClient.invalidateQueries({ queryKey: ['artists'] });
    queryClient.invalidateQueries({ queryKey: ['tracks'] });
    queryClient.invalidateQueries({ queryKey: ['playlists'] });
    refreshLibrary();
  }, [qobuzEnabled, spotifyEnabled, tidalEnabled, soundcloudEnabled, activeServer, dataLoaded, queryClient, refreshLibrary]);

  const clearAllData = useCallback(async () => {
    try {
      await Promise.all([
        AsyncStorage.removeItem(SERVERS_KEY),
        AsyncStorage.removeItem(QOBUZ_KEY),
        AsyncStorage.removeItem(RECENT_KEY),
        AsyncStorage.removeItem(RECENT_ITEMS_KEY),
        AsyncStorage.removeItem(FAVORITES_KEY),
        AsyncStorage.removeItem(PLAYLISTS_KEY),
      ]);
      setServers([]);
      setActiveServerState(null);
      setRecentlyPlayed([]);
      setRecentlyPlayedItems([]);
      setQobuzConnected(false);
      setFavorites(DEFAULT_FAVORITES);
      setPlaylists([]);
      queryClient.clear();
    } catch (e) {
      console.error("Failed to clear all data:", e);
    }
  }, [queryClient]);

  const addToRecentlyPlayed = useCallback(async (track: Track) => {
    setRecentlyPlayed((prev) => {
      const filtered = prev.filter((t) => t.id !== track.id);
      const updated = [track, ...filtered].slice(0, 20);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
      return updated;
    });
    
    // Also add to unified recently played items
    const item: RecentlyPlayedItem = {
      type: 'track',
      id: track.id,
      name: track.title,
      artwork: track.albumArt,
      track,
    };
    setRecentlyPlayedItems((prev) => {
      const filtered = prev.filter((i) => !(i.type === 'track' && i.id === item.id));
      const updated = [item, ...filtered].slice(0, 20);
      AsyncStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);
  
  const addPlaylistToRecentlyPlayed = useCallback(async (playlistId: string, playlistName: string, artwork?: string) => {
    const item: RecentlyPlayedItem = {
      type: 'playlist',
      id: `playlist-${playlistId}`,
      name: playlistName,
      artwork,
      playlistId,
    };
    setRecentlyPlayedItems((prev) => {
      const filtered = prev.filter((i) => !(i.type === 'playlist' && i.playlistId === playlistId));
      const updated = [item, ...filtered].slice(0, 20);
      AsyncStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const toggleFavoriteArtist = useCallback((artistId: string) => {
    setFavorites((prev) => {
      const exists = prev.artists.includes(artistId);
      const updated = {
        ...prev,
        artists: exists 
          ? prev.artists.filter((id) => id !== artistId)
          : [...prev.artists, artistId],
      };
      saveFavorites(updated);
      return updated;
    });
  }, []);

  const toggleFavoriteAlbum = useCallback((albumId: string) => {
    setFavorites((prev) => {
      const exists = prev.albums.includes(albumId);
      const updated = {
        ...prev,
        albums: exists 
          ? prev.albums.filter((id) => id !== albumId)
          : [...prev.albums, albumId],
      };
      saveFavorites(updated);
      return updated;
    });
  }, []);

  const toggleFavoriteTrack = useCallback((trackId: string) => {
    setFavorites((prev) => {
      const exists = prev.tracks.includes(trackId);
      const updated = {
        ...prev,
        tracks: exists 
          ? prev.tracks.filter((id) => id !== trackId)
          : [...prev.tracks, trackId],
      };
      saveFavorites(updated);
      return updated;
    });
  }, []);

  const isFavoriteArtist = useCallback((artistId: string) => {
    return favorites.artists.includes(artistId);
  }, [favorites]);

  const isFavoriteAlbum = useCallback((albumId: string) => {
    return favorites.albums.includes(albumId);
  }, [favorites]);

  const isFavoriteTrack = useCallback((trackId: string) => {
    return favorites.tracks.includes(trackId);
  }, [favorites]);

  /**
   * Check if a track/album/artist is favorited in Qobuz
   */
  const isQobuzFavorite = useCallback(async (trackId?: string, albumId?: string, artistId?: string): Promise<boolean> => {
    if (!qobuzConnected || !activeServer) {
      return false;
    }

    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      
      if (trackId) {
        // Check cache first
        if (qobuzFavoritesCache.tracks.has(trackId)) {
          return true;
        }
        const isFavorite = await lmsClient.isQobuzTrackFavorite(trackId);
        if (isFavorite) {
          setQobuzFavoritesCache(prev => ({
            ...prev,
            tracks: new Set([...prev.tracks, trackId]),
          }));
        }
        return isFavorite;
      } else if (albumId) {
        if (qobuzFavoritesCache.albums.has(albumId)) {
          return true;
        }
        const isFavorite = await lmsClient.isQobuzAlbumFavorite(albumId);
        if (isFavorite) {
          setQobuzFavoritesCache(prev => ({
            ...prev,
            albums: new Set([...prev.albums, albumId]),
          }));
        }
        return isFavorite;
      } else if (artistId) {
        if (qobuzFavoritesCache.artists.has(artistId)) {
          return true;
        }
        const isFavorite = await lmsClient.isQobuzArtistFavorite(artistId);
        if (isFavorite) {
          setQobuzFavoritesCache(prev => ({
            ...prev,
            artists: new Set([...prev.artists, artistId]),
          }));
        }
        return isFavorite;
      }
      
      return false;
    } catch (error) {
      debugLog.error('Failed to check Qobuz favorite', error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [qobuzConnected, activeServer, qobuzFavoritesCache]);

  /**
   * Toggle Qobuz favorite (add if not favorited, remove if favorited)
   */
  const toggleQobuzFavorite = useCallback(async (trackId?: string, albumId?: string, artistId?: string): Promise<void> => {
    if (!qobuzConnected || !activeServer) {
      return;
    }

    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      
      if (trackId) {
        const isFavorite = await lmsClient.isQobuzTrackFavorite(trackId);
        if (isFavorite) {
          await lmsClient.removeQobuzTrackFavorite(trackId);
          setQobuzFavoritesCache(prev => {
            const newTracks = new Set(prev.tracks);
            newTracks.delete(trackId);
            return { ...prev, tracks: newTracks };
          });
        } else {
          await lmsClient.addQobuzTrackFavorite(trackId);
          setQobuzFavoritesCache(prev => ({
            ...prev,
            tracks: new Set([...prev.tracks, trackId]),
          }));
        }
      } else if (albumId) {
        const isFavorite = await lmsClient.isQobuzAlbumFavorite(albumId);
        if (isFavorite) {
          await lmsClient.removeQobuzAlbumFavorite(albumId);
          setQobuzFavoritesCache(prev => {
            const newAlbums = new Set(prev.albums);
            newAlbums.delete(albumId);
            return { ...prev, albums: newAlbums };
          });
        } else {
          await lmsClient.addQobuzAlbumFavorite(albumId);
          setQobuzFavoritesCache(prev => ({
            ...prev,
            albums: new Set([...prev.albums, albumId]),
          }));
        }
      } else if (artistId) {
        const isFavorite = await lmsClient.isQobuzArtistFavorite(artistId);
        if (isFavorite) {
          await lmsClient.removeQobuzArtistFavorite(artistId);
          setQobuzFavoritesCache(prev => {
            const newArtists = new Set(prev.artists);
            newArtists.delete(artistId);
            return { ...prev, artists: newArtists };
          });
        } else {
          await lmsClient.addQobuzArtistFavorite(artistId);
          setQobuzFavoritesCache(prev => ({
            ...prev,
            artists: new Set([...prev.artists, artistId]),
          }));
        }
      }
    } catch (error) {
      debugLog.error('Failed to toggle Qobuz favorite', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [qobuzConnected, activeServer]);

  const createPlaylist = useCallback((name: string): Playlist => {
    const newPlaylist: Playlist = {
      id: Date.now().toString(),
      name,
      tracks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setPlaylists((prev) => {
      const updated = [...prev, newPlaylist];
      savePlaylists(updated);
      return updated;
    });
    return newPlaylist;
  }, []);

  const deletePlaylist = useCallback((id: string) => {
    setPlaylists((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      savePlaylists(updated);
      return updated;
    });
  }, []);

  const renamePlaylist = useCallback((id: string, name: string) => {
    setPlaylists((prev) => {
      const updated = prev.map((p) =>
        p.id === id ? { ...p, name, updatedAt: Date.now() } : p
      );
      savePlaylists(updated);
      return updated;
    });
  }, []);

  const addToPlaylist = useCallback((playlistId: string, track: Track) => {
    setPlaylists((prev) => {
      const updated = prev.map((p) => {
        if (p.id !== playlistId) return p;
        if (p.tracks.find((t) => t.id === track.id)) return p;
        return {
          ...p,
          tracks: [...p.tracks, track],
          updatedAt: Date.now(),
        };
      });
      savePlaylists(updated);
      return updated;
    });
  }, []);

  const removeFromPlaylist = useCallback((playlistId: string, trackId: string) => {
    setPlaylists((prev) => {
      const updated = prev.map((p) => {
        if (p.id !== playlistId) return p;
        return {
          ...p,
          tracks: p.tracks.filter((t) => t.id !== trackId),
          updatedAt: Date.now(),
        };
      });
      savePlaylists(updated);
      return updated;
    });
  }, []);

  const reorderPlaylist = useCallback((playlistId: string, fromIndex: number, toIndex: number) => {
    setPlaylists((prev) => {
      const updated = prev.map((p) => {
        if (p.id !== playlistId) return p;
        const newTracks = [...p.tracks];
        const [removed] = newTracks.splice(fromIndex, 1);
        newTracks.splice(toIndex, 0, removed);
        return {
          ...p,
          tracks: newTracks,
          updatedAt: Date.now(),
        };
      });
      savePlaylists(updated);
      return updated;
    });
  }, []);

  return (
    <MusicContext.Provider
      value={{
        servers,
        activeServer,
        recentlyPlayed,
        recentlyPlayedItems,
        qobuzConnected,
        tidalConnected,
        isLoading,
        favorites,
        playlists,
        addServer,
        removeServer,
        toggleServerEnabled,
        setActiveServer,
        updateServerConnectionStatus,
        reconnectServer,
        connectQobuz,
        disconnectQobuz,
        getTidalAuthUrl,
        connectTidal,
        disconnectTidal,
        checkTidalStatus,
        searchMusic,
        getArtistAlbums,
        getAlbumTracks,
        refreshLibrary,
        clearAllData,
        addToRecentlyPlayed,
        addPlaylistToRecentlyPlayed,
        toggleFavoriteArtist,
        toggleFavoriteAlbum,
        toggleFavoriteTrack,
        isFavoriteArtist,
        isFavoriteAlbum,
        isFavoriteTrack,
        isQobuzFavorite,
        toggleQobuzFavorite,
        createPlaylist,
        deletePlaylist,
        renamePlaylist,
        addToPlaylist,
        removeFromPlaylist,
        reorderPlaylist,
      }}
    >
      {children}
    </MusicContext.Provider>
  );
}

export function useMusic() {
  const context = useContext(MusicContext);
  if (!context) {
    throw new Error("useMusic must be used within a MusicProvider");
  }
  return context;
}
