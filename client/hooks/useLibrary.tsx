import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lmsClient, LmsAlbum, LmsArtist, LmsRadioStation } from '@/lib/lmsClient';
import { getApiUrl } from '@/lib/query-client';
import { useMusic } from './useMusic';
import { useSettings } from './useSettings';

const PAGE_SIZE = 100;

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
  const { qobuzEnabled, tidalEnabled, soundcloudEnabled, spotifyEnabled, localLibraryEnabled, isLoaded } = useSettings();

  console.log('useAlbumsPreview enabled:', !!activeServer, 'activeServer:', activeServer);

  return useQuery({
    queryKey: ['albums', 'preview', activeServer?.id, limit, qobuzEnabled, tidalEnabled, localLibraryEnabled],
    queryFn: async () => {
      console.log('useAlbumsPreview queryFn called');
      if (!activeServer) return { albums: [], total: 0 };
      lmsClient.setServer(activeServer.host, activeServer.port);

      let albums = [];
      let total = 0;

      // Always include local LMS albums, then filter based on settings
      const result = await lmsClient.getAlbumsPage(0, limit);
      let allAlbums = result.albums.map(album => convertLmsAlbumToAlbum(album, 'local'));

      // Filter albums based on integration settings
      albums = allAlbums.filter(album => {
        const id = (album.id || '').toLowerCase();
        const imageUrl = (album.imageUrl || '').toLowerCase();

        // Check if this is a Spotify album
        const isSpotify = id.includes('spotify') || imageUrl.includes('spotify') || album.source === 'spotify';
        if (isSpotify && !spotifyEnabled) {
          return false;
        }

        // Check if this is a Tidal album
        const isTidal = id.includes('tidal') || imageUrl.includes('tidal') || album.source === 'tidal';
        if (isTidal && !tidalEnabled) {
          return false;
        }

        // Check if this is a Qobuz album
        const isQobuz = id.includes('qobuz') || imageUrl.includes('qobuz') || album.source === 'qobuz';
        if (isQobuz && !qobuzEnabled) {
          return false;
        }

        // Check if this is a local album (not from streaming services)
        const isLocal = album.source === 'local' || (!isSpotify && !isTidal && !isQobuz);
        if (isLocal && !localLibraryEnabled) {
          return false;
        }

        return true;
      });

      total = result.total;
      
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
      
      
      const qobuzCount = qobuzEnabled ? (await lmsClient.getQobuzFavoriteAlbums().catch(() => [])).length : 0;

      // Get Tidal count

      let tidalCount = 0;
      if (tidalEnabled) {
        try {
          const tidalResponse = await fetch(`${getApiUrl()}api/tidal/albums?limit=1&offset=0`);
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
  const { qobuzEnabled, tidalEnabled, soundcloudEnabled, spotifyEnabled, localLibraryEnabled, isLoaded } = useSettings();

  return useQuery({
    queryKey: ['artists', 'preview', activeServer?.id, limit, qobuzEnabled, tidalEnabled, soundcloudEnabled, spotifyEnabled, localLibraryEnabled],
    queryFn: async () => {
      if (!activeServer) return { artists: [], total: 0 };
      lmsClient.setServer(activeServer.host, activeServer.port);

      // Always fetch artists, then filter based on settings
      const result = await lmsClient.getArtistsPage(0, limit, qobuzEnabled);
      let allArtists = result.artists;

      // Filter artists based on integration settings
      let artists = allArtists.filter(artist => {
        const id = String(artist.id || '').toLowerCase();

        // Keep artists that are from enabled streaming services
        if (id.startsWith('qobuz-') && !qobuzEnabled) {
          return false;
        }
        if (id.startsWith('tidal-') && !tidalEnabled) {
          return false;
        }
        if (id.startsWith('spotify-') && !spotifyEnabled) {
          return false;
        }

        // For local artists (no prefix), check local library setting
        const isLocal = !id.startsWith('qobuz-') && !id.startsWith('tidal-') && !id.startsWith('spotify-');
        if (isLocal && !localLibraryEnabled) {
          return false;
        }

        return true;
      });

      let total = result.total;
      
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
          const tidalResponse = await fetch(`${getApiUrl()}api/tidal/artists?limit=${limit}&offset=0`);
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
          const tidalResponse = await fetch(`${getApiUrl()}api/tidal/artists?limit=1&offset=0`);
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
      console.log(`[useInfiniteAlbums] queryFn called for page ${pageParam}, tidalEnabled: ${tidalEnabled}`);
      if (!activeServer) return { albums: [], total: 0, nextPage: undefined };

      lmsClient.setServer(activeServer.host, activeServer.port);

      // Fetch LMS albums
      const result = await lmsClient.getAlbumsPage(pageParam, PAGE_SIZE, artistId);
      
      // Convert LMS albums to our Album format immediately
      const convertedLmsAlbums = result.albums.map(album => convertLmsAlbumToAlbum(album, 'local'));

      // Add Tidal albums if Tidal is enabled
      let tidalAlbums: Album[] = [];
      if (tidalEnabled && !artistId) { // Only fetch Tidal albums for all albums view, not artist-specific
        try {
          const apiUrl = getApiUrl();
          // Remove trailing slash if present to avoid double slashes
          const cleanApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
          const tidalResponse = await fetch(`${cleanApiUrl}/api/tidal/albums?limit=${PAGE_SIZE}&offset=${pageParam}`);
          console.log('[useInfiniteAlbums] Tidal response status:', tidalResponse.status);
          if (tidalResponse.ok) {
            const tidalResult = await tidalResponse.json();
            console.log('[useInfiniteAlbums] Tidal items found:', tidalResult.items?.length || 0);
            if (tidalResult.items) {
              tidalAlbums = tidalResult.items.map((album: any) => ({
                id: `tidal-${album.id}`,
                name: album.title,
                artist: album.artist, // Backend already provides artist name
                artistId: `tidal-artist-${album.artistId}`,
                imageUrl: album.artwork_url, // Backend already provides artwork_url
                year: album.year,
                trackCount: album.numberOfTracks,
                source: 'tidal' as const,
              }));
            }
          } else {
            console.warn('[useInfiniteAlbums] Failed to fetch Tidal albums:', tidalResponse.status);
          }
        } catch (e) {
          console.warn('Tidal albums not available:', e);
        }
      }
      
      // Combine LMS and Tidal albums
      const allAlbums = [...convertedLmsAlbums, ...tidalAlbums];
      
      // Remove duplicates by ID and Name+Artist
      const uniqueAlbumsMap = new Map();
      allAlbums.forEach(album => {
        const key = album.id.startsWith('tidal-') ? album.id : `${album.name.toLowerCase()}|${album.artist.toLowerCase()}`;
        if (!uniqueAlbumsMap.has(key)) {
          uniqueAlbumsMap.set(key, album);
        }
      });
      let albums = Array.from(uniqueAlbumsMap.values());

      console.log(`[useInfiniteAlbums] Merged albums: ${albums.length} (LMS: ${convertedLmsAlbums.length}, Tidal: ${tidalAlbums.length})`);

      // Sort albums by name
      albums.sort((a, b) => a.name.localeCompare(b.name));

      // Filter based on integration settings
      albums = albums.filter(album => {
        if (album.source === 'tidal' && !tidalEnabled) return false;
        if (album.source === 'spotify' && !spotifyEnabled) return false;
        if (album.source === 'qobuz' && !qobuzEnabled) return false;
        if (album.source === 'local' && !localLibraryEnabled) return false;
        return true;
      });

      // When not scoped to a specific artist, also merge in Qobuz "My Favorites" albums (if enabled)
      let qobuzAlbumsCount = 0;
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
      }

      // Total includes local, Qobuz, and Tidal albums
      const totalAlbums = result.total + qobuzAlbumsCount + tidalAlbums.length;
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
  const { qobuzEnabled, tidalEnabled, localLibraryEnabled, isLoaded } = useSettings();

  return useInfiniteQuery({
    queryKey: ['artists', 'infinite', activeServer?.id, qobuzEnabled, tidalEnabled, localLibraryEnabled],
    queryFn: async ({ pageParam = 0 }) => {
      if (!activeServer) {
        console.log('[useInfiniteArtists] No active server');
        return { artists: [], total: 0, nextPage: undefined };
      }
      console.log('[useInfiniteArtists] Fetching artists, pageParam:', pageParam);
      lmsClient.setServer(activeServer.host, activeServer.port);
      try {
      const result = await lmsClient.getArtistsPage(pageParam, PAGE_SIZE, qobuzEnabled);

      // Add Tidal artists if Tidal is enabled
      let tidalArtists: Artist[] = [];
      if (tidalEnabled) {
        try {
          const tidalResponse = await fetch(`${getApiUrl()}api/tidal/artists?limit=${PAGE_SIZE}&offset=${pageParam}`);
          if (tidalResponse.ok) {
            const tidalResult = await tidalResponse.json();
            if (tidalResult.items) {
              tidalArtists = tidalResult.items.map((artist: any) => ({
                id: `tidal-artist-${artist.id}`,
                name: artist.name,
                imageUrl: artist.picture ? `https://resources.tidal.com/images/${artist.picture.replace(/-/g, '/')}/640x640.jpg` : undefined,
                albumCount: undefined, // Not available from Tidal API
              }));
            }
          }
        } catch (e) {
          console.warn('Tidal artists not available:', e);
        }
      }
        // Convert all to Artist objects first
        const lmsArtists = result.artists.map(a => convertLmsArtistToArtist(a));
        const allArtists = [...lmsArtists, ...tidalArtists];

        // Sort artists by name
        allArtists.sort((a, b) => a.name.localeCompare(b.name));

        // Filter out artists based on integration settings
        let filteredArtists = allArtists;

        if (!localLibraryEnabled) {
          // If local library is disabled, filter out local artists (keep only streaming service artists)
          filteredArtists = allArtists.filter(artist => {
            const id = String(artist.id || '').toLowerCase();
            // Keep artists that are from streaming services (have service prefixes)
            return id.startsWith('qobuz-') || id.startsWith('tidal-') || id.startsWith('spotify-');
          });
        }

        // Fetch artist images (portraits) from TheAudioDB for local artists if they don't have one
        const artists = await Promise.all(
          filteredArtists.map(async (artist) => {
            if (!artist.imageUrl) {
              try {
                const artistImage = await lmsClient.getArtistImage(artist.name);
                if (artistImage) {
                  artist.imageUrl = artistImage;
                }
              } catch (e) {
                // Ignore errors
              }
            }
            return artist;
          })
        );

      // Calculate total including Tidal artists
      const totalArtists = result.total + tidalArtists.length;
      const nextPage = pageParam + PAGE_SIZE < totalArtists ? pageParam + PAGE_SIZE : undefined;
      return { artists, total: totalArtists, nextPage };
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

export function useRadioStations() {
  const { activeServer } = useMusic();

  console.log('useRadioStations enabled:', !!activeServer, 'activeServer:', activeServer);

  return useQuery({
    queryKey: ['radio', 'stations', activeServer?.id],
    queryFn: async () => {
      console.log('useRadioStations queryFn called');
      if (!activeServer) return [];
      lmsClient.setServer(activeServer.host, activeServer.port);
      return await lmsClient.getRadioStations();
    },
    enabled: !!activeServer,
    staleTime: 5 * 60 * 1000,
  });
}
