import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";

import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { usePlayback } from "@/hooks/usePlayback";

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function DesktopBottomBar() {
  const {
    currentTrack,
    isPlaying,
    togglePlayPause,
    previous,
    next,
    currentTime,
    seek,
    volume,
    setVolume,
  } = usePlayback();

  const duration = Math.max(0, currentTrack?.duration || 0);
  const canSeek = duration > 0;

  const [isSeeking, setIsSeeking] = React.useState(false);
  const [seekValue, setSeekValue] = React.useState(0);

  React.useEffect(() => {
    if (!isSeeking) {
      setSeekValue(currentTime || 0);
    }
  }, [currentTime, isSeeking]);

  const changeVolumeBy = (delta: number) => {
    setVolume(Math.max(0, Math.min(1, (volume ?? 0) + delta)));
  };

  return (
    <View style={styles.container}>
      <View style={styles.middle}>
        <View style={styles.controlsRow}>
          <Pressable
            onPress={previous}
            style={({ pressed }) => [
              styles.iconButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
            hitSlop={10}
          >
            <Feather name="skip-back" size={22} color={Colors.light.text} />
          </Pressable>

          <Pressable
            onPress={togglePlayPause}
            style={({ pressed }) => [
              styles.playButton,
              { opacity: pressed ? 0.75 : 1 },
            ]}
            hitSlop={10}
          >
            <Feather
              name={isPlaying ? "pause" : "play"}
              size={22}
              color={Colors.light.text}
              style={!isPlaying ? { marginLeft: 2 } : undefined}
            />
          </Pressable>

          <Pressable
            onPress={next}
            style={({ pressed }) => [
              styles.iconButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
            hitSlop={10}
          >
            <Feather name="skip-forward" size={22} color={Colors.light.text} />
          </Pressable>
        </View>

        <View style={styles.progressRow}>
          <ThemedText style={styles.timeText}>{formatTime(isSeeking ? seekValue : currentTime)}</ThemedText>
          <Slider
            style={styles.progressSlider}
            minimumValue={0}
            maximumValue={canSeek ? duration : 1}
            value={canSeek ? (isSeeking ? seekValue : currentTime) : 0}
            disabled={!canSeek}
            onSlidingStart={() => setIsSeeking(true)}
            onValueChange={(v) => setSeekValue(v)}
            onSlidingComplete={(v) => {
              setIsSeeking(false);
              if (canSeek) seek(v);
            }}
            minimumTrackTintColor={Colors.light.text}
            maximumTrackTintColor={Colors.light.backgroundTertiary}
            thumbTintColor={Colors.light.text}
          />
          <ThemedText style={styles.timeText}>{formatTime(duration)}</ThemedText>
        </View>
      </View>

      <View style={styles.volume}>
        <Feather name="volume-2" size={18} color={Colors.light.textSecondary} />
        <Pressable
          onPress={() => changeVolumeBy(-0.02)}
          style={({ pressed }) => [
            styles.volButton,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          hitSlop={10}
        >
          <Feather name="minus" size={16} color={Colors.light.text} />
        </Pressable>
        <Slider
          style={styles.volumeSlider}
          minimumValue={0}
          maximumValue={1}
          value={volume ?? 0}
          onValueChange={(v) => setVolume(v)}
          minimumTrackTintColor={Colors.light.accent}
          maximumTrackTintColor={Colors.light.backgroundTertiary}
          thumbTintColor={Colors.light.text}
        />
        <Pressable
          onPress={() => changeVolumeBy(0.02)}
          style={({ pressed }) => [
            styles.volButton,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          hitSlop={10}
        >
          <Feather name="plus" size={16} color={Colors.light.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 120,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light.border,
    backgroundColor: Colors.light.backgroundDefault,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  middle: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginBottom: 10,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.light.backgroundSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  playButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.light.backgroundSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    maxWidth: 920,
    gap: 12,
  },
  timeText: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    minWidth: 44,
    textAlign: "center",
  },
  progressSlider: {
    flex: 1,
    height: 24,
  },
  volume: {
    width: 320,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    marginLeft: Spacing.lg,
  },
  volumeSlider: {
    flex: 1,
    height: 24,
  },
  volButton: {
    width: 34,
    height: 34,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.light.backgroundSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
});


