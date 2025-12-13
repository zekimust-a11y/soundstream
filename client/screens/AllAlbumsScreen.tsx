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
import { AlbumGridSkeleton, AlbumListSkeleton } from "@/components/SkeletonLoader";
import { useInfiniteAlbums, Album } from "@/hooks/useLibrary";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient } from "@/lib/lmsClient";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

const { width } = Dimensions.get("window");
const NUM_COLUMNS = 2;
const GRID_ITEM_SIZE = (width - Spacing.lg * 3) / NUM_COLUMNS;

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
  onShuffle: () => void;
}) => {
  const cardScale = useSharedValue(1);
  const overlayOpacity = useSharedValue(0.7);
  const shuffleScale = useSharedValue(1);
  const playScale = useSharedValue(1);

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
          <Image
            source={album.imageUrl || require("../assets/images/placeholder-album.png")}
            style={styles.gridImage}
            contentFit="cover"
          />
        </AnimatedPressable>
        <SourceBadge source={album.source} size={20} />
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
      </View>
      <ThemedText style={styles.gridTitle} numberOfLines={2}>
        {album.name}
      </ThemedText>
      <ThemedText style={styles.gridSubtitle} numberOfLines={1}>
        {album.artist}
      </ThemedText>
    </Animated.View>
  );
});

const AlbumListRow = memo(({ album, onPress, onPlay, onShuffle }: { 
  album: Album; 
  onPress: () => void;
  onPlay: () => void;
  onShuffle: () => void;
}) => (
  <View style={styles.listRow}>
    <Pressable
      style={({ pressed }) => [
        styles.listMainArea,
        { opacity: pressed ? 0.6 : 1 },
      ]}
      onPress={onPress}
    >
      <View style={styles.listImageContainer}>
        <Image
          source={album.imageUrl || require("../assets/images/placeholder-album.png")}
          style={styles.listImage}
          contentFit="cover"
        />
        <SourceBadge source={album.source} size={18} />
      </View>
      <View style={styles.listInfo}>
        <ThemedText style={styles.listTitle} numberOfLines={1}>
          {album.name}
        </ThemedText>
        <ThemedText style={styles.listSubtitle} numberOfLines={1}>
          {album.artist}
        </ThemedText>
      </View>
    </Pressable>
    <View style={styles.listActions}>
      <Pressable
        style={({ pressed }) => [
          styles.actionButton,
          { opacity: pressed ? 0.6 : 1 },
        ]}
        onPress={onShuffle}
      >
        <Feather name="shuffle" size={20} color={Colors.light.accent} />
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
  </View>
));

export default function AllAlbumsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const { activeServer } = useMusic();
  const { activePlayer } = usePlayback();
  
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteAlbums();

  const albums = data?.pages.flatMap(page => page.albums) || [];
  const total = data?.pages[0]?.total || 0;
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

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

  const handleAlbumPress = useCallback((album: Album) => {
    navigation.navigate("Album", { id: album.id, name: album.name, artistName: album.artist });
  }, [navigation]);

  const handlePlayAlbum = useCallback(async (album: Album) => {
    if (!activePlayer || !activeServer) return;
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      await lmsClient.setPower(activePlayer.id, true);
      await lmsClient.playAlbum(activePlayer.id, album.id);
      await lmsClient.play(activePlayer.id);
    } catch (error) {
      console.error('Failed to play album:', error);
    }
  }, [activePlayer, activeServer]);

  const handleShuffleAlbum = useCallback(async (album: Album) => {
    if (!activePlayer || !activeServer) return;
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      await lmsClient.setPower(activePlayer.id, true);
      await lmsClient.setShuffle(activePlayer.id, 1);
      await lmsClient.playAlbum(activePlayer.id, album.id);
      await lmsClient.play(activePlayer.id);
    } catch (error) {
      console.error('Failed to shuffle album:', error);
    }
  }, [activePlayer, activeServer]);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderGridItem = useCallback(({ item }: { item: Album }) => (
    <AlbumGridCard 
      album={item} 
      onPress={() => handleAlbumPress(item)}
      onPlay={() => handlePlayAlbum(item)}
      onShuffle={() => handleShuffleAlbum(item)}
    />
  ), [handleAlbumPress, handlePlayAlbum, handleShuffleAlbum]);

  const renderListItem = useCallback(({ item }: { item: Album }) => (
    <AlbumListRow 
      album={item} 
      onPress={() => handleAlbumPress(item)}
      onPlay={() => handlePlayAlbum(item)}
      onShuffle={() => handleShuffleAlbum(item)}
    />
  ), [handleAlbumPress, handlePlayAlbum, handleShuffleAlbum]);

  const keyExtractor = useCallback((item: Album) => item.id, []);

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
          <ThemedText style={styles.headerTitle}>Albums</ThemedText>
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
        {viewMode === "grid" ? <AlbumGridSkeleton /> : <AlbumListSkeleton />}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <ThemedText style={styles.headerTitle}>Albums</ThemedText>
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
          data={albums}
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
          data={albums}
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
    gap: Spacing.md,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    borderRadius: BorderRadius.xs,
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
});
