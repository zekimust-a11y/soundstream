import React, { useCallback, memo, useState, useEffect } from "react";
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
import { SourceBadge } from "@/components/SourceBadge";
import { Colors, Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { useInfiniteAlbums, Album } from "@/hooks/useLibrary";

interface AlbumItem extends Album {}
import { useMusic } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient } from "@/lib/lmsClient";
import type { Track } from "@/hooks/useLibrary";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

const { width } = Dimensions.get("window");
const NUM_COLUMNS = 3;
const GRID_ITEM_SIZE = (width - Spacing.lg * 4) / NUM_COLUMNS;

type NavigationProp = NativeStackNavigationProp<BrowseStackParamList>;
type ViewMode = "grid" | "list";

const VIEW_MODE_KEY = "@albums_view_mode";

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
  energyThreshold: 0.001,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);


const AlbumGridCard = memo(({ album, onPress, onPlay, onShuffle }: {
  album: Album;
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
    <Animated.View style={[styles.gridItem, cardAnimatedStyle]}>
      <View style={styles.gridImageContainer}>
        <AnimatedPressable
          style={cardAnimatedStyle}
          onPress={onPress}
          onPressIn={() => {
            cardScale.value = withSpring(0.96, springConfig);
          }}
          onPressOut={() => {
            cardScale.value = withSpring(1, springConfig);
          }}
        >
          {imageUrl ? (
            <Image
              source={imageUrl}
              style={styles.gridImage}
              contentFit="cover"
            />
          ) : (
            <View style={styles.gridImagePlaceholder}>
              <Feather name="disc" size={GRID_ITEM_SIZE * 0.3} color={Colors.light.textTertiary} />
            </View>
          )}
        </AnimatedPressable>
        <SourceBadge source={album.source || 'local'} size={20} />
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
    </Animated.View>
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
        {imageUrl ? (
          <Image
            source={imageUrl}
            style={styles.listImage}
            contentFit="cover"
          />
        ) : (
          <View style={styles.listImagePlaceholder}>
            <Feather name="disc" size={20} color={Colors.light.accent} />
          </View>
        )}
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
  console.log('🎵 AllAlbumsScreen rendering - should show ALBUMS!');
  console.trace('AllAlbumsScreen call stack');
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
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

  // Get base URL for constructing image URLs
  const baseUrl = activeServer
    ? `http://${activeServer.host}:${activeServer.port}`
    : 'http://192.168.0.19:9000';

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const allAlbums = data?.pages.flatMap(page => page.albums) || [];
  const total = data?.pages[0]?.total || 0;

  const handlePlayAlbum = useCallback(async (album: Album) => {
    console.log('🎵 [DEBUG] handlePlayAlbum called with:', {
      albumTitle: album.title,
      albumId: album.id,
      albumSource: album.source,
      activePlayer: activePlayer?.id,
      activeServer: activeServer?.host
    });

    if (!activePlayer || !activeServer) {
      console.log('❌ [DEBUG] Cannot play album: missing player or server', {
        hasPlayer: !!activePlayer,
        hasServer: !!activeServer,
        albumTitle: album.title
      });
      return;
    }

    try {
      console.log('🚀 [DEBUG] Starting album playback process');

      // Set a temporary current track so mini player appears immediately
      const tempTrack: Track = {
        id: `album-${album.id}`,
        title: album.title,
        artist: album.artist,
        album: album.title,
        albumArt: album.imageUrl,
        duration: 0,
        source: album.source || 'local'
      };
      console.log('🎼 [DEBUG] Setting temporary current track:', tempTrack);
      setCurrentTrack(tempTrack);

      console.log('🔌 [DEBUG] Setting LMS server');
      lmsClient.setServer(activeServer.host, activeServer.port);

      // Ensure player is powered on
      console.log('🔋 [DEBUG] Powering on player');
      await lmsClient.setPower(activePlayer.id, true);
      console.log('✅ [DEBUG] Player powered on');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Clear playlist first
      console.log('🧹 [DEBUG] Clearing playlist');
      const clearResult = await lmsClient.request(activePlayer.id, ['playlist', 'clear']);
      console.log('✅ [DEBUG] Playlist cleared:', clearResult);

      // Add album to playlist
      console.log('➕ [DEBUG] Adding album to playlist:', album.id);
      const addResult = await lmsClient.addAlbumToPlaylist(activePlayer.id, album.id);
      console.log('✅ [DEBUG] Album added to playlist:', addResult);

      // Give LMS time to process the album addition
      console.log('⏳ [DEBUG] Waiting for LMS to process album addition');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Check playlist status
      console.log('📋 [DEBUG] Checking playlist status');
      const playlistStatus = await lmsClient.request(activePlayer.id, ['playlist', 'tracks', '0', '10']);
      console.log('📋 [DEBUG] Playlist tracks result:', playlistStatus);

      // Start playback from the beginning
      console.log('▶️ [DEBUG] Setting playlist index to 0');
      const indexResult = await lmsClient.request(activePlayer.id, ['playlist', 'index', '0']);
      console.log('✅ [DEBUG] Playlist index set:', indexResult);

      console.log('🎵 [DEBUG] Starting playback');
      const playResult = await lmsClient.play(activePlayer.id);
      console.log('✅ [DEBUG] Play command sent:', playResult);

      // Trigger sync to get real track info
      console.log('🔄 [DEBUG] Triggering player status sync in 1 second');
      setTimeout(() => {
        console.log('🔄 [DEBUG] Syncing player status now');
        syncPlayerStatus();
      }, 1000);

      console.log('🎉 [DEBUG] Album play command sequence completed successfully');
    } catch (error) {
      console.error('❌ [DEBUG] Failed to play album:', error);
      if (error instanceof Error) {
        console.error('❌ [DEBUG] Error details:', error.message, error.stack);
      }
    }
  }, [activePlayer, activeServer, setCurrentTrack, syncPlayerStatus]);

  const handleShuffleAlbum = useCallback(async (album: Album) => {
    console.log('🎵 [DEBUG] handleShuffleAlbum called with:', {
      albumTitle: album.title,
      albumId: album.id,
      albumSource: album.source,
      activePlayer: activePlayer?.id,
      activeServer: activeServer?.host
    });

    if (!activePlayer || !activeServer) {
      console.log('❌ [DEBUG] Cannot shuffle album: missing player or server');
      return;
    }

    try {
      console.log('🚀 [DEBUG] Starting album shuffle process');

      console.log('🔌 [DEBUG] Setting LMS server');
      lmsClient.setServer(activeServer.host, activeServer.port);

      // Ensure player is powered on
      console.log('🔋 [DEBUG] Powering on player');
      await lmsClient.setPower(activePlayer.id, true);
      console.log('✅ [DEBUG] Player powered on');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get all album tracks
      console.log('📀 [DEBUG] Fetching album tracks');
      const albumTracks = await lmsClient.getAlbumTracks(album.id, album.source as "qobuz" | "local");
      console.log('✅ [DEBUG] Retrieved album tracks:', albumTracks.length, 'tracks');

      if (albumTracks.length === 0) {
        console.error('❌ [DEBUG] No tracks found in album');
        return;
      }

      // Shuffle the tracks array
      console.log('🔀 [DEBUG] Shuffling tracks');
      const shuffledTracks = [...albumTracks].sort(() => Math.random() - 0.5);
      console.log('✅ [DEBUG] Tracks shuffled, first 3:', shuffledTracks.slice(0, 3).map(t => t.title));

      // Clear playlist first
      console.log('🧹 [DEBUG] Clearing playlist');
      const clearResult = await lmsClient.request(activePlayer.id, ['playlist', 'clear']);
      console.log('✅ [DEBUG] Playlist cleared:', clearResult);

      // Add shuffled tracks individually
      console.log('➕ [DEBUG] Adding shuffled tracks to playlist');
      let addedCount = 0;
      for (const track of shuffledTracks) {
        await lmsClient.addTrackToPlaylist(activePlayer.id, track.id);
        addedCount++;
        if (addedCount % 5 === 0) {
          console.log(`✅ [DEBUG] Added ${addedCount}/${shuffledTracks.length} tracks`);
        }
      }
      console.log('✅ [DEBUG] All shuffled tracks added to playlist');

      // Give LMS time to process all track additions
      console.log('⏳ [DEBUG] Waiting for LMS to process track additions');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check playlist status
      console.log('📋 [DEBUG] Checking final playlist status');
      const playlistStatus = await lmsClient.request(activePlayer.id, ['playlist', 'tracks', '0', '5']);
      console.log('📋 [DEBUG] Final playlist tracks:', playlistStatus);

      // Start playback from the beginning
      console.log('▶️ [DEBUG] Setting playlist index to 0');
      const indexResult = await lmsClient.request(activePlayer.id, ['playlist', 'index', '0']);
      console.log('✅ [DEBUG] Playlist index set:', indexResult);

      console.log('🎵 [DEBUG] Starting shuffle playback');
      const playResult = await lmsClient.play(activePlayer.id);
      console.log('✅ [DEBUG] Shuffle play command sent:', playResult);

      // Trigger sync to get real track info
      console.log('🔄 [DEBUG] Triggering player status sync in 1 second');
      setTimeout(() => {
        console.log('🔄 [DEBUG] Syncing player status now');
        syncPlayerStatus();
      }, 1000);

      console.log('🎉 [DEBUG] Album shuffle command sequence completed successfully');
    } catch (error) {
      console.error('❌ [DEBUG] Failed to shuffle album:', error);
      if (error instanceof Error) {
        console.error('❌ [DEBUG] Error details:', error.message, error.stack);
      }
    }
  }, [activePlayer, activeServer, syncPlayerStatus]);

  const renderGridItem = useCallback(({ item }: { item: Album }) => (
    <AlbumGridCard
      album={item}
      onPress={() => {
        navigation.navigate("Album", { id: item.id, name: item.title, artistName: item.artist });
      }}
      onPlay={() => handlePlayAlbum(item)}
      onShuffle={() => handleShuffleAlbum(item)}
    />
  ), [navigation, handlePlayAlbum, handleShuffleAlbum]);

  const renderListItem = useCallback(({ item }: { item: Album }) => (
    <AlbumListRow
      album={item}
      onPress={() => {
        navigation.navigate("Album", { id: item.id, name: item.title, artistName: item.artist });
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
    console.error('Albums query error:', error);
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
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <ThemedText style={styles.headerTitle}>Albums ({allAlbums.length})</ThemedText>
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
      ) : viewMode === "grid" ? (
        <FlatList
          key="grid"
          data={allAlbums}
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
          {...(Platform.OS === 'ios' && { contentInsetAdjustmentBehavior: 'automatic' })}
        />
      ) : (
        <FlatList
          key="list"
          data={allAlbums}
          renderItem={renderListItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingTop: Spacing.md,
              paddingBottom: tabBarHeight + Spacing["5xl"]
            },
          ]}
          ItemSeparatorComponent={ItemSeparator}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={isFetchingNextPage ? <ActivityIndicator /> : null}
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
  filterRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
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
    ...Shadows.small,
  },
  gridImage: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
    borderRadius: BorderRadius.xs,
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
  listImageContainer: {
    marginRight: Spacing.md,
  },
  listImage: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.xs,
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
  listActions: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  actionButton: {
    padding: Spacing.sm,
  },
  footer: {
    padding: Spacing.xl,
    alignItems: "center",
  },
  filterModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  filterModalContent: {
    backgroundColor: Colors.light.backgroundDefault,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    maxHeight: "70%",
  },
  filterModalTitle: {
    ...Typography.title,
    marginBottom: Spacing.md,
    color: Colors.light.text,
  },
  filterOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  filterOptionText: {
    ...Typography.body,
    color: Colors.light.text,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
    paddingVertical: Spacing.sm,
    borderRadius: 999,
    backgroundColor: Colors.light.backgroundSecondary,
    marginRight: Spacing.sm,
  },
  filterChipActive: {
    backgroundColor: Colors.light.text,
  },
  filterChipText: {
    ...Typography.body,
    color: Colors.light.text,
  },
  filterLoading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
  },
  filterLoadingText: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: Spacing.sm,
  },
  filterDoneButton: {
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    alignSelf: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.light.text,
  },
  filterDoneButtonText: {
    ...Typography.body,
    color: Colors.dark.text,
    fontWeight: "600",
  },
  retryButton: {
    backgroundColor: Colors.light.accent,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.lg,
  },
  retryText: {
    color: Colors.light.buttonText,
    fontWeight: "600",
    textAlign: "center",
  },
  albumItem: {
    flex: 1,
    margin: Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  albumImage: {
    width: '100%',
    aspectRatio: 1,
  },
  albumInfo: {
    padding: Spacing.sm,
  },
  albumTitle: {
    ...Typography.body,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  albumArtist: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
});
