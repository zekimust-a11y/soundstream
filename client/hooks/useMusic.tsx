import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Track } from "@/hooks/usePlayback";

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
  type: "upnp" | "lms";
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
  getArtistAlbums: (artistId: string) => Album[];
  getAlbumTracks: (albumId: string) => Track[];
  refreshLibrary: () => void;
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

interface ServerMusicLibrary {
  serverId: string;
  serverName: string;
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
}

const generateServerMusic = (server: Server): ServerMusicLibrary => {
  const serverId = server.id;
  const prefix = serverId.slice(-4);
  
  const serverMusicData: Record<string, { artists: Array<{name: string, albums: Array<{name: string, year: number, tracks: string[]}>}> }> = {
    lms: {
      artists: [
        {
          name: "Pink Floyd",
          albums: [
            { name: "The Dark Side of the Moon", year: 1973, tracks: ["Speak to Me", "Breathe", "Time", "Money", "Us and Them"] },
            { name: "Wish You Were Here", year: 1975, tracks: ["Shine On You Crazy Diamond", "Welcome to the Machine", "Have a Cigar", "Wish You Were Here"] },
          ]
        },
        {
          name: "Led Zeppelin",
          albums: [
            { name: "Led Zeppelin IV", year: 1971, tracks: ["Black Dog", "Rock and Roll", "Stairway to Heaven", "Going to California"] },
            { name: "Physical Graffiti", year: 1975, tracks: ["Custard Pie", "Kashmir", "Trampled Under Foot", "Ten Years Gone"] },
          ]
        },
        {
          name: "The Beatles",
          albums: [
            { name: "Abbey Road", year: 1969, tracks: ["Come Together", "Something", "Here Comes the Sun", "Golden Slumbers"] },
            { name: "Sgt. Pepper's Lonely Hearts Club Band", year: 1967, tracks: ["Lucy in the Sky with Diamonds", "A Day in the Life", "With a Little Help from My Friends"] },
          ]
        },
      ]
    },
    upnp: {
      artists: [
        {
          name: "Miles Davis",
          albums: [
            { name: "Kind of Blue", year: 1959, tracks: ["So What", "Freddie Freeloader", "Blue in Green", "All Blues", "Flamenco Sketches"] },
            { name: "Bitches Brew", year: 1970, tracks: ["Pharaoh's Dance", "Bitches Brew", "Spanish Key", "Miles Runs the Voodoo Down"] },
          ]
        },
        {
          name: "John Coltrane",
          albums: [
            { name: "A Love Supreme", year: 1965, tracks: ["Acknowledgement", "Resolution", "Pursuance", "Psalm"] },
            { name: "Giant Steps", year: 1960, tracks: ["Giant Steps", "Cousin Mary", "Countdown", "Naima"] },
          ]
        },
        {
          name: "Herbie Hancock",
          albums: [
            { name: "Head Hunters", year: 1973, tracks: ["Chameleon", "Watermelon Man", "Sly", "Vein Melter"] },
            { name: "Maiden Voyage", year: 1965, tracks: ["Maiden Voyage", "The Eye of the Hurricane", "Little One", "Survival of the Fittest"] },
          ]
        },
      ]
    }
  };

  const musicData = serverMusicData[server.type] || serverMusicData.upnp;
  const artists: Artist[] = [];
  const albums: Album[] = [];
  const tracks: Track[] = [];

  musicData.artists.forEach((artistData, artistIndex) => {
    const artistId = `${prefix}-artist-${artistIndex}`;
    artists.push({
      id: artistId,
      name: artistData.name,
      albumCount: artistData.albums.length,
    });

    artistData.albums.forEach((albumData, albumIndex) => {
      const albumId = `${prefix}-album-${artistIndex}-${albumIndex}`;
      albums.push({
        id: albumId,
        name: albumData.name,
        artist: artistData.name,
        artistId: artistId,
        year: albumData.year,
        trackCount: albumData.tracks.length,
      });

      albumData.tracks.forEach((trackTitle, trackIndex) => {
        tracks.push({
          id: `${prefix}-track-${artistIndex}-${albumIndex}-${trackIndex}`,
          title: trackTitle,
          artist: artistData.name,
          album: albumData.name,
          duration: 180 + Math.floor(Math.random() * 300),
          source: "local" as const,
        });
      });
    });
  });

  return {
    serverId: server.id,
    serverName: server.name,
    artists,
    albums,
    tracks,
  };
};

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
        setServers(parsed.servers || []);
        if (parsed.activeServerId) {
          const active = parsed.servers?.find((s: Server) => s.id === parsed.activeServerId);
          setActiveServerState(active || null);
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
        setArtists(library.artists || []);
        setAlbums(library.albums || []);
        setTracks(library.tracks || []);
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

  const loadMusicFromServer = useCallback(async (server: Server) => {
    setIsLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    const library = generateServerMusic(server);
    
    setArtists((prev) => {
      const existingIds = new Set(prev.map(a => a.id));
      const newArtists = library.artists.filter(a => !existingIds.has(a.id));
      const updated = [...prev, ...newArtists];
      return updated;
    });
    
    setAlbums((prev) => {
      const existingIds = new Set(prev.map(a => a.id));
      const newAlbums = library.albums.filter(a => !existingIds.has(a.id));
      const updated = [...prev, ...newAlbums];
      return updated;
    });
    
    setTracks((prev) => {
      const existingIds = new Set(prev.map(t => t.id));
      const newTracks = library.tracks.filter(t => !existingIds.has(t.id));
      const updated = [...prev, ...newTracks];
      return updated;
    });

    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (artists.length > 0 || albums.length > 0 || tracks.length > 0) {
      saveLibrary(artists, albums, tracks);
    }
  }, [artists, albums, tracks]);

  const addServer = useCallback((server: Omit<Server, "id" | "connected">) => {
    const newServer: Server = {
      ...server,
      id: Date.now().toString(),
      connected: true,
    };
    setServers((prev) => {
      const updated = [...prev, newServer];
      saveServers(updated, activeServer?.id);
      return updated;
    });
    loadMusicFromServer(newServer);
  }, [activeServer, loadMusicFromServer]);

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
    const lowerQuery = query.toLowerCase();
    const sourceFilter = filters?.source || "all";
    const typeFilter = filters?.type || "all";

    let filteredArtists: Artist[] = [];
    let filteredAlbums: Album[] = [];
    let filteredTracks: Track[] = [];

    if (typeFilter === "all" || typeFilter === "artists") {
      filteredArtists = artists.filter((a) => a.name.toLowerCase().includes(lowerQuery));
    }

    if (typeFilter === "all" || typeFilter === "albums") {
      filteredAlbums = albums.filter((a) => 
        a.name.toLowerCase().includes(lowerQuery) || 
        a.artist.toLowerCase().includes(lowerQuery)
      );
    }

    if (typeFilter === "all" || typeFilter === "tracks") {
      filteredTracks = tracks.filter((t) => {
        const matchesQuery = t.title.toLowerCase().includes(lowerQuery) ||
          t.artist.toLowerCase().includes(lowerQuery) ||
          t.album.toLowerCase().includes(lowerQuery);
        
        if (sourceFilter === "all") return matchesQuery;
        return matchesQuery && t.source === sourceFilter;
      });
    }

    return {
      artists: filteredArtists,
      albums: filteredAlbums,
      tracks: filteredTracks,
    };
  }, [artists, albums, tracks]);

  const getArtistAlbums = useCallback((artistId: string) => {
    return albums.filter((a) => a.artistId === artistId);
  }, [albums]);

  const getAlbumTracks = useCallback((albumId: string) => {
    const album = albums.find((a) => a.id === albumId);
    if (!album) return [];
    return tracks.filter((t) => t.album === album.name);
  }, [albums, tracks]);

  const refreshLibrary = useCallback(async () => {
    if (servers.length === 0) return;
    
    setIsLoading(true);
    setArtists([]);
    setAlbums([]);
    setTracks([]);
    
    for (const server of servers) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const library = generateServerMusic(server);
      
      setArtists((prev) => [...prev, ...library.artists]);
      setAlbums((prev) => [...prev, ...library.albums]);
      setTracks((prev) => [...prev, ...library.tracks]);
    }
    
    setIsLoading(false);
  }, [servers]);

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
