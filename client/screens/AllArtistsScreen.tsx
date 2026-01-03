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
import { AppHeader } from "@/components/AppHeader";
import { LibraryToolbar, type SourceFilter, type ViewMode } from "@/components/LibraryToolbar";
import { Colors, Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { ArtistGridSkeleton, AlbumListSkeleton } from "@/components/SkeletonLoader";
import { useInfiniteArtists, Artist } from "@/hooks/useLibrary";
import { DESKTOP_SIDEBAR_WIDTH } from "@/constants/layout";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient } from "@/lib/lmsClient";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

type NavigationProp = NativeStackNavigationProp<BrowseStackParamList>;
type SortKey = "name_az" | "albums_desc" | "recently_played";
type QualityKey = "all";

const VIEW_MODE_KEY = "@artists_view_mode";
const SORT_KEY = "@artists_sort";

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
  energyThreshold: 0.001,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const ArtistGridCard = memo(({ artist, size, onPress, onPlay }: { 
  artist: Artist; 
  size: number;
  onPress: () => void;
  onPlay: () => void;
}) => {
  const cardScale = useSharedValue(1);
  const overlayOpacity = useSharedValue(1);
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

  return (
    <Animated.View style={[styles.gridItem, { width: size }, cardAnimatedStyle]}>
      <View style={[styles.gridImageContainer, { width: size, height: size }]}>
        <AnimatedPressable
          style={[styles.gridImagePressable, { width: size, height: size, borderRadius: size / 2 }]}
          onPress={onPress}
          onPressIn={() => {
            cardScale.value = withSpring(0.96, springConfig);
            overlayOpacity.value = withSpring(1, springConfig);
          }}
          onPressOut={() => {
            cardScale.value = withSpring(1, springConfig);
          }}
        >
          {artist.imageUrl ? (
            <Image
              source={artist.imageUrl}
              style={[styles.gridImageRound, { width: size, height: size, borderRadius: size / 2 }]}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.gridImageRoundPlaceholder, { width: size, height: size, borderRadius: size / 2 }]}>
              <Feather name="user" size={Math.max(20, size * 0.3)} color={Colors.light.textTertiary} />
            </View>
          )}
        </AnimatedPressable>
        <Animated.View 
          style={[styles.gridOverlay, { borderRadius: size / 2 }, overlayAnimatedStyle]}
          pointerEvents="box-none"
        >
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
            onPressOut={(e) => {
              e?.stopPropagation?.();
              playScale.value = withSpring(1, springConfig);
            }}
            hitSlop={8}
          >
            <Feather name="play" size={22} color="#fff" style={{ marginLeft: 2 }} />
          </AnimatedPressable>
        </Animated.View>
      </View>
      <ThemedText style={styles.gridTitle} numberOfLines={2}>
        {artist.name}
      </ThemedText>
      <ThemedText style={styles.gridSubtitle} numberOfLines={1}>
        {artist.albumCount || 0} albums
      </ThemedText>
    </Animated.View>
  );
});

const ArtistListRow = memo(({ artist, onPress, onPlay }: { 
  artist: Artist; 
  onPress: () => void;
  onPlay: () => void;
}) => (
  <View style={styles.listRow}>
  <Pressable
    style={({ pressed }) => [
        styles.listMainArea,
      { opacity: pressed ? 0.6 : 1 },
    ]}
    onPress={onPress}
  >
      {artist.imageUrl ? (
        <Image
          source={artist.imageUrl}
          style={styles.listImageRound}
          contentFit="cover"
        />
      ) : (
        <View style={styles.listImageRoundPlaceholder}>
      <Feather name="user" size={24} color={Colors.light.textTertiary} />
    </View>
      )}
      <View style={styles.listInfo}>
        <ThemedText style={styles.listTitle} numberOfLines={1}>
        {artist.name}
      </ThemedText>
        <ThemedText style={styles.listSubtitle} numberOfLines={1}>
        {artist.albumCount || 0} albums
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
));

export default function AllArtistsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const { width: windowWidth } = useWindowDimensions();
  const { activeServer, recentlyPlayed } = useMusic();
  const { activePlayer, syncPlayerStatus } = usePlayback();
  
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
  } = useInfiniteArtists();

  const allArtists = data?.pages.flatMap(page => page.artists) || [];
  const totalAll = data?.pages[0]?.total || 0;
  const totalLocal = data?.pages[0]?.localTotal || 0;
  const totalTidal = data?.pages[0]?.tidalTotal || 0;
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortKey, setSortKey] = useState<SortKey>("name_az");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [qualityFilter, setQualityFilter] = useState<QualityKey>("all");
  const displayTotal =
    sourceFilter === "local" ? totalLocal : sourceFilter === "tidal" ? totalTidal : totalAll;
  const countsSuffix = `Tidal ${Number(totalTidal || 0).toLocaleString()} • LMS ${Number(
    totalLocal || 0
  ).toLocaleString()}`;

  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY).then((mode) => {
      if (mode === "list" || mode === "grid") {
        setViewMode(mode);
      }
    });
    AsyncStorage.getItem(SORT_KEY).then((sort) => {
      if (sort === "name_az" || sort === "albums_desc" || sort === "recently_played") {
        setSortKey(sort);
      }
    });
  }, []);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const handleSortChange = (k: SortKey) => {
    setSortKey(k);
    AsyncStorage.setItem(SORT_KEY, k);
  };

  const filteredArtists = useMemo(() => {
    let result = allArtists.slice();
    // Artists data is currently local-only; keep Src dropdown but only 'All/Local' will be meaningful.
    if (sourceFilter !== "all") {
      // If in future we add per-source artists, filter here.
      result = result.filter(() => sourceFilter === "local");
    }
    if (sortKey === "name_az") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortKey === "albums_desc") {
      result.sort((a, b) => (b.albumCount || 0) - (a.albumCount || 0));
    } else if (sortKey === "recently_played") {
      const recentlyPlayedMap = new Map<string, number>();
      recentlyPlayed.forEach((track, index) => {
        if (track.artist) {
          const key = track.artist.toLowerCase();
          if (!recentlyPlayedMap.has(key)) recentlyPlayedMap.set(key, index);
        }
      });
      result.sort((a, b) => {
        const keyA = a.name.toLowerCase();
        const keyB = b.name.toLowerCase();
        const indexA = recentlyPlayedMap.get(keyA) ?? Infinity;
        const indexB = recentlyPlayedMap.get(keyB) ?? Infinity;
        if (indexA === Infinity && indexB === Infinity) return a.name.localeCompare(b.name);
        if (indexA === Infinity) return 1;
        if (indexB === Infinity) return -1;
        return indexA - indexB;
      });
    }
    return result;
  }, [allArtists, sortKey, sourceFilter, recentlyPlayed]);

  const gridLayout = useMemo(() => {
    const isLargeWeb = Platform.OS === "web" && windowWidth >= 900;
    const padding = Spacing.lg;
    const gap = Spacing.lg;
    const contentWidth = isLargeWeb ? Math.max(0, windowWidth - DESKTOP_SIDEBAR_WIDTH) : windowWidth;
    const available = Math.max(0, contentWidth - padding * 2);

    if (Platform.OS !== "web") {
      const cols = 3;
      const size = Math.floor((available - gap * (cols - 1)) / cols);
      return { numColumns: cols, itemSize: Math.max(90, size) };
    }

    // +16% bigger tiles on large screens
    const min = 165;
    const max = 245;
    let cols = Math.max(3, Math.min(10, Math.floor((available + gap) / (min + gap)) || 3));
    let size = (available - gap * (cols - 1)) / cols;
    while (size > max && cols < 10) {
      cols += 1;
      size = (available - gap * (cols - 1)) / cols;
    }
    return { numColumns: cols, itemSize: Math.floor(Math.max(min, Math.min(max, size))) };
  }, [windowWidth]);

  const handleArtistPress = useCallback((artist: Artist) => {
    navigation.navigate("Artist", { id: artist.id, name: artist.name });
  }, [navigation]);

  const handlePlayArtist = useCallback(async (artist: Artist) => {
    if (!activePlayer || !activeServer) {
      console.log('Cannot play artist: missing player or server', {
        hasPlayer: !!activePlayer,
        hasServer: !!activeServer,
        artistName: artist.name
      });
      return;
    }
    try {
      console.log('Playing artist:', artist.name);
      lmsClient.setServer(activeServer.host, activeServer.port);
      // Get first album from artist and play it
      const albums = await lmsClient.getAlbumsByArtistName(artist.name);
      console.log(`Found ${albums.length} albums for artist: ${artist.name}`);
      if (albums.length > 0) {
        console.log('Playing album:', albums[0].title, 'ID:', albums[0].id);
        await lmsClient.setPower(activePlayer.id, true);
        await lmsClient.stop(activePlayer.id);
        await lmsClient.playAlbum(activePlayer.id, albums[0].id);
        await lmsClient.play(activePlayer.id);
        console.log('Artist play command sent successfully');
        
        setTimeout(() => {
          syncPlayerStatus();
        }, 500);
      } else {
        console.log(`No albums found for artist: ${artist.name}`);
      }
    } catch (error) {
      console.error('Failed to play artist:', error);
    }
  }, [activePlayer, activeServer, syncPlayerStatus]);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderGridItem = useCallback(({ item }: { item: Artist }) => (
    <ArtistGridCard 
      artist={item} 
      size={gridLayout.itemSize}
      onPress={() => handleArtistPress(item)}
      onPlay={() => handlePlayArtist(item)}
    />
  ), [handleArtistPress, handlePlayArtist, gridLayout.itemSize]);

  const renderListItem = useCallback(({ item }: { item: Artist }) => (
    <ArtistListRow 
      artist={item} 
      onPress={() => handleArtistPress(item)}
      onPlay={() => handlePlayArtist(item)}
    />
  ), [handleArtistPress, handlePlayArtist]);

  const keyExtractor = useCallback((item: Artist) => item.id, []);

  const ListFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={Colors.light.accent} />
      </View>
    );
  }, [isFetchingNextPage]);

  if (isLoading) {
    return (
      <ThemedView style={styles.container}>
        <AppHeader title={`Artists (${Number(displayTotal || 0).toLocaleString()}) — ${countsSuffix}`} />
        <LibraryToolbar
          sortValue={sortKey}
          sortLabel="Sorting"
          sortOptions={[
            { label: "Name (A–Z)", value: "name_az" },
            { label: "Albums (most)", value: "albums_desc" },
            { label: "Recently played", value: "recently_played" },
          ]}
          onSortChange={(v) => handleSortChange(v as SortKey)}
          sourceValue={sourceFilter}
          onSourceChange={setSourceFilter}
          showQuality={false}
          qualityValue={qualityFilter}
          qualityOptions={[{ value: "all", label: "All" }]}
          onQualityChange={() => {}}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
        />
        {viewMode === "grid" ? <ArtistGridSkeleton /> : <AlbumListSkeleton />}
      </ThemedView>
    );
  }
  
  if (error) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText style={styles.errorText}>Error loading artists</ThemedText>
        <ThemedText style={styles.errorSubtext}>
          {error instanceof Error ? error.message : 'Unknown error'}
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <AppHeader title={`Artists (${Number(displayTotal || 0).toLocaleString()}) — ${countsSuffix}`} />
      <LibraryToolbar
        sortValue={sortKey}
        sortLabel="Sorting"
        sortOptions={[
          { label: "Name (A–Z)", value: "name_az" },
          { label: "Albums (most)", value: "albums_desc" },
          { label: "Recently played", value: "recently_played" },
        ]}
        onSortChange={(v) => handleSortChange(v as SortKey)}
        sourceValue={sourceFilter}
        onSourceChange={setSourceFilter}
        showQuality={false}
        qualityValue={qualityFilter}
        qualityOptions={[{ value: "all", label: "All" }]}
        onQualityChange={() => {}}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
      />

      {filteredArtists.length === 0 ? (
        <View style={styles.centered}>
          <ThemedText style={styles.emptyTitle}>No artists found</ThemedText>
          <ThemedText style={styles.emptySubtitle}>
            {activeServer ? "Try refreshing the library in Settings." : "Connect to an LMS server first."}
          </ThemedText>
        </View>
      ) : viewMode === "grid" ? (
        <FlatList
          key={`grid-${gridLayout.numColumns}`}
          data={filteredArtists}
          renderItem={renderGridItem}
          keyExtractor={keyExtractor}
          numColumns={gridLayout.numColumns}
          contentContainerStyle={[
            styles.gridContent,
            { 
              paddingTop: Spacing.md,
              paddingBottom: tabBarHeight + Spacing["5xl"] 
            },
          ]}
          columnWrapperStyle={styles.gridRow}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={ListFooter}
          removeClippedSubviews={false}
          maxToRenderPerBatch={20}
          windowSize={10}
          initialNumToRender={20}
          {...(Platform.OS === 'ios' && { contentInsetAdjustmentBehavior: 'automatic' })}
        />
      ) : (
      <FlatList
          key="list"
          data={filteredArtists}
          renderItem={renderListItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
            styles.listContent,
            { 
              paddingTop: Spacing.md,
              paddingBottom: tabBarHeight + Spacing["5xl"] 
            },
        ]}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={ListFooter}
        removeClippedSubviews={true}
        maxToRenderPerBatch={20}
        windowSize={10}
        initialNumToRender={20}
          {...(Platform.OS === 'ios' && { contentInsetAdjustmentBehavior: 'automatic' })}
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
  emptyTitle: {
    ...Typography.title,
    color: Colors.light.text,
    textAlign: "center",
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
  // Header now standardized via `AppHeader`.
  viewToggle: {
    flexDirection: "row",
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    padding: 2,
  },
  toggleButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
  },
  toggleButtonActive: {
    backgroundColor: Colors.light.backgroundDefault,
  },
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
  },
  gridImagePressable: {
    overflow: "hidden",
  },
  gridImageRound: {
    backgroundColor: "transparent",
  },
  gridImageRoundPlaceholder: {
    backgroundColor: "#4A4A4E", // Darker grey to match overlay behind play button
    justifyContent: "center",
    alignItems: "center",
  },
  gridOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    pointerEvents: "box-none",
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
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  gridTitle: {
    ...Typography.headline,
    color: Colors.light.text,
    marginTop: Spacing.xs,
    textAlign: "center",
  },
  gridSubtitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
    textAlign: "center",
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
  listImageRound: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: Spacing.md,
  },
  listImageRoundPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#4A4A4E", // Darker grey to match overlay behind play button
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  listInfo: {
    flex: 1,
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
  footer: {
    padding: Spacing.xl,
    alignItems: "center",
  },
  loadingText: {
    marginTop: Spacing.md,
    color: Colors.light.textSecondary,
  },
  errorText: {
    ...Typography.title,
    color: Colors.light.error,
    marginBottom: Spacing.sm,
  },
  errorSubtext: {
    ...Typography.body,
    color: Colors.light.textSecondary,
  },
});
