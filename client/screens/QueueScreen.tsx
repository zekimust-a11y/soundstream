import React from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, CommonActions } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { Platform } from "react-native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { StatusBar } from "expo-status-bar";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { AlbumArtwork } from "@/components/AlbumArtwork";
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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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
        <AlbumArtwork
          source={item.albumArt}
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
      <StatusBar style="dark" translucent />
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <Pressable style={styles.backButton} onPress={() => {
          try {
            // Check if we can go back
            if (typeof navigation.canGoBack === 'function' && !navigation.canGoBack()) {
              console.warn('[QueueScreen] Cannot go back - no previous screen');
              return;
            }
            
            // Go back to NowPlaying first
            navigation.dispatch(CommonActions.goBack());
            
            // Then dismiss NowPlaying modal after a short delay
            setTimeout(() => {
              if (typeof navigation.canGoBack === 'function' && navigation.canGoBack()) {
                navigation.dispatch(CommonActions.goBack());
              }
            }, 100);
          } catch (error) {
            console.error('[QueueScreen] Error dismissing:', error);
            // Fallback: try to go back once
            if (typeof navigation.canGoBack === 'function' && navigation.canGoBack()) {
              navigation.dispatch(CommonActions.goBack());
            }
          }
        }}>
          <Feather name="chevron-down" size={28} color={Colors.light.textSecondary} />
        </Pressable>
        <View style={styles.headerTitleContainer}>
          <Pressable onPress={() => navigation.navigate('NowPlaying')}>
            <View style={styles.headerTab}>
              <ThemedText style={styles.headerTitleInactive}>Now Playing</ThemedText>
              <View style={styles.tabIndicatorHidden} />
            </View>
          </Pressable>
          <View style={styles.headerTab}>
            <ThemedText style={styles.headerTitleActive}>Queue</ThemedText>
            <View style={styles.tabIndicatorActive} />
          </View>
        </View>
        {queue.length > 0 ? (
          <Pressable
            style={({ pressed }) => [styles.clearButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={clearQueue}
          >
            <Feather name="x" size={20} color={Colors.light.textSecondary} />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>


      <FlatList
        data={upcomingTracks}
        renderItem={renderTrack}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Spacing["5xl"] }, // Space for underlying MiniPlayer + tab bar
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
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitleContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  headerTab: {
    alignItems: "center",
  },
  headerTitleActive: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.light.text,
  },
  headerTitleInactive: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.light.textTertiary,
  },
  headerSpacer: {
    width: 44,
  },
  clearButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  clearButtonText: {
    ...Typography.body,
    color: Colors.light.accent,
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
  tabIndicatorActive: {
    marginTop: 4,
    height: 3,
    width: 28,
    borderRadius: 2,
    backgroundColor: Colors.light.text,
  },
  tabIndicatorHidden: {
    marginTop: 4,
    height: 3,
    width: 28,
    borderRadius: 2,
    backgroundColor: "transparent",
  },
});
