import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { lmsClient, LmsAlbum, LmsArtist } from '@/lib/lmsClient';
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
}

export interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  albumCount?: number;
}

const convertLmsAlbumToAlbum = (lmsAlbum: LmsAlbum): Album => ({
  id: lmsAlbum.id,
  name: lmsAlbum.title,
  artist: lmsAlbum.artist,
  artistId: lmsAlbum.artistId || '',
  imageUrl: lmsClient.getArtworkUrl(lmsAlbum),
  year: lmsAlbum.year,
  trackCount: lmsAlbum.trackCount,
});

const convertLmsArtistToArtist = (lmsArtist: LmsArtist): Artist => ({
  id: lmsArtist.id,
  name: lmsArtist.name,
  albumCount: lmsArtist.albumCount,
});

export function useAlbumsPreview(limit: number = 20) {
  const { activeServer } = useMusic();
  
  return useQuery({
    queryKey: ['albums', 'preview', activeServer?.id, limit],
    queryFn: async () => {
      if (!activeServer) return { albums: [], total: 0 };
      const result = await lmsClient.getAlbumsPage(0, limit);
      return {
        albums: result.albums.map(convertLmsAlbumToAlbum),
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
      return {
        artists: result.artists.map(convertLmsArtistToArtist),
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
      const albums = result.albums.map(convertLmsAlbumToAlbum);
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
      if (!activeServer) return { artists: [], total: 0, nextPage: undefined };
      const result = await lmsClient.getArtistsPage(pageParam, PAGE_SIZE);
      const artists = result.artists.map(convertLmsArtistToArtist);
      const nextPage = pageParam + PAGE_SIZE < result.total ? pageParam + PAGE_SIZE : undefined;
      return { artists, total: result.total, nextPage };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 0,
    enabled: !!activeServer,
    staleTime: 5 * 60 * 1000,
  });
}
