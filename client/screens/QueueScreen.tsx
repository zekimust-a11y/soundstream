import React from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { usePlayback, type Track } from "@/hooks/usePlayback";

function normalizeDuration(duration: number): number {
  if (!duration || !isFinite(duration) || duration <= 0) return 0;
  if (duration > 36000) {
    return Math.round(duration / 1000);
  }
  return duration;
}

function formatDuration(duration: number): string {
  const seconds = normalizeDuration(duration);
  if (!seconds || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function QueueScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { queue, currentTrack, isPlaying, playTrack, removeFromQueue, clearQueue } = usePlayback();

  const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
  const upcomingTracks = currentIndex >= 0 ? queue.slice(currentIndex + 1) : queue;

  const renderTrack = ({ item, index }: { item: Track; index: number }) => {
    const isCurrentTrack = currentTrack?.id === item.id;
    const actualIndex = currentIndex >= 0 ? currentIndex + 1 + index : index;

    return (
      <Pressable
        style={({ pressed }) => [
          styles.trackRow,
          { opacity: pressed ? 0.6 : 1 },
          isCurrentTrack && styles.trackRowActive,
        ]}
        onPress={() => playTrack(item, queue)}
      >
        <View style={styles.dragHandle}>
          <Feather name="menu" size={18} color={Colors.light.textTertiary} />
        </View>
        <Image
          source={item.albumArt || require("../assets/images/placeholder-album.png")}
          style={styles.trackImage}
          contentFit="cover"
        />
        <View style={styles.trackInfo}>
          <ThemedText
            style={[styles.trackTitle, isCurrentTrack && styles.trackTitleActive]}
            numberOfLines={1}
          >
            {item.title}
          </ThemedText>
          <ThemedText style={styles.trackArtist} numberOfLines={1}>
            {item.artist}
          </ThemedText>
        </View>
        <ThemedText style={styles.trackDuration}>
          {formatDuration(item.duration)}
        </ThemedText>
        <Pressable
          style={({ pressed }) => [styles.removeButton, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => removeFromQueue(actualIndex)}
        >
          <Feather name="x" size={18} color={Colors.light.textSecondary} />
        </Pressable>
      </Pressable>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Image
        source={require("../assets/images/empty-queue.png")}
        style={styles.emptyImage}
        contentFit="contain"
      />
      <ThemedText style={styles.emptyTitle}>Your queue is empty</ThemedText>
      <ThemedText style={styles.emptySubtitle}>
        Add some tracks to start listening
      </ThemedText>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <ThemedText style={styles.headerTitle}>Queue</ThemedText>
        {queue.length > 0 ? (
          <Pressable
            style={({ pressed }) => [styles.clearButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={clearQueue}
          >
            <ThemedText style={styles.clearButtonText}>Clear</ThemedText>
          </Pressable>
        ) : null}
      </View>

      {currentTrack ? (
        <View style={styles.nowPlayingSection}>
          <ThemedText style={styles.sectionLabel}>Now Playing</ThemedText>
          <View style={styles.nowPlayingCard}>
            <Image
              source={currentTrack.albumArt || require("../assets/images/placeholder-album.png")}
              style={styles.nowPlayingImage}
              contentFit="cover"
            />
            <View style={styles.nowPlayingInfo}>
              <ThemedText style={styles.nowPlayingTitle} numberOfLines={1}>
                {currentTrack.title}
              </ThemedText>
              <ThemedText style={styles.nowPlayingArtist} numberOfLines={1}>
                {currentTrack.artist}
              </ThemedText>
            </View>
            {isPlaying ? (
              <Feather name="volume-2" size={20} color={Colors.light.accent} />
            ) : (
              <Feather name="pause" size={20} color={Colors.light.textSecondary} />
            )}
          </View>
        </View>
      ) : null}

      {upcomingTracks.length > 0 ? (
        <ThemedText style={styles.sectionLabel}>Up Next</ThemedText>
      ) : null}

      <FlatList
        data={upcomingTracks}
        renderItem={renderTrack}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: tabBarHeight + Spacing["5xl"] },
          queue.length === 0 && styles.emptyListContent,
        ]}
        ListEmptyComponent={!currentTrack ? renderEmptyState : null}
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
  clearButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  clearButtonText: {
    ...Typography.body,
    color: Colors.light.accent,
  },
  sectionLabel: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    marginTop: Spacing.lg,
  },
  nowPlayingSection: {
    marginBottom: Spacing.md,
  },
  nowPlayingCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.light.backgroundSecondary,
    marginHorizontal: Spacing.lg,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  nowPlayingImage: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.xs,
  },
  nowPlayingInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  nowPlayingTitle: {
    ...Typography.headline,
    color: Colors.light.text,
  },
  nowPlayingArtist: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  trackRowActive: {
    backgroundColor: Colors.light.backgroundSecondary,
    marginHorizontal: -Spacing.lg,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.xs,
  },
  dragHandle: {
    paddingRight: Spacing.md,
  },
  trackImage: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.xs,
  },
  trackInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  trackTitle: {
    ...Typography.body,
    color: Colors.light.text,
  },
  trackTitleActive: {
    color: Colors.light.accent,
  },
  trackArtist: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
  },
  trackDuration: {
    ...Typography.caption,
    color: Colors.light.textTertiary,
    marginRight: Spacing.md,
  },
  removeButton: {
    padding: Spacing.sm,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  emptyImage: {
    width: 160,
    height: 160,
    marginBottom: Spacing.xl,
    opacity: 0.6,
  },
  emptyTitle: {
    ...Typography.title,
    color: Colors.light.text,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
});
