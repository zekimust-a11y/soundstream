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

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
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
      
      setPlaylistArtworks(prev => ({
        ...prev,
        [playlist.id]: uniqueArtworks,
      }));
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

  const handlePlayPlaylist = (playlist: LmsPlaylist) => {
    if (!activePlayer) return;
    playPlaylist(playlist.id);
  };

  const handleShufflePlaylist = async (playlist: LmsPlaylist) => {
    if (!activePlayer) return;
    await lmsClient.setShuffle(activePlayer.id, 1);
    playPlaylist(playlist.id);
  };

  const handleOpenPlaylist = (playlist: LmsPlaylist) => {
    navigation.navigate("PlaylistDetail", { playlist });
  };

  const renderGridItem = ({ item }: { item: LmsPlaylist }) => {
    const artworks = playlistArtworks[item.id];
    const displayName = item.name.replace(/^Qobuz\s*:?\s*/i, '').trim();
    const isQobuz = item.url?.includes('qobuz');
    
    if (artworks === undefined) {
      loadPlaylistArtworks(item);
    }
    
    return (
      <Pressable
        style={({ pressed }) => [
          styles.gridItem,
          { opacity: pressed ? 0.6 : 1 },
        ]}
        onPress={() => handleOpenPlaylist(item)}
      >
        <View style={styles.gridImageContainer}>
          <PlaylistMosaic artworks={artworks || []} size={GRID_ITEM_SIZE} />
          <View style={styles.gridOverlay}>
            <Pressable
              style={({ pressed }) => [
                styles.gridOverlayButton,
                { opacity: pressed ? 0.8 : 1 },
              ]}
              onPress={(e) => {
                e.stopPropagation();
                handleShufflePlaylist(item);
              }}
            >
              <Feather name="shuffle" size={18} color="#fff" />
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.gridOverlayButton,
                styles.gridPlayButton,
                { opacity: pressed ? 0.8 : 1 },
              ]}
              onPress={(e) => {
                e.stopPropagation();
                handlePlayPlaylist(item);
              }}
            >
              <Feather name="play" size={22} color="#fff" />
            </Pressable>
          </View>
          {isQobuz ? (
            <View style={styles.gridQobuzBadge}>
              <ThemedText style={styles.gridQobuzText}>Q</ThemedText>
            </View>
          ) : null}
        </View>
        <ThemedText style={styles.gridTitle} numberOfLines={2}>
          {displayName}
        </ThemedText>
        {item.trackCount !== undefined ? (
          <ThemedText style={styles.gridSubtitle}>
            {item.trackCount} tracks
          </ThemedText>
        ) : null}
      </Pressable>
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
                <ThemedText style={styles.listQobuzText}>Q</ThemedText>
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
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={Colors.light.accent} />
          <ThemedText style={styles.emptySubtitle}>
            Loading playlists...
          </ThemedText>
        </View>
      );
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
    ...Typography.display,
    color: Colors.light.text,
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
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    borderRadius: BorderRadius.sm,
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
    backgroundColor: Colors.light.accent,
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
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  gridQobuzText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
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
    borderRadius: 4,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
  },
  listQobuzText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
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
