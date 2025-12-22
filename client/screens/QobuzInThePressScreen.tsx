import React, { useCallback, memo, useState, useEffect, useMemo } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  Dimensions,
  ActivityIndicator,
  Platform,
  Modal,
  ScrollView,
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
import { SortFilter, type SortOption } from "@/components/SortFilter";
import { Colors, Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { AlbumGridSkeleton, AlbumListSkeleton } from "@/components/SkeletonLoader";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient, type LmsAlbum } from "@/lib/lmsClient";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

const { width } = Dimensions.get("window");
const NUM_COLUMNS = 2;
const GRID_ITEM_SIZE = (width - Spacing.lg * 3) / NUM_COLUMNS;

type NavigationProp = NativeStackNavigationProp<BrowseStackParamList>;
type ViewMode = "grid" | "list";
type SortOption = "alphabetical" | "recently_played" | "recently_added";

const VIEW_MODE_KEY = "@qobuz_in_the_press_view_mode";
const SORT_KEY = "@qobuz_in_the_press_sort";

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
  energyThreshold: 0.001,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Album {
  id: string;
  name: string;
  artist: string;
  imageUrl?: string;
  year?: number;
  trackCount?: number;
  source?: "local" | "qobuz";
}

const AlbumGridCard = memo(({ album, onPress, onPlay, onShuffle }: { 
  album: Album; 
  onPress: () => void;
  onPlay: () => void;
  onShuffle: () => void;
}) => {
  const cardScale = useSharedValue(1);
  const overlayOpacity = useSharedValue(1);
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
          }}
        >
          <Image
            source={album.imageUrl || require("../assets/images/placeholder-album.png")}
            style={[styles.gridImage, { width: GRID_ITEM_SIZE, height: GRID_ITEM_SIZE }]}
            contentFit="cover"
          />
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
            <Feather name="play" size={18} color="#fff" style={{ marginLeft: 2 }} />
          </AnimatedPressable>
        </Animated.View>
        <SourceBadge source="qobuz" />
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

const AlbumListItem = memo(({ album, onPress, onPlay, onShuffle }: { 
  album: Album; 
  onPress: () => void;
  onPlay: () => void;
  onShuffle: () => void;
}) => {
  const cardScale = useSharedValue(1);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));

  return (
    <Animated.View style={[styles.listItem, cardAnimatedStyle]}>
      <Pressable
        style={({ pressed }) => [
          styles.listItemContent,
          { opacity: pressed ? 0.6 : 1 },
        ]}
        onPress={onPress}
        onPressIn={() => {
          cardScale.value = withSpring(0.98, springConfig);
        }}
        onPressOut={() => {
          cardScale.value = withSpring(1, springConfig);
        }}
      >
        <Image
          source={album.imageUrl || require("../assets/images/placeholder-album.png")}
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
        <View style={styles.listActions}>
          <Pressable
            style={({ pressed }) => [
              styles.listActionButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
            onPress={(e) => {
              e?.stopPropagation?.();
              onShuffle();
            }}
            hitSlop={8}
          >
            <Feather name="shuffle" size={18} color={Colors.light.textSecondary} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.listActionButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
            onPress={(e) => {
              e?.stopPropagation?.();
              onPlay();
            }}
            hitSlop={8}
          >
            <Feather name="play-circle" size={22} color={Colors.light.accent} />
          </Pressable>
        </View>
        <SourceBadge source="qobuz" />
      </Pressable>
    </Animated.View>
  );
});

export default function QobuzInThePressScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const { activeServer } = useMusic();
  const { activePlayer } = usePlayback();
  
  const [albums, setAlbums] = useState<Album[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortOption, setSortOption] = useState<SortOption>("alphabetical");
  const [activeFilterSheet, setActiveFilterSheet] = useState<"sort" | null>(null);

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

  useEffect(() => {
    const loadInThePress = async () => {
      if (!activeServer) {
        setAlbums([]);
        setIsLoading(false);
        return;
      }
      
      try {
        setIsLoading(true);
        lmsClient.setServer(activeServer.host, activeServer.port);
        const lmsAlbums = await lmsClient.getQobuzSelectionAlbums(1000, activePlayer?.id);
        
        const mappedAlbums: Album[] = lmsAlbums.map((album) => ({
          id: album.id,
          name: album.title,
          artist: album.artist,
          imageUrl: album.artwork_url ? lmsClient.getArtworkUrl(album as any) : undefined,
          year: album.year,
          trackCount: album.trackCount,
          source: "qobuz" as const,
        }));
        
        setAlbums(mappedAlbums);
      } catch (error) {
        console.error("Failed to load Qobuz In the Press:", error);
        setAlbums([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadInThePress();
  }, [activeServer, activePlayer?.id]);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const handleSortChange = (sort: SortOption) => {
    setSortOption(sort);
    AsyncStorage.setItem(SORT_KEY, sort);
  };

  const sortedAlbums = useMemo(() => {
    let list = [...albums];
    
    if (sortOption === "alphabetical") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortOption === "recently_played") {
      // For now, just alphabetical since we don't have recently played data
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortOption === "recently_added") {
      // For now, just alphabetical since we don't have recently added data
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    return list;
  }, [albums, sortOption]);

  const handleAlbumPress = useCallback((album: Album) => {
    navigation.navigate("Album", { 
      id: album.id, 
      name: album.name, 
      artistName: album.artist,
      source: "qobuz",
    });
  }, [navigation]);

  const handlePlayAlbum = useCallback(async (album: Album) => {
    if (!activePlayer || !activeServer) return;
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      await lmsClient.setPower(activePlayer.id, true);
      await lmsClient.playAlbum(activePlayer.id, album.id);
      await lmsClient.play(activePlayer.id);
    } catch (error) {
      console.error("Failed to play album:", error);
    }
  }, [activePlayer, activeServer]);

  const handleShuffleAlbum = useCallback(async (album: Album) => {
    if (!activePlayer || !activeServer) return;
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      const tracks = await lmsClient.getAlbumTracks(album.id, "qobuz");
      if (tracks.length === 0) return;
      
      // Shuffle tracks
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      
      await lmsClient.setPower(activePlayer.id, true);
      await lmsClient.clearPlaylist(activePlayer.id);
      
      // Add shuffled tracks
      for (const track of shuffled) {
        await lmsClient.addTrackToPlaylist(activePlayer.id, track.id);
      }
      
      await lmsClient.setShuffle(activePlayer.id, 1);
      await lmsClient.play(activePlayer.id);
    } catch (error) {
      console.error("Failed to shuffle album:", error);
    }
  }, [activePlayer, activeServer]);

  const renderItem = useCallback(({ item }: { item: Album }) => {
    if (viewMode === "grid") {
      return (
        <AlbumGridCard
          album={item}
          onPress={() => handleAlbumPress(item)}
          onPlay={() => handlePlayAlbum(item)}
          onShuffle={() => handleShuffleAlbum(item)}
        />
      );
    } else {
      return (
        <AlbumListItem
          album={item}
          onPress={() => handleAlbumPress(item)}
          onPlay={() => handlePlayAlbum(item)}
          onShuffle={() => handleShuffleAlbum(item)}
        />
      );
    }
  }, [viewMode, handleAlbumPress, handlePlayAlbum, handleShuffleAlbum]);

  if (isLoading) {
    return (
      <ThemedView style={styles.container}>
        {viewMode === "grid" ? (
          <AlbumGridSkeleton count={6} />
        ) : (
          <AlbumListSkeleton count={10} />
        )}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.md }]}>
        <View style={styles.headerLeft}>
          <Pressable
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => navigation.goBack()}
          >
            <Feather name="chevron-left" size={24} color={Colors.light.text} />
          </Pressable>
        </View>
        <View style={styles.headerCenter}>
          <ThemedText style={styles.headerTitle}>In the Press</ThemedText>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => setActiveFilterSheet("sort")}
          >
            <Feather name="sliders-h" size={20} color={Colors.light.text} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => handleViewModeChange(viewMode === "grid" ? "list" : "grid")}
          >
            <Feather
              name={viewMode === "grid" ? "list" : "grid"}
              size={20}
              color={Colors.light.text}
            />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={sortedAlbums}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        numColumns={viewMode === "grid" ? NUM_COLUMNS : 1}
        key={viewMode}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: tabBarHeight + Spacing.xl },
        ]}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Feather name="music" size={48} color={Colors.light.textTertiary} />
            <ThemedText style={styles.emptyText}>No content available</ThemedText>
          </View>
        }
      />

      <Modal
        visible={activeFilterSheet === "sort"}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveFilterSheet(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setActiveFilterSheet(null)}
        >
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>Sort By</ThemedText>
              <Pressable
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
                onPress={() => setActiveFilterSheet(null)}
              >
                <Feather name="x" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalBody}>
              <SortFilter
                value={sortOption}
                onChange={(sort) => {
                  handleSortChange(sort);
                  setActiveFilterSheet(null);
                }}
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
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
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerLeft: {
    width: 80,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    ...Typography.title2,
    fontWeight: "600",
  },
  headerRight: {
    width: 80,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
  },
  headerButton: {
    padding: Spacing.xs,
  },
  list: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  gridItem: {
    flex: 1,
    margin: Spacing.xs,
  },
  gridImageContainer: {
    position: "relative",
    marginBottom: Spacing.xs,
  },
  gridImage: {
    borderRadius: BorderRadius.sm,
  },
  gridOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    borderRadius: BorderRadius.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    opacity: 0,
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
  gridTitle: {
    ...Typography.body,
    color: Colors.light.text,
    fontWeight: "500",
    marginTop: Spacing.xs,
  },
  gridSubtitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  listItem: {
    marginBottom: Spacing.sm,
  },
  listItemContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.md,
  },
  listImage: {
    width: 60,
    height: 60,
    borderRadius: BorderRadius.sm,
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
    alignItems: "center",
    gap: Spacing.sm,
    marginRight: Spacing.sm,
  },
  listActionButton: {
    padding: Spacing.xs,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["5xl"],
  },
  emptyText: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    marginTop: Spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.light.backgroundDefault,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    maxHeight: "80%",
    paddingBottom: Spacing.xl,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  modalTitle: {
    ...Typography.title2,
    fontWeight: "600",
  },
  modalBody: {
    padding: Spacing.md,
  },
});

