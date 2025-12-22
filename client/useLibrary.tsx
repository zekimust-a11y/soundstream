import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lmsClient, LmsAlbum, LmsArtist, LmsRadioStation } from '@/lib/lmsClient';
import { useMusic } from './useMusic';
import { useSettings } from './useSettings';

const PAGE_SIZE = 50;

export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  imageUrl?: string;
  year?: number;
  trackCount?: number;
  source?: "local" | "qobuz" | "tidal" | "spotify" | "soundcloud";
}

export interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  albumCount?: number;
}

const convertLmsAlbumToAlbum = (lmsAlbum: LmsAlbum, source: "local" | "qobuz" | "tidal" | "spotify" | "soundcloud" = "local"): Album => ({
  id: lmsAlbum.id,
  name: lmsAlbum.title,
  artist: lmsAlbum.artist,
  artistId: lmsAlbum.artistId || '',
  imageUrl: lmsClient.getArtworkUrl(lmsAlbum),
  year: lmsAlbum.year,
  trackCount: lmsAlbum.trackCount,
  source,
});

const convertLmsArtistToArtist = (lmsArtist: LmsArtist): Artist => ({
  id: lmsArtist.id,
  name: lmsArtist.name,
  albumCount: lmsArtist.albumCount,
  imageUrl: lmsArtist.artworkUrl,
});

export function useAlbumsPreview(limit: number = 20) {
  const { activeServer } = useMusic();
  const { qobuzEnabled, tidalEnabled, localLibraryEnabled, isLoaded } = useSettings();

  console.log('useAlbumsPreview enabled:', !!activeServer, 'activeServer:', activeServer);

  return useQuery({
    queryKey: ['albums', 'preview', activeServer?.id, limit, qobuzEnabled, tidalEnabled, localLibraryEnabled],
    queryFn: async () => {
      console.log('useAlbumsPreview queryFn called');
      if (!activeServer) return { albums: [], total: 0 };
      lmsClient.setServer(activeServer.host, activeServer.port);

      let albums = [];
      let total = 0;

      // Include local LMS albums if local library is enabled
      if (localLibraryEnabled) {
        const result = await lmsClient.getAlbumsPage(0, limit);
        albums = result.albums.map(album => convertLmsAlbumToAlbum(album, 'local'));
        total = result.total;
      }
      
      // Also include Qobuz favorite albums if enabled
      if (qobuzEnabled) {
        try {
          const qobuzFavs = await lmsClient.getQobuzFavoriteAlbums();
          if (qobuzFavs.length > 0) {
            const qobuzAlbums = qobuzFavs.slice(0, limit).map(album => convertLmsAlbumToAlbum(album, 'qobuz'));
            // Avoid duplicates by album id
            const existingIds = new Set(albums.map(a => a.id));
            const merged = [
              ...albums,
              ...qobuzAlbums.filter(a => !existingIds.has(a.id)),
            ];
            albums = merged.slice(0, limit);
          }
        } catch (e) {
          // If Qobuz isn't available, just show local albums
        }
      }
      
      // Include Tidal favorite albums if enabled
      if (tidalEnabled) {
        try {
          const tidalResponse = await fetch(`${getApiUrl()}/api/tidal/albums?limit=${limit}&offset=0`);
          if (tidalResponse.ok) {
            const tidalResult = await tidalResponse.json();
            if (tidalResult.items && tidalResult.items.length > 0) {
              const tidalAlbums = tidalResult.items.map((album: any) => ({
                id: `tidal-${album.id}`,
                title: album.title,
                artist: album.artist.name,
                artistId: album.artist.id,
                artwork: album.cover ? `https://resources.tidal.com/images/${album.cover.replace(/-/g, '/')}/640x640.jpg` : undefined,
                year: album.year,
                trackCount: album.numberOfTracks,
                source: 'tidal' as const,
                url: album.lmsUri, // LMS playable URI
              }));
              // Avoid duplicates by album id
              const existingIds = new Set(albums.map(a => a.id));
              const merged = [
                ...albums,
                ...tidalAlbums.filter((a: any) => !existingIds.has(a.id)),
              ];
              albums = merged.slice(0, limit);
            }
          }
        } catch (e) {
          console.warn('Tidal albums not available:', e);
        }
      }
      
      const qobuzCount = qobuzEnabled ? (await lmsClient.getQobuzFavoriteAlbums().catch(() => [])).length : 0;

      // Get Tidal count
      let tidalCount = 0;
      if (tidalEnabled) {
        try {
          const tidalResponse = await fetch(`${getApiUrl()}/api/tidal/albums?limit=1&offset=0`);
          if (tidalResponse.ok) {
            const tidalResult = await tidalResponse.json();
            tidalCount = tidalResult.total || 0;
          }
        } catch (e) {
          // Ignore errors
        }
      }

      return {
        albums,
        total: total + qobuzCount + tidalCount,
      };
    },
    enabled: !!activeServer && isLoaded,
    staleTime: 5 * 60 * 1000,
  });
}

export function useArtistsPreview(limit: number = 20) {
  const { activeServer } = useMusic();
  const { qobuzEnabled, tidalEnabled, localLibraryEnabled, isLoaded } = useSettings();

  return useQuery({
    queryKey: ['artists', 'preview', activeServer?.id, limit, qobuzEnabled, tidalEnabled, localLibraryEnabled],
    queryFn: async () => {
      if (!activeServer) return { artists: [], total: 0 };
      lmsClient.setServer(activeServer.host, activeServer.port);

      let artists = [];
      let total = 0;

      // Include local LMS artists if local library is enabled
      if (localLibraryEnabled) {
        const result = await lmsClient.getArtistsPage(0, limit, qobuzEnabled);
        artists = result.artists;
        total = result.total;
      }
      
      // Also include artists from Qobuz albums if enabled
      if (qobuzEnabled) {
        try {
          const qobuzFavs = await lmsClient.getQobuzFavoriteAlbums();
          const qobuzArtists = new Set<string>();
          for (const album of qobuzFavs) {
            const artistName = String(album.artist || '').trim();
            if (artistName && artistName !== '-' && artistName !== '') {
              qobuzArtists.add(artistName);
            }
          }
          
          // Add Qobuz artists that aren't already in the list
          const existingArtistNames = new Set(artists.map(a => a.name));
          for (const artistName of qobuzArtists) {
            if (!existingArtistNames.has(artistName)) {
              artists.push({
                id: `qobuz-${artistName}`,
                name: artistName,
                albumCount: qobuzFavs.filter(a => String(a.artist || '').trim() === artistName).length,
              });
            }
          }
          
          total = total + qobuzArtists.size;
        } catch (e) {
          // If Qobuz isn't available, just show local artists
        }
      }
      
      // Include Tidal favorite artists if enabled
      if (tidalEnabled) {
        try {
          const tidalResponse = await fetch(`${getApiUrl()}/api/tidal/artists?limit=${limit}&offset=0`);
          if (tidalResponse.ok) {
            const tidalResult = await tidalResponse.json();
            if (tidalResult.items && tidalResult.items.length > 0) {
              const tidalArtists = tidalResult.items.map((artist: any) => ({
                id: `tidal-${artist.id}`,
                name: artist.name,
                albumCount: 0, // Tidal API doesn't provide album count in this endpoint
                imageUrl: artist.picture ? `https://resources.tidal.com/images/${artist.picture.replace(/-/g, '/')}/320x320.jpg` : undefined,
              }));
              // Avoid duplicates by artist name
              const existingArtistNames = new Set(artists.map(a => a.name));
              const merged = [
                ...artists,
                ...tidalArtists.filter((a: any) => !existingArtistNames.has(a.name)),
              ];
              artists = merged.slice(0, limit * 2); // Allow more for merging
            }
          }
        } catch (e) {
          console.warn('Tidal artists not available:', e);
        }
      }
      
      const artistsWithImages = await Promise.all(
        artists.slice(0, limit).map(async (lmsArtist) => {
          const artist = convertLmsArtistToArtist(lmsArtist);
          // Fetch actual artist image (portrait/photo) from TheAudioDB, not album artwork
          try {
            const artistImage = await lmsClient.getArtistImage(lmsArtist.name);
            if (artistImage) {
              artist.imageUrl = artistImage;
            }
          } catch (e) {
            // Ignore errors - artist will have no image
          }
          return artist;
        })
      );
      
      // Get Tidal count
      let tidalArtistCount = 0;
      if (tidalEnabled) {
        try {
          const tidalResponse = await fetch(`${getApiUrl()}/api/tidal/artists?limit=1&offset=0`);
          if (tidalResponse.ok) {
            const tidalResult = await tidalResponse.json();
            tidalArtistCount = tidalResult.total || 0;
          }
        } catch (e) {
          // Ignore errors
        }
      }

      return {
        artists: artistsWithImages,
        total: total + tidalArtistCount,
      };
    },
    enabled: !!activeServer && isLoaded,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInfiniteAlbums(artistId?: string) {
  const { activeServer } = useMusic();
  const { qobuzEnabled, spotifyEnabled, tidalEnabled, localLibraryEnabled, isLoaded } = useSettings();

  console.log('useInfiniteAlbums enabled:', !!activeServer, 'activeServer:', activeServer);

  return useInfiniteQuery({
    queryKey: ['albums', 'infinite', activeServer?.id, artistId, qobuzEnabled, spotifyEnabled, tidalEnabled, localLibraryEnabled],
    queryFn: async ({ pageParam = 0 }) => {
      console.log('useInfiniteAlbums queryFn called');
      if (!activeServer) return { albums: [], total: 0, nextPage: undefined };

      lmsClient.setServer(activeServer.host, activeServer.port);
      // Always load local albums for this page
      const result = await lmsClient.getAlbumsPage(pageParam, PAGE_SIZE, artistId);
      
      // Check if Spotify and Tidal are enabled
      let spotifyEnabled = true;
      let tidalEnabled = true;
      try {
        const settings = await AsyncStorage.getItem("@soundstream_settings");
        if (settings) {
          const parsed = JSON.parse(settings);
          spotifyEnabled = parsed.spotifyEnabled !== false;
          tidalEnabled = parsed.tidalEnabled !== false;
        }
      } catch (e) {
        // Use default if settings can't be loaded
      }
      
      // Filter out disabled service albums, and identify source
      let albums = result.albums
        .filter(album => {
          const id = (album.id || '').toLowerCase();
          const artworkUrl = (album.artwork_url || '').toLowerCase();
          const url = (album as any).url ? String((album as any).url).toLowerCase() : '';

          // Check if this is a Spotify album
          const isSpotify = id.includes('spotify') || artworkUrl.includes('spotify') || url.includes('spotify');
          if (isSpotify && !spotifyEnabled) {
            return false;
          }

          // Check if this is a Tidal album
          const isTidal = id.includes('tidal') || artworkUrl.includes('tidal') || url.includes('tidal');
          if (isTidal && !tidalEnabled) {
            return false;
          }

          // Check if this is a local album (not from streaming services)
          const isLocal = !isSpotify && !isTidal && !id.includes('qobuz') && !artworkUrl.includes('qobuz');
          if (isLocal && !localLibraryEnabled) {
            return false;
          }

          return true;
        })
        .map(album => {
          const id = (album.id || '').toLowerCase();
          const artworkUrl = (album.artwork_url || '').toLowerCase();
          const url = (album as any).url ? String((album as any).url).toLowerCase() : '';
          
          // Determine source
          let source: "local" | "qobuz" | "tidal" | "spotify" | "soundcloud" = "local";
          if (id.includes('tidal') || artworkUrl.includes('tidal') || url.includes('tidal')) {
            source = 'tidal';
          } else if (id.includes('spotify') || artworkUrl.includes('spotify') || url.includes('spotify')) {
            source = 'spotify';
          } else if (id.includes('qobuz') || artworkUrl.includes('qobuz') || url.includes('qobuz')) {
            source = 'qobuz';
          } else if (id.includes('soundcloud') || artworkUrl.includes('soundcloud') || url.includes('soundcloud')) {
            source = 'soundcloud';
          }
          
          return convertLmsAlbumToAlbum(album, source);
        });

      // When not scoped to a specific artist, also merge in Qobuz and Tidal "My Favorites" albums (if enabled)
      let qobuzAlbumsCount = 0;
      let tidalAlbumsCount = 0;
      if (!artistId) {
        // Check if Qobuz is enabled
        let qobuzEnabled = true;
        try {
          const settings = await AsyncStorage.getItem("@soundstream_settings");
          if (settings) {
            const parsed = JSON.parse(settings);
            qobuzEnabled = parsed.qobuzEnabled !== false;
          }
        } catch (e) {
          // Use default if settings can't be loaded
        }
        
        if (qobuzEnabled) {
          try {
            const qobuzFavs = await lmsClient.getQobuzFavoriteAlbums();
            qobuzAlbumsCount = qobuzFavs.length;
            if (qobuzFavs.length > 0) {
              const qobuzAlbums = qobuzFavs.map(album => convertLmsAlbumToAlbum(album, 'qobuz'));
              // Avoid simple duplicates by album id
              const existingIds = new Set(albums.map(a => a.id));
              const merged = [
                ...albums,
                ...qobuzAlbums.filter(a => !existingIds.has(a.id)),
              ];
              albums = merged;
            }
          } catch (e) {
            // If Qobuz isn't available, just show local albums
          }
        }
        
        // Tidal albums are already included in the standard library query (result.albums)
        // They are identified by checking URL/ID/artwork_url for "tidal"
        // Count Tidal albums from the results
        if (tidalEnabled) {
          tidalAlbumsCount = albums.filter(album => album.source === 'tidal').length;
        }
      }

      // Total includes local, Qobuz, and Tidal albums
      const totalAlbums = result.total + qobuzAlbumsCount + tidalAlbumsCount;
      const nextPage = pageParam + PAGE_SIZE < totalAlbums ? pageParam + PAGE_SIZE : undefined;
      return { albums, total: totalAlbums, nextPage };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 0,
    enabled: !!activeServer,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInfiniteArtists() {
  const { activeServer } = useMusic();
  const { qobuzEnabled, localLibraryEnabled, isLoaded } = useSettings();
  
  return useInfiniteQuery({
    queryKey: ['artists', 'infinite', activeServer?.id, qobuzEnabled, localLibraryEnabled],
    queryFn: async ({ pageParam = 0 }) => {
      if (!activeServer) {
        console.log('[useInfiniteArtists] No active server');
        return { artists: [], total: 0, nextPage: undefined };
      }
      console.log('[useInfiniteArtists] Fetching artists, pageParam:', pageParam);
      lmsClient.setServer(activeServer.host, activeServer.port);
      try {
      const result = await lmsClient.getArtistsPage(pageParam, PAGE_SIZE, qobuzEnabled);
        console.log('[useInfiniteArtists] Got result:', result.artists.length, 'artists, total:', result.total);

        // Filter out artists based on integration settings
        let filteredArtists = result.artists;

        if (!localLibraryEnabled) {
          // If local library is disabled, filter out local artists (keep only streaming service artists)
          filteredArtists = result.artists.filter(artist => {
            const id = String(artist.id || '').toLowerCase();
            // Keep artists that are from streaming services (have service prefixes)
            return id.startsWith('qobuz-') || id.startsWith('tidal-') || id.startsWith('spotify-');
          });
        }

        // Fetch artist images (portraits) from TheAudioDB
        const artists = await Promise.all(
          filteredArtists.map(async (lmsArtist) => {
            const artist = convertLmsArtistToArtist(lmsArtist);
            try {
              const artistImage = await lmsClient.getArtistImage(lmsArtist.name);
              if (artistImage) {
                artist.imageUrl = artistImage;
              }
            } catch (e) {
              // Ignore errors - artist will have no image
            }
            return artist;
          })
        );

      const nextPage = pageParam + PAGE_SIZE < result.total ? pageParam + PAGE_SIZE : undefined;
      return { artists, total: result.total, nextPage };
      } catch (error) {
        console.error('[useInfiniteArtists] Error:', error);
        return { artists: [], total: 0, nextPage: undefined };
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 0,
    enabled: !!activeServer && isLoaded,
    staleTime: 5 * 60 * 1000,
  });
}

export function useFavoriteRadios() {
  const { activeServer } = useMusic();

  console.log('useFavoriteRadios enabled:', !!activeServer, 'activeServer:', activeServer);

  return useQuery({
    queryKey: ['radio', 'favorites', activeServer?.id],
    queryFn: async () => {
      console.log('useFavoriteRadios queryFn called');
      if (!activeServer) return [];
      lmsClient.setServer(activeServer.host, activeServer.port);
      return await lmsClient.getFavoriteRadios();
    },
    enabled: !!activeServer,
    staleTime: 5 * 60 * 1000,
  });
}
