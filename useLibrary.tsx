import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lmsClient, LmsAlbum, LmsArtist, LmsRadioStation } from '@/lib/lmsClient';
import { getApiUrl } from '@/lib/query-client';
import { useMusic } from './useMusic';
import { useSettings } from './useSettings';

const PAGE_SIZE = 1000;

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
  const { tidalEnabled, soundcloudEnabled, spotifyEnabled, localLibraryEnabled, isLoaded } = useSettings();

  console.log('useAlbumsPreview enabled:', !!activeServer, 'activeServer:', activeServer);

  return useQuery({
    queryKey: ['albums', 'preview', activeServer?.id, limit, tidalEnabled, localLibraryEnabled],
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

        // Check if this is a local album (not from streaming services)
        const isLocal = album.source === 'local' || (!isSpotify && !isTidal);
        if (isLocal && !localLibraryEnabled) {
          return false;
        }

        return true;
      });

      total = result.total;

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
        total: total + tidalCount,
      };
    },
    enabled: !!activeServer && isLoaded,
    staleTime: 5 * 60 * 1000,
  });
}

export function useArtistsPreview(limit: number = 20) {
  const { activeServer } = useMusic();
  const { tidalEnabled, soundcloudEnabled, spotifyEnabled, localLibraryEnabled, isLoaded } = useSettings();

  return useQuery({
    queryKey: ['artists', 'preview', activeServer?.id, limit, tidalEnabled, soundcloudEnabled, spotifyEnabled, localLibraryEnabled],
    queryFn: async () => {
      if (!activeServer) return { artists: [], total: 0 };
      lmsClient.setServer(activeServer.host, activeServer.port);

      // Always fetch artists, then filter based on settings
      const result = await lmsClient.getArtistsPage(0, limit, false);
      let allArtists = result.artists;

      // Filter artists based on integration settings
      let artists = allArtists.filter(artist => {
        const id = String(artist.id || '').toLowerCase();

        // Keep artists that are from enabled streaming services
        if (id.startsWith('tidal-') && !tidalEnabled) {
          return false;
        }
        if (id.startsWith('spotify-') && !spotifyEnabled) {
          return false;
        }

        // For local artists (no prefix), check local library setting
        const isLocal = !id.startsWith('tidal-') && !id.startsWith('spotify-');
        if (isLocal && !localLibraryEnabled) {
          return false;
        }

        return true;
      });

      let total = result.total;
      
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
    queryKey: ['albums', 'infinite', activeServer?.id, artistId, spotifyEnabled, tidalEnabled, localLibraryEnabled],
    queryFn: async ({ pageParam = 0 }) => {
      console.log('useInfiniteAlbums queryFn called');
      if (!activeServer) return { albums: [], total: 0, nextPage: undefined };

      lmsClient.setServer(activeServer.host, activeServer.port);

      // Fetch LMS albums
      const result = await lmsClient.getAlbumsPage(pageParam, PAGE_SIZE, artistId);

      // Add Tidal albums if Tidal is enabled
      let tidalAlbums: Album[] = [];
      if (tidalEnabled && !artistId) { // Only fetch Tidal albums for all albums view, not artist-specific
        try {
          const tidalResponse = await fetch(`${getApiUrl()}/api/tidal/albums?limit=${PAGE_SIZE}&offset=${pageParam}`);
          if (tidalResponse.ok) {
            const tidalResult = await tidalResponse.json();
            if (tidalResult.items) {
              tidalAlbums = tidalResult.items.map((album: any) => ({
                id: `tidal-${album.id}`,
                name: album.title,
                artist: album.artist.name,
                artistId: `tidal-artist-${album.artist.id}`,
                imageUrl: album.cover ? `https://resources.tidal.com/images/${album.cover.replace(/-/g, '/')}/640x640.jpg` : undefined,
                year: album.year,
                trackCount: album.numberOfTracks,
                source: 'tidal' as const,
              }));
            }
          }
        } catch (e) {
          console.warn('Tidal albums not available:', e);
        }
      }
      
      // Combine LMS and Tidal albums
      const allAlbums = [...result.albums, ...tidalAlbums];

      // Filter out disabled service albums, and identify source
      let albums = allAlbums
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
          const isLocal = !isSpotify && !isTidal;
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
          let source: "local" | "tidal" | "spotify" | "soundcloud" = "local";
          if (id.includes('tidal') || artworkUrl.includes('tidal') || url.includes('tidal')) {
            source = 'tidal';
          } else if (id.includes('spotify') || artworkUrl.includes('spotify') || url.includes('spotify')) {
            source = 'spotify';
          } else if (id.includes('soundcloud') || artworkUrl.includes('soundcloud') || url.includes('soundcloud')) {
            source = 'soundcloud';
          }
          
          return convertLmsAlbumToAlbum(album, source);
        });

      // When not scoped to a specific artist, also merge in Tidal "My Favorites" albums (if enabled)
      let tidalAlbumsCount = 0;
      if (!artistId) {
        // Tidal albums are fetched separately from the API and added to the albums array
        // Count Tidal albums from the tidalAlbums we added
        if (tidalEnabled && !artistId) {
          tidalAlbumsCount = tidalAlbums.length;
        }
      }

      // Total includes local and Tidal albums
      const totalAlbums = result.total + tidalAlbumsCount;
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
  const { tidalEnabled, localLibraryEnabled, isLoaded } = useSettings();

  return useInfiniteQuery({
    queryKey: ['artists', 'infinite', activeServer?.id, tidalEnabled, localLibraryEnabled],
    queryFn: async ({ pageParam = 0 }) => {
      if (!activeServer) {
        console.log('[useInfiniteArtists] No active server');
        return { artists: [], total: 0, nextPage: undefined };
      }
      console.log('[useInfiniteArtists] Fetching artists, pageParam:', pageParam);
      lmsClient.setServer(activeServer.host, activeServer.port);
      try {
      const result = await lmsClient.getArtistsPage(pageParam, PAGE_SIZE);

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
        console.log('[useInfiniteArtists] Got result:', result.artists.length, 'artists, total:', result.total, 'tidal artists:', tidalArtists.length);

        // Combine LMS and Tidal artists
        const allArtists = [...result.artists, ...tidalArtists];

        // Filter out artists based on integration settings
        let filteredArtists = allArtists;

        if (!localLibraryEnabled) {
          // If local library is disabled, filter out local artists (keep only streaming service artists)
          filteredArtists = allArtists.filter(artist => {
            const id = String(artist.id || '').toLowerCase();
            // Keep artists that are from streaming services (have service prefixes)
            return id.startsWith('tidal-') || id.startsWith('spotify-');
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
