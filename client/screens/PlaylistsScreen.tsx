import React, { useEffect, useState, useCallback, memo } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
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
import { Colors, Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { AlbumGridSkeleton, AlbumListSkeleton } from "@/components/SkeletonLoader";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient, type LmsPlaylist, type LmsTrack } from "@/lib/lmsClient";
import type { PlaylistsStackParamList } from "@/navigation/PlaylistsStackNavigator";

const { width } = Dimensions.get("window");
const NUM_COLUMNS = 2;
const GRID_ITEM_SIZE = (width - Spacing.lg * 3) / NUM_COLUMNS;
const TILE_SIZE = GRID_ITEM_SIZE / 2;

type NavigationProp = NativeStackNavigationProp<PlaylistsStackParamList>;
type ViewMode = "grid" | "list";

const VIEW_MODE_KEY = "@playlists_view_mode";
const ARTWORK_CACHE_KEY = "@playlists_artworks";

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
  energyThreshold: 0.001,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PlaylistGridItem = memo(({ 
  item, 
  artworks, 
  onPress, 
  onPlay, 
  onShuffle 
}: { 
  item: LmsPlaylist;
  artworks: string[];
  onPress: () => void;
  onPlay: () => void;
  onShuffle: () => void;
}) => {
  const cardScale = useSharedValue(1);
  const overlayOpacity = useSharedValue(0.7);
  const shuffleScale = useSharedValue(1);
  const playScale = useSharedValue(1);
  const isQobuz = item.url?.includes('qobuz');

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const shuffleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shuffleScale.value }],
  }));

  const playAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: playScale.value }],
  }));

  return (
    <Animated.View style={[styles.gridItem, cardAnimatedStyle]}>
      <View style={styles.gridImageContainer}>
        <AnimatedPressable
          style={cardAnimatedStyle}
          onPress={onPress}
          onPressIn={() => {
            cardScale.value = withSpring(0.96, springConfig);
            overlayOpacity.value = withSpring(1, springConfig);
          }}
          onPressOut={() => {
            cardScale.value = withSpring(1, springConfig);
            overlayOpacity.value = withSpring(0.7, springConfig);
          }}
        >
          <PlaylistMosaic artworks={artworks || []} size={GRID_ITEM_SIZE} />
        </AnimatedPressable>
        <Animated.View style={[styles.gridOverlay, overlayAnimatedStyle]}>
          <AnimatedPressable
            style={[styles.gridOverlayButton, shuffleAnimatedStyle]}
            onPress={(e) => {
              e?.stopPropagation?.();
              onShuffle();
            }}
            onPressIn={(e) => {
              e?.stopPropagation?.();
              shuffleScale.value = withSpring(0.9, springConfig);
            }}
            onPressOut={() => {
              shuffleScale.value = withSpring(1, springConfig);
            }}
            hitSlop={8}
          >
            <Feather name="shuffle" size={18} color="#fff" />
          </AnimatedPressable>
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
            <Feather name="play" size={22} color="#fff" style={{ marginLeft: 2 }} />
          </AnimatedPressable>
        </Animated.View>
        {isQobuz ? (
          <View style={styles.gridQobuzBadge}>
            <Image
              source={require("../assets/images/qobuz-icon.png")}
              style={styles.gridQobuzIcon}
              contentFit="contain"
            />
          </View>
        ) : null}
      </View>
      <ThemedText style={styles.gridTitle} numberOfLines={2}>
        {item.name.replace(/^Qobuz\s*:?\s*/i, '').trim()}
      </ThemedText>
      {item.trackCount !== undefined ? (
        <ThemedText style={styles.gridSubtitle}>
          {item.trackCount} {item.trackCount === 1 ? "track" : "tracks"}
        </ThemedText>
      ) : null}
    </Animated.View>
  );
});

const PlaylistMosaic = memo(({ artworks, size }: { artworks: string[]; size: number }) => {
  const tileSize = size / 2;
  
  if (artworks.length === 0) {
    return (
      <View style={[styles.mosaicContainer, { width: size, height: size }]}>
        <View style={[
          styles.mosaicPlaceholder, 
          { 
            width: size, 
            height: size,
            backgroundColor: Colors.light.backgroundTertiary,
          }
        ]}>
          <Feather name="music" size={size * 0.3} color={Colors.light.textTertiary} />
        </View>
      </View>
    );
  }
  
  if (artworks.length === 1) {
    return (
      <View style={[styles.mosaicContainer, { width: size, height: size }]}>
        <Image
          source={artworks[0]}
          style={{ width: size, height: size, borderRadius: BorderRadius.sm }}
          contentFit="cover"
        />
      </View>
    );
  }
  
  const tiles = artworks.slice(0, 4);
  while (tiles.length < 4) {
    tiles.push(tiles[tiles.length % artworks.length] || tiles[0]);
  }
  
  return (
    <View style={[styles.mosaicContainer, { width: size, height: size }]}>
      <View style={styles.mosaicRow}>
        <Image
          source={tiles[0]}
          style={[styles.mosaicTile, { width: tileSize, height: tileSize }, styles.mosaicTopLeft]}
          contentFit="cover"
        />
        <Image
          source={tiles[1]}
          style={[styles.mosaicTile, { width: tileSize, height: tileSize }, styles.mosaicTopRight]}
          contentFit="cover"
        />
      </View>
      <View style={styles.mosaicRow}>
        <Image
          source={tiles[2]}
          style={[styles.mosaicTile, { width: tileSize, height: tileSize }, styles.mosaicBottomLeft]}
          contentFit="cover"
        />
        <Image
          source={tiles[3]}
          style={[styles.mosaicTile, { width: tileSize, height: tileSize }, styles.mosaicBottomRight]}
          contentFit="cover"
        />
      </View>
    </View>
  );
});

export default function PlaylistsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const { activeServer } = useMusic();
  const { activePlayer, playPlaylist } = usePlayback();
  const [playlists, setPlaylists] = useState<LmsPlaylist[]>([]);
  const [playlistArtworks, setPlaylistArtworks] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY).then((mode) => {
      if (mode === "list" || mode === "grid") {
        setViewMode(mode);
      }
    });
    // Load cached artworks immediately
    AsyncStorage.getItem(ARTWORK_CACHE_KEY).then((cached) => {
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setPlaylistArtworks(parsed);
        } catch (e) {
          // ignore parse errors
        }
      }
    });
  }, []);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const loadPlaylistArtworks = useCallback(async (playlist: LmsPlaylist) => {
    try {
      const tracks = await lmsClient.getPlaylistTracks(playlist.id);
      const uniqueArtworks: string[] = [];
      const seen = new Set<string>();
      
      for (const track of tracks) {
        if (track.artwork_url && !seen.has(track.artwork_url)) {
          seen.add(track.artwork_url);
          uniqueArtworks.push(track.artwork_url);
          if (uniqueArtworks.length >= 4) break;
        }
      }
      
      setPlaylistArtworks(prev => {
        const updated = { ...prev, [playlist.id]: uniqueArtworks };
        // Cache to AsyncStorage for instant load next time
        AsyncStorage.setItem(ARTWORK_CACHE_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });
    } catch (error) {
      setPlaylistArtworks(prev => ({
        ...prev,
        [playlist.id]: [],
      }));
    }
  }, []);

  const loadPlaylists = useCallback(async () => {
    if (!activeServer) return;
    
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      const fetchedPlaylists = await lmsClient.getPlaylists();
      setPlaylists(fetchedPlaylists);
      
      fetchedPlaylists.slice(0, 20).forEach(playlist => {
        loadPlaylistArtworks(playlist);
      });
    } catch (error) {
      console.error("Failed to load playlists:", error);
    }
  }, [activeServer, loadPlaylistArtworks]);

  useEffect(() => {
    if (activeServer) {
      setIsLoading(true);
      loadPlaylists().finally(() => setIsLoading(false));
    } else {
      setPlaylists([]);
      setPlaylistArtworks({});
    }
  }, [activeServer, loadPlaylists]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadPlaylists();
    setIsRefreshing(false);
  };

  const handlePlayPlaylist = async (playlist: LmsPlaylist) => {
    if (!activePlayer) {
      console.log('No active player');
      return;
    }
    if (!activeServer) {
      console.log('No active server');
      return;
    }
    // Ensure server is set in lmsClient
    lmsClient.setServer(activeServer.host, activeServer.port);
    console.log('Playing playlist:', playlist.id);
    try {
      await playPlaylist(playlist.id);
    } catch (error) {
      console.error('Failed to play playlist:', error);
    }
  };

  const handleShufflePlaylist = async (playlist: LmsPlaylist) => {
    if (!activePlayer) {
      console.log('No active player');
      return;
    }
    if (!activeServer) {
      console.log('No active server');
      return;
    }
    // Ensure server is set in lmsClient
    lmsClient.setServer(activeServer.host, activeServer.port);
    console.log('Shuffling playlist:', playlist.id);
    try {
      await lmsClient.setShuffle(activePlayer.id, 1);
      await playPlaylist(playlist.id);
    } catch (error) {
      console.error('Failed to shuffle playlist:', error);
    }
  };

  const handleOpenPlaylist = (playlist: LmsPlaylist) => {
    navigation.navigate("PlaylistDetail", { playlist });
  };

  const renderGridItem = ({ item }: { item: LmsPlaylist }) => {
    const artworks = playlistArtworks[item.id];
    
    if (artworks === undefined) {
      loadPlaylistArtworks(item);
    }
    
    return (
      <PlaylistGridItem
        item={item}
        artworks={artworks || []}
        onPress={() => handleOpenPlaylist(item)}
        onPlay={() => handlePlayPlaylist(item)}
        onShuffle={() => handleShufflePlaylist(item)}
      />
    );
  };

  const renderListItem = ({ item }: { item: LmsPlaylist }) => (
    <View style={styles.listRow}>
      <Pressable
        style={({ pressed }) => [
          styles.listMainArea,
          { opacity: pressed ? 0.6 : 1 },
        ]}
        onPress={() => handleOpenPlaylist(item)}
      >
        <View style={styles.listInfo}>
          <View style={styles.listNameRow}>
            {item.url?.includes('qobuz') ? (
              <View style={styles.listQobuzBadge}>
                <Image
                  source={require("../assets/images/qobuz-icon.png")}
                  style={styles.listQobuzIcon}
                  contentFit="contain"
                />
              </View>
            ) : null}
            <ThemedText style={styles.listName} numberOfLines={1}>
              {item.name.replace(/^Qobuz\s*:?\s*/i, '').trim()}
            </ThemedText>
          </View>
          {item.trackCount !== undefined ? (
            <ThemedText style={styles.listTracks}>
              {item.trackCount} {item.trackCount === 1 ? "track" : "tracks"}
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
      <View style={styles.listActions}>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          onPress={() => handleShufflePlaylist(item)}
        >
          <Feather name="shuffle" size={20} color={Colors.light.accent} />
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          onPress={() => handlePlayPlaylist(item)}
        >
          <Feather name="play-circle" size={22} color={Colors.light.accent} />
        </Pressable>
      </View>
    </View>
  );

  const renderEmptyState = () => {
    if (isLoading) {
      return null; // Skeleton will be shown instead
    }

    if (!activeServer) {
      return (
        <View style={styles.emptyState}>
          <Feather name="server" size={48} color={Colors.light.textTertiary} />
          <ThemedText style={styles.emptyTitle}>No server connected</ThemedText>
          <ThemedText style={styles.emptySubtitle}>
            Connect to your LMS server in Settings
          </ThemedText>
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <Feather name="list" size={48} color={Colors.light.textTertiary} />
        <ThemedText style={styles.emptyTitle}>No playlists found</ThemedText>
        <ThemedText style={styles.emptySubtitle}>
          Create playlists in your LMS to see them here
        </ThemedText>
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <ThemedText style={styles.headerTitle}>Playlists</ThemedText>
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

      {viewMode === "grid" ? (
        <FlatList
          key="grid"
          data={playlists}
          renderItem={renderGridItem}
          keyExtractor={(item) => item.id}
          numColumns={NUM_COLUMNS}
          contentContainerStyle={[
            styles.gridContent,
            { paddingBottom: tabBarHeight + Spacing["5xl"] },
            playlists.length === 0 && styles.emptyListContent,
          ]}
          columnWrapperStyle={styles.gridRow}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.light.accent}
            />
          }
        />
      ) : (
        <FlatList
          key="list"
          data={playlists}
          renderItem={renderListItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: tabBarHeight + Spacing["5xl"] },
            playlists.length === 0 && styles.emptyListContent,
          ]}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.light.accent}
            />
          }
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
    ...Shadows.small,
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
    gap: Spacing.md,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    borderRadius: BorderRadius.sm,
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
  mosaicContainer: {
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  mosaicRow: {
    flexDirection: "row",
  },
  mosaicTile: {
  },
  mosaicTopLeft: {
    borderTopLeftRadius: BorderRadius.sm,
  },
  mosaicTopRight: {
    borderTopRightRadius: BorderRadius.sm,
  },
  mosaicBottomLeft: {
    borderBottomLeftRadius: BorderRadius.sm,
  },
  mosaicBottomRight: {
    borderBottomRightRadius: BorderRadius.sm,
  },
  mosaicPlaceholder: {
    backgroundColor: Colors.light.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.sm,
  },
  gridQobuzBadge: {
    position: "absolute",
    bottom: Spacing.sm,
    left: Spacing.sm,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderRadius: 4,
    padding: 2,
  },
  gridQobuzIcon: {
    width: 20,
    height: 20,
  },
  gridTitle: {
    ...Typography.body,
    color: Colors.light.text,
    fontWeight: "500",
  },
  gridSubtitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: "center",
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
  listInfo: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  listNameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  listName: {
    ...Typography.body,
    color: Colors.light.text,
    flexShrink: 1,
  },
  listQobuzBadge: {
    width: 20,
    height: 20,
    marginRight: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderRadius: 3,
    padding: 2,
  },
  listQobuzIcon: {
    width: 16,
    height: 16,
  },
  listTracks: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  listActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  actionButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  emptyTitle: {
    ...Typography.title,
    color: Colors.light.text,
    textAlign: "center",
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
});
