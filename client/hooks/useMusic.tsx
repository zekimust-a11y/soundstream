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
  contentDirectoryUrl?: string;
}

export interface Renderer {
  id: string;
  name: string;
  host: string;
  port: number;
  avTransportUrl: string;
  renderingControlUrl?: string;
  isActive: boolean;
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
  renderers: Renderer[];
  activeRenderer: Renderer | null;
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
  addRenderer: (renderer: Omit<Renderer, "id" | "isActive">) => void;
  removeRenderer: (id: string) => void;
  setActiveRenderer: (renderer: Renderer | null) => void;
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
const RENDERERS_KEY = "@soundstream_renderers";
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
    const fullItemXml = match[0]; // The complete <item>...</item> element
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
      
      // Wrap item in DIDL-Lite for AVTransport metadata
      const metadata = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">${fullItemXml}</DIDL-Lite>`;
      
      tracks.push({
        id: `${serverId}-${id}`,
        title: titleMatch[1],
        artist: artistMatch ? artistMatch[1] : 'Unknown Artist',
        album: albumMatch ? albumMatch[1] : 'Unknown Album',
        duration: Math.round(duration),
        uri: resMatch ? resMatch[1] : undefined,
        albumArt: artMatch ? artMatch[1] : undefined,
        source: 'local' as const,
        metadata,
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
      
      console.log('Device description response:', response.status, 'for', path);
      
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

const makeSOAPRequestXHR = (controlUrl: string, soapEnvelope: string, headerVariant: number = 0): Promise<{ status: number; responseText: string }> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', controlUrl, true);
    
    // Try different header combinations - OhNet/MinimServer is very picky
    switch (headerVariant) {
      case 0:
        // Most common format with quotes
        xhr.setRequestHeader('Content-Type', 'text/xml; charset=utf-8');
        xhr.setRequestHeader('SOAPAction', '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"');
        break;
      case 1:
        // Without quotes on action
        xhr.setRequestHeader('Content-Type', 'text/xml; charset=utf-8');
        xhr.setRequestHeader('SOAPAction', 'urn:schemas-upnp-org:service:ContentDirectory:1#Browse');
        break;
      case 2:
        // Uppercase header name
        xhr.setRequestHeader('Content-Type', 'text/xml; charset=utf-8');
        xhr.setRequestHeader('SOAPACTION', '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"');
        break;
      case 3:
        // Lowercase header name
        xhr.setRequestHeader('Content-Type', 'text/xml; charset=utf-8');
        xhr.setRequestHeader('soapaction', '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"');
        break;
    }
    
    xhr.timeout = 15000;
    
    xhr.onload = () => {
      console.log(`SOAP variant ${headerVariant} response:`, xhr.status);
      resolve({ status: xhr.status, responseText: xhr.responseText });
    };
    
    xhr.onerror = () => {
      reject(new Error('XMLHttpRequest network error'));
    };
    
    xhr.ontimeout = () => {
      reject(new Error('XMLHttpRequest timeout'));
    };
    
    xhr.send(soapEnvelope);
  });
};

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
        `${baseUrl}/ctl/ContentDirectory`,
        `${baseUrl}/dev/srv0/ctl/ContentDirectory`,
        `${baseUrl}/ContentDirectory/control`,
        `${baseUrl}/upnp/control/content_dir`,
        `${baseUrl}/MediaServer/ContentDirectory/Control`,
      ];

  // Try each control URL with each header variant
  for (const controlUrl of controlUrls) {
    for (let variant = 0; variant < 4; variant++) {
      try {
        console.log('Trying UPNP control URL (XHR):', controlUrl, 'variant:', variant, 'for container:', containerId);
        
        const { status, responseText } = await makeSOAPRequestXHR(controlUrl, soapEnvelope, variant);

        console.log('UPNP XHR response status:', status, 'variant:', variant, 'for URL:', controlUrl);
        
        if (status === 200) {
          console.log('SUCCESS! UPNP response received with variant', variant, ', length:', responseText.length);
          if (responseText.length > 0) {
            console.log('UPNP response preview:', responseText.substring(0, 500));
          }
          const result = parseUPNPResponse(responseText, serverId);
          if (result.artists.length > 0 || result.albums.length > 0 || result.tracks.length > 0) {
            return result;
          }
          // Even if no content parsed, variant 0 with 200 status means headers are correct
          return result;
        } else if (status === 412) {
          // 412 means header format wrong, try next variant
          console.log('412 with variant', variant, '- trying next header format');
          continue;
        } else {
          console.log('UPNP XHR error response:', status, 'body:', responseText.substring(0, 200));
        }
      } catch (error) {
        console.log('Control URL failed:', controlUrl, 'variant:', variant, 'Error:', error instanceof Error ? error.message : String(error));
        continue;
      }
    }
  }
  
  return { artists: [], albums: [], tracks: [] };
};

const browseMinimServerWeb = async (baseUrl: string, serverId: string): Promise<{ artists: Artist[], albums: Album[], tracks: Track[] }> => {
  const artists: Artist[] = [];
  const albums: Album[] = [];
  const tracks: Track[] = [];
  
  const webPaths = [
    '/',
    '/browse',
    '/music',
    '/albums',
    '/artists',
    '/library',
    '/content',
  ];
  
  for (const path of webPaths) {
    try {
      console.log('Trying web browse path:', baseUrl + path);
      const response = await fetch(baseUrl + path, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      
      console.log('Web browse response:', response.status, 'for path:', path);
      
      if (response.ok) {
        const html = await response.text();
        console.log('Web content preview:', html.substring(0, 500));
        
        if (html.includes('album') || html.includes('artist') || html.includes('track') || html.includes('music')) {
          console.log('Found music-related content at:', path);
        }
      }
    } catch (error) {
      console.log('Web browse failed for:', path, error instanceof Error ? error.message : String(error));
    }
  }
  
  return { artists, albums, tracks };
};

// Parse UPNP response with context hint for what type of container we're browsing
type BrowseContext = 'root' | 'albums' | 'artists' | 'album' | 'unknown';

const parseUPNPResponseWithContext = (xml: string, serverId: string, context: BrowseContext): { artists: Artist[], albums: Album[], tracks: Track[] } => {
  const artists: Artist[] = [];
  const albums: Album[] = [];
  const tracks: Track[] = [];
  
  const resultMatch = xml.match(/<Result[^>]*>([\s\S]*?)<\/Result>/i);
  if (!resultMatch) return { artists, albums, tracks };
  
  let didl = resultMatch[1];
  didl = didl.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  
  // Parse containers - extract id attribute specifically (not parentID)
  // Use \sid= to ensure we match standalone 'id=' not 'parentID='
  const containerMatches = Array.from(didl.matchAll(/<container[^>]*\sid="([^"]*)"[^>]*>([\s\S]*?)<\/container>/gi));
  console.log(`Parsing ${containerMatches.length} containers for context: ${context}`);
  
  for (const match of containerMatches) {
    const id = match[1];
    const content = match[2];
    const titleMatch = content.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i);
    const artistMatch = content.match(/<upnp:artist[^>]*>([^<]*)<\/upnp:artist>/i) ||
                       content.match(/<dc:creator[^>]*>([^<]*)<\/dc:creator>/i);
    const artMatch = content.match(/<upnp:albumArtURI[^>]*>([^<]*)<\/upnp:albumArtURI>/i);
    
    if (titleMatch) {
      const title = titleMatch[1];
      console.log(`Container: id="${id}", title="${title}", context=${context}`);
      
      // Context-aware parsing: when browsing 'albums' container, treat all results as albums
      if (context === 'albums') {
        albums.push({
          id: `${serverId}-${id}`,
          name: title,
          artist: artistMatch ? artistMatch[1] : 'Unknown Artist',
          artistId: '',
          imageUrl: artMatch ? artMatch[1] : undefined,
        });
      } else if (context === 'artists') {
        artists.push({ id: `${serverId}-${id}`, name: title });
      }
      // For 'root' context, we skip containers as they're just navigation
    }
  }
  
  // Parse items (tracks) - extract id attribute specifically (not parentID)
  // Use \sid= to ensure we match standalone 'id=' not 'parentID='
  const itemMatches = Array.from(didl.matchAll(/<item[^>]*\sid="([^"]*)"[^>]*>([\s\S]*?)<\/item>/gi));
  for (const match of itemMatches) {
    const fullItemXml = match[0]; // The complete <item>...</item> element
    const id = match[1];
    const content = match[2];
    const titleMatch = content.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i);
    const artistMatch = content.match(/<upnp:artist[^>]*>([^<]*)<\/upnp:artist>/i) ||
                       content.match(/<dc:creator[^>]*>([^<]*)<\/dc:creator>/i);
    const albumMatch = content.match(/<upnp:album[^>]*>([^<]*)<\/upnp:album>/i);
    const durationMatch = content.match(/<res[^>]*duration="([^"]*)"[^>]*>/i);
    const resMatch = content.match(/<res[^>]*>([^<]*)<\/res>/i);
    const artMatch = content.match(/<upnp:albumArtURI[^>]*>([^<]*)<\/upnp:albumArtURI>/i);
    
    if (titleMatch && resMatch) {
      let durationMs = 0;
      if (durationMatch) {
        const parts = durationMatch[1].split(':');
        if (parts.length >= 3) {
          const hours = parseInt(parts[0]) || 0;
          const minutes = parseInt(parts[1]) || 0;
          const seconds = parseFloat(parts[2]) || 0;
          durationMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
        }
      }
      
      // Wrap item in DIDL-Lite for AVTransport metadata
      const metadata = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">${fullItemXml}</DIDL-Lite>`;
      
      tracks.push({
        id: `${serverId}-${id}`,
        title: titleMatch[1],
        artist: artistMatch ? artistMatch[1] : 'Unknown Artist',
        album: albumMatch ? albumMatch[1] : 'Unknown Album',
        duration: durationMs,
        uri: resMatch[1],
        albumArt: artMatch ? artMatch[1] : undefined,
        source: 'local' as const,
        metadata,
      });
    }
  }
  
  return { artists, albums, tracks };
};

const browseWithDirectUrl = async (controlUrl: string, containerId: string, serverId: string, context: BrowseContext = 'unknown'): Promise<{ artists: Artist[], albums: Album[], tracks: Track[] }> => {
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

  try {
    console.log('UPNP Browse request to:', controlUrl, 'ObjectID:', containerId, 'context:', context);
    
    const response = await fetch(controlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml;charset="utf-8"',
        'SOAPAction': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
      },
      body: soapEnvelope,
    });
    
    console.log('UPNP Browse response status:', response.status);
    
    if (response.ok) {
      const responseText = await response.text();
      console.log('UPNP Browse response length:', responseText.length);
      return parseUPNPResponseWithContext(responseText, serverId, context);
    } else {
      console.error('UPNP Browse failed:', response.status, await response.text());
      return { artists: [], albums: [], tracks: [] };
    }
  } catch (error) {
    console.error('UPNP Browse error:', error);
    return { artists: [], albums: [], tracks: [] };
  }
};

const fetchServerMusic = async (server: Server): Promise<ServerMusicLibrary> => {
  console.log('Fetching music from server:', server.name);
  
  // Use the pre-configured contentDirectoryUrl if available
  const controlUrl = server.contentDirectoryUrl;
  
  if (!controlUrl) {
    console.error('No contentDirectoryUrl configured for server:', server.name);
    return {
      serverId: server.id,
      serverName: server.name,
      artists: [],
      albums: [],
      tracks: [],
    };
  }
  
  console.log('Using ContentDirectory control URL:', controlUrl);
  
  try {
    const allArtists: Artist[] = [];
    const allAlbums: Album[] = [];
    const allTracks: Track[] = [];
    
    // Browse albums container to get album list (context: 'albums' tells parser to treat containers as albums)
    const albumsContent = await browseWithDirectUrl(controlUrl, '0$albums', server.id, 'albums');
    console.log('Albums container result:', albumsContent.albums.length, 'albums');
    allAlbums.push(...albumsContent.albums);
    
    // Browse each album to get tracks for ALL albums
    console.log('Loading tracks for', albumsContent.albums.length, 'albums...');
    for (let i = 0; i < albumsContent.albums.length; i++) {
      const album = albumsContent.albums[i];
      const albumId = album.id.replace(`${server.id}-`, '');
      const albumContent = await browseWithDirectUrl(controlUrl, albumId, server.id, 'album');
      console.log(`[${i + 1}/${albumsContent.albums.length}] Album "${album.name}" has ${albumContent.tracks.length} tracks`);
      for (const t of albumContent.tracks) {
        allTracks.push({
          ...t,
          album: album.name,
          artist: t.artist || album.artist || 'Unknown Artist',
          albumArt: t.albumArt || album.imageUrl,
        });
      }
    }
    
    // Browse artists container
    const artistsContent = await browseWithDirectUrl(controlUrl, '0$=Artist', server.id, 'artists');
    console.log('Artists container result:', artistsContent.artists.length, 'artists');
    allArtists.push(...artistsContent.artists);
    
    console.log('Total fetched:', allArtists.length, 'artists,', allAlbums.length, 'albums,', allTracks.length, 'tracks');
    
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

// Pre-configured devices - discovered via SSDP
const DEFAULT_SERVER: Server = {
  id: 'minimserver-default',
  name: 'MinimServer[OLADRAserver]',
  type: 'upnp',
  host: '192.168.0.19',
  port: 9790,
  connected: true,
  contentDirectoryUrl: 'http://192.168.0.19:9791/88f1207c-ffc2-4070-940e-ca5af99aa4d3/upnp.org-ContentDirectory-1/control',
};

const DEFAULT_RENDERER: Renderer = {
  id: 'varese-default',
  name: 'dCS Varese (Living room)',
  host: '192.168.0.42',
  port: 16500,
  avTransportUrl: 'http://192.168.0.42:16500/Control/LibRygelRenderer/RygelAVTransport',
  renderingControlUrl: 'http://192.168.0.42:16500/Control/LibRygelRenderer/RygelRenderingControl',
  isActive: true,
};

export function MusicProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServer, setActiveServerState] = useState<Server | null>(null);
  const [renderers, setRenderers] = useState<Renderer[]>([]);
  const [activeRenderer, setActiveRendererState] = useState<Renderer | null>(null);
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
      const [serversData, renderersData, qobuzData, recentData, favoritesData, playlistsData, libraryData] = await Promise.all([
        AsyncStorage.getItem(SERVERS_KEY),
        AsyncStorage.getItem(RENDERERS_KEY),
        AsyncStorage.getItem(QOBUZ_KEY),
        AsyncStorage.getItem(RECENT_KEY),
        AsyncStorage.getItem(FAVORITES_KEY),
        AsyncStorage.getItem(PLAYLISTS_KEY),
        AsyncStorage.getItem(LIBRARY_KEY),
      ]);

      // Load servers with default MinimServer always present
      // Always use the latest DEFAULT_SERVER config to ensure contentDirectoryUrl is set
      if (serversData) {
        const parsed = JSON.parse(serversData);
        const existingServers = (parsed.servers || []) as Server[];
        // Replace any outdated default server with the current DEFAULT_SERVER
        const updatedServers = existingServers
          .filter((s: Server) => s.id !== 'minimserver-default')
          .concat([DEFAULT_SERVER]);
        setServers(updatedServers);
        saveServers(updatedServers, DEFAULT_SERVER.id);
        setActiveServerState(DEFAULT_SERVER);
      } else {
        setServers([DEFAULT_SERVER]);
        setActiveServerState(DEFAULT_SERVER);
        saveServers([DEFAULT_SERVER], DEFAULT_SERVER.id);
      }

      // Load renderers with default dCS Varese always present
      if (renderersData) {
        const parsed = JSON.parse(renderersData);
        const existingRenderers = parsed.renderers || [];
        const hasDefault = existingRenderers.some((r: Renderer) => r.id === 'varese-default');
        const allRenderers = hasDefault ? existingRenderers : [DEFAULT_RENDERER, ...existingRenderers];
        setRenderers(allRenderers);
        if (parsed.activeRendererId) {
          const active = allRenderers.find((r: Renderer) => r.id === parsed.activeRendererId);
          setActiveRendererState(active || DEFAULT_RENDERER);
        } else {
          setActiveRendererState(DEFAULT_RENDERER);
        }
      } else {
        setRenderers([DEFAULT_RENDERER]);
        setActiveRendererState(DEFAULT_RENDERER);
        saveRenderers([DEFAULT_RENDERER], DEFAULT_RENDERER.id);
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
        // Deduplicate loaded library data to prevent duplicate key errors
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

  const saveRenderers = async (newRenderers: Renderer[], activeId?: string) => {
    try {
      await AsyncStorage.setItem(
        RENDERERS_KEY,
        JSON.stringify({ renderers: newRenderers, activeRendererId: activeId })
      );
    } catch (e) {
      console.error("Failed to save renderers:", e);
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

  const addRenderer = useCallback((renderer: Omit<Renderer, "id" | "isActive">) => {
    const newRenderer: Renderer = {
      ...renderer,
      id: Date.now().toString(),
      isActive: true,
    };
    setRenderers((prev) => {
      // Deactivate other renderers
      const updated = prev.map(r => ({ ...r, isActive: false }));
      updated.push(newRenderer);
      saveRenderers(updated, newRenderer.id);
      return updated;
    });
    setActiveRendererState(newRenderer);
  }, []);

  const removeRenderer = useCallback((id: string) => {
    // Don't allow removing the default renderer
    if (id === 'varese-default') return;
    setRenderers((prev) => {
      const updated = prev.filter((r) => r.id !== id);
      saveRenderers(updated, activeRenderer?.id === id ? undefined : activeRenderer?.id);
      return updated;
    });
    if (activeRenderer?.id === id) {
      setActiveRendererState(DEFAULT_RENDERER);
    }
  }, [activeRenderer]);

  const setActiveRenderer = useCallback((renderer: Renderer | null) => {
    setRenderers((prev) => {
      const updated = prev.map(r => ({ ...r, isActive: r.id === renderer?.id }));
      saveRenderers(updated, renderer?.id);
      return updated;
    });
    setActiveRendererState(renderer);
  }, []);

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
      
      // Deduplicate artists by ID
      setArtists((prev) => {
        const existingIds = new Set(prev.map(a => a.id));
        const uniqueNew = library.artists.filter(a => !existingIds.has(a.id));
        return [...prev, ...uniqueNew];
      });
      
      // Deduplicate albums by ID
      setAlbums((prev) => {
        const existingIds = new Set(prev.map(a => a.id));
        const uniqueNew = library.albums.filter(a => !existingIds.has(a.id));
        return [...prev, ...uniqueNew];
      });
      
      // Deduplicate tracks by ID
      setTracks((prev) => {
        const existingIds = new Set(prev.map(t => t.id));
        const uniqueNew = library.tracks.filter(t => !existingIds.has(t.id));
        return [...prev, ...uniqueNew];
      });
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
        renderers,
        activeRenderer,
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
        addRenderer,
        removeRenderer,
        setActiveRenderer,
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
