import React, { useCallback, memo, useState, useEffect, useMemo } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  WithSpringConfig,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { SourceBadge } from "@/components/SourceBadge";
import { AlbumArtwork } from "@/components/AlbumArtwork";
import { AppHeader } from "@/components/AppHeader";
import { LibraryToolbar, type SourceFilter } from "@/components/LibraryToolbar";
import { Colors, Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { useInfiniteAlbums, Album } from "@/hooks/useLibrary";
import { DESKTOP_SIDEBAR_WIDTH } from "@/constants/layout";

interface AlbumItem extends Album {}
import { useMusic } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient } from "@/lib/lmsClient";
import type { Track } from "@/hooks/useLibrary";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

type NavigationProp = NativeStackNavigationProp<BrowseStackParamList>;
type ViewMode = "grid" | "list";
type SortKey = "name_az" | "artist_az" | "year_desc";
type QualityKey = "all" | "cd" | "hires" | "lossy" | "unknown";

const VIEW_MODE_KEY = "@albums_view_mode";

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
  energyThreshold: 0.001,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);


const AlbumGridCard = memo(({ album, size, onPress, onPlay, onShuffle }: {
  album: Album;
  size: number;
  onPress: () => void;
  onPlay: () => void;
  onShuffle?: () => void;
}) => {
  const cardScale = useSharedValue(1);
  const overlayOpacity = useSharedValue(0.7);
  const playScale = useSharedValue(1);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const playAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: playScale.value }],
  }));

  const imageUrl = album.imageUrl;

  return (
    <AnimatedPressable
      style={[styles.gridItem, { width: size }, cardAnimatedStyle]}
      onPress={onPress}
      onPressIn={() => {
        cardScale.value = withSpring(0.96, springConfig);
      }}
      onPressOut={() => {
        cardScale.value = withSpring(1, springConfig);
      }}
    >
      <View style={styles.gridImageContainer}>
          <AlbumArtwork
            source={imageUrl}
            style={[styles.gridImage, { width: size, height: size }]}
            contentFit="cover"
          />
        <SourceBadge source={album.source || 'local'} size={32} />
        <Animated.View style={[styles.gridOverlay, overlayAnimatedStyle]}>
          <View style={styles.gridOverlayButtons}>
            <AnimatedPressable
              style={[styles.gridOverlayButton, styles.gridPlayButton, playAnimatedStyle]}
              onPress={(e) => {
                e?.stopPropagation?.();
                onPlay();
              }}
              onPressIn={(e) => {
                e?.stopPropagation?.();
                playScale.value = withSpring(0.9, springConfig);
              }}
              onPressOut={() => {
                playScale.value = withSpring(1, springConfig);
              }}
              hitSlop={8}
            >
              <Feather name="play" size={18} color="#fff" style={{ marginLeft: 2 }} />
            </AnimatedPressable>
            {onShuffle && (
              <AnimatedPressable
                style={[styles.gridOverlayButton, styles.gridShuffleButton]}
                onPress={(e) => {
                  e?.stopPropagation?.();
                  onShuffle();
                }}
                hitSlop={8}
              >
                <Feather name="shuffle" size={16} color="#fff" />
              </AnimatedPressable>
            )}
          </View>
        </Animated.View>
      </View>
      <ThemedText style={styles.gridTitle} numberOfLines={2}>
        {album.name}
      </ThemedText>
      <ThemedText style={styles.gridSubtitle} numberOfLines={1}>
        {album.artist}
      </ThemedText>
    </AnimatedPressable>
  );
});

const AlbumListRow = memo(({ album, onPress, onPlay }: {
  album: Album;
  onPress: () => void;
  onPlay: () => void;
}) => {
  const imageUrl = album.imageUrl;

  return (
    <View style={styles.listRow}>
      <Pressable
        style={({ pressed }) => [
          styles.listMainArea,
          { opacity: pressed ? 0.6 : 1 },
        ]}
        onPress={onPress}
      >
        <AlbumArtwork
          source={imageUrl}
          style={styles.listImage}
          contentFit="cover"
        />
        <View style={styles.listInfo}>
          <ThemedText style={styles.listTitle} numberOfLines={1}>
            {album.name}
          </ThemedText>
          <ThemedText style={styles.listSubtitle} numberOfLines={1}>
            {album.artist}
          </ThemedText>
        </View>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          styles.actionButton,
          { opacity: pressed ? 0.6 : 1 },
        ]}
        onPress={onPlay}
      >
        <Feather name="play-circle" size={22} color={Colors.light.accent} />
      </Pressable>
    </View>
  );
});

export default function AllAlbumsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const { width: windowWidth } = useWindowDimensions();
  const { activeServer } = useMusic();
  const { activePlayer, setCurrentTrack, syncPlayerStatus } = usePlayback();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  const {
    data,
    error,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteAlbums();

  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY).then((mode) => {
      if (mode === "list" || mode === "grid") {
        setViewMode(mode);
      }
    });
  }, []);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const allAlbums = data?.pages.flatMap(page => page.albums) || [];
  const totalAll = data?.pages[0]?.total || 0;
  const totalLocal = data?.pages[0]?.localTotal || 0;
  const totalTidal = data?.pages[0]?.tidalTotal || 0;
  const [sortKey, setSortKey] = useState<SortKey>("name_az");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [qualityFilter, setQualityFilter] = useState<QualityKey>("all");
  const [albumQuality, setAlbumQuality] = useState<Record<string, QualityKey>>({});
  const [textFilter, setTextFilter] = useState("");
  
  const displayTotal =
    sourceFilter === "local" ? totalLocal : sourceFilter === "tidal" ? totalTidal : totalAll;

  console.log(`🎵 AllAlbumsScreen: allAlbums.length=${allAlbums.length}, total=${totalAll}, hasNextPage=${hasNextPage}`);

  // When the user selects a quality filter, probe local LMS albums for quality (best-effort) and cache results in-memory.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!activeServer) return;
      if (qualityFilter === "all") return;

      // Only probe local albums; Tidal quality metadata isn't available here yet.
      const locals = allAlbums
        .filter((a) => (a.source || "local") === "local")
        .slice(0, 400); // bound work to what's currently loaded + avoid huge bursts

      const missing = locals.filter((a) => albumQuality[a.id] === undefined).slice(0, 80);
      if (missing.length === 0) return;

      lmsClient.setServer(activeServer.host, activeServer.port);

      // Small concurrency to avoid hammering LMS
      const CONCURRENCY = 5;
      let idx = 0;
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (!cancelled) {
          const a = missing[idx++];
          if (!a) break;
          const q = await lmsClient.getLocalAlbumQuality(String(a.id));
          if (cancelled) break;
          setAlbumQuality((prev) => (prev[a.id] ? prev : { ...prev, [a.id]: q as QualityKey }));
        }
      });
      await Promise.all(workers);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [qualityFilter, allAlbums, activeServer, albumQuality]);

  const filteredAlbums = useMemo(() => {
    let result = allAlbums.slice();
    if (sourceFilter !== "all") {
      result = result.filter((a) => (a.source || "local") === sourceFilter);
    }
    const q = textFilter.trim().toLowerCase();
    if (q) {
      result = result.filter((a) => {
        const name = (a.name || "").toLowerCase();
        const artist = (a.artist || "").toLowerCase();
        return name.includes(q) || artist.includes(q);
      });
    }
    if (qualityFilter !== "all") {
      result = result.filter((a) => {
        const src = (a.source || "local") as string;
        if (src !== "local") {
          // For non-local sources we currently don't have reliable quality metadata.
          // Treat them as unknown so the filter behaves predictably.
          return qualityFilter === "unknown";
        }
        const q = albumQuality[a.id] || "unknown";
        return q === qualityFilter;
      });
    }
    if (sortKey === "name_az") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortKey === "artist_az") {
      result.sort((a, b) => a.artist.localeCompare(b.artist));
    } else if (sortKey === "year_desc") {
      result.sort((a, b) => (b.year || 0) - (a.year || 0));
    }
    return result;
  }, [allAlbums, sourceFilter, sortKey, qualityFilter, textFilter]);

  const gridLayout = useMemo(() => {
    const isLargeWeb = Platform.OS === "web" && windowWidth >= 900;
    const padding = Spacing.lg;
    const gap = Spacing.lg;
    const contentWidth = isLargeWeb ? Math.max(0, windowWidth - DESKTOP_SIDEBAR_WIDTH) : windowWidth;
    const available = Math.max(0, contentWidth - padding * 2);

    // Preserve mobile layout, improve desktop/web.
    if (Platform.OS !== "web") {
      const cols = 3;
      const size = Math.floor((available - gap * (cols - 1)) / cols);
      return { numColumns: cols, itemSize: Math.max(90, size) };
    }

    // Desktop tiles: slightly larger for big screens (user request ~15% bigger covers)
    // +16% bigger tiles on large screens
    const min = 200;
    const max = 325;
    let cols = Math.max(3, Math.min(10, Math.floor((available + gap) / (min + gap)) || 3));
    let size = (available - gap * (cols - 1)) / cols;
    while (size > max && cols < 10) {
      cols += 1;
      size = (available - gap * (cols - 1)) / cols;
    }
    return { numColumns: cols, itemSize: Math.floor(Math.max(min, Math.min(max, size))) };
  }, [windowWidth]);

  const handlePlayAlbum = useCallback(async (album: Album) => {
    if (!activePlayer || !activeServer) return;

    try {
      // Set a temporary current track so mini player appears immediately
      const tempTrack: Track = {
        id: `album-${album.id}`,
        title: album.name,
        artist: album.artist,
        album: album.name,
        albumArt: album.imageUrl,
        duration: 0,
        source: album.source || 'local'
      };
      setCurrentTrack(tempTrack);

      lmsClient.setServer(activeServer.host, activeServer.port);

      // Ensure player is powered on
      await lmsClient.setPower(activePlayer.id, true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Clear playlist first
      await lmsClient.request(activePlayer.id, ['playlist', 'clear']);

      // Add album to playlist
      await lmsClient.addAlbumToPlaylist(activePlayer.id, album.id);

      // Give LMS time to process the album addition
      await new Promise(resolve => setTimeout(resolve, 300));

      // Start playback from the beginning
      await lmsClient.request(activePlayer.id, ['playlist', 'index', '0']);
      await lmsClient.play(activePlayer.id);

      // Trigger sync to get real track info
      setTimeout(() => {
        syncPlayerStatus();
      }, 1000);
    } catch (error) {
      console.error('Failed to play album:', error);
    }
  }, [activePlayer, activeServer, setCurrentTrack, syncPlayerStatus]);

  const handleShuffleAlbum = useCallback(async (album: Album) => {
    if (!activePlayer || !activeServer) return;

    try {
      lmsClient.setServer(activeServer.host, activeServer.port);

      // Ensure player is powered on
      await lmsClient.setPower(activePlayer.id, true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get all album tracks
      const albumTracks = await lmsClient.getAlbumTracks(album.id);

      if (albumTracks.length === 0) return;

      // Shuffle the tracks array
      const shuffledTracks = [...albumTracks].sort(() => Math.random() - 0.5);

      // Clear playlist first
      await lmsClient.request(activePlayer.id, ['playlist', 'clear']);

      // Add shuffled tracks individually
      for (const track of shuffledTracks) {
        await lmsClient.addTrackToPlaylist(activePlayer.id, track.id);
      }

      // Give LMS time to process all track additions
      await new Promise(resolve => setTimeout(resolve, 500));

      // Start playback from the beginning
      await lmsClient.request(activePlayer.id, ['playlist', 'index', '0']);
      await lmsClient.play(activePlayer.id);

      // Trigger sync to get real track info
      setTimeout(() => {
        syncPlayerStatus();
      }, 1000);
    } catch (error) {
      console.error('Failed to shuffle album:', error);
    }
  }, [activePlayer, activeServer, syncPlayerStatus]);

  const renderGridItem = useCallback(({ item }: { item: Album }) => (
    <AlbumGridCard
      album={item}
      size={gridLayout.itemSize}
      onPress={() => {
        navigation.navigate("Album", { 
          id: item.id, 
          name: item.name, 
          artistName: item.artist,
          source: item.source
        });
      }}
      onPlay={() => handlePlayAlbum(item)}
      onShuffle={() => handleShuffleAlbum(item)}
    />
  ), [navigation, handlePlayAlbum, handleShuffleAlbum, gridLayout.itemSize]);

  const renderListItem = useCallback(({ item }: { item: Album }) => (
    <AlbumListRow
      album={item}
      onPress={() => {
        navigation.navigate("Album", { 
          id: item.id, 
          name: item.name, 
          artistName: item.artist,
          source: item.source
        });
      }}
      onPlay={() => handlePlayAlbum(item)}
    />
  ), [navigation, handlePlayAlbum]);

  const keyExtractor = useCallback((item: Album) => item.id, []);

  const ItemSeparator = useCallback(() => (
    <View style={styles.separator} />
  ), []);

  if (isLoading && allAlbums.length === 0) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.accent} />
      </ThemedView>
    );
  }

  // Handle errors gracefully instead of crashing
  if (error) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText style={styles.errorTitle}>Error Loading Albums</ThemedText>
        <ThemedText style={styles.errorMessage}>
          {error instanceof Error ? error.message : 'Failed to load albums'}
        </ThemedText>
        <Pressable
          onPress={() => window.location.reload()}
          style={({ pressed }) => [
            styles.retryButton,
            { opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <ThemedText style={styles.retryText}>Retry</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <AppHeader
        title={`Albums — Tidal ${(totalTidal || 0).toLocaleString()} • LMS ${(totalLocal || 0).toLocaleString()}`}
      />

      <LibraryToolbar
        sortValue={sortKey}
        sortLabel="Sorting"
        sortOptions={[
          { label: "Album (A–Z)", value: "name_az" },
          { label: "Artist (A–Z)", value: "artist_az" },
          { label: "Year (newest)", value: "year_desc" },
        ]}
        onSortChange={(v) => setSortKey(v as SortKey)}
        sourceValue={sourceFilter}
        onSourceChange={setSourceFilter}
        qualityValue={qualityFilter}
        qualityOptions={[
          { value: "all", label: "All" },
          { value: "cd", label: "CD" },
          { value: "hires", label: "Hi-res" },
          { value: "lossy", label: "Lossy" },
          { value: "unknown", label: "Unknown" },
        ]}
        onQualityChange={(v) => setQualityFilter(v as QualityKey)}
        showSearch
        searchQuery={textFilter}
        onSearchQueryChange={setTextFilter}
        searchPlaceholder="Filter albums…"
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        showViewToggle
      />

      {!activeServer || (activeServer && !activeServer.connected) ? (
        <View style={styles.emptyState}>
          <Feather name="wifi-off" size={48} color={Colors.light.error} />
          <ThemedText style={styles.emptyTitle}>Server Offline</ThemedText>
          <ThemedText style={[styles.emptyText, { color: Colors.light.textSecondary }]}>
            Please connect to a server in Settings to access albums
          </ThemedText>
        </View>
      ) : allAlbums.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="disc" size={40} color={Colors.light.textTertiary} />
          <ThemedText style={[styles.emptyText, { color: Colors.light.textSecondary }]}>
            No albums found
          </ThemedText>
        </View>
      ) : (
        <FlatList
          key={viewMode === "grid" ? `grid-${gridLayout.numColumns}` : "list"}
          data={filteredAlbums}
          renderItem={viewMode === "grid" ? renderGridItem : renderListItem}
          keyExtractor={keyExtractor}
          numColumns={viewMode === "grid" ? gridLayout.numColumns : 1}
          contentContainerStyle={[
            viewMode === "grid" ? styles.gridContent : styles.listContent,
            {
              paddingTop: Spacing.md,
              paddingBottom: tabBarHeight + Spacing["5xl"]
            },
          ]}
          columnWrapperStyle={viewMode === "grid" ? styles.gridRow : undefined}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={isFetchingNextPage ? <ActivityIndicator /> : null}
          removeClippedSubviews={false}
          maxToRenderPerBatch={20}
          windowSize={10}
          initialNumToRender={20}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundRoot,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.light.backgroundRoot,
  },
  // Header now standardized via `AppHeader`; view toggle moved into `LibraryToolbar`.
  gridContent: {
    paddingHorizontal: Spacing.lg,
  },
  gridRow: {
    gap: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  gridItem: {
    width: "100%",
  },
  gridImageContainer: {
    position: "relative",
    marginBottom: Spacing.sm,
    ...Shadows.small,
  },
  gridImage: {
    borderRadius: BorderRadius.xs,
  },
  gridImagePlaceholder: {
    borderRadius: BorderRadius.xs,
    backgroundColor: Colors.light.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  gridOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderRadius: BorderRadius.xs,
    pointerEvents: "box-none",
  },
  gridOverlayButtons: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  gridOverlayButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  gridPlayButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  gridShuffleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  gridTitle: {
    ...Typography.headline,
    color: Colors.light.text,
    marginTop: Spacing.xs,
  },
  gridSubtitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  listMainArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  listImage: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.xs,
  },
  listInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  listTitle: {
    ...Typography.body,
    color: Colors.light.text,
    fontWeight: "500",
  },
  listSubtitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  actionButton: {
    padding: Spacing.sm,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.light.border,
  },
  errorTitle: {
    ...Typography.headline,
    color: Colors.light.text,
    marginBottom: Spacing.sm,
  },
  errorMessage: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    marginBottom: Spacing.lg,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: Colors.light.accent,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  retryText: {
    color: "#fff",
    fontWeight: "600",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  emptyTitle: {
    ...Typography.headline,
    marginTop: Spacing.md,
    color: Colors.light.text,
  },
  emptyText: {
    ...Typography.body,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
});
