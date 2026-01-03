import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import type { Track } from "@/hooks/usePlayback";
import { lmsClient, LmsAlbum, LmsArtist, LmsTrack } from "@/lib/lmsClient";
import { debugLog } from "@/lib/debugLog";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "./useSettings";
import { getApiUrl } from "@/lib/query-client";

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
  source?: "local" | "soundcloud" | "spotify" | "tidal";
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

// Playlist metadata shown in the UI (Playlists screen needs url/trackCount/artwork to build mosaics).
export interface Playlist {
  id: string;
  name: string;
  url?: string;
  trackCount?: number;
  artwork_url?: string;
  // Kept for legacy/local-only playlist operations; unused for LMS playlists.
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
  source?: "all" | "local" | "tidal";
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
  getTidalAuthUrl: () => Promise<string>;
  connectTidal: (authCode: string) => Promise<boolean>;
  disconnectTidal: () => Promise<void>;
  checkTidalStatus: () => Promise<boolean>;
  searchMusic: (query: string, filters?: SearchFilters) => Promise<{ artists: Artist[]; albums: Album[]; tracks: Track[] }>;
  getArtistAlbums: (artistId: string) => Promise<Album[]>;
  getAlbumTracks: (albumId: string, source?: "local" | "tidal") => Promise<Track[]>;
  getPlaylistTracks: (playlistId: string, source?: "local" | "tidal") => Promise<any[]>;
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
  createPlaylist: (name: string) => Playlist;
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, name: string) => void;
  addToPlaylist: (playlistId: string, track: Track) => void;
  removeFromPlaylist: (playlistId: string, trackId: string) => void;
  reorderPlaylist: (playlistId: string, fromIndex: number, toIndex: number) => void;
}

const MusicContext = createContext<MusicContextType | undefined>(undefined);

const SERVERS_KEY = "@soundstream_servers";
const TIDAL_KEY = "@soundstream_tidal";
const RECENT_KEY = "@soundstream_recent";
const RECENT_ITEMS_KEY = "@soundstream_recent_items"; // New unified format
const FAVORITES_KEY = "@soundstream_favorites";
const PLAYLISTS_KEY = "@soundstream_playlists";

// Keep more history for the History screen
const MAX_RECENT_ITEMS = 50;

const DEFAULT_FAVORITES: Favorites = { artists: [], albums: [], tracks: [] };

function isArray(value: unknown): value is any[] {
  return Array.isArray(value);
}

function filterRecentlyPlayedItemsBySettings(
  items: RecentlyPlayedItem[],
  opts: { qobuzEnabled: boolean; tidalEnabled: boolean; spotifyEnabled: boolean; soundcloudEnabled: boolean }
): RecentlyPlayedItem[] {
  return items.filter((i) => {
    if (i.type === "track") {
      const src = (i.track as any)?.source as string | undefined;
      if (src === "tidal" && !opts.tidalEnabled) return false;
      if (src === "qobuz" && !opts.qobuzEnabled) return false;
      if (src === "spotify" && !opts.spotifyEnabled) return false;
      if (src === "soundcloud" && !opts.soundcloudEnabled) return false;
      return true;
    }

    // Playlist items: infer source from name (legacy naming conventions)
    const name = (i.name || "").toLowerCase();
    const isSoundCloud = name.includes("soundcloud:") || name.startsWith("soundcloud");
    const isSpotify = name.includes("spotify:") || name.startsWith("spotify");
    const isTidal = name.includes("tidal:") || name.startsWith("tidal");

    if (isSoundCloud && !opts.soundcloudEnabled) return false;
    if (isSpotify && !opts.spotifyEnabled) return false;
    if (isTidal && !opts.tidalEnabled) return false;
    return true;
  });
}

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

const convertLmsAlbumToAlbum = (lmsAlbum: LmsAlbum, source: "local" | "spotify" | "tidal" | "soundcloud" = "local"): Album => ({
  id: lmsAlbum.id,
  name: lmsAlbum.title,
  artist: lmsAlbum.artist,
  artistId: lmsAlbum.artistId || '',
  imageUrl: lmsClient.getArtworkUrl(lmsAlbum),
  year: lmsAlbum.year,
  trackCount: lmsAlbum.trackCount,
  source,
});

const convertLmsTrackToTrack = (lmsTrack: LmsTrack, serverId: string): Track => {
  const url = (lmsTrack.url || '').toLowerCase();
  const id = (lmsTrack.id || '').toLowerCase();
  
  let source: "local" | "qobuz" | "tidal" = 'local';
  if (url.includes('tidal') || id.includes('tidal')) source = 'tidal';
  else if (url.includes('qobuz') || id.includes('qobuz')) source = 'qobuz';

  return {
    id: `${serverId}-${lmsTrack.id}`,
    title: lmsTrack.title,
    artist: lmsTrack.artist,
    album: lmsTrack.album,
    albumId: lmsTrack.albumId,
    albumArt: lmsTrack.artwork_url ? lmsClient.getArtworkUrl(lmsTrack as LmsAlbum) : undefined,
    duration: lmsTrack.duration,
    source,
    uri: lmsTrack.url,
    format: lmsTrack.format,
    bitrate: lmsTrack.bitrate,
    sampleRate: lmsTrack.sampleRate,
    bitDepth: lmsTrack.bitDepth,
    lmsTrackId: lmsTrack.id,
  };
};

export function MusicProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { qobuzEnabled, spotifyEnabled, tidalEnabled, soundcloudEnabled } = useSettings();
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServer, setActiveServerState] = useState<Server | null>(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>([]);
  const [recentlyPlayedItems, setRecentlyPlayedItems] = useState<RecentlyPlayedItem[]>([]);
  const [tidalConnected, setTidalConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [favorites, setFavorites] = useState<Favorites>(DEFAULT_FAVORITES);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  
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
      const [serversData, tidalData, recentData, recentItemsData, favoritesData, playlistsData] = await Promise.all([
        AsyncStorage.getItem(SERVERS_KEY),
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

      if (tidalData) {
        const tidalInfo = JSON.parse(tidalData);
        // Don't set connected state from AsyncStorage - let checkTidalStatus() verify with server
        // setTidalConnected(tidalInfo.connected);

        // Send tokens to server only when the user is actually connected.
        // Otherwise (e.g. after explicit disconnect), avoid re-seeding server tokens.
        if (tidalInfo.connected && tidalInfo.accessToken && tidalInfo.refreshToken) {
          const v = tidalTokenVersionRef.current;
          fetch(`${getApiUrl()}/api/tidal/set-tokens`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              accessToken: tidalInfo.accessToken,
              refreshToken: tidalInfo.refreshToken,
              userId: tidalInfo.userId
            }),
          }).then(() => {
            // Check status after setting tokens (unless a disconnect happened meanwhile)
            if (v === tidalTokenVersionRef.current) checkTidalStatus();
          }).catch(error => {
            console.warn('Failed to send Tidal tokens to server:', error);
            // If sending tokens fails, ensure we check status anyway (unless a disconnect happened meanwhile)
            if (v === tidalTokenVersionRef.current) checkTidalStatus();
          });
        } else {
          // No tokens in AsyncStorage, check server status anyway
          checkTidalStatus();
        }
      } else {
        // No Tidal data in AsyncStorage, check server status
        checkTidalStatus();
      }

      // Load persisted "recently played" (and migrate legacy format if needed).
      // NOTE: Previously this code intentionally cleared RECENT_* on startup, which caused history to be lost
      // on every web refresh. We now load + filter + re-save instead.
      try {
        let loadedItems: RecentlyPlayedItem[] = [];

        if (recentItemsData) {
          const parsed = JSON.parse(recentItemsData);
          if (isArray(parsed)) loadedItems = parsed as RecentlyPlayedItem[];
        } else if (recentData) {
          const parsed = JSON.parse(recentData);
          if (isArray(parsed)) {
            const tracks = parsed as Track[];
            loadedItems = tracks.map((t) => ({
              type: "track",
              id: t.id,
              name: t.title,
              artwork: t.albumArt,
              track: t,
            }));
            // Migrate forward to the unified key; keep the legacy key for now.
            await AsyncStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(loadedItems.slice(0, MAX_RECENT_ITEMS)));
          }
        }

        // Apply source toggles so disabled services don't appear.
        const filtered = filterRecentlyPlayedItemsBySettings(loadedItems, {
          qobuzEnabled,
          tidalEnabled,
          spotifyEnabled,
          soundcloudEnabled,
        }).slice(0, MAX_RECENT_ITEMS);

        setRecentlyPlayedItems(filtered);
        const tracks = filtered
          .filter((i) => i.type === "track" && i.track)
          .map((i) => i.track as Track)
          .slice(0, MAX_RECENT_ITEMS);
        setRecentlyPlayed(tracks);

        // Persist the filtered list so old/disabled content doesn't keep returning.
        await AsyncStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(filtered));
        await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(tracks));
      } catch (e) {
        console.warn("Failed to load recently played from storage:", e);
      }

      if (favoritesData) {
        setFavorites(JSON.parse(favoritesData));
      }

      if (playlistsData) {
        const loadedPlaylists = JSON.parse(playlistsData);
        
        // Filter out SoundCloud, Spotify, and Tidal playlists if disabled
        let soundcloudEnabled = true;
        let spotifyEnabled = true;
        let tidalEnabled = true;
        try {
          const settings = await AsyncStorage.getItem("@soundstream_settings");
          if (settings) {
            const parsed = JSON.parse(settings);
            soundcloudEnabled = parsed.soundcloudEnabled !== false;
            spotifyEnabled = parsed.spotifyEnabled !== false;
            tidalEnabled = parsed.tidalEnabled !== false;
          }
        } catch (e) {
          // Use defaults if settings can't be loaded
        }
        
        const filteredPlaylists = loadedPlaylists.filter((playlist: Playlist) => {
          const name = playlist.name.toLowerCase();
          const isSoundCloud = name.includes('soundcloud:') || name.startsWith('soundcloud');
          const isSpotify = name.includes('spotify:') || name.startsWith('spotify');
          const isTidal = name.includes('tidal:') || name.startsWith('tidal');
          
          if (isSoundCloud && !soundcloudEnabled) return false;
          if (isSpotify && !spotifyEnabled) return false;
          if (isTidal && !tidalEnabled) return false;
          return true;
        });
        
        setPlaylists(filteredPlaylists);
      }
      setDataLoaded(true);
      
      // Tidal status is checked above in the tidalData handling block
      // No need to check again here
    } catch (e) {
      console.error("Failed to load music data:", e);
      setDataLoaded(true);
      // Still check Tidal status even if other data loading fails
      checkTidalStatus();
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


  // Store latest OAuth state/redirectUri so connectTidal() can pass state for PKCE session lookup.
  const tidalAuthStateRef = useRef<string | null>(null);
  const tidalRedirectUriRef = useRef<string | null>(null);
  // Guards against in-flight token rehydration/status checks re-connecting after an explicit disconnect.
  const tidalTokenVersionRef = useRef(0);

  const getTidalAuthUrl = useCallback(async (): Promise<string> => {
    try {
      // Detect platform for appropriate redirect URI
      const platform = Platform.OS === 'web' ? 'web' : 'mobile';
      const appRedirectUri = platform === "mobile" ? Linking.createURL("callback") : "";
      const qs = new URLSearchParams({
        platform,
        // Request a "hybrid" scope set: modern Developer Platform scopes + legacy r_usr
        // so we can fetch fast, accurate library totals (albums/artists/tracks/playlists).
        preset: "hybrid",
        ...(platform === "mobile" ? { appRedirectUri } : {}),
      });
      const response = await fetch(`${getApiUrl()}/api/tidal/auth-url?${qs.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to get Tidal auth URL');
      }
      const data = await response.json();
      tidalAuthStateRef.current = typeof data.state === 'string' ? data.state : null;
      tidalRedirectUriRef.current = typeof data.redirectUri === 'string' ? data.redirectUri : null;
      return data.authUrl;
    } catch (error) {
      console.error('Failed to get Tidal auth URL:', error);
      throw error;
    }
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

  const connectTidal = useCallback(async (authCode: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      const response = await fetch(`${getApiUrl()}/api/tidal/authenticate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: authCode, state: tidalAuthStateRef.current }),
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

        // Also send tokens to server for API calls
        await fetch(`${getApiUrl()}/api/tidal/set-tokens`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            accessToken: data.tokens.accessToken,
            refreshToken: data.tokens.refreshToken,
            userId: data.tokens.userId
          }),
        });

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
    try {
      setIsLoading(true);
      // Invalidate any in-flight token rehydration/status checks before we clear server tokens.
      tidalTokenVersionRef.current += 1;
      const response = await fetch(`${getApiUrl()}/api/tidal/disconnect`, {
        method: 'POST',
      });

      if (!response.ok) {
        console.error('Failed to disconnect Tidal on server');
      }
    } catch (error) {
      console.error('Failed to disconnect Tidal:', error);
    } finally {
      setTidalConnected(false);
      await AsyncStorage.setItem(TIDAL_KEY, JSON.stringify({ connected: false }));
      setIsLoading(false);
    }
  }, []);

  const searchMusic = useCallback(async (query: string, filters?: SearchFilters) => {
    if (!activeServer) {
      debugLog.info('No active server for search', 'Returning empty results');
      return { artists: [], albums: [], tracks: [] };
    }
    
    // Get integration settings from AsyncStorage (we can't use useSettings hook here)
    let soundcloudEnabled = true;
    let spotifyEnabled = true;
    let tidalEnabled = true;
    try {
      const settings = await AsyncStorage.getItem("@soundstream_settings");
      if (settings) {
        const parsed = JSON.parse(settings);
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

      const normalize = (s: string) =>
        (s || "")
          .toLowerCase()
          .replace(/[()\[\]{}'"?.,!;:]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      const cleanQuery = normalize(query);

      const scoreText = (text: string): number => {
        const t = normalize(text);
        if (!cleanQuery) return 0;
        if (t === cleanQuery) return 300;
        if (t.startsWith(cleanQuery)) return 200;
        if (t.includes(cleanQuery)) return 120;
        const qw = cleanQuery.split(" ").filter(Boolean);
        const matched = qw.filter((w) => t.includes(w)).length;
        return matched * 20;
      };
      
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
                const isSoundCloud = url.includes('soundcloud') || id.includes('soundcloud');
                const isSpotify = url.includes('spotify') || id.includes('spotify');
                const isTidal = url.includes('tidal') || id.includes('tidal');
                const source = isSoundCloud ? 'soundcloud' : (isSpotify ? 'spotify' : (isTidal ? 'tidal' : 'local'));
                return { ...convertLmsTrackToTrack(t, activeServer.id), source };
              })
              .filter(t => {
                if (t.source === 'soundcloud' && !soundcloudEnabled) return false;
                if (t.source === 'spotify' && !spotifyEnabled) return false;
                if (t.source === 'tidal' && !tidalEnabled) return false;
                return true;
              });
            
            const albumsWithSource = result.albums
              .map(album => {
                const url = album.artwork_url || '';
                const id = album.id || '';
                const isSoundCloud = url.includes('soundcloud') || id.includes('soundcloud');
                const isSpotify = url.includes('spotify') || id.includes('spotify');
                const isTidal = url.includes('tidal') || id.includes('tidal');
                const source = isSoundCloud ? 'soundcloud' : (isSpotify ? 'spotify' : (isTidal ? 'tidal' : 'local'));
                return convertLmsAlbumToAlbum(album, source);
              })
              .filter(album => {
                if (album.source === 'soundcloud' && !soundcloudEnabled) return false;
                if (album.source === 'spotify' && !spotifyEnabled) return false;
                if (album.source === 'tidal' && !tidalEnabled) return false;
                return true;
              });
            
            const artistsRanked = result.artists
              .map(convertLmsArtistToArtist)
              .filter((a) => a.name && a.name !== "Unknown Artist")
              .sort((a, b) => scoreText(b.name) - scoreText(a.name) || a.name.localeCompare(b.name));

            const albumsRanked = albumsWithSource
              .filter((a) => a.name && a.name !== "Unknown Album")
              .sort((a, b) => {
                const sa = scoreText(a.name) + scoreText(a.artist) * 0.5;
                const sb = scoreText(b.name) + scoreText(b.artist) * 0.5;
                return sb - sa || a.name.localeCompare(b.name);
              });

            return {
              artists: (typeFilter === "all" || typeFilter === "artists") ? artistsRanked : [],
              albums: (typeFilter === "all" || typeFilter === "albums") ? albumsRanked : [],
              tracks: (typeFilter === "all" || typeFilter === "tracks") ? tracksWithSource : [],
            };
          } else {
            debugLog.info('Global search returned no results, falling back to separate searches');
            // Fall through to separate searches
          }
        } catch (e) {
          debugLog.info('Global search failed, falling back to separate searches', e instanceof Error ? e.message : String(e));
          // Fall through to separate searches for both local
        }
      }
      
      let localResult = { artists: [] as any[], albums: [] as any[], tracks: [] as any[] };
      
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
      
      const mergedArtists = [...localResult.artists];
      const mergedAlbums = [...localResult.albums];
      const mergedTracks = [...localResult.tracks];
      
      const uniqueArtists = mergedArtists.filter((a, i, arr) => 
        arr.findIndex(x => x.id === a.id || x.name === a.name) === i
      );
      const uniqueAlbums = mergedAlbums.filter((a, i, arr) => 
        arr.findIndex(x => x.id === a.id || (x.name === a.name && x.artist === a.artist)) === i
      );

      // Rank artists/albums to avoid "strange" ordering from LMS search endpoints.
      uniqueArtists.sort((a, b) => scoreText(b.name) - scoreText(a.name) || a.name.localeCompare(b.name));
      uniqueAlbums.sort((a, b) => {
        const sa = scoreText(a.name) + scoreText(a.artist) * 0.5;
        const sb = scoreText(b.name) + scoreText(b.artist) * 0.5;
        return sb - sa || a.name.localeCompare(b.name);
      });
      
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

  const getAlbumTracks = useCallback(async (albumId: string, source: "local" | "tidal" = "local"): Promise<Track[]> => {
    if (!activeServer) {
      return [];
    }
    
    try {
      const inferredSource: "local" | "tidal" = source || (albumId.startsWith("tidal-") ? "tidal" : "local");

      if (inferredSource === "tidal" || albumId.startsWith("tidal-")) {
        const tidalAlbumId = albumId
          .replace(/^tidal-/, "")
          .replace(/^album-/, "");
        const apiUrl = getApiUrl();
        const cleanApiUrl = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
        const response = await fetch(`${cleanApiUrl}/api/tidal/albums/${encodeURIComponent(tidalAlbumId)}/tracks`);
        if (!response.ok) {
          debugLog.info("Failed to fetch Tidal album tracks", `HTTP ${response.status}`);
          return [];
        }
        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        return items.map((t: any) => ({
          // Server may already return `tidal-track-*` IDs; keep stable.
          id: typeof t.id === "string" && t.id.startsWith("tidal-track-") ? t.id : `tidal-track-${t.id}`,
          title: t.title,
          artist: t.artist,
          album: t.album,
          albumId: t.albumId
            ? `tidal-${String(t.albumId).replace(/^album-/, "").replace(/^tidal-/, "")}`
            : `tidal-${tidalAlbumId}`,
          duration: typeof t.duration === "number" ? t.duration : 0,
          albumArt: t.albumArt || t.artwork_url || undefined,
          source: "tidal" as const,
          // LMS TIDAL plugin expects `tidal://<id>` (NOT `tidal://track:<id>`)
          uri: t.lmsUri || t.uri || `tidal://${String(t.id).replace(/^tidal-track-/, "")}`,
          lmsTrackId: String(t.id).replace(/^tidal-track-/, ""),
        }));
      }

      const lmsTracks = await lmsClient.getAlbumTracks(albumId, source as any);
      return lmsTracks.map(t => convertLmsTrackToTrack(t, activeServer.id));
    } catch (error) {
      debugLog.error('Failed to get album tracks', error instanceof Error ? error.message : String(error));
      return [];
    }
  }, [activeServer]);

  const getPlaylistTracks = useCallback(async (playlistId: string, source: "local" | "tidal" = "local"): Promise<any[]> => {
    if (!activeServer) return [];
    try {
      const inferredSource: "local" | "tidal" = source || (playlistId.startsWith("tidal-") ? "tidal" : "local");
      if (inferredSource === "tidal" || playlistId.startsWith("tidal-")) {
        const tidalPlaylistId = playlistId
          .replace(/^tidal-/, "")
          .replace(/^playlist-/, "");
        const apiUrl = getApiUrl();
        const cleanApiUrl = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
        const response = await fetch(`${cleanApiUrl}/api/tidal/playlists/${encodeURIComponent(tidalPlaylistId)}/tracks`);
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data?.items) ? data.items : [];
      }
      // fallback to LMS
      lmsClient.setServer(activeServer.host, activeServer.port);
      // If we have playlist metadata, pass url/name so plugins (e.g. SoundCloud) can resolve properly.
      const meta = playlists.find((p) => p.id === playlistId);
      return await lmsClient.getPlaylistTracks(playlistId, meta?.url, meta?.name);
    } catch (e) {
      return [];
    }
  }, [activeServer, playlists]);

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

      // Filter out SoundCloud, Spotify, and Tidal playlists if disabled
      let soundcloudEnabled = true;
      let spotifyEnabled = true;
      let tidalEnabled = true;
      try {
        const settings = await AsyncStorage.getItem("@soundstream_settings");
        if (settings) {
          const parsed = JSON.parse(settings);
          soundcloudEnabled = parsed.soundcloudEnabled !== false;
          spotifyEnabled = parsed.spotifyEnabled !== false;
          tidalEnabled = parsed.tidalEnabled !== false;
        }
      } catch (e) {
        // Use defaults if settings can't be loaded
      }

      const lmsPlaylists = await lmsClient.getPlaylists(false, soundcloudEnabled, spotifyEnabled, false); // Don't include Tidal from LMS

      // Add Tidal playlists if enabled
      let tidalPlaylists: any[] = [];
      if (tidalEnabled) {
        try {
          const apiUrl = getApiUrl();
          const cleanApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
          const tidalResponse = await fetch(`${cleanApiUrl}/api/tidal/playlists?limit=50&offset=0`);
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
          const isSoundCloud = name.includes('soundcloud:') || name.startsWith('soundcloud') || url.includes('soundcloud');
          const isSpotify = name.includes('spotify:') || name.startsWith('spotify') || url.includes('spotify');
          const isTidal = name.includes('tidal:') || name.startsWith('tidal') || url.includes('tidal') || playlist.id.startsWith('tidal-');

          if (isSoundCloud && !soundcloudEnabled) return false;
          if (isSpotify && !spotifyEnabled) return false;
          if (isTidal && !tidalEnabled) return false;
          return true;
        });
      
      // Convert to internal playlist format while retaining useful metadata (url, artwork, trackCount).
      const playlistData: Playlist[] = filteredPlaylists.map((p: any) => ({
        id: String(p.id),
        name: String(p.name),
        url: p.url ? String(p.url) : undefined,
        trackCount: p.trackCount !== undefined ? Number(p.trackCount) : p.tracks !== undefined ? Number(p.tracks) : undefined,
        artwork_url: (p.artwork_url || p.artwork) ? String(p.artwork_url || p.artwork) : undefined,
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
    debugLog.info('Integration settings changed, refreshing library', JSON.stringify({ spotifyEnabled, tidalEnabled, soundcloudEnabled }));
    queryClient.invalidateQueries({ queryKey: ['albums'] });
    queryClient.invalidateQueries({ queryKey: ['artists'] });
    queryClient.invalidateQueries({ queryKey: ['tracks'] });
    queryClient.invalidateQueries({ queryKey: ['playlists'] });
    refreshLibrary();
  }, [spotifyEnabled, tidalEnabled, soundcloudEnabled, activeServer, dataLoaded, queryClient, refreshLibrary]);

  const clearAllData = useCallback(async () => {
    try {
      await Promise.all([
        AsyncStorage.removeItem(SERVERS_KEY),
        AsyncStorage.removeItem(TIDAL_KEY),
        AsyncStorage.removeItem(RECENT_KEY),
        AsyncStorage.removeItem(RECENT_ITEMS_KEY),
        AsyncStorage.removeItem(FAVORITES_KEY),
        AsyncStorage.removeItem(PLAYLISTS_KEY),
      ]);
      setServers([]);
      setActiveServerState(null);
      setRecentlyPlayed([]);
      setRecentlyPlayedItems([]);
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
      const updated = [track, ...filtered].slice(0, MAX_RECENT_ITEMS);
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
      const updated = [item, ...filtered].slice(0, MAX_RECENT_ITEMS);
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
      const updated = [item, ...filtered].slice(0, MAX_RECENT_ITEMS);
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
        tidalConnected,
        isLoading,
        favorites,
        playlists,
        tidalEnabled,
        soundcloudEnabled,
        spotifyEnabled,
        addServer,
        removeServer,
        toggleServerEnabled,
        setActiveServer,
        updateServerConnectionStatus,
        reconnectServer,
        getTidalAuthUrl,
        connectTidal,
        disconnectTidal,
        checkTidalStatus,
        searchMusic,
        getArtistAlbums,
        getAlbumTracks,
        getPlaylistTracks,
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
