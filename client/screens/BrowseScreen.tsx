import React, { useCallback, useState, useMemo, useEffect } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { AlbumArtwork } from "@/components/AlbumArtwork";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback, Track } from "@/hooks/usePlayback";
import { useSettings } from "@/hooks/useSettings";
import { lmsClient, type LmsAlbum } from "@/lib/lmsClient";
import { debugLog } from "@/lib/debugLog";
import { useInfiniteArtists, type Artist } from "@/hooks/useLibrary";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

type NavigationProp = NativeStackNavigationProp<BrowseStackParamList>;

type RecentItem =
  | { kind: "track"; id: string; track: Track }
  | { kind: "album"; id: string; track: Track }
  | { kind: "playlist"; id: string; playlistId: string; name: string; artwork?: string };

export default function BrowseScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const {
    recentlyPlayed,
    recentlyPlayedItems,
    playlists,
    refreshLibrary,
    activeServer,
    tidalConnected,
    isLoading: musicLoading,
  } = useMusic();
  const { playTrack, playPlaylist, activePlayer, syncPlayerStatus } = usePlayback();
  const {  tidalEnabled } = useSettings();
  const { data: artistsData, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteArtists();
  
  // Flatten all artists from all pages safely
  const allArtists = useMemo(() => {
    if (!artistsData?.pages) return [];
    return artistsData.pages.flatMap(page => page?.artists || []);
  }, [artistsData]);
  const [isShuffling, setIsShuffling] = useState(false);
  const [tidalAlbums, setTidalAlbums] = useState<LmsAlbum[]>([]);
  const [tidalPlaylists, setTidalPlaylists] = useState<LmsPlaylist[]>([]);
  const [tidalMixes, setTidalMixes] = useState<any[]>([]);

  // Load Tidal content
  useEffect(() => {
    const loadTidalContent = async () => {
      if (!tidalEnabled || !tidalConnected) {
        setTidalAlbums([]);
        setTidalPlaylists([]);
        setTidalMixes([]);
        return;
      }
      try {
        const { getApiUrl } = await import('@/lib/query-client');
        const apiUrl = getApiUrl();
        
        // Load albums
        fetch(`${apiUrl}/api/tidal/albums?limit=20`)
          .then(res => res.ok ? res.json() : null)
          .then(data => data && setTidalAlbums(data.items.map((a: any) => ({
            id: `tidal-${a.id}`,
            title: a.title,
            artist: a.artist,
            artistId: `tidal-artist-${a.artistId}`,
            artwork_url: a.artwork_url,
            trackCount: a.numberOfTracks,
            year: a.year,
            source: 'tidal'
          }))));

        // Load playlists
        fetch(`${apiUrl}/api/tidal/playlists?limit=20`)
          .then(res => res.ok ? res.json() : null)
          .then(data => data && setTidalPlaylists(data.items.map((p: any) => ({
            id: `tidal-${p.id}`,
            name: p.title,
            url: p.lmsUri,
            artwork_url: p.cover,
            trackCount: p.numberOfTracks,
            source: 'tidal'
          }))));

        // Load mixes
        fetch(`${apiUrl}/api/tidal/mixes`)
          .then(res => res.ok ? res.json() : null)
          .then(data => data && setTidalMixes(data.items));

      } catch (error) {
        console.error('Error loading Tidal content:', error);
      }
    };
    loadTidalContent();
  }, [tidalEnabled, tidalConnected]);

  const recentItems: RecentItem[] = useMemo(() => {
    const items: RecentItem[] = [];
    const seen = new Set<string>();

    // First, add playlists from recentlyPlayedItems
    for (const item of recentlyPlayedItems) {
      if (item.type === 'playlist' && item.playlistId) {
        const key = `playlist-${item.playlistId}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({
            kind: "playlist",
            id: key,
            playlistId: item.playlistId,
            name: item.name,
            artwork: item.artwork,
          });
        }
      }
    }

    // Then add tracks/albums from recentlyPlayed (for backward compatibility)
    for (const track of recentlyPlayed) {
      if (!track) continue;

      // Prefer album grouping when we have an albumId
      if (track.albumId) {
        const key = `album-${track.albumId}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({ kind: "album", id: key, track });
        }
      } else {
        const key = `track-${track.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({ kind: "track", id: key, track });
        }
      }
    }

    // Limit to 30 items for the horizontal list
    return items.slice(0, 30);
  }, [recentlyPlayed, recentlyPlayedItems]);

  const handleRefresh = useCallback(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  const handleShuffleAll = useCallback(async () => {
    if (!activePlayer || !activeServer || isShuffling) {
      if (!activePlayer) {
        Alert.alert('No Player', 'Please select a player first to shuffle the library.');
      }
      return;
    }

    setIsShuffling(true);
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);

      // Enable shuffle mode first
      await lmsClient.setShuffle(activePlayer.id, 1);

      // Get a sample of tracks from the library
      // Fetch up to 5000, but we'll only shuffle & play a random 1000
      const lmsTracks = await lmsClient.getAllLibraryTracks(5000);

      if (lmsTracks.length === 0) {
        Alert.alert('No Tracks', 'No tracks found in library to shuffle.');
        setIsShuffling(false);
        return;
      }

      console.log(`[Shuffle] Found ${lmsTracks.length} tracks in library`);
      console.log(`[Shuffle] Sample track IDs:`, lmsTracks.slice(0, 3).map(t => t.id));

      // Convert to app Track format
      // Keep the original LMS track ID for adding to playlist
      const tracks: Track[] = lmsTracks.map(t => ({
        id: `${activeServer.id}-${t.id}`,
        title: t.title,
        artist: t.artist,
        album: t.album,
        albumArt: t.artwork_url ? lmsClient.getArtworkUrl(t as any) : undefined,
        duration: t.duration,
        source: 'local',
        uri: t.url,
        format: t.format,
        bitrate: t.bitrate,
        sampleRate: t.sampleRate,
        bitDepth: t.bitDepth,
        lmsTrackId: t.id, // This is the raw LMS track ID we need
      }));

      // Limit to 200 random tracks to avoid overloading the queue / LMS
      // Start with fewer tracks to ensure it works, can increase later
      const MAX_SHUFFLE_TRACKS = 200;
      let pool = tracks;
      if (tracks.length > MAX_SHUFFLE_TRACKS) {
        const selectedIndices = new Set<number>();
        while (selectedIndices.size < MAX_SHUFFLE_TRACKS) {
          const idx = Math.floor(Math.random() * tracks.length);
          selectedIndices.add(idx);
        }
        pool = Array.from(selectedIndices).map((idx) => tracks[idx]);
      }

      console.log(`[Shuffle] Selected ${pool.length} tracks from ${tracks.length} available`);

      // Shuffle the pool using Fisher-Yates algorithm
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      // Ensure player is powered on
      await lmsClient.setPower(activePlayer.id, true);

      // Clear current playlist and load shuffled tracks directly into LMS
      await lmsClient.clearPlaylist(activePlayer.id);

      // Add tracks using LMS track ID (not app composite ID)
      const trackIds = shuffled
        .filter(t => t.lmsTrackId)
        .map(t => t.lmsTrackId!);

      if (trackIds.length === 0) {
        Alert.alert('No Tracks', 'No valid tracks to add to playlist.');
        setIsShuffling(false);
        return;
      }

      console.log(`[Shuffle] Adding ${trackIds.length} tracks to playlist...`);
      console.log(`[Shuffle] First few track IDs:`, trackIds.slice(0, 5));

      // Add tracks in smaller batches with delays to avoid overwhelming LMS
      const BATCH_SIZE = 20;
      let addedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < trackIds.length; i += BATCH_SIZE) {
        const batch = trackIds.slice(i, i + BATCH_SIZE);
        console.log(`[Shuffle] Adding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(trackIds.length / BATCH_SIZE)} (${batch.length} tracks})`);

        // Add tracks in batch with Promise.all for speed, but catch individual errors
        const results = await Promise.allSettled(
          batch.map(trackId => lmsClient.addTrackToPlaylist(activePlayer.id, trackId))
        );

        results.forEach((result, idx) => {
          if (result.status === 'fulfilled') {
            addedCount++;
          } else {
            failedCount++;
            console.warn(`[Shuffle] Failed to add track ${batch[idx]}:`, result.reason);
          }
        });

        // Small delay between batches to avoid overwhelming the server
        if (i + BATCH_SIZE < trackIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`[Shuffle] Added ${addedCount} of ${trackIds.length} tracks (${failedCount} failed)`);

      if (addedCount === 0) {
        Alert.alert(
          'Failed to Add Tracks',
          'No tracks could be added to the playlist. Please check your server connection and try again.'
        );
        setIsShuffling(false);
        return;
      }

      // Wait for playlist to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify playlist has tracks before playing
      const playlistStatus = await lmsClient.getPlayerStatus(activePlayer.id);
      console.log(`[Shuffle] Playlist status: ${playlistStatus.playlistLength} tracks`);

      if (playlistStatus.playlistLength === 0) {
        Alert.alert(
          'Playlist Empty',
          'No tracks were added to the playlist. This may be a server issue. Please try again.'
        );
        setIsShuffling(false);
        return;
      }

      // Ensure shuffle is enabled and start playback
      await lmsClient.setShuffle(activePlayer.id, 1);
      await lmsClient.play(activePlayer.id);

      console.log('[Shuffle] Playback started');

      // Sync status so UI updates to the shuffled playback
      setTimeout(() => {
        syncPlayerStatus();
      }, 500);
    } catch (error) {
      console.error('Failed to shuffle all tracks:', error);
      // Show error to user
      Alert.alert(
        'Shuffle Failed',
        `Failed to shuffle library: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease try again or check your connection.`,
        [{ text: 'OK' }]
      );
    } finally {
      setIsShuffling(false);
    }
  }, [activePlayer, activeServer, isShuffling, playTrack]);

  const handleRecentItemPress = useCallback(
    async (item: RecentItem) => {
      if (!activePlayer || !activeServer) return;

      if (item.kind === "playlist") {
        // Play the playlist
        try {
          lmsClient.setServer(activeServer.host, activeServer.port);
          await playPlaylist(item.playlistId, item.name, item.artwork);
        } catch (error) {
          console.error("Failed to play playlist from Recently Played:", error);
        }
        return;
      }

      if (item.kind === "track") {
        // Replay the specific track
        playTrack(item.track);
        return;
      }

      // Album: play the whole album again if we have an albumId
      const { track } = item;
      if (!track.albumId) {
        // Fallback: just play the track if album id is missing
        playTrack(track);
        return;
      }

      try {
        lmsClient.setServer(activeServer.host, activeServer.port);
        await lmsClient.setPower(activePlayer.id, true);
        await lmsClient.playAlbum(activePlayer.id, track.albumId);
        await lmsClient.play(activePlayer.id);
      } catch (error) {
        console.error("Failed to play album from Recently Played:", error);
      }
    },
    [activePlayer, activeServer, playTrack, playPlaylist]
  );

  // Load Tidal albums for the Browse screen
  useEffect(() => {
    const loadTidalAlbums = async () => {
      if (!tidalEnabled || !tidalConnected) {
        setTidalAlbums([]);
        return;
      }
      try {
        const { getApiUrl } = await import('@/lib/query-client');
        const response = await fetch(`${getApiUrl()}/api/tidal/albums?limit=30`);
        if (response.ok) {
          const data = await response.json();
          const albums = (data.items || []).map((album: any) => ({
            id: `tidal-${album.id}`,
            title: album.title,
            artist: album.artist,
            artistId: album.artistId || '',
            artwork_url: album.artwork_url,
            year: album.year,
            trackCount: album.numberOfTracks,
            lmsUri: album.lmsUri,
            source: 'tidal' as const,
          }));
          setTidalAlbums(albums);
        } else {
          console.warn('Failed to fetch Tidal albums:', response.status);
          setTidalAlbums([]);
        }
      } catch (e) {
        debugLog.info(
          "Tidal albums not available",
          e instanceof Error ? e.message : String(e),
        );
        setTidalAlbums([]);
      }
    };
    loadTidalAlbums();
  }, [tidalEnabled, tidalConnected]);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: tabBarHeight + Spacing["5xl"] },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={musicLoading}
            onRefresh={handleRefresh}
            tintColor={Colors.light.accent}
          />
        }
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
          <View style={styles.headerLeft}>
            <ThemedText style={styles.headerTitle}>Browse</ThemedText>
          </View>
          <View style={styles.headerRight}>
            <Pressable
              style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
              onPress={handleShuffleAll}
            >
              {isShuffling ? (
                <ActivityIndicator size="small" color={Colors.light.text} />
              ) : (
                <Feather name="shuffle" size={20} color={Colors.light.text} />
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => navigation.navigate("History")}
            >
              <Feather name="clock" size={20} color={Colors.light.text} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => navigation.navigate("Settings")}
            >
              <Feather name="settings" size={20} color={Colors.light.text} />
            </Pressable>
          </View>
        </View>

        {/* Recently Played Section */}
        {recentItems.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Recently Played</ThemedText>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {recentItems.map((item) => {
                if (item.kind === "playlist") {
                  return (
                    <Pressable
                      key={item.id}
                      style={({ pressed }) => [
                        styles.smallCard,
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                      onPress={() => handleRecentItemPress(item)}
                    >
                    <AlbumArtwork
                      source={item.artwork}
                      style={styles.smallImage}
                      contentFit="cover"
                    />
                      <ThemedText
                        style={styles.smallTitle}
                        numberOfLines={1}
                      >
                        {item.name}
                      </ThemedText>
                      <ThemedText
                        style={styles.smallSubtitle}
                        numberOfLines={1}
                      >
                        Playlist
                      </ThemedText>
                    </Pressable>
                  );
                }

                const track = item.track;
                const title =
                  item.kind === "track"
                    ? track.title
                    : track.album || track.title;
                const subtitle = track.artist;

                return (
                  <Pressable
                    key={item.id}
                    style={({ pressed }) => [
                      styles.smallCard,
                      { opacity: pressed ? 0.6 : 1 },
                    ]}
                    onPress={() => handleRecentItemPress(item)}
                  >
                  <AlbumArtwork
                    source={track.albumArt}
                    style={styles.smallImage}
                    contentFit="cover"
                  />
                    <ThemedText
                      style={styles.smallTitle}
                      numberOfLines={1}
                    >
                      {title}
                    </ThemedText>
                    <ThemedText
                      style={styles.smallSubtitle}
                      numberOfLines={1}
                    >
                      {subtitle}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Tidal Custom Mixes Section */}
        {tidalMixes.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Custom Mixes</ThemedText>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {tidalMixes.map((mix) => (
                <Pressable
                  key={mix.id}
                  style={({ pressed }) => [
                    styles.smallCard,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                  onPress={() => {
                    if (activePlayer && mix.lmsUri) {
                      lmsClient.playPlaylist(activePlayer.id, mix.lmsUri);
                    } else if (!activePlayer) {
                      Alert.alert('No Player', 'Please select a player first.');
                    }
                  }}
                >
                  <AlbumArtwork
                    source={mix.artwork_url}
                    style={styles.smallImage}
                    contentFit="cover"
                  />
                  <ThemedText style={styles.smallTitle} numberOfLines={1}>
                    {mix.title}
                  </ThemedText>
                  <ThemedText style={styles.smallSubtitle} numberOfLines={1}>
                    {mix.description || 'Tidal Mix'}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Artists Section */}
        {allArtists.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Artists A-Z</ThemedText>
              <Pressable
                onPress={() => navigation.navigate("AllArtists")}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <ThemedText style={styles.viewAll}>See all</ThemedText>
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              onScroll={(event) => {
                const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                // Load more when user scrolls near the end (within 200px)
                if (contentOffset.x + layoutMeasurement.width >= contentSize.width - 200) {
                  if (hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                  }
                }
              }}
              scrollEventThrottle={400}
            >
              {allArtists.map((artist: Artist) => (
                <Pressable
                  key={artist.id}
                  style={({ pressed }) => [
                    styles.smallCard,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() =>
                    navigation.navigate("Artist", {
                      id: artist.id,
                      name: artist.name,
                    })
                  }
                >
                  {artist.imageUrl ? (
                    <Image
                      source={artist.imageUrl}
                      style={styles.artistImageRound}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={styles.artistImageRoundPlaceholder}>
                      <Feather
                        name="user"
                        size={32}
                        color={Colors.light.textTertiary}
                      />
                    </View>
                  )}
                  <ThemedText
                    style={styles.smallTitle}
                    numberOfLines={1}
                  >
                    {artist.name}
                  </ThemedText>
                </Pressable>
              ))}
              {isFetchingNextPage && (
                <View style={[styles.smallCard, { justifyContent: 'center', alignItems: 'center' }]}>
                  <ActivityIndicator size="small" color={Colors.light.textSecondary} />
                </View>
              )}
            </ScrollView>
          </View>
        ) : null}

        {/* Tidal Section - Shows when enabled */}
        {tidalEnabled && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Tidal</ThemedText>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {tidalConnected && tidalAlbums.length > 0 ? (
                tidalAlbums.slice(0, 20).map((album) => (
                  <Pressable
                    key={album.id}
                    style={({ pressed }) => [
                      styles.smallCard,
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                    onPress={() => {
                      navigation.navigate('Album', {
                        id: album.id,
                        name: album.title,
                        artistName: album.artist,
                        source: 'tidal',
                      });
                    }}
                  >
                    <AlbumArtwork
                      source={album.artwork_url}
                      style={styles.smallImage}
                      contentFit="cover"
                    />
                    <ThemedText style={styles.smallTitle} numberOfLines={1}>
                      {album.title}
                    </ThemedText>
                    <ThemedText style={styles.smallSubtitle} numberOfLines={1}>
                      {album.artist}
                    </ThemedText>
                  </Pressable>
                ))
              ) : tidalConnected ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.smallCard,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => navigation.navigate('TidalBrowse')}
                >
                  <View style={[styles.artistImageRoundPlaceholder, { backgroundColor: '#000000' }]}>
                    <Feather name="music" size={32} color="white" />
                  </View>
                  <ThemedText style={styles.smallTitle} numberOfLines={1}>
                    My Music
                  </ThemedText>
                  <ThemedText style={styles.smallSubtitle} numberOfLines={1}>
                    Tidal
                  </ThemedText>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.smallCard,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => navigation.navigate('Settings')}
                >
                  <View style={[styles.artistImageRoundPlaceholder, { backgroundColor: '#1DB954' }]}>
                    <Feather name="log-in" size={32} color="white" />
                  </View>
                  <ThemedText style={styles.smallTitle} numberOfLines={1}>
                    Connect
                  </ThemedText>
                  <ThemedText style={styles.smallSubtitle} numberOfLines={1}>
                    Tidal
                  </ThemedText>
                </Pressable>
              )}
            </ScrollView>
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundRoot,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    ...Typography.title,
    color: Colors.light.text,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: Spacing.sm,
    flex: 1,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.title,
    color: Colors.light.text,
  },
  viewAll: {
    ...Typography.caption,
    color: Colors.light.accent,
  },
  horizontalList: {
    gap: Spacing.md,
    paddingRight: Spacing.lg,
  },
  smallCard: {
    width: 100,
  },
  smallImage: {
    width: 100,
    height: 100,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
  },
  smallTitle: {
    ...Typography.caption,
    color: Colors.light.text,
    fontWeight: "500",
  },
  smallSubtitle: {
    ...Typography.label,
    color: Colors.light.textSecondary,
  },
  artistImageRound: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: Spacing.xs,
  },
  artistImageRoundPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#4A4A4E",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
});