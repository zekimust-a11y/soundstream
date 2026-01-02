import React, { useCallback } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
} from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { SourceBadge } from "@/components/SourceBadge";
import { AppHeader } from "@/components/AppHeader";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback, Track } from "@/hooks/usePlayback";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

type NavigationProp = NativeStackNavigationProp<BrowseStackParamList>;

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function HistoryScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const { recentlyPlayed } = useMusic();
  const { playTrack } = usePlayback();

  const handleTrackPress = useCallback((track: Track) => {
    playTrack(track);
  }, [playTrack]);

  const handleAlbumPress = useCallback((track: Track) => {
    if (track.metadata) {
      try {
        const meta = JSON.parse(track.metadata);
        if (meta.albumId) {
          navigation.navigate("Album", {
            id: meta.albumId,
            name: track.album,
            artistName: track.artist,
          });
        }
      } catch {}
    }
  }, [navigation]);

  const handleArtistPress = useCallback((track: Track) => {
    if (track.metadata) {
      try {
        const meta = JSON.parse(track.metadata);
        if (meta.artistId) {
          navigation.navigate("Artist", {
            id: meta.artistId,
            name: track.artist,
          });
        }
      } catch {}
    }
  }, [navigation]);

  const renderTrack = useCallback(({ item: track }: { item: Track }) => (
    <Pressable
      style={({ pressed }) => [
        styles.trackRow,
        { opacity: pressed ? 0.6 : 1 },
      ]}
      onPress={() => handleTrackPress(track)}
    >
      <View style={styles.trackImageContainer}>
        <Image
          source={track.albumArt || require("../assets/images/placeholder-album.png")}
          style={styles.trackImage}
          contentFit="cover"
        />
        <SourceBadge source={track.source} size={16} />
      </View>
      <View style={styles.trackInfo}>
        <ThemedText style={styles.trackTitle} numberOfLines={1}>
          {track.title}
        </ThemedText>
        <View style={styles.trackMeta}>
          <Pressable
            onPress={() => handleArtistPress(track)}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <ThemedText style={styles.trackArtist} numberOfLines={1}>
              {track.artist}
            </ThemedText>
          </Pressable>
          {track.album ? (
            <>
              <ThemedText style={styles.trackSeparator}> • </ThemedText>
              <Pressable
                onPress={() => handleAlbumPress(track)}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <ThemedText style={styles.trackAlbum} numberOfLines={1}>
                  {track.album}
                </ThemedText>
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
      {track.duration > 0 ? (
        <ThemedText style={styles.trackDuration}>
          {formatTime(track.duration)}
        </ThemedText>
      ) : null}
      <Pressable
        style={({ pressed }) => [
          styles.playButton,
          { opacity: pressed ? 0.6 : 1 },
        ]}
        onPress={() => handleTrackPress(track)}
      >
        <Feather name="play" size={18} color={Colors.light.text} />
      </Pressable>
    </Pressable>
  ), [handleTrackPress, handleArtistPress, handleAlbumPress]);

  return (
    <ThemedView style={styles.container}>
      <AppHeader title="History" showBack />

      {recentlyPlayed.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="clock" size={64} color={Colors.light.textTertiary} />
          <ThemedText style={styles.emptyTitle}>No History</ThemedText>
          <ThemedText style={styles.emptySubtitle}>
            Tracks you play will appear here
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={recentlyPlayed}
          renderItem={renderTrack}
          keyExtractor={(track) => `history-${track.id}`}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: tabBarHeight + Spacing.xl },
          ]}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
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
  // Header now standardized via `AppHeader`.
  content: {
    paddingHorizontal: Spacing.lg,
  },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
  },
  trackImageContainer: {
    position: "relative",
    marginRight: Spacing.md,
  },
  trackImage: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.sm,
  },
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    ...Typography.body,
    color: Colors.light.text,
    fontWeight: "500",
    marginBottom: 4,
  },
  trackMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  trackArtist: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
  },
  trackSeparator: {
    ...Typography.caption,
    color: Colors.light.textTertiary,
  },
  trackAlbum: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
  },
  trackDuration: {
    ...Typography.caption,
    color: Colors.light.textTertiary,
    marginRight: Spacing.sm,
    minWidth: 40,
    textAlign: "right",
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.light.border,
    marginLeft: 72,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    ...Typography.title,
    color: Colors.light.text,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
});

