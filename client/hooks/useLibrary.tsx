import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { lmsClient, LmsAlbum, LmsArtist, LmsRadioStation } from '@/lib/lmsClient';
import { useMusic } from './useMusic';

const PAGE_SIZE = 50;

export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  imageUrl?: string;
  year?: number;
  trackCount?: number;
  source?: "local" | "qobuz";
}

export interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  albumCount?: number;
}

const convertLmsAlbumToAlbum = (lmsAlbum: LmsAlbum, source: "local" | "qobuz" = "local"): Album => ({
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
  
  return useQuery({
    queryKey: ['albums', 'preview', activeServer?.id, limit],
    queryFn: async () => {
      if (!activeServer) return { albums: [], total: 0 };
      const result = await lmsClient.getAlbumsPage(0, limit);
      return {
        albums: result.albums.map(album => convertLmsAlbumToAlbum(album, 'local')),
        total: result.total,
      };
    },
    enabled: !!activeServer,
    staleTime: 5 * 60 * 1000,
  });
}

export function useArtistsPreview(limit: number = 20) {
  const { activeServer } = useMusic();
  
  return useQuery({
    queryKey: ['artists', 'preview', activeServer?.id, limit],
    queryFn: async () => {
      if (!activeServer) return { artists: [], total: 0 };
      const result = await lmsClient.getArtistsPage(0, limit);
      
      const artistsWithImages = await Promise.all(
        result.artists.map(async (lmsArtist) => {
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
      
      return {
        artists: artistsWithImages,
        total: result.total,
      };
    },
    enabled: !!activeServer,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInfiniteAlbums(artistId?: string) {
  const { activeServer } = useMusic();
  
  return useInfiniteQuery({
    queryKey: ['albums', 'infinite', activeServer?.id, artistId],
    queryFn: async ({ pageParam = 0 }) => {
      if (!activeServer) return { albums: [], total: 0, nextPage: undefined };
      const result = await lmsClient.getAlbumsPage(pageParam, PAGE_SIZE, artistId);
      const albums = result.albums.map(album => convertLmsAlbumToAlbum(album, 'local'));
      const nextPage = pageParam + PAGE_SIZE < result.total ? pageParam + PAGE_SIZE : undefined;
      return { albums, total: result.total, nextPage };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 0,
    enabled: !!activeServer,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInfiniteArtists() {
  const { activeServer } = useMusic();
  
  return useInfiniteQuery({
    queryKey: ['artists', 'infinite', activeServer?.id],
    queryFn: async ({ pageParam = 0 }) => {
      if (!activeServer) {
        console.log('[useInfiniteArtists] No active server');
        return { artists: [], total: 0, nextPage: undefined };
      }
      console.log('[useInfiniteArtists] Fetching artists, pageParam:', pageParam);
      try {
        const result = await lmsClient.getArtistsPage(pageParam, PAGE_SIZE);
        console.log('[useInfiniteArtists] Got result:', result.artists.length, 'artists, total:', result.total);
        
        // Fetch artist images (portraits) from TheAudioDB
        const artists = await Promise.all(
          result.artists.map(async (lmsArtist) => {
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
    enabled: !!activeServer,
    staleTime: 5 * 60 * 1000,
  });
}

export function useFavoriteRadios() {
  const { activeServer } = useMusic();
  
  return useQuery({
    queryKey: ['radio', 'favorites', activeServer?.id],
    queryFn: async () => {
      if (!activeServer) return [];
      // Ensure server is set before fetching favorites
      lmsClient.setServer(activeServer.host, activeServer.port);
      return await lmsClient.getFavoriteRadios();
    },
    enabled: !!activeServer,
    staleTime: 5 * 60 * 1000,
  });
}
