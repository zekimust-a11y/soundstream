import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Dimensions,
  Modal,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { usePlayback, Zone } from "@/hooks/usePlayback";

const { width } = Dimensions.get("window");
const ALBUM_ART_SIZE = width * 0.8;

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function ZoneItem({ zone, isActive, onSelect, onToggle, onVolumeChange }: {
  zone: Zone;
  isActive: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onVolumeChange: (volume: number) => void;
}) {
  const iconName = zone.type === "airplay" ? "airplay" : zone.type === "upnp" ? "speaker" : "smartphone";
  
  return (
    <View style={styles.zoneItem}>
      <Pressable
        style={({ pressed }) => [
          styles.zoneHeader,
          isActive && styles.zoneHeaderActive,
          { opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={onSelect}
      >
        <View style={[styles.zoneIcon, zone.isActive && styles.zoneIconActive]}>
          <Feather name={iconName} size={20} color={zone.isActive ? Colors.light.accent : Colors.light.textSecondary} />
        </View>
        <View style={styles.zoneInfo}>
          <ThemedText style={[styles.zoneName, zone.isActive && styles.zoneNameActive]}>
            {zone.name}
          </ThemedText>
          <ThemedText style={styles.zoneType}>
            {zone.type === "upnp" ? "UPNP Renderer" : zone.type === "airplay" ? "AirPlay" : "Local"}
          </ThemedText>
        </View>
        <Pressable
          style={({ pressed }) => [styles.zoneToggle, { opacity: pressed ? 0.6 : 1 }]}
          onPress={onToggle}
        >
          <View style={[styles.checkbox, zone.isActive && styles.checkboxActive]}>
            {zone.isActive ? (
              <Feather name="check" size={14} color={Colors.light.buttonText} />
            ) : null}
          </View>
        </Pressable>
      </Pressable>
      {zone.isActive ? (
        <View style={styles.zoneVolume}>
          <Feather name="volume" size={14} color={Colors.light.textTertiary} />
          <Slider
            style={styles.zoneVolumeSlider}
            minimumValue={0}
            maximumValue={1}
            value={zone.volume}
            onValueChange={onVolumeChange}
            minimumTrackTintColor={Colors.light.accent}
            maximumTrackTintColor={Colors.light.backgroundTertiary}
            thumbTintColor={Colors.light.accent}
          />
          <ThemedText style={styles.zoneVolumeText}>{Math.round(zone.volume * 100)}%</ThemedText>
        </View>
      ) : null}
    </View>
  );
}

export default function NowPlayingScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [showZoneModal, setShowZoneModal] = useState(false);
  const {
    currentTrack,
    isPlaying,
    currentTime,
    volume,
    shuffle,
    repeat,
    zones,
    activeZone,
    activeZoneId,
    togglePlayPause,
    next,
    previous,
    seek,
    setVolume,
    toggleShuffle,
    toggleRepeat,
    setActiveZone,
    setZoneVolume,
    toggleZone,
  } = usePlayback();

  const activeZones = zones.filter(z => z.isActive);

  if (!currentTrack) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
          <Pressable
            style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => navigation.goBack()}
          >
            <Feather name="chevron-down" size={28} color={Colors.light.text} />
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
          <Feather name="chevron-down" size={28} color={Colors.light.text} />
        </Pressable>
        <ThemedText style={styles.headerTitle}>Now Playing</ThemedText>
        <Pressable
          style={({ pressed }) => [styles.menuButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="more-horizontal" size={24} color={Colors.light.text} />
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
            minimumTrackTintColor={Colors.light.accent}
            maximumTrackTintColor={Colors.light.backgroundTertiary}
            thumbTintColor={Colors.light.accent}
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
              color={shuffle ? Colors.light.accent : Colors.light.textSecondary}
            />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.controlButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={previous}
          >
            <Feather name="skip-back" size={32} color={Colors.light.text} />
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
              color={Colors.light.buttonText}
              style={!isPlaying ? { marginLeft: 4 } : undefined}
            />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.controlButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={next}
          >
            <Feather name="skip-forward" size={32} color={Colors.light.text} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.controlButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={toggleRepeat}
          >
            <Feather
              name={repeat === "one" ? "repeat" : "repeat"}
              size={20}
              color={repeat !== "off" ? Colors.light.accent : Colors.light.textSecondary}
            />
            {repeat === "one" ? (
              <View style={styles.repeatOneBadge}>
                <ThemedText style={styles.repeatOneText}>1</ThemedText>
              </View>
            ) : null}
          </Pressable>
        </View>

        <View style={styles.volumeContainer}>
          <Feather name="volume" size={20} color={Colors.light.textSecondary} />
          <View style={styles.volumeSliderWrapper}>
            <Slider
              style={styles.volumeSlider}
              minimumValue={0}
              maximumValue={1}
              value={volume}
              onSlidingComplete={setVolume}
              minimumTrackTintColor={Colors.light.accent}
              maximumTrackTintColor={Colors.light.backgroundTertiary}
              thumbTintColor={Colors.light.accent}
            />
          </View>
          <Feather name="volume-2" size={20} color={Colors.light.textSecondary} />
        </View>

        <View style={[styles.deviceSelector, { marginBottom: insets.bottom + Spacing.xl }]}>
          <Pressable
            style={({ pressed }) => [styles.deviceButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => setShowZoneModal(true)}
          >
            <Feather name="speaker" size={16} color={Colors.light.accent} />
            <ThemedText style={styles.deviceText}>
              {activeZones.length > 1 
                ? `${activeZones.length} zones` 
                : activeZone?.name || "Select zone"}
            </ThemedText>
            <Feather name="chevron-up" size={16} color={Colors.light.textSecondary} />
          </Pressable>
        </View>
      </View>

      <Modal
        visible={showZoneModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowZoneModal(false)}
      >
        <Pressable 
          style={styles.modalOverlay} 
          onPress={() => setShowZoneModal(false)}
        >
          <Pressable 
            style={[styles.modalContent, { paddingBottom: insets.bottom + Spacing.lg }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>Play To</ThemedText>
              <ThemedText style={styles.modalSubtitle}>
                Select one or more zones
              </ThemedText>
            </View>
            <ScrollView style={styles.zoneList}>
              {zones.map((zone) => (
                <ZoneItem
                  key={zone.id}
                  zone={zone}
                  isActive={zone.id === activeZoneId}
                  onSelect={() => setActiveZone(zone.id)}
                  onToggle={() => toggleZone(zone.id)}
                  onVolumeChange={(vol) => setZoneVolume(zone.id, vol)}
                />
              ))}
            </ScrollView>
            <Pressable
              style={({ pressed }) => [
                styles.doneButton,
                { opacity: pressed ? 0.8 : 1 },
              ]}
              onPress={() => setShowZoneModal(false)}
            >
              <ThemedText style={styles.doneButtonText}>Done</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
    color: Colors.light.textSecondary,
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
    color: Colors.light.text,
    textAlign: "center",
  },
  trackArtist: {
    ...Typography.body,
    color: Colors.light.textSecondary,
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
    color: Colors.light.textSecondary,
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
    backgroundColor: Colors.light.accent,
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
    backgroundColor: Colors.light.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  repeatOneText: {
    fontSize: 9,
    fontWeight: "700",
    color: Colors.light.buttonText,
  },
  volumeContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
    gap: Spacing.md,
  },
  volumeSliderWrapper: {
    flex: 1,
    height: 44,
    justifyContent: "center",
  },
  volumeSlider: {
    width: "100%",
    height: 44,
  },
  deviceSelector: {
    alignItems: "center",
  },
  deviceButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.light.backgroundSecondary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    gap: Spacing.sm,
  },
  deviceText: {
    ...Typography.caption,
    color: Colors.light.accent,
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
    color: Colors.light.text,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.light.backgroundDefault,
    borderTopLeftRadius: BorderRadius.md,
    borderTopRightRadius: BorderRadius.md,
    paddingTop: Spacing.md,
    maxHeight: "70%",
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.light.textTertiary,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: Spacing.lg,
  },
  modalHeader: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  modalTitle: {
    ...Typography.title,
    color: Colors.light.text,
  },
  modalSubtitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: Spacing.xs,
  },
  zoneList: {
    paddingHorizontal: Spacing.lg,
  },
  zoneItem: {
    marginBottom: Spacing.md,
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  zoneHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
  },
  zoneHeaderActive: {
    backgroundColor: Colors.light.accent + "10",
  },
  zoneIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.backgroundTertiary,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  zoneIconActive: {
    backgroundColor: Colors.light.accent + "20",
  },
  zoneInfo: {
    flex: 1,
  },
  zoneName: {
    ...Typography.body,
    color: Colors.light.text,
  },
  zoneNameActive: {
    color: Colors.light.accent,
  },
  zoneType: {
    ...Typography.caption,
    color: Colors.light.textTertiary,
    marginTop: 2,
  },
  zoneToggle: {
    padding: Spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: Colors.light.textTertiary,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxActive: {
    backgroundColor: Colors.light.accent,
    borderColor: Colors.light.accent,
  },
  zoneVolume: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light.border,
  },
  zoneVolumeSlider: {
    flex: 1,
    height: 30,
    marginHorizontal: Spacing.sm,
  },
  zoneVolumeText: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    width: 40,
    textAlign: "right",
  },
  doneButton: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    backgroundColor: Colors.light.accent,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
  },
  doneButtonText: {
    ...Typography.bodyBold,
    color: Colors.light.buttonText,
  },
});
