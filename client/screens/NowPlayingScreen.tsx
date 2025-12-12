import React, { useState, useRef, useCallback } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Dimensions,
  Modal,
  ScrollView,
  GestureResponderEvent,
  LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from "react-native-reanimated";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";

import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { usePlayback, Zone } from "@/hooks/usePlayback";
import { useMusic } from "@/hooks/useMusic";

const { width, height } = Dimensions.get("window");
const ALBUM_ART_SIZE = Math.min(width - Spacing.xl * 2, height * 0.34);

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function normalizeDuration(duration: number): number {
  if (!duration || !isFinite(duration) || duration <= 0) return 0;
  if (duration > 36000) {
    return Math.round(duration / 1000);
  }
  return duration;
}

function getQualityLabel(format?: string, sampleRate?: string, bitDepth?: string): string {
  if (!format) return "";
  const f = format.toUpperCase();
  if (f === "FLAC" || f === "ALAC" || f === "WAV" || f === "AIFF") {
    if (sampleRate) {
      const rate = parseFloat(sampleRate);
      if (rate >= 176) return "HI-RES";
      if (rate >= 88) return "HI-RES";
      if (rate >= 44) return "CD QUALITY";
    }
    return "LOSSLESS";
  }
  if (f === "DSD") return "HI-RES";
  return f;
}

function ZoneItem({ zone, isActive, onSelect, onToggle, onVolumeChange }: {
  zone: Zone;
  isActive: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onVolumeChange: (volume: number) => void;
}) {
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
          <Feather name="speaker" size={20} color={zone.isActive ? Colors.light.accent : Colors.light.textSecondary} />
        </View>
        <View style={styles.zoneInfo}>
          <ThemedText style={[styles.zoneName, zone.isActive && styles.zoneNameActive]}>
            {zone.name}
          </ThemedText>
          <ThemedText style={styles.zoneType}>
            {zone.type === "lms" ? "LMS Player" : "Local"}
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
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPosition, setSeekPosition] = useState(0);
  const sliderWidthRef = useRef(0);
  
  const translateY = useSharedValue(0);
  
  const minimizePlayer = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation]);
  
  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (event.translationY > 0) {
        translateY.value = event.translationY * 0.3;
      }
    })
    .onEnd((event) => {
      if (event.translationY > 100) {
        runOnJS(minimizePlayer)();
      }
      translateY.value = withSpring(0, { damping: 20 });
    });
  
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  
  const { isFavoriteTrack, toggleFavoriteTrack } = useMusic();
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
  
  const handleSliderLayout = useCallback((event: LayoutChangeEvent) => {
    sliderWidthRef.current = event.nativeEvent.layout.width;
  }, []);
  
  const handleProgressTap = useCallback((event: GestureResponderEvent) => {
    if (!currentTrack) return;
    const duration = normalizeDuration(currentTrack.duration);
    if (duration <= 0) return;
    
    const { locationX } = event.nativeEvent;
    const sliderWidth = sliderWidthRef.current || width - Spacing.xl * 2;
    const ratio = Math.max(0, Math.min(1, locationX / sliderWidth));
    const newTime = ratio * duration;
    
    seek(newTime);
  }, [currentTrack, seek]);
  
  const handleSliderValueChange = useCallback((value: number) => {
    setIsSeeking(true);
    setSeekPosition(value);
  }, []);
  
  const handleSliderComplete = useCallback((value: number) => {
    setIsSeeking(false);
    seek(value);
  }, [seek]);
  
  const displayTime = isSeeking ? seekPosition : currentTime;
  const duration = currentTrack ? normalizeDuration(currentTrack.duration) : 0;
  const qualityLabel = currentTrack ? getQualityLabel(currentTrack.format, currentTrack.sampleRate, currentTrack.bitDepth) : "";
  const isFavorite = currentTrack?.id ? isFavoriteTrack(currentTrack.id) : false;

  if (!currentTrack) {
    return (
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.container, animatedStyle]}>
          <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top }]}>
              <Pressable style={styles.minimizeButton} onPress={minimizePlayer}>
                <Feather name="chevron-down" size={28} color={Colors.light.textSecondary} />
              </Pressable>
              <ThemedText style={styles.headerTitle}>Now Playing</ThemedText>
              <View style={styles.headerSpacer} />
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
          </View>
        </Animated.View>
      </GestureDetector>
    );
  }

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[styles.container, animatedStyle]}>
        <View style={styles.container}>
          <View style={[styles.header, { paddingTop: insets.top }]}>
            <Pressable style={styles.minimizeButton} onPress={minimizePlayer}>
              <Feather name="chevron-down" size={28} color={Colors.light.textSecondary} />
            </Pressable>
            <ThemedText style={styles.headerTitle}>Now Playing</ThemedText>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView 
            style={styles.content} 
            contentContainerStyle={[styles.contentContainer, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            bounces={true}
          >
            <View style={styles.albumArtContainer}>
              <Image
                source={currentTrack.albumArt || require("../assets/images/placeholder-album.png")}
                style={styles.albumArt}
                contentFit="cover"
              />
            </View>

            <View style={styles.trackInfo}>
              <ThemedText style={styles.trackTitle} numberOfLines={2}>
                {currentTrack.title}
              </ThemedText>
              <ThemedText style={styles.trackArtistAlbum} numberOfLines={1}>
                {currentTrack.artist}{currentTrack.album ? ` \u2022 ${currentTrack.album}` : ""}
              </ThemedText>
            </View>

            <View style={styles.metaRow}>
              <Pressable style={styles.metaButton}>
                <Feather name="info" size={20} color={Colors.light.textSecondary} />
              </Pressable>
              {qualityLabel ? (
                <View style={styles.qualityBadge}>
                  <ThemedText style={styles.qualityText}>{qualityLabel}</ThemedText>
                </View>
              ) : null}
              <Pressable
                style={styles.metaButton}
                onPress={() => currentTrack.id && toggleFavoriteTrack(currentTrack.id)}
              >
                <Feather 
                  name="heart" 
                  size={20} 
                  color={isFavorite ? Colors.light.accent : Colors.light.textSecondary}
                  style={{ opacity: isFavorite ? 1 : 0.6 }}
                />
              </Pressable>
            </View>

            <View style={styles.progressContainer} onLayout={handleSliderLayout}>
              <Pressable style={styles.progressTapArea} onPress={handleProgressTap}>
                <View style={styles.progressTrack}>
                  <View 
                    style={[
                      styles.progressFill,
                      { width: `${duration > 0 ? (displayTime / duration) * 100 : 0}%` }
                    ]} 
                  />
                  <View 
                    style={[
                      styles.progressThumb,
                      { left: `${duration > 0 ? (displayTime / duration) * 100 : 0}%` }
                    ]}
                  />
                </View>
              </Pressable>
              <View style={styles.timeLabels}>
                <ThemedText style={styles.timeLabel}>{formatTime(displayTime)}</ThemedText>
                <ThemedText style={styles.timeLabel}>-{formatTime(duration - displayTime)}</ThemedText>
              </View>
            </View>

            <View style={styles.controls}>
              <Pressable
                style={({ pressed }) => [styles.sideControl, { opacity: pressed ? 0.5 : 1 }]}
                onPress={toggleShuffle}
              >
                <Feather
                  name="shuffle"
                  size={22}
                  color={shuffle ? Colors.light.accent : Colors.light.textSecondary}
                />
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.mainControl, { opacity: pressed ? 0.5 : 1 }]}
                onPress={previous}
              >
                <Feather name="skip-back" size={36} color={Colors.light.text} />
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
                  size={36}
                  color={Colors.light.buttonText}
                  style={!isPlaying ? { marginLeft: 4 } : undefined}
                />
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.mainControl, { opacity: pressed ? 0.5 : 1 }]}
                onPress={next}
              >
                <Feather name="skip-forward" size={36} color={Colors.light.text} />
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.sideControl, { opacity: pressed ? 0.5 : 1 }]}
                onPress={toggleRepeat}
              >
                <Feather
                  name="repeat"
                  size={22}
                  color={repeat !== "off" ? Colors.light.accent : Colors.light.textSecondary}
                />
                {repeat === "one" ? (
                  <View style={styles.repeatBadge}>
                    <ThemedText style={styles.repeatBadgeText}>1</ThemedText>
                  </View>
                ) : null}
              </Pressable>
            </View>

            <View style={styles.volumeRow}>
              <Feather name="volume" size={18} color={Colors.light.textTertiary} />
              <View style={styles.volumeSliderWrapper}>
                <Slider
                  style={styles.volumeSlider}
                  minimumValue={0}
                  maximumValue={1}
                  value={volume}
                  onValueChange={setVolume}
                  minimumTrackTintColor={Colors.light.accent}
                  maximumTrackTintColor={Colors.light.backgroundTertiary}
                  thumbTintColor={Colors.light.accent}
                />
              </View>
              <Feather name="volume-2" size={18} color={Colors.light.textTertiary} />
            </View>

            <View style={styles.bottomRow}>
              <Pressable
                style={({ pressed }) => [styles.bottomButton, { opacity: pressed ? 0.6 : 1 }]}
                onPress={() => setShowZoneModal(true)}
              >
                <Feather name="smartphone" size={18} color={Colors.light.textSecondary} />
                <ThemedText style={styles.bottomButtonText}>
                  {activeZone?.name || "Select player"}
                </ThemedText>
                <Feather name="chevron-down" size={16} color={Colors.light.textTertiary} />
              </Pressable>
              <Pressable style={({ pressed }) => [styles.menuButton, { opacity: pressed ? 0.6 : 1 }]}>
                <Feather name="more-vertical" size={20} color={Colors.light.textSecondary} />
              </Pressable>
            </View>
          </ScrollView>

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
                  <ThemedText style={styles.modalSubtitle}>Select a player</ThemedText>
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
                  style={({ pressed }) => [styles.doneButton, { opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => setShowZoneModal(false)}
                >
                  <ThemedText style={styles.doneButtonText}>Done</ThemedText>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>
        </View>
      </Animated.View>
    </GestureDetector>
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
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  minimizeButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
  headerSpacer: {
    width: 44,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: Spacing.xl,
  },
  albumArtContainer: {
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  albumArt: {
    width: ALBUM_ART_SIZE,
    height: ALBUM_ART_SIZE,
    borderRadius: BorderRadius.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
  },
  trackInfo: {
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  trackTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.light.text,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  trackArtistAlbum: {
    fontSize: 15,
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
    gap: Spacing.lg,
  },
  metaButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  qualityBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.backgroundSecondary,
  },
  qualityText: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.light.textSecondary,
    letterSpacing: 0.5,
  },
  progressContainer: {
    marginBottom: Spacing.md,
  },
  progressTapArea: {
    height: 24,
    justifyContent: "center",
  },
  progressTrack: {
    height: 4,
    backgroundColor: Colors.light.backgroundTertiary,
    borderRadius: 2,
    position: "relative",
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.light.accent,
    borderRadius: 2,
  },
  progressThumb: {
    position: "absolute",
    top: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.light.accent,
    marginLeft: -6,
  },
  timeLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: Spacing.sm,
  },
  timeLabel: {
    fontSize: 12,
    color: Colors.light.textTertiary,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  sideControl: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  mainControl: {
    width: 56,
    height: 56,
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
    marginHorizontal: Spacing.md,
  },
  repeatBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.light.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  repeatBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: Colors.light.buttonText,
  },
  volumeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  volumeSliderWrapper: {
    flex: 1,
    height: 40,
    justifyContent: "center",
  },
  volumeSlider: {
    width: "100%",
    height: 40,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bottomButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  bottomButtonText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  menuButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  emptyImage: {
    width: 160,
    height: 160,
    marginBottom: Spacing.xl,
    opacity: 0.6,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: Colors.light.text,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    fontSize: 15,
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.light.backgroundDefault,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    paddingTop: Spacing.md,
    maxHeight: "70%",
  },
  modalHandle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.light.backgroundTertiary,
    alignSelf: "center",
    marginBottom: Spacing.md,
  },
  modalHeader: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.light.text,
    marginBottom: Spacing.xs,
  },
  modalSubtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  zoneList: {
    paddingHorizontal: Spacing.lg,
  },
  zoneItem: {
    marginBottom: Spacing.sm,
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.md,
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
    backgroundColor: Colors.light.backgroundDefault,
    justifyContent: "center",
    alignItems: "center",
  },
  zoneIconActive: {
    backgroundColor: Colors.light.accent + "20",
  },
  zoneInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  zoneName: {
    fontSize: 15,
    fontWeight: "500",
    color: Colors.light.text,
  },
  zoneNameActive: {
    color: Colors.light.accent,
  },
  zoneType: {
    fontSize: 12,
    color: Colors.light.textTertiary,
    marginTop: 2,
  },
  zoneToggle: {
    padding: Spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.light.border,
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
    gap: Spacing.sm,
  },
  zoneVolumeSlider: {
    flex: 1,
    height: 30,
  },
  zoneVolumeText: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    width: 36,
    textAlign: "right",
  },
  doneButton: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: Colors.light.accent,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.light.buttonText,
  },
});
