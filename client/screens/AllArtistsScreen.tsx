import React, { useCallback, memo, useState, useEffect, useMemo } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  Dimensions,
  ActivityIndicator,
  Platform,
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
import { SortFilter, type SortOption } from "@/components/SortFilter";
import { Colors, Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { ArtistGridSkeleton, AlbumListSkeleton } from "@/components/SkeletonLoader";
import { useInfiniteArtists, Artist } from "@/hooks/useLibrary";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient } from "@/lib/lmsClient";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

const { width } = Dimensions.get("window");
const NUM_COLUMNS = 3;
const GRID_ITEM_SIZE = (width - Spacing.lg * 4) / NUM_COLUMNS;

type NavigationProp = NativeStackNavigationProp<BrowseStackParamList>;
type ViewMode = "grid" | "list";

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

const ArtistGridCard = memo(({ artist, onPress, onPlay }: { 
  artist: Artist; 
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
    <Animated.View style={[styles.gridItem, cardAnimatedStyle]}>
      <View style={styles.gridImageContainer}>
        <AnimatedPressable
          style={styles.gridImagePressable}
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
              style={styles.gridImageRound}
              contentFit="cover"
            />
          ) : (
            <View style={styles.gridImageRoundPlaceholder}>
              <Feather name="user" size={GRID_ITEM_SIZE * 0.3} color={Colors.light.textTertiary} />
            </View>
          )}
        </AnimatedPressable>
        <Animated.View 
          style={[styles.gridOverlay, overlayAnimatedStyle]}
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
  const total = data?.pages[0]?.total || 0;
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortOption, setSortOption] = useState<SortOption>("alphabetical");

  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY).then((mode) => {
      if (mode === "list" || mode === "grid") {
        setViewMode(mode);
      }
    });
    AsyncStorage.getItem(SORT_KEY).then((sort) => {
      if (sort === "alphabetical" || sort === "recently_played" || sort === "recently_added") {
        setSortOption(sort);
      }
    });
  }, []);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const handleSortChange = (sort: SortOption) => {
    setSortOption(sort);
    AsyncStorage.setItem(SORT_KEY, sort);
  };

  // Sort artists based on selected option
  const artists = React.useMemo(() => {
    const sorted = [...allArtists];
    
    if (sortOption === "alphabetical") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortOption === "recently_played") {
      // Create a map of recently played artists
      const recentlyPlayedMap = new Map<string, number>();
      recentlyPlayed.forEach((track, index) => {
        if (track.artist) {
          const key = track.artist.toLowerCase();
          if (!recentlyPlayedMap.has(key)) {
            recentlyPlayedMap.set(key, index);
          }
        }
      });
      
      sorted.sort((a, b) => {
        const keyA = a.name.toLowerCase();
        const keyB = b.name.toLowerCase();
        const indexA = recentlyPlayedMap.get(keyA) ?? Infinity;
        const indexB = recentlyPlayedMap.get(keyB) ?? Infinity;
        
        if (indexA === Infinity && indexB === Infinity) {
          return a.name.localeCompare(b.name); // Both not played, sort alphabetically
        }
        if (indexA === Infinity) return 1; // A not played, B played
        if (indexB === Infinity) return -1; // B not played, A played
        return indexA - indexB; // Both played, sort by play order
      });
    } else if (sortOption === "recently_added") {
      // For recently added, we don't have this data, so fall back to alphabetical
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    return sorted;
  }, [allArtists, sortOption, recentlyPlayed]);

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
      onPress={() => handleArtistPress(item)}
      onPlay={() => handlePlayArtist(item)}
    />
  ), [handleArtistPress, handlePlayArtist]);

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
        <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
          <ThemedText style={styles.headerTitle}>Artists</ThemedText>
          <View style={styles.headerRight}>
            <SortFilter value={sortOption} onChange={handleSortChange} />
            <View style={styles.viewToggle}>
            <Pressable
              style={[
                styles.toggleButton,
                viewMode === "grid" && styles.toggleButtonActive,
              ]}
              onPress={() => handleViewModeChange("grid")}
            >
              <Feather
                name="grid"
                size={18}
                color={viewMode === "grid" ? Colors.light.accent : Colors.light.textSecondary}
              />
            </Pressable>
            <Pressable
              style={[
                styles.toggleButton,
                viewMode === "list" && styles.toggleButtonActive,
              ]}
              onPress={() => handleViewModeChange("list")}
            >
              <Feather
                name="list"
                size={18}
                color={viewMode === "list" ? Colors.light.accent : Colors.light.textSecondary}
              />
            </Pressable>
          </View>
          </View>
        </View>
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
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <ThemedText style={styles.headerTitle}>Artists</ThemedText>
        <View style={styles.headerRight}>
          <SortFilter value={sortOption} onChange={handleSortChange} />
          <View style={styles.viewToggle}>
          <Pressable
            style={[
              styles.toggleButton,
              viewMode === "grid" && styles.toggleButtonActive,
            ]}
            onPress={() => handleViewModeChange("grid")}
          >
            <Feather
              name="grid"
              size={18}
              color={viewMode === "grid" ? Colors.light.accent : Colors.light.textSecondary}
            />
          </Pressable>
          <Pressable
            style={[
              styles.toggleButton,
              viewMode === "list" && styles.toggleButtonActive,
            ]}
            onPress={() => handleViewModeChange("list")}
          >
            <Feather
              name="list"
              size={18}
              color={viewMode === "list" ? Colors.light.accent : Colors.light.textSecondary}
            />
          </Pressable>
        </View>
        </View>
      </View>

      {viewMode === "grid" ? (
        <FlatList
          key="grid"
          data={artists}
          renderItem={renderGridItem}
          keyExtractor={keyExtractor}
          numColumns={NUM_COLUMNS}
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
        data={artists}
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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  headerTitle: {
    fontSize: 22.4, // 30% smaller than Typography.display (32px * 0.7)
    fontWeight: "700",
    color: Colors.light.text,
    textAlign: "left",
    alignSelf: "flex-start",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
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
    width: GRID_ITEM_SIZE,
  },
  gridImageContainer: {
    position: "relative",
    marginBottom: Spacing.sm,
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
  },
  gridImagePressable: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
    borderRadius: GRID_ITEM_SIZE / 2,
    overflow: "hidden",
  },
  gridImageRound: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
    borderRadius: GRID_ITEM_SIZE / 2,
    backgroundColor: "transparent",
  },
  gridImageRoundPlaceholder: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
    borderRadius: GRID_ITEM_SIZE / 2,
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
    borderRadius: GRID_ITEM_SIZE / 2,
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
