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

interface MusicContextType {
  servers: Server[];
  activeServer: Server | null;
  artists: Artist[];
  albums: Album[];
  recentlyPlayed: Track[];
  qobuzConnected: boolean;
  isLoading: boolean;
  addServer: (server: Omit<Server, "id" | "connected">) => void;
  removeServer: (id: string) => void;
  setActiveServer: (server: Server | null) => void;
  connectQobuz: (email: string, password: string) => Promise<boolean>;
  disconnectQobuz: () => void;
  searchMusic: (query: string) => Promise<{ artists: Artist[]; albums: Album[]; tracks: Track[] }>;
  getArtistAlbums: (artistId: string) => Album[];
  getAlbumTracks: (albumId: string) => Track[];
  refreshLibrary: () => void;
  addToRecentlyPlayed: (track: Track) => void;
}

const MusicContext = createContext<MusicContextType | undefined>(undefined);

const SERVERS_KEY = "@soundstream_servers";
const QOBUZ_KEY = "@soundstream_qobuz";
const RECENT_KEY = "@soundstream_recent";

const DEMO_ARTISTS: Artist[] = [
  { id: "1", name: "Hans Zimmer", imageUrl: undefined, albumCount: 5 },
  { id: "2", name: "Max Richter", imageUrl: undefined, albumCount: 3 },
  { id: "3", name: "Nils Frahm", imageUrl: undefined, albumCount: 4 },
  { id: "4", name: "Olafur Arnalds", imageUrl: undefined, albumCount: 3 },
  { id: "5", name: "Ludovico Einaudi", imageUrl: undefined, albumCount: 6 },
  { id: "6", name: "Radiohead", imageUrl: undefined, albumCount: 9 },
];

const DEMO_ALBUMS: Album[] = [
  { id: "a1", name: "Interstellar", artist: "Hans Zimmer", artistId: "1", year: 2014, trackCount: 16 },
  { id: "a2", name: "Dune", artist: "Hans Zimmer", artistId: "1", year: 2021, trackCount: 22 },
  { id: "a3", name: "The Blue Notebooks", artist: "Max Richter", artistId: "2", year: 2004, trackCount: 11 },
  { id: "a4", name: "Sleep", artist: "Max Richter", artistId: "2", year: 2015, trackCount: 31 },
  { id: "a5", name: "Spaces", artist: "Nils Frahm", artistId: "3", year: 2013, trackCount: 12 },
  { id: "a6", name: "All Melody", artist: "Nils Frahm", artistId: "3", year: 2018, trackCount: 12 },
  { id: "a7", name: "re:member", artist: "Olafur Arnalds", artistId: "4", year: 2018, trackCount: 12 },
  { id: "a8", name: "In a Time Lapse", artist: "Ludovico Einaudi", artistId: "5", year: 2013, trackCount: 14 },
  { id: "a9", name: "OK Computer", artist: "Radiohead", artistId: "6", year: 1997, trackCount: 12 },
  { id: "a10", name: "Kid A", artist: "Radiohead", artistId: "6", year: 2000, trackCount: 10 },
];

const DEMO_TRACKS: Track[] = [
  { id: "t1", title: "Cornfield Chase", artist: "Hans Zimmer", album: "Interstellar", duration: 127, source: "local" },
  { id: "t2", title: "No Time for Caution", artist: "Hans Zimmer", album: "Interstellar", duration: 239, source: "local" },
  { id: "t3", title: "Day One", artist: "Hans Zimmer", album: "Interstellar", duration: 196, source: "local" },
  { id: "t4", title: "On The Nature of Daylight", artist: "Max Richter", album: "The Blue Notebooks", duration: 372, source: "local" },
  { id: "t5", title: "Says", artist: "Nils Frahm", album: "Spaces", duration: 607, source: "local" },
  { id: "t6", title: "re:member", artist: "Olafur Arnalds", album: "re:member", duration: 283, source: "local" },
  { id: "t7", title: "Experience", artist: "Ludovico Einaudi", album: "In a Time Lapse", duration: 315, source: "local" },
  { id: "t8", title: "Paranoid Android", artist: "Radiohead", album: "OK Computer", duration: 386, source: "local" },
  { id: "t9", title: "Karma Police", artist: "Radiohead", album: "OK Computer", duration: 264, source: "local" },
  { id: "t10", title: "Everything In Its Right Place", artist: "Radiohead", album: "Kid A", duration: 251, source: "local" },
];

export function MusicProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServer, setActiveServerState] = useState<Server | null>(null);
  const [artists, setArtists] = useState<Artist[]>(DEMO_ARTISTS);
  const [albums, setAlbums] = useState<Album[]>(DEMO_ALBUMS);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>([]);
  const [qobuzConnected, setQobuzConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [serversData, qobuzData, recentData] = await Promise.all([
        AsyncStorage.getItem(SERVERS_KEY),
        AsyncStorage.getItem(QOBUZ_KEY),
        AsyncStorage.getItem(RECENT_KEY),
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
  }, [activeServer]);

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

  const searchMusic = useCallback(async (query: string) => {
    const lowerQuery = query.toLowerCase();
    return {
      artists: artists.filter((a) => a.name.toLowerCase().includes(lowerQuery)),
      albums: albums.filter((a) => 
        a.name.toLowerCase().includes(lowerQuery) || 
        a.artist.toLowerCase().includes(lowerQuery)
      ),
      tracks: DEMO_TRACKS.filter((t) => 
        t.title.toLowerCase().includes(lowerQuery) ||
        t.artist.toLowerCase().includes(lowerQuery) ||
        t.album.toLowerCase().includes(lowerQuery)
      ),
    };
  }, [artists, albums]);

  const getArtistAlbums = useCallback((artistId: string) => {
    return albums.filter((a) => a.artistId === artistId);
  }, [albums]);

  const getAlbumTracks = useCallback((albumId: string) => {
    const album = albums.find((a) => a.id === albumId);
    if (!album) return [];
    return DEMO_TRACKS.filter((t) => t.album === album.name);
  }, [albums]);

  const refreshLibrary = useCallback(() => {
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
    }, 1000);
  }, []);

  const addToRecentlyPlayed = useCallback(async (track: Track) => {
    setRecentlyPlayed((prev) => {
      const filtered = prev.filter((t) => t.id !== track.id);
      const updated = [track, ...filtered].slice(0, 20);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
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
