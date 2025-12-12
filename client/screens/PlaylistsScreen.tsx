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
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useLms } from "@/hooks/useLms";
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient, type LmsPlaylist } from "@/lib/lmsClient";

export default function PlaylistsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { server, activePlayer } = useLms();
  const { playPlaylist } = usePlayback();
  const [playlists, setPlaylists] = useState<LmsPlaylist[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadPlaylists = useCallback(async () => {
    if (!server) return;
    
    try {
      lmsClient.setServer(server.host, server.port);
      const fetchedPlaylists = await lmsClient.getPlaylists();
      setPlaylists(fetchedPlaylists);
    } catch (error) {
      console.error("Failed to load playlists:", error);
    }
  }, [server]);

  useEffect(() => {
    if (server) {
      setIsLoading(true);
      loadPlaylists().finally(() => setIsLoading(false));
    } else {
      setPlaylists([]);
    }
  }, [server, loadPlaylists]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadPlaylists();
    setIsRefreshing(false);
  };

  const handlePlayPlaylist = (playlist: LmsPlaylist) => {
    if (!activePlayer) return;
    playPlaylist(playlist.id);
  };

  const renderPlaylist = ({ item }: { item: LmsPlaylist }) => (
    <Pressable
      style={({ pressed }) => [
        styles.playlistRow,
        { opacity: pressed ? 0.6 : 1 },
      ]}
      onPress={() => handlePlayPlaylist(item)}
    >
      <View style={styles.playlistIcon}>
        <Feather name="list" size={24} color={Colors.light.accent} />
      </View>
      <View style={styles.playlistInfo}>
        <ThemedText style={styles.playlistName} numberOfLines={1}>
          {item.name}
        </ThemedText>
        {item.trackCount !== undefined ? (
          <ThemedText style={styles.playlistTracks}>
            {item.trackCount} {item.trackCount === 1 ? "track" : "tracks"}
          </ThemedText>
        ) : null}
      </View>
      <Feather name="play-circle" size={24} color={Colors.light.textSecondary} />
    </Pressable>
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

    if (!server) {
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
  playlistIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.light.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  playlistInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  playlistName: {
    ...Typography.body,
    color: Colors.light.text,
  },
  playlistTracks: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
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
