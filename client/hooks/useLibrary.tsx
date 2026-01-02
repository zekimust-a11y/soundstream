import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lmsClient, LmsAlbum, LmsArtist, LmsRadioStation } from '@/lib/lmsClient';
import { getApiUrl } from '@/lib/query-client';
import { useMusic } from './useMusic';
import { useSettings } from './useSettings';

// LMS can handle large pages; TIDAL v2 endpoints typically cap at 100 and use offset pagination.
const LMS_PAGE_SIZE = 500;
const TIDAL_PAGE_SIZE = 100;

export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  imageUrl?: string;
  year?: number;
  trackCount?: number;
  source?: "local"  | "tidal" | "spotify" | "soundcloud";
}

export interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  albumCount?: number;
}

const convertLmsAlbumToAlbum = (lmsAlbum: LmsAlbum, source: "local"  | "tidal" | "spotify" | "soundcloud" = "local"): Album => ({
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
  const {  tidalEnabled, soundcloudEnabled, spotifyEnabled, localLibraryEnabled, isLoaded } = useSettings();

  console.log('useAlbumsPreview enabled:', !!activeServer, 'activeServer:', activeServer);

  return useQuery({
    queryKey: ['albums', 'preview', activeServer?.id, limit,  tidalEnabled, localLibraryEnabled],
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
        total: total  + tidalCount,
      };
    },
    enabled: !!activeServer && isLoaded,
    staleTime: 5 * 60 * 1000,
  });
}

export function useArtistsPreview(limit: number = 20) {
  const { activeServer } = useMusic();
  const {  tidalEnabled, soundcloudEnabled, spotifyEnabled, localLibraryEnabled, isLoaded } = useSettings();

  return useQuery({
    queryKey: ['artists', 'preview', activeServer?.id, limit,  tidalEnabled, soundcloudEnabled, spotifyEnabled, localLibraryEnabled],
    queryFn: async () => {
      if (!activeServer) return { artists: [], total: 0 };
      lmsClient.setServer(activeServer.host, activeServer.port);

      // Always fetch artists, then filter based on settings
      const result = await lmsClient.getArtistsPage(0, limit);
      let allArtists = result.artists;

      // Filter artists based on integration settings
      let artists = allArtists.filter(artist => {
        const id = String(artist.id || '').toLowerCase();

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
          const tidalResponse = await fetch(`${getApiUrl()}/api/tidal/artists?limit=${limit}&offset=0`);
          if (tidalResponse.ok) {
            const tidalResult = await tidalResponse.json();
            if (tidalResult.items && tidalResult.items.length > 0) {
              const tidalArtists = tidalResult.items.map((artist: any) => ({
                id: `tidal-artist-${artist.id}`,
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
  const {  spotifyEnabled, tidalEnabled, localLibraryEnabled, isLoaded } = useSettings();

  return useInfiniteQuery({
    queryKey: ['albums', 'infinite', activeServer?.id, artistId,  spotifyEnabled, tidalEnabled, localLibraryEnabled],
    queryFn: async ({ pageParam = { lmsOffset: 0, tidalOffset: 0 } as any }) => {
      const lmsOffset = Number(pageParam?.lmsOffset || 0);
      const tidalOffset = Number(pageParam?.tidalOffset || 0);
      console.log(`[useInfiniteAlbums] queryFn called: lmsOffset=${lmsOffset}, tidalOffset=${tidalOffset}, LMS_PAGE_SIZE=${LMS_PAGE_SIZE}, TIDAL_PAGE_SIZE=${TIDAL_PAGE_SIZE}, tidalEnabled=${tidalEnabled}, localEnabled=${localLibraryEnabled}`);
      
      if (!activeServer) return { albums: [], total: 0, nextPage: undefined };

      lmsClient.setServer(activeServer.host, activeServer.port);

      // Fetch LMS albums
      const result = await lmsClient.getAlbumsPage(lmsOffset, LMS_PAGE_SIZE, artistId);
      const convertedLmsAlbums = result.albums.map(album => convertLmsAlbumToAlbum(album, 'local'));
      console.log(`[useInfiniteAlbums] LMS albums fetched: ${convertedLmsAlbums.length}, total reported by LMS: ${result.total}`);

      // Add Tidal albums if Tidal is enabled
      let tidalAlbums: Album[] = [];
      let tidalTotalCount = 0;
      if (tidalEnabled && !artistId) {
        try {
          const apiUrl = getApiUrl();
          const cleanApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
          const url = `${cleanApiUrl}/api/tidal/albums?limit=${TIDAL_PAGE_SIZE}&offset=${tidalOffset}`;
          console.log(`[useInfiniteAlbums] Fetching Tidal albums from: ${url}`);
          const tidalResponse = await fetch(url);
          if (tidalResponse.ok) {
            const tidalResult = await tidalResponse.json();
            console.log(`[useInfiniteAlbums] Tidal items found: ${tidalResult.items?.length || 0}, total: ${tidalResult.total}`);
            tidalTotalCount = tidalResult.total || 0;
            if (tidalResult.items) {
              tidalAlbums = tidalResult.items.map((album: any) => ({
                id: `tidal-${album.id}`,
                name: album.title,
                artist: album.artist,
                artistId: `tidal-artist-${album.artistId}`,
                imageUrl: album.artwork_url,
                year: album.year,
                trackCount: album.numberOfTracks,
                source: 'tidal' as const,
              }));
            }
          } else {
            console.error(`[useInfiniteAlbums] Tidal API error: ${tidalResponse.status}`);
          }
        } catch (e) {
          console.warn('[useInfiniteAlbums] Tidal albums not available:', e);
        }
      }
      
      // Combine LMS and Tidal albums
      const allAlbums = [...convertedLmsAlbums, ...tidalAlbums];
      console.log(`[useInfiniteAlbums] Combined count before dedupe: ${allAlbums.length}`);
      
      // Remove duplicates
      const uniqueAlbumsMap = new Map();
      allAlbums.forEach(album => {
        // De-dupe aggressively to avoid repeated pages showing as duplicates in the UI.
        // For TIDAL, ids can differ across editions; use name+artist+year as a stable key.
        const key = `${(album.source || 'local')}|${(album.name || '').toLowerCase()}|${(album.artist || '').toLowerCase()}|${album.year || ''}`;
        const existing = uniqueAlbumsMap.get(key) as Album | undefined;
        if (!existing) {
          uniqueAlbumsMap.set(key, album);
          return;
        }
        // Prefer entries with a real imageUrl.
        if (!existing.imageUrl && album.imageUrl) uniqueAlbumsMap.set(key, album);
      });
      let albums = Array.from(uniqueAlbumsMap.values());
      console.log(`[useInfiniteAlbums] After dedupe: ${albums.length}`);

      // Filter based on integration settings
      albums = albums.filter(album => {
        if (album.source === 'tidal' && !tidalEnabled) return false;
        if (album.source === 'spotify' && !spotifyEnabled) return false;
        if (album.source === 'local' && !localLibraryEnabled) return false;
        return true;
      });
      console.log(`[useInfiniteAlbums] After filtering: ${albums.length}`);

      // Sort albums by name
      albums.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      // Total should reflect enabled sources (otherwise headers show "wrong" counts when local/tidal toggles are off).
      const totalAlbumsCount =
        (localLibraryEnabled ? (result.total || 0) : 0) +
        (tidalEnabled && !artistId ? (tidalTotalCount || 0) : 0);
      const nextLmsOffset = (lmsOffset + LMS_PAGE_SIZE < (result.total || 0)) ? (lmsOffset + LMS_PAGE_SIZE) : lmsOffset;
      const nextTidalOffset = (tidalEnabled && !artistId && (tidalOffset + TIDAL_PAGE_SIZE < (tidalTotalCount || 0))) ? (tidalOffset + TIDAL_PAGE_SIZE) : tidalOffset;
      const hasMoreLocal = nextLmsOffset !== lmsOffset;
      const hasMoreTidal = nextTidalOffset !== tidalOffset;
      const nextPage = (hasMoreLocal || hasMoreTidal) ? { lmsOffset: nextLmsOffset, tidalOffset: nextTidalOffset } : undefined;
      
      console.log(`[useInfiniteAlbums] Returning ${albums.length} albums, totalAlbumsCount=${totalAlbumsCount}, nextPage=${nextPage}`);
      
      return { albums, total: totalAlbumsCount, nextPage };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: { lmsOffset: 0, tidalOffset: 0 } as any,
    enabled: !!activeServer,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInfiniteArtists() {
  const { activeServer } = useMusic();
  const {  tidalEnabled, localLibraryEnabled, isLoaded } = useSettings();

  return useInfiniteQuery({
    queryKey: ['artists', 'infinite', activeServer?.id,  tidalEnabled, localLibraryEnabled],
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
      let tidalTotalCount = 0;
      if (tidalEnabled) {
        try {
          const apiUrl = getApiUrl();
          const cleanApiUrl = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
          const tidalResponse = await fetch(`${cleanApiUrl}/api/tidal/artists?limit=${PAGE_SIZE}&offset=${pageParam}`);
          if (tidalResponse.ok) {
            const tidalResult = await tidalResponse.json();
            tidalTotalCount = tidalResult.total || 0;
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
            return id.startsWith('tidal-') || id.startsWith('spotify-');
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
      const totalArtistsCount = (result.total || 0) + (tidalTotalCount || 0);
      const nextPage = pageParam + PAGE_SIZE < totalArtistsCount ? pageParam + PAGE_SIZE : undefined;
      return { artists, total: totalArtistsCount, nextPage };
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
