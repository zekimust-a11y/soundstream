import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Track } from "@/hooks/usePlayback";
import { lmsClient, LmsAlbum, LmsArtist, LmsTrack } from "@/lib/lmsClient";
import { debugLog } from "@/lib/debugLog";

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
}

export interface Server {
  id: string;
  name: string;
  type: "lms";
  host: string;
  port: number;
  connected: boolean;
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

interface MusicContextType {
  servers: Server[];
  activeServer: Server | null;
  artists: Artist[];
  albums: Album[];
  recentlyPlayed: Track[];
  qobuzConnected: boolean;
  isLoading: boolean;
  favorites: Favorites;
  playlists: Playlist[];
  addServer: (server: Omit<Server, "id" | "connected">) => void;
  removeServer: (id: string) => void;
  setActiveServer: (server: Server | null) => void;
  connectQobuz: (email: string, password: string) => Promise<boolean>;
  disconnectQobuz: () => void;
  searchMusic: (query: string, filters?: SearchFilters) => Promise<{ artists: Artist[]; albums: Album[]; tracks: Track[] }>;
  getArtistAlbums: (artistId: string) => Promise<Album[]>;
  getAlbumTracks: (albumId: string) => Promise<Track[]>;
  refreshLibrary: () => Promise<void>;
  clearAllData: () => Promise<void>;
  addToRecentlyPlayed: (track: Track) => void;
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
const QOBUZ_KEY = "@soundstream_qobuz";
const RECENT_KEY = "@soundstream_recent";
const FAVORITES_KEY = "@soundstream_favorites";
const PLAYLISTS_KEY = "@soundstream_playlists";
const LIBRARY_KEY = "@soundstream_library";

const DEFAULT_FAVORITES: Favorites = { artists: [], albums: [], tracks: [] };

const convertLmsArtistToArtist = (lmsArtist: LmsArtist): Artist => ({
  id: lmsArtist.id,
  name: lmsArtist.name,
  albumCount: lmsArtist.albumCount,
});

const convertLmsAlbumToAlbum = (lmsAlbum: LmsAlbum): Album => ({
  id: lmsAlbum.id,
  name: lmsAlbum.title,
  artist: lmsAlbum.artist,
  artistId: lmsAlbum.artistId || '',
  imageUrl: lmsClient.getArtworkUrl(lmsAlbum),
  year: lmsAlbum.year,
  trackCount: lmsAlbum.trackCount,
});

const convertLmsTrackToTrack = (lmsTrack: LmsTrack, serverId: string): Track => ({
  id: `${serverId}-${lmsTrack.id}`,
  title: lmsTrack.title,
  artist: lmsTrack.artist,
  album: lmsTrack.album,
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
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServer, setActiveServerState] = useState<Server | null>(null);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>([]);
  const [qobuzConnected, setQobuzConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [favorites, setFavorites] = useState<Favorites>(DEFAULT_FAVORITES);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [serversData, qobuzData, recentData, favoritesData, playlistsData, libraryData] = await Promise.all([
        AsyncStorage.getItem(SERVERS_KEY),
        AsyncStorage.getItem(QOBUZ_KEY),
        AsyncStorage.getItem(RECENT_KEY),
        AsyncStorage.getItem(FAVORITES_KEY),
        AsyncStorage.getItem(PLAYLISTS_KEY),
        AsyncStorage.getItem(LIBRARY_KEY),
      ]);

      if (serversData) {
        const parsed = JSON.parse(serversData);
        const loadedServers = (parsed.servers || []) as Server[];
        setServers(loadedServers);
        
        if (parsed.activeServerId) {
          const active = loadedServers.find((s: Server) => s.id === parsed.activeServerId);
          if (active) {
            setActiveServerState(active);
            lmsClient.setServer(active.host, active.port);
          }
        }
      }

      if (qobuzData) {
        setQobuzConnected(JSON.parse(qobuzData).connected);
      }

      if (recentData) {
        setRecentlyPlayed(JSON.parse(recentData));
      }

      if (favoritesData) {
        setFavorites(JSON.parse(favoritesData));
      }

      if (playlistsData) {
        setPlaylists(JSON.parse(playlistsData));
      }

      if (libraryData) {
        const library = JSON.parse(libraryData);
        const uniqueArtists = (library.artists || []).filter((a: Artist, i: number, arr: Artist[]) => 
          arr.findIndex((x: Artist) => x.id === a.id) === i
        );
        const uniqueAlbums = (library.albums || []).filter((a: Album, i: number, arr: Album[]) => 
          arr.findIndex((x: Album) => x.id === a.id) === i
        );
        const uniqueTracks = (library.tracks || []).filter((t: Track, i: number, arr: Track[]) => 
          arr.findIndex((x: Track) => x.id === t.id) === i
        );
        setArtists(uniqueArtists);
        setAlbums(uniqueAlbums);
        setTracks(uniqueTracks);
      }
    } catch (e) {
      console.error("Failed to load music data:", e);
    }
  };

  const saveServers = async (newServers: Server[], activeId?: string) => {
    try {
      await AsyncStorage.setItem(
        SERVERS_KEY,
        JSON.stringify({ servers: newServers, activeServerId: activeId })
      );
    } catch (e) {
      console.error("Failed to save servers:", e);
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

  const saveLibrary = async (newArtists: Artist[], newAlbums: Album[], newTracks: Track[]) => {
    try {
      await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify({
        artists: newArtists,
        albums: newAlbums,
        tracks: newTracks,
      }));
    } catch (e) {
      console.error("Failed to save library:", e);
    }
  };

  const fetchLmsLibrary = async (server: Server): Promise<{ artists: Artist[], albums: Album[], tracks: Track[] }> => {
    debugLog.info('Fetching LMS library', `${server.host}:${server.port}`);
    
    lmsClient.setServer(server.host, server.port);
    
    try {
      const [lmsArtists, lmsAlbums] = await Promise.all([
        lmsClient.getArtists(),
        lmsClient.getAlbums(),
      ]);
      
      const convertedArtists = lmsArtists.map(convertLmsArtistToArtist);
      const convertedAlbums = lmsAlbums.map(convertLmsAlbumToAlbum);
      
      debugLog.info('LMS library loaded', `${convertedArtists.length} artists, ${convertedAlbums.length} albums`);
      
      return {
        artists: convertedArtists,
        albums: convertedAlbums,
        tracks: [],
      };
    } catch (error) {
      debugLog.error('Failed to fetch LMS library', error instanceof Error ? error.message : String(error));
      return { artists: [], albums: [], tracks: [] };
    }
  };

  useEffect(() => {
    if (artists.length > 0 || albums.length > 0 || tracks.length > 0) {
      saveLibrary(artists, albums, tracks);
    }
  }, [artists, albums, tracks]);

  const addServer = useCallback((server: Omit<Server, "id" | "connected">) => {
    const newServer: Server = {
      ...server,
      id: `lms-${server.host}:${server.port}`,
      connected: true,
    };
    setServers((prev) => {
      const updated = prev.filter(s => s.id !== newServer.id);
      updated.push(newServer);
      saveServers(updated, newServer.id);
      return updated;
    });
    setActiveServerState(newServer);
    lmsClient.setServer(newServer.host, newServer.port);
  }, []);

  const removeServer = useCallback((id: string) => {
    setServers((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      saveServers(updated, activeServer?.id === id ? undefined : activeServer?.id);
      return updated;
    });
    if (activeServer?.id === id) {
      setActiveServerState(null);
    }
  }, [activeServer]);

  const setActiveServer = useCallback((server: Server | null) => {
    setActiveServerState(server);
    if (server) {
      lmsClient.setServer(server.host, server.port);
    }
    saveServers(servers, server?.id);
  }, [servers]);

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

  const searchMusic = useCallback(async (query: string, filters?: SearchFilters) => {
    if (!activeServer) {
      return { artists: [], albums: [], tracks: [] };
    }
    
    try {
      const result = await lmsClient.search(query);
      
      const convertedArtists = result.artists.map(convertLmsArtistToArtist);
      const convertedAlbums = result.albums.map(convertLmsAlbumToAlbum);
      const convertedTracks = result.tracks.map(t => convertLmsTrackToTrack(t, activeServer.id));
      
      const typeFilter = filters?.type || "all";
      
      return {
        artists: (typeFilter === "all" || typeFilter === "artists") ? convertedArtists : [],
        albums: (typeFilter === "all" || typeFilter === "albums") ? convertedAlbums : [],
        tracks: (typeFilter === "all" || typeFilter === "tracks") ? convertedTracks : [],
      };
    } catch (error) {
      debugLog.error('Search failed', error instanceof Error ? error.message : String(error));
      return { artists: [], albums: [], tracks: [] };
    }
  }, [activeServer]);

  const getArtistAlbums = useCallback(async (artistId: string): Promise<Album[]> => {
    try {
      const lmsAlbums = await lmsClient.getAlbums(artistId);
      return lmsAlbums.map(convertLmsAlbumToAlbum);
    } catch (error) {
      debugLog.error('Failed to get artist albums', error instanceof Error ? error.message : String(error));
      return albums.filter((a) => a.artistId === artistId);
    }
  }, [albums]);

  const getAlbumTracks = useCallback(async (albumId: string): Promise<Track[]> => {
    if (!activeServer) {
      return [];
    }
    
    try {
      const lmsTracks = await lmsClient.getAlbumTracks(albumId);
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
    
    setIsLoading(true);
    
    try {
      const library = await fetchLmsLibrary(activeServer);
      
      setArtists(library.artists);
      setAlbums(library.albums);
      setTracks(library.tracks);
    } catch (error) {
      debugLog.error('Failed to refresh library', error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeServer]);

  const clearAllData = useCallback(async () => {
    try {
      await Promise.all([
        AsyncStorage.removeItem(SERVERS_KEY),
        AsyncStorage.removeItem(QOBUZ_KEY),
        AsyncStorage.removeItem(RECENT_KEY),
        AsyncStorage.removeItem(FAVORITES_KEY),
        AsyncStorage.removeItem(PLAYLISTS_KEY),
        AsyncStorage.removeItem(LIBRARY_KEY),
      ]);
      setServers([]);
      setActiveServerState(null);
      setArtists([]);
      setAlbums([]);
      setTracks([]);
      setRecentlyPlayed([]);
      setQobuzConnected(false);
      setFavorites(DEFAULT_FAVORITES);
      setPlaylists([]);
    } catch (e) {
      console.error("Failed to clear all data:", e);
    }
  }, []);

  const addToRecentlyPlayed = useCallback(async (track: Track) => {
    setRecentlyPlayed((prev) => {
      const filtered = prev.filter((t) => t.id !== track.id);
      const updated = [track, ...filtered].slice(0, 20);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
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
        artists,
        albums,
        recentlyPlayed,
        qobuzConnected,
        isLoading,
        favorites,
        playlists,
        addServer,
        removeServer,
        setActiveServer,
        connectQobuz,
        disconnectQobuz,
        searchMusic,
        getArtistAlbums,
        getAlbumTracks,
        refreshLibrary,
        clearAllData,
        addToRecentlyPlayed,
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
