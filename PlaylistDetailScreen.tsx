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
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient, type LmsTrack, type LmsPlaylist } from "@/lib/lmsClient";
import type { PlaylistsStackParamList } from "@/navigation/PlaylistsStackNavigator";

type RouteType = RouteProp<PlaylistsStackParamList, "PlaylistDetail">;
type NavigationType = NativeStackNavigationProp<PlaylistsStackParamList, "PlaylistDetail">;

export default function PlaylistDetailScreen() {
  const route = useRoute<RouteType>();
  const navigation = useNavigation<NavigationType>();
  const { playlist } = route.params;
  const { activeServer } = useMusic();
  const { activePlayer, playPlaylist } = usePlayback();
  const [tracks, setTracks] = useState<LmsTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadTracks = useCallback(async () => {
    if (!activeServer) return;
    
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      // Pass playlist.url and playlist.name to enable Qobuz/SoundCloud playlist track fetching
      const fetchedTracks = await lmsClient.getPlaylistTracks(playlist.id, playlist.url, playlist.name);
      setTracks(fetchedTracks);
    } catch (error) {
      console.error("Failed to load playlist tracks:", error);
    }
  }, [activeServer, playlist.id, playlist.url]);

  const displayName = playlist.name.trim();

  useEffect(() => {
    navigation.setOptions({
      headerTitle: displayName,
    });
  }, [navigation, displayName]);

  useEffect(() => {
    if (activeServer) {
      setIsLoading(true);
      loadTracks().finally(() => setIsLoading(false));
    }
  }, [activeServer, loadTracks]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadTracks();
    setIsRefreshing(false);
  };

  const handlePlayAll = () => {
    if (!activePlayer) return;
    const displayName = playlist.name.trim();
    playPlaylist(playlist.id, displayName);
  };

  const handleShuffleAll = async () => {
    if (!activePlayer) return;
    await lmsClient.setShuffle(activePlayer.id, 1);
    const displayName = playlist.name.trim();
    playPlaylist(playlist.id, displayName);
  };

  const handlePlayTrack = async (track: LmsTrack, index: number) => {
    if (!activePlayer) return;
    await playPlaylist(playlist.id);
    await lmsClient.playPlaylistIndex(activePlayer.id, index);
  };


  const renderTrack = ({ item, index }: { item: LmsTrack; index: number }) => (
    <Pressable
      style={({ pressed }) => [
        styles.trackRow,
        { opacity: pressed ? 0.6 : 1 },
      ]}
      onPress={() => handlePlayTrack(item, index)}
    >
      <View style={styles.trackNumber}>
        <ThemedText style={styles.trackNumberText}>{index + 1}</ThemedText>
      </View>
      <View style={styles.trackInfo}>
        <ThemedText style={styles.trackTitle} numberOfLines={1}>
          {item.title}
        </ThemedText>
        <ThemedText style={styles.trackArtist} numberOfLines={1}>
          {item.artist}
        </ThemedText>
      </View>
    </Pressable>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.playlistInfo}>
        <View style={styles.playlistIcon}>
          <Feather name="list" size={40} color={Colors.light.accent} />
        </View>
        <View style={styles.playlistMeta}>
          <ThemedText style={styles.trackCount}>
            {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
          </ThemedText>
        </View>
      </View>
      <View style={styles.actionButtons}>
        <Pressable
          style={({ pressed }) => [
            styles.shuffleButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
          onPress={handleShuffleAll}
        >
          <Feather name="shuffle" size={20} color={Colors.light.accent} />
          <ThemedText style={styles.shuffleButtonText}>Shuffle</ThemedText>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.playButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
          onPress={handlePlayAll}
        >
          <Feather name="play" size={20} color={Colors.light.buttonText} />
          <ThemedText style={styles.playButtonText}>Play</ThemedText>
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
            Loading tracks...
          </ThemedText>
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <Feather name="music" size={48} color={Colors.light.textTertiary} />
        <ThemedText style={styles.emptyTitle}>No tracks</ThemedText>
        <ThemedText style={styles.emptySubtitle}>
          This playlist is empty
        </ThemedText>
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={tracks}
        renderItem={renderTrack}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={[
          styles.listContent,
          tracks.length === 0 && styles.emptyListContent,
        ]}
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
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing["5xl"],
  },
  emptyListContent: {
    flexGrow: 1,
  },
  header: {
    paddingVertical: Spacing.xl,
  },
  playlistInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  playlistIcon: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.light.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  playlistMeta: {
    marginLeft: Spacing.lg,
    flex: 1,
  },
  trackCount: {
    ...Typography.body,
    color: Colors.light.textSecondary,
  },
  actionButtons: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  shuffleButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.light.accent,
    gap: Spacing.sm,
  },
  shuffleButtonText: {
    ...Typography.body,
    color: Colors.light.accent,
    fontWeight: "600",
  },
  playButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.light.accent,
    gap: Spacing.sm,
  },
  playButtonText: {
    ...Typography.body,
    color: Colors.light.buttonText,
    fontWeight: "600",
  },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  trackNumber: {
    width: 32,
    alignItems: "center",
  },
  trackNumberText: {
    ...Typography.body,
    color: Colors.light.textTertiary,
  },
  trackInfo: {
    flex: 1,
    marginLeft: Spacing.sm,
  },
  trackTitle: {
    ...Typography.body,
    color: Colors.light.text,
  },
  trackArtist: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["4xl"],
  },
  emptyTitle: {
    ...Typography.title,
    color: Colors.light.text,
    marginTop: Spacing.lg,
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    marginTop: Spacing.sm,
  },
});
