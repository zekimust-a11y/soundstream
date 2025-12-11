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

interface ServerMusicLibrary {
  serverId: string;
  serverName: string;
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
}

const parseUPNPResponse = (xml: string, serverId: string): { artists: Artist[], albums: Album[], tracks: Track[] } => {
  const artists: Artist[] = [];
  const albums: Album[] = [];
  const tracks: Track[] = [];
  
  const resultMatch = xml.match(/<Result[^>]*>([\s\S]*?)<\/Result>/i);
  if (!resultMatch) return { artists, albums, tracks };
  
  let didl = resultMatch[1];
  didl = didl.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  
  const containerMatches = Array.from(didl.matchAll(/<container[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/container>/gi));
  for (const match of containerMatches) {
    const id = match[1];
    const content = match[2];
    const titleMatch = content.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i);
    const classMatch = content.match(/<upnp:class[^>]*>([^<]*)<\/upnp:class>/i);
    
    if (titleMatch) {
      const title = titleMatch[1];
      const upnpClass = classMatch ? classMatch[1] : '';
      
      if (upnpClass.includes('musicArtist') || upnpClass.includes('person')) {
        artists.push({ id: `${serverId}-${id}`, name: title });
      } else if (upnpClass.includes('musicAlbum') || upnpClass.includes('album')) {
        const artistMatch = content.match(/<upnp:artist[^>]*>([^<]*)<\/upnp:artist>/i) ||
                           content.match(/<dc:creator[^>]*>([^<]*)<\/dc:creator>/i);
        const artMatch = content.match(/<upnp:albumArtURI[^>]*>([^<]*)<\/upnp:albumArtURI>/i);
        
        albums.push({
          id: `${serverId}-${id}`,
          name: title,
          artist: artistMatch ? artistMatch[1] : 'Unknown Artist',
          artistId: '',
          imageUrl: artMatch ? artMatch[1] : undefined,
        });
      }
    }
  }
  
  const itemMatches = Array.from(didl.matchAll(/<item[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/item>/gi));
  for (const match of itemMatches) {
    const id = match[1];
    const content = match[2];
    const titleMatch = content.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i);
    const artistMatch = content.match(/<upnp:artist[^>]*>([^<]*)<\/upnp:artist>/i) ||
                       content.match(/<dc:creator[^>]*>([^<]*)<\/dc:creator>/i);
    const albumMatch = content.match(/<upnp:album[^>]*>([^<]*)<\/upnp:album>/i);
    const durationMatch = content.match(/<res[^>]*duration="([^"]*)"[^>]*>/i);
    const resMatch = content.match(/<res[^>]*>([^<]*)<\/res>/i);
    const artMatch = content.match(/<upnp:albumArtURI[^>]*>([^<]*)<\/upnp:albumArtURI>/i);
    const classMatch = content.match(/<upnp:class[^>]*>([^<]*)<\/upnp:class>/i);
    
    if (titleMatch && classMatch && classMatch[1].includes('audioItem')) {
      let duration = 0;
      if (durationMatch) {
        const parts = durationMatch[1].split(':');
        if (parts.length === 3) {
          duration = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
        }
      }
      
      tracks.push({
        id: `${serverId}-${id}`,
        title: titleMatch[1],
        artist: artistMatch ? artistMatch[1] : 'Unknown Artist',
        album: albumMatch ? albumMatch[1] : 'Unknown Album',
        duration: Math.round(duration),
        streamUrl: resMatch ? resMatch[1] : undefined,
        albumArt: artMatch ? artMatch[1] : undefined,
        source: 'local' as const,
      });
    }
  }
  
  return { artists, albums, tracks };
};

const discoverControlUrl = async (baseUrl: string): Promise<string | null> => {
  const descriptionPaths = [
    '/DeviceDescription.xml',
    '/description.xml', 
    '/rootDesc.xml',
    '/upnp/description.xml',
    '/',
  ];

  for (const path of descriptionPaths) {
    try {
      console.log('Trying device description at:', baseUrl + path);
      const response = await fetch(baseUrl + path, {
        headers: { 'Accept': 'text/xml, application/xml, */*' },
      });
      
      if (response.ok) {
        const xml = await response.text();
        console.log('Device description found, length:', xml.length);
        console.log('Device description preview:', xml.substring(0, 1000));
        
        const serviceTypeMatch = xml.match(/ContentDirectory[^<]*/gi);
        if (serviceTypeMatch) {
          console.log('Found ContentDirectory references:', serviceTypeMatch);
        }
        
        const allControlUrls = xml.match(/<controlURL>([^<]+)<\/controlURL>/gi);
        if (allControlUrls) {
          console.log('All control URLs found:', allControlUrls);
          for (const match of allControlUrls) {
            const url = match.replace(/<\/?controlURL>/gi, '');
            console.log('Checking control URL:', url);
            if (url.toLowerCase().includes('contentdirectory') || url.toLowerCase().includes('content') || url.includes('CDS')) {
              const fullUrl = url.startsWith('http') ? url : baseUrl + (url.startsWith('/') ? url : '/' + url);
              console.log('Found ContentDirectory control URL:', fullUrl);
              return fullUrl;
            }
          }
        }
        
        const serviceBlocks = xml.match(/<service>[\s\S]*?<\/service>/gi);
        if (serviceBlocks) {
          console.log('Found', serviceBlocks.length, 'service blocks');
          for (const block of serviceBlocks) {
            if (block.toLowerCase().includes('contentdirectory')) {
              console.log('ContentDirectory service block:', block.substring(0, 500));
              const ctrlMatch = block.match(/<controlURL>([^<]+)<\/controlURL>/i);
              if (ctrlMatch) {
                const url = ctrlMatch[1];
                const fullUrl = url.startsWith('http') ? url : baseUrl + (url.startsWith('/') ? url : '/' + url);
                console.log('Found ContentDirectory service control URL:', fullUrl);
                return fullUrl;
              }
            }
          }
        }
        
        if (allControlUrls && allControlUrls.length > 0) {
          const firstUrl = allControlUrls[0].replace(/<\/?controlURL>/gi, '');
          const fullUrl = firstUrl.startsWith('http') ? firstUrl : baseUrl + (firstUrl.startsWith('/') ? firstUrl : '/' + firstUrl);
          console.log('Using first available control URL:', fullUrl);
          return fullUrl;
        }
      }
    } catch (error) {
      console.log('Description fetch failed for', path, ':', error instanceof Error ? error.message : String(error));
    }
  }
  
  return null;
};

let cachedControlUrl: string | null = null;

const browseUPNPContainer = async (baseUrl: string, containerId: string, serverId: string): Promise<{ artists: Artist[], albums: Album[], tracks: Track[] }> => {
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <ObjectID>${containerId}</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>0</StartingIndex>
      <RequestedCount>0</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`;

  if (!cachedControlUrl) {
    cachedControlUrl = await discoverControlUrl(baseUrl);
  }

  const controlUrls = cachedControlUrl 
    ? [cachedControlUrl]
    : [
        `${baseUrl}/dev/srv0/ctl/ContentDirectory`,
        `${baseUrl}/ctl/ContentDirectory`,
        `${baseUrl}/ContentDirectory/control`,
        `${baseUrl}/upnp/control/content_dir`,
        `${baseUrl}/MediaServer/ContentDirectory/Control`,
      ];

  for (const controlUrl of controlUrls) {
    try {
      console.log('Trying UPNP control URL:', controlUrl, 'for container:', containerId);
      const urlObj = new URL(controlUrl);
      const hostHeader = `${urlObj.hostname}:${urlObj.port || '80'}`;
      
      const response = await fetch(controlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
          'Host': hostHeader,
          'User-Agent': 'SoundStream/1.0 UPnP/1.0',
          'Connection': 'close',
        },
        body: soapEnvelope,
      });

      console.log('UPNP response status:', response.status, 'for URL:', controlUrl);
      
      if (response.ok) {
        const xml = await response.text();
        console.log('UPNP response received, length:', xml.length);
        if (xml.length > 0) {
          console.log('UPNP response preview:', xml.substring(0, 500));
        }
        const result = parseUPNPResponse(xml, serverId);
        if (result.artists.length > 0 || result.albums.length > 0 || result.tracks.length > 0) {
          return result;
        }
      } else {
        const errorText = await response.text();
        console.log('UPNP error response:', response.status, errorText.substring(0, 300));
      }
    } catch (error) {
      console.log('Control URL failed:', controlUrl, 'Error:', error instanceof Error ? error.message : String(error));
      continue;
    }
  }
  
  return { artists: [], albums: [], tracks: [] };
};

const fetchServerMusic = async (server: Server): Promise<ServerMusicLibrary> => {
  const upnpPort = server.port === 9790 ? 9791 : server.port;
  const baseUrl = `http://${server.host}:${upnpPort}`;
  const contentUrl = `http://${server.host}:${server.port}`;
  console.log('Connecting to UPNP server at:', baseUrl, '(content at:', contentUrl + ')');
  
  cachedControlUrl = null;
  
  try {
    const allArtists: Artist[] = [];
    const allAlbums: Album[] = [];
    const allTracks: Track[] = [];
    
    const rootContent = await browseUPNPContainer(baseUrl, '0', server.id);
    console.log('Root browse result:', rootContent.artists.length, 'artists,', rootContent.albums.length, 'albums,', rootContent.tracks.length, 'tracks');
    
    allArtists.push(...rootContent.artists);
    allAlbums.push(...rootContent.albums);
    allTracks.push(...rootContent.tracks);
    
    if (allTracks.length === 0) {
      const containerIds = ['1', '2', '3', '64', '65', 'Music', 'Albums', 'Artists'];
      
      for (const containerId of containerIds) {
        const content = await browseUPNPContainer(baseUrl, containerId, server.id);
        console.log(`Container ${containerId} result:`, content.artists.length, 'artists,', content.albums.length, 'albums,', content.tracks.length, 'tracks');
        
        allArtists.push(...content.artists);
        allAlbums.push(...content.albums);
        allTracks.push(...content.tracks);
        
        for (const album of content.albums) {
          const albumId = album.id.replace(`${server.id}-`, '');
          const albumContent = await browseUPNPContainer(baseUrl, albumId, server.id);
          allTracks.push(...albumContent.tracks.map(t => ({
            ...t,
            album: album.name,
            artist: album.artist,
          })));
        }
        
        if (allTracks.length > 0) break;
      }
    }
    
    return {
      serverId: server.id,
      serverName: server.name,
      artists: allArtists,
      albums: allAlbums,
      tracks: allTracks,
    };
  } catch (error) {
    console.error('Failed to fetch music from server:', error);
    return {
      serverId: server.id,
      serverName: server.name,
      artists: [],
      albums: [],
      tracks: [],
    };
  }
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
    
    const library = await fetchServerMusic(server);
    
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
      saveServers(updated, newServer.id);
      return updated;
    });
    setActiveServerState(newServer);
    loadMusicFromServer(newServer);
  }, [loadMusicFromServer]);

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
      const library = await fetchServerMusic(server);
      
      setArtists((prev) => [...prev, ...library.artists]);
      setAlbums((prev) => [...prev, ...library.albums]);
      setTracks((prev) => [...prev, ...library.tracks]);
    }
    
    setIsLoading(false);
  }, [servers]);

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
