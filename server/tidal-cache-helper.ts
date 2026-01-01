// Tidal cache helper - provides fallback data when Tidal API is unavailable

interface CachedAlbum {
  id: string;
  title: string;
  artist: string;
  cover: string;
}

interface CachedPlaylist {
  id: string;
  title: string;
  creator: string;
  numberOfTracks: number;
  image: string;
}

interface CachedArtist {
  id: string;
  name: string;
  picture: string;
}

interface CachedTotals {
  albums: number;
  playlists: number;
  artists: number;
  tracks: number;
}

interface PaginatedResult<T> {
  items: T[];
  totalNumberOfItems: number;
  limit: number;
  offset: number;
}

// Return empty results as fallback (no cache available)
export function getCachedAlbums(limit: number = 50, offset: number = 0): PaginatedResult<CachedAlbum> {
  return {
    items: [],
    totalNumberOfItems: 0,
    limit,
    offset
  };
}

export function getCachedPlaylists(limit: number = 50, offset: number = 0): PaginatedResult<CachedPlaylist> {
  return {
    items: [],
    totalNumberOfItems: 0,
    limit,
    offset
  };
}

export function getCachedArtists(limit: number = 50, offset: number = 0): PaginatedResult<CachedArtist> {
  return {
    items: [],
    totalNumberOfItems: 0,
    limit,
    offset
  };
}

export function getCachedTotals(): CachedTotals {
  return {
    albums: 0,
    playlists: 0,
    artists: 0,
    tracks: 0
  };
}

