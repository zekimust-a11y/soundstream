import React from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { usePlayback } from "@/hooks/usePlayback";

const { width } = Dimensions.get("window");
const ALBUM_ART_SIZE = width * 0.8;

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function NowPlayingScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const {
    currentTrack,
    isPlaying,
    currentTime,
    volume,
    shuffle,
    repeat,
    togglePlayPause,
    next,
    previous,
    seek,
    setVolume,
    toggleShuffle,
    toggleRepeat,
  } = usePlayback();

  if (!currentTrack) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
          <Pressable
            style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => navigation.goBack()}
          >
            <Feather name="chevron-down" size={28} color={Colors.dark.text} />
          </Pressable>
        </View>
        <View style={styles.emptyState}>
          <Image
            source={require("../assets/images/empty-queue.png")}
            style={styles.emptyImage}
            contentFit="contain"
          />
          <ThemedText style={styles.emptyTitle}>Nothing playing</ThemedText>
          <ThemedText style={styles.emptySubtitle}>
            Select a track to start listening
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <Pressable
          style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => navigation.goBack()}
        >
          <Feather name="chevron-down" size={28} color={Colors.dark.text} />
        </Pressable>
        <ThemedText style={styles.headerTitle}>Now Playing</ThemedText>
        <Pressable
          style={({ pressed }) => [styles.menuButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="more-horizontal" size={24} color={Colors.dark.text} />
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.albumArtContainer}>
          <Image
            source={currentTrack.albumArt || require("../assets/images/placeholder-album.png")}
            style={styles.albumArt}
            contentFit="cover"
          />
        </View>

        <View style={styles.trackInfo}>
          <ThemedText style={styles.trackTitle} numberOfLines={1}>
            {currentTrack.title}
          </ThemedText>
          <ThemedText style={styles.trackArtist} numberOfLines={1}>
            {currentTrack.artist}
          </ThemedText>
        </View>

        <View style={styles.progressContainer}>
          <Slider
            style={styles.progressSlider}
            minimumValue={0}
            maximumValue={currentTrack.duration}
            value={currentTime}
            onSlidingComplete={seek}
            minimumTrackTintColor={Colors.dark.accent}
            maximumTrackTintColor={Colors.dark.backgroundTertiary}
            thumbTintColor={Colors.dark.accent}
          />
          <View style={styles.timeLabels}>
            <ThemedText style={styles.timeLabel}>
              {formatTime(currentTime)}
            </ThemedText>
            <ThemedText style={styles.timeLabel}>
              -{formatTime(currentTrack.duration - currentTime)}
            </ThemedText>
          </View>
        </View>

        <View style={styles.controls}>
          <Pressable
            style={({ pressed }) => [styles.controlButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={toggleShuffle}
          >
            <Feather
              name="shuffle"
              size={20}
              color={shuffle ? Colors.dark.accent : Colors.dark.textSecondary}
            />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.controlButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={previous}
          >
            <Feather name="skip-back" size={32} color={Colors.dark.text} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.playButton,
              { opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] },
            ]}
            onPress={togglePlayPause}
          >
            <Feather
              name={isPlaying ? "pause" : "play"}
              size={32}
              color={Colors.dark.buttonText}
              style={!isPlaying ? { marginLeft: 4 } : undefined}
            />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.controlButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={next}
          >
            <Feather name="skip-forward" size={32} color={Colors.dark.text} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.controlButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={toggleRepeat}
          >
            <Feather
              name={repeat === "one" ? "repeat" : "repeat"}
              size={20}
              color={repeat !== "off" ? Colors.dark.accent : Colors.dark.textSecondary}
            />
            {repeat === "one" ? (
              <View style={styles.repeatOneBadge}>
                <ThemedText style={styles.repeatOneText}>1</ThemedText>
              </View>
            ) : null}
          </Pressable>
        </View>

        <View style={styles.volumeContainer}>
          <Feather name="volume" size={16} color={Colors.dark.textSecondary} />
          <Slider
            style={styles.volumeSlider}
            minimumValue={0}
            maximumValue={1}
            value={volume}
            onValueChange={setVolume}
            minimumTrackTintColor={Colors.dark.textSecondary}
            maximumTrackTintColor={Colors.dark.backgroundTertiary}
            thumbTintColor={Colors.dark.textSecondary}
          />
          <Feather name="volume-2" size={16} color={Colors.dark.textSecondary} />
        </View>

        <View style={[styles.deviceSelector, { marginBottom: insets.bottom + Spacing.xl }]}>
          <Pressable
            style={({ pressed }) => [styles.deviceButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather name="speaker" size={16} color={Colors.dark.accent} />
            <ThemedText style={styles.deviceText}>This device</ThemedText>
            <Feather name="chevron-up" size={16} color={Colors.dark.textSecondary} />
          </Pressable>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    ...Typography.caption,
    color: Colors.dark.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  menuButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  albumArtContainer: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  albumArt: {
    width: ALBUM_ART_SIZE,
    height: ALBUM_ART_SIZE,
    borderRadius: BorderRadius.xs,
    ...Shadows.large,
  },
  trackInfo: {
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  trackTitle: {
    ...Typography.display,
    color: Colors.dark.text,
    textAlign: "center",
  },
  trackArtist: {
    ...Typography.body,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.xs,
  },
  progressContainer: {
    marginBottom: Spacing.xl,
  },
  progressSlider: {
    width: "100%",
    height: 40,
  },
  timeLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -Spacing.sm,
  },
  timeLabel: {
    ...Typography.caption,
    color: Colors.dark.textSecondary,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing["2xl"],
    gap: Spacing.lg,
  },
  controlButton: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.dark.accent,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: Spacing.lg,
  },
  repeatOneBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.dark.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  repeatOneText: {
    fontSize: 9,
    fontWeight: "700",
    color: Colors.dark.buttonText,
  },
  volumeContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  volumeSlider: {
    flex: 1,
    height: 40,
    marginHorizontal: Spacing.sm,
  },
  deviceSelector: {
    alignItems: "center",
  },
  deviceButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundSecondary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    gap: Spacing.sm,
  },
  deviceText: {
    ...Typography.caption,
    color: Colors.dark.accent,
  },
  emptyState: {
    flex: 1,
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
    color: Colors.dark.text,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.dark.textSecondary,
    textAlign: "center",
  },
});
