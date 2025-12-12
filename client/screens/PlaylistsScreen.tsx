import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient, type LmsPlaylist } from "@/lib/lmsClient";
import type { PlaylistsStackParamList } from "@/navigation/PlaylistsStackNavigator";

type NavigationProp = NativeStackNavigationProp<PlaylistsStackParamList>;

export default function PlaylistsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const { activeServer } = useMusic();
  const { activePlayer, playPlaylist } = usePlayback();
  const [playlists, setPlaylists] = useState<LmsPlaylist[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadPlaylists = useCallback(async () => {
    if (!activeServer) return;
    
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      const fetchedPlaylists = await lmsClient.getPlaylists();
      setPlaylists(fetchedPlaylists);
    } catch (error) {
      console.error("Failed to load playlists:", error);
    }
  }, [activeServer]);

  useEffect(() => {
    if (activeServer) {
      setIsLoading(true);
      loadPlaylists().finally(() => setIsLoading(false));
    } else {
      setPlaylists([]);
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

  const renderPlaylist = ({ item }: { item: LmsPlaylist }) => (
    <View style={styles.playlistRow}>
      <Pressable
        style={({ pressed }) => [
          styles.playlistMainArea,
          { opacity: pressed ? 0.6 : 1 },
        ]}
        onPress={() => handleOpenPlaylist(item)}
      >
        <View style={styles.playlistInfo}>
          <View style={styles.playlistNameRow}>
            {item.url?.includes('qobuz') ? (
              <View style={styles.qobuzBadge}>
                <ThemedText style={styles.qobuzBadgeText}>Q</ThemedText>
              </View>
            ) : null}
            <ThemedText style={styles.playlistName} numberOfLines={1}>
              {item.name.replace(/^Qobuz\s*:?\s*/i, '').trim()}
            </ThemedText>
          </View>
          {item.trackCount !== undefined ? (
            <ThemedText style={styles.playlistTracks}>
              {item.trackCount} {item.trackCount === 1 ? "track" : "tracks"}
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
      <View style={styles.playlistActions}>
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
      </View>

      <FlatList
        data={playlists}
        renderItem={renderPlaylist}
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
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  playlistRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  playlistMainArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  playlistInfo: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  playlistNameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  playlistName: {
    ...Typography.body,
    color: Colors.light.text,
    flexShrink: 1,
  },
  qobuzBadge: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
  },
  qobuzBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },
  playlistTracks: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  playlistActions: {
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
