import React, { useEffect, useState, useCallback } from "react";
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

type NavigationProp = NativeStackNavigationProp<PlaylistsStackParamList>;
type ViewMode = "grid" | "list";

const VIEW_MODE_KEY = "@playlists_view_mode";

export default function PlaylistsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const { activeServer } = useMusic();
  const { activePlayer, playPlaylist } = usePlayback();
  const [playlists, setPlaylists] = useState<LmsPlaylist[]>([]);
  const [playlistArtwork, setPlaylistArtwork] = useState<Record<string, string>>({});
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

  const loadPlaylistArtwork = useCallback(async (playlist: LmsPlaylist) => {
    try {
      const tracks = await lmsClient.getPlaylistTracks(playlist.id);
      if (tracks.length > 0 && tracks[0].artwork_url) {
        setPlaylistArtwork(prev => ({
          ...prev,
          [playlist.id]: tracks[0].artwork_url!,
        }));
      }
    } catch (error) {
      // Silently fail for artwork loading
    }
  }, []);

  const loadPlaylists = useCallback(async () => {
    if (!activeServer) return;
    
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      const fetchedPlaylists = await lmsClient.getPlaylists();
      setPlaylists(fetchedPlaylists);
      
      // Load artwork for first 20 playlists
      fetchedPlaylists.slice(0, 20).forEach(playlist => {
        loadPlaylistArtwork(playlist);
      });
    } catch (error) {
      console.error("Failed to load playlists:", error);
    }
  }, [activeServer, loadPlaylistArtwork]);

  useEffect(() => {
    if (activeServer) {
      setIsLoading(true);
      loadPlaylists().finally(() => setIsLoading(false));
    } else {
      setPlaylists([]);
      setPlaylistArtwork({});
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
    const artwork = playlistArtwork[item.id];
    const displayName = item.name.replace(/^Qobuz\s*:?\s*/i, '').trim();
    const isQobuz = item.url?.includes('qobuz');
    
    return (
      <Pressable
        style={({ pressed }) => [
          styles.gridItem,
          { opacity: pressed ? 0.6 : 1 },
        ]}
        onPress={() => handleOpenPlaylist(item)}
      >
        <View style={styles.gridImageContainer}>
          {artwork ? (
            <Image
              source={artwork}
              style={styles.gridImage}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.gridImage, styles.gridPlaceholder]}>
              <Feather name="music" size={40} color={Colors.light.textTertiary} />
            </View>
          )}
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
  gridImage: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
    borderRadius: BorderRadius.sm,
  },
  gridPlaceholder: {
    backgroundColor: Colors.light.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  gridQobuzBadge: {
    position: "absolute",
    top: Spacing.sm,
    left: Spacing.sm,
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: "#000",
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
