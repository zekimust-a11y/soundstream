import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Dimensions,
  Modal,
  ScrollView,
  GestureResponderEvent,
  LayoutChangeEvent,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, CommonActions, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { InteractionManager } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, Easing, useAnimatedReaction } from "react-native-reanimated";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { Feather, MaterialIcons, MaterialCommunityIcons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { LinearGradient } from "expo-linear-gradient";
import { extractDominantColor, lightenColor, darkenColor } from "@/utils/colorExtractor";

import { ThemedText } from "@/components/ThemedText";
import { AlbumArtwork } from "@/components/AlbumArtwork";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { usePlayback, Zone } from "@/hooks/usePlayback";
import { useMusic } from "@/hooks/useMusic";

const { width, height } = Dimensions.get("window");
const ALBUM_ART_SIZE = Math.min(width - Spacing.xl * 2, Platform.OS === 'ios' ? height * 0.32 : height * 0.42);

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

interface QualityInfo {
  label: string;
  details: string;
}

function getQualityInfo(format?: string, sampleRate?: string, bitDepth?: string, bitrate?: string): QualityInfo {
  const f = (format || "").toString().toUpperCase();

  // Normalise bit depth and sample rate strings coming from LMS/Qobuz
  let bits: number | null = null;
  if (bitDepth) {
    // Handle formats like "24-bit", "24", or just the number
    // bitDepth comes from LMS as "24-bit" format or just a number
    const cleaned = bitDepth.toString().replace(/[^\d]/g, "");
    const parsed = parseInt(cleaned, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      bits = parsed;
    }
  }
  
  // Also check if bitDepth might be in sampleRate field (some LMS versions)
  // This is a fallback - normally bitDepth should be separate
  
  let rateKHz: number | null = null;
  if (sampleRate) {
    const cleaned = sampleRate.toString().toLowerCase().replace(/khz/g, "").replace(/[^\d.]/g, "");
    const rate = parseFloat(cleaned);
    if (!Number.isNaN(rate)) {
      rateKHz = rate >= 1000 ? rate / 1000 : rate;
    }
  }

  // Parse bitrate (usually in kbps format from LMS)
  let bitrateKbps: number | null = null;
  if (bitrate) {
    const cleaned = bitrate.toString().toLowerCase().replace(/kbps|kb\/s|kbit\/s/g, "").replace(/[^\d.]/g, "");
    const parsed = parseFloat(cleaned);
    if (!Number.isNaN(parsed) && parsed > 0) {
      bitrateKbps = parsed;
    }
  }

  let label = "";

  // Determine quality label (CD vs Hi‑Res), even if format string is missing
  const hasResolutionInfo = rateKHz != null || bits != null;

  if (f === "FLAC" || f === "ALAC" || f === "WAV" || f === "AIFF") {
    if (hasResolutionInfo) {
      const isCdLike = (rateKHz == null || rateKHz <= 48) && (bits == null || bits <= 16);
      label = isCdLike ? "CD" : "Hi-Res";
    } else {
      label = "Lossless";
    }
  } else if (f === "DSD" || f.includes("DSD")) {
    label = "Hi-Res";
  } else if (f === "MP3" || f === "AAC" || f === "OGG") {
    label = f;
  } else if (hasResolutionInfo) {
    // No known format string, but we know the resolution – decide CD vs Hi‑Res from that
    const isCdLike = (rateKHz == null || rateKHz <= 48) && (bits == null || bits <= 16);
    label = isCdLike ? "CD" : "Hi-Res";
  } else {
    label = f || "";
  }

  // If we've determined it's CD quality but didn't get an explicit bit depth,
  // assume standard 16‑bit so we always show something like "16-bit 44.1kHz"
  if (!bits && label === "CD") {
    bits = 16;
  }

  // Build human‑readable details string (e.g. "CD 16-bit 44.1kHz" or "Hi-Res 1411 kbps 24-bit 96kHz")
  const parts: string[] = [];
  if (label) parts.push(label);
  
  // For Hi-Res files, show bitrate between label and bit depth/kHz
  if (label === "Hi-Res" && bitrateKbps != null) {
    parts.push(`${bitrateKbps} kbps`);
  }
  
  // For Hi-Res, always show bit depth if available, or if we have sample rate but no bits, try to infer
  if (bits) {
    parts.push(`${bits}-bit`);
  } else if (label === "Hi-Res" && rateKHz != null) {
    // For Hi-Res with sample rate but no bit depth, we can't infer it, but we should still show what we have
    // The user will see "Hi-Res [bitrate] 96kHz" which is better than nothing
  }
  if (rateKHz != null) parts.push(`${rateKHz}kHz`);

  return { label, details: parts.join(" ") };
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
          <Feather name="speaker" size={20} color={zone.isActive ? "#000" : Colors.light.textSecondary} />
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
            minimumTrackTintColor="#000"
            maximumTrackTintColor={Colors.light.backgroundTertiary}
            thumbTintColor="#000"
          />
          <ThemedText style={styles.zoneVolumeText}>{Math.round(zone.volume * 100)}%</ThemedText>
        </View>
      ) : null}
    </View>
  );
}

export default function NowPlayingScreen() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPosition, setSeekPosition] = useState(0);
  const sliderWidthRef = useRef(0);
  const isMountedRef = useRef(true);
  const isNavigatingRef = useRef(false);
  const [scrollViewEnabled, setScrollViewEnabled] = useState(true);
  
  const translateY = useSharedValue(0);
  const scrollEnabled = useSharedValue(true);
  
  useEffect(() => {
    isMountedRef.current = true;
    isNavigatingRef.current = false;
    return () => {
      isMountedRef.current = false;
      isNavigatingRef.current = false;
    };
  }, []);
  
  const minimizePlayer = useCallback(() => {
    if (!isMountedRef.current || isNavigatingRef.current) {
      return;
    }
    
    isNavigatingRef.current = true;
    
    setTimeout(() => {
      if (!isMountedRef.current) {
        isNavigatingRef.current = false;
        return;
      }
      
      try {
        if (!navigation) {
          isNavigatingRef.current = false;
          return;
        }
        
        const state = navigation.getState();
        const routes = state?.routes || [];
        const currentRoute = routes[routes.length - 1];
        
        if (currentRoute?.name === 'Queue') {
          navigation.goBack();
          setTimeout(() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            }
            isNavigatingRef.current = false;
          }, 100);
        } else {
          if (navigation.canGoBack()) {
            navigation.goBack();
          }
          isNavigatingRef.current = false;
        }
      } catch (error) {
        console.error('[NowPlayingScreen] Error minimizing player:', error);
        isNavigatingRef.current = false;
      }
    }, 50);
  }, [navigation]);
  
  const handleMinimize = useCallback(() => {
    if (isMountedRef.current && !isNavigatingRef.current) {
      minimizePlayer();
    }
  }, [minimizePlayer]);

  // Pan gesture that works from anywhere - uses manual activation to detect swipe direction
  const panGesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((event, state) => {
      // Don't activate immediately - wait to see direction
    })
    .onTouchesMove((event, state) => {
      // Check if this is a downward swipe
      const translationY = event.allTouches[0]?.translationY || 0;
      if (translationY > 10) {
        // Downward swipe detected - activate gesture and disable scrolling
        scrollEnabled.value = false;
        state.activate();
      } else if (translationY < -10) {
        // Upward movement - let ScrollView handle it
        state.fail();
      }
      // Small movements - wait for more input
    })
    .failOffsetX([-30, 30])
    .onUpdate((event) => {
      if (isNavigatingRef.current) return;
      // Only respond to downward swipes
      if (event.translationY > 0) {
        translateY.value = event.translationY;
      }
    })
    .onEnd((event) => {
      // Re-enable scrolling when gesture ends
      scrollEnabled.value = true;
      
      if (isNavigatingRef.current) {
        translateY.value = withTiming(0, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
        });
        return;
      }

      const shouldClose = event.translationY > height * 0.25 || event.velocityY > 500;

      if (shouldClose) {
        translateY.value = withTiming(
          height,
          {
            duration: 300,
            easing: Easing.out(Easing.cubic),
          },
          (finished) => {
            if (finished) {
              runOnJS(handleMinimize)();
            }
          }
        );
      } else {
        translateY.value = withTiming(0, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
        });
      }
    });
  
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  
  // Fade out gradient as we swipe down - reveals underlying screen
  const gradientAnimatedStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, translateY.value / (height * 0.5));
    return {
      opacity: 1 - progress,
    };
  });
  
  // Sync scrollEnabled shared value to state so ScrollView can use it
  useAnimatedReaction(
    () => scrollEnabled.value,
    (enabled) => {
      runOnJS(setScrollViewEnabled)(enabled);
    }
  );
  
  const { isFavoriteTrack, toggleFavoriteTrack, isQobuzFavorite, toggleQobuzFavorite, qobuzConnected, searchMusic } = useMusic();
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

  const [dominantColor, setDominantColor] = useState<string>('#1C1C1E');
  const [gradientColors, setGradientColors] = useState<[string, string]>(['#F2F2F7', '#1C1C1E']);
  const [volumeOverlayVisible, setVolumeOverlayVisible] = useState(false);
  const [volumeOverlayValue, setVolumeOverlayValue] = useState<number | null>(null);
  const lastVolumeRef = useRef<number | null>(null);
  const volumeOverlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeAdjustIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const volumeRef = useRef<number>(volume);
  const volumeHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeHoldActiveRef = useRef(false);

  // Marquee state for long track titles
  const titleContainerWidthRef = useRef<number>(0);
  const titleTextWidthRef = useRef<number>(0);
  const [shouldScrollTitle, setShouldScrollTitle] = useState(false);
  const titleTranslateX = useSharedValue(0);
  
  // Extract color from album artwork when track changes
  useEffect(() => {
    if (currentTrack && !currentTrack.isRadio) {
      const imageUrl = currentTrack.albumArt;
      if (imageUrl) {
        // Reset to default first to show we're processing
        setGradientColors(['#F2F2F7', '#1C1C1E']);
        
        extractDominantColor(imageUrl)
          .then((color) => {
            console.log('[NowPlaying] Extracted color:', color, 'from track:', currentTrack.title, 'Platform:', Platform.OS);
            setDominantColor(color);
            // Create gradient: light at top, darker at bottom
            // Darken the base color by 40% first, then create gradient from it
            // This makes the background darker overall for better white text readability
            // Skip minimum brightness check to allow darker backgrounds
            const darkerBase = darkenColor(color, 0.4, true); // Darken base by 40%, skip brightness check
            const lightColor = lightenColor(darkerBase, 0.3); // Lighten the darker base by 30% for top
            const darkColor = darkenColor(darkerBase, 0.15, true); // Darken the darker base by 15% more for bottom
            console.log('[NowPlaying] Gradient colors:', lightColor, '->', darkColor);
            setGradientColors([lightColor, darkColor]);
          })
          .catch((error) => {
            console.error('[NowPlaying] Failed to extract color:', error);
            // Reset to default on error - use darker gradient for better text visibility
            setDominantColor('#2C2C2E');
            setGradientColors(['#3C3C3E', '#1C1C1E']);
          });
      } else {
        // Reset to default if no artwork
        setDominantColor('#1C1C1E');
        setGradientColors(['#F2F2F7', '#1C1C1E']);
      }
    } else {
      // Reset for radio or no track
      setDominantColor('#1C1C1E');
      setGradientColors(['#F2F2F7', '#1C1C1E']);
    }
  }, [currentTrack?.albumArt, currentTrack?.id]);

  // Show temporary volume overlay when volume changes (slider or hardware buttons)
  useEffect(() => {
    // keep ref in sync for press-and-hold logic
    if (Number.isFinite(volume)) {
      volumeRef.current = volume;
    }

    if (volume < 0 || volume > 1) return;
    if (lastVolumeRef.current === null) {
      // Initialize without showing overlay on first render
      lastVolumeRef.current = volume;
      return;
    }
    if (Math.abs(volume - lastVolumeRef.current) < 0.01) {
      return; // Ignore tiny changes
    }
    lastVolumeRef.current = volume;
    const percent = Math.round(volume * 100);
    setVolumeOverlayValue(percent);
    setVolumeOverlayVisible(true);
    if (volumeOverlayTimeoutRef.current) {
      clearTimeout(volumeOverlayTimeoutRef.current);
    }
    volumeOverlayTimeoutRef.current = setTimeout(() => {
      setVolumeOverlayVisible(false);
    }, 1200);
  }, [volume]);

  // Track title marquee: start/stop scrolling when title is wider than container
  useEffect(() => {
    if (!shouldScrollTitle) {
      titleTranslateX.value = 0;
      return;
    }

    const overflow = titleTextWidthRef.current - titleContainerWidthRef.current;
    if (overflow <= 0) {
      titleTranslateX.value = 0;
      return;
    }

    // Reset to starting position at the right edge, then scroll to the left
    titleTranslateX.value = 0;
    titleTranslateX.value = withTiming(-overflow, {
      duration: Math.min(20000, Math.max(8000, overflow * 80)),
      easing: Easing.linear,
    }, (finished) => {
      if (finished) {
        // Loop the animation with a small pause at the ends
        titleTranslateX.value = withTiming(0, { duration: 800, easing: Easing.linear });
      }
    });
  }, [shouldScrollTitle, titleTranslateX]);

  const activeZones = zones.filter(z => z.isActive);
  const [showAddMenu, setShowAddMenu] = useState(false);
  
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
  const qualityInfo = currentTrack ? getQualityInfo(currentTrack.format, currentTrack.sampleRate, currentTrack.bitDepth, currentTrack.bitrate) : { label: "", details: "" };
  
  // Check if track is from Qobuz and if it's favorited
  const isQobuzTrack = currentTrack?.source === "qobuz";
  const [isQobuzFav, setIsQobuzFav] = React.useState(false);
  const [isCheckingQobuzFav, setIsCheckingQobuzFav] = React.useState(false);
  
  // Check Qobuz favorite status when track changes
  React.useEffect(() => {
    if (isQobuzTrack && currentTrack?.id && qobuzConnected) {
      setIsCheckingQobuzFav(true);
      isQobuzFavorite(currentTrack.id)
        .then((fav) => {
          setIsQobuzFav(fav);
          setIsCheckingQobuzFav(false);
        })
        .catch(() => {
          setIsCheckingQobuzFav(false);
        });
    } else {
      setIsQobuzFav(false);
      setIsCheckingQobuzFav(false);
    }
  }, [currentTrack?.id, currentTrack?.source, isQobuzTrack, qobuzConnected, isQobuzFavorite]);
  
  // Use Qobuz favorite if Qobuz track, otherwise use local favorite
  const isFavorite = isQobuzTrack && qobuzConnected ? isQobuzFav : (currentTrack?.id ? isFavoriteTrack(currentTrack.id) : false);
  
  const handleToggleFavorite = React.useCallback(async () => {
    if (!currentTrack?.id) return;
    
    if (isQobuzTrack && qobuzConnected) {
      try {
        await toggleQobuzFavorite(currentTrack.id);
        // Update local state immediately for better UX
        setIsQobuzFav(!isQobuzFav);
      } catch (error) {
        console.error('Failed to toggle Qobuz favorite:', error);
      }
    } else {
      toggleFavoriteTrack(currentTrack.id);
    }
  }, [currentTrack, isQobuzTrack, qobuzConnected, isQobuzFav, toggleQobuzFavorite, toggleFavoriteTrack]);

  // Volume button press-and-hold behaviour
  const stepVolume = useCallback((delta: number) => {
    const current = Number.isFinite(volumeRef.current) ? volumeRef.current : 0;
    const next = Math.max(0, Math.min(1, current + delta));
    volumeRef.current = next;
    setVolume(next);
  }, [setVolume]);

  const startContinuousVolumeAdjust = useCallback((direction: "up" | "down") => {
    const step = direction === "up" ? 0.02 : -0.02;
    if (volumeAdjustIntervalRef.current) {
      clearInterval(volumeAdjustIntervalRef.current);
    }
    volumeAdjustIntervalRef.current = setInterval(() => {
      stepVolume(step);
    }, 120);
  }, [stepVolume]);

  const stopVolumeAdjust = useCallback(() => {
    if (volumeAdjustIntervalRef.current) {
      clearInterval(volumeAdjustIntervalRef.current);
      volumeAdjustIntervalRef.current = null;
    }
    if (volumeHoldTimeoutRef.current) {
      clearTimeout(volumeHoldTimeoutRef.current);
      volumeHoldTimeoutRef.current = null;
    }
    volumeHoldActiveRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      if (volumeAdjustIntervalRef.current) {
        clearInterval(volumeAdjustIntervalRef.current);
        volumeAdjustIntervalRef.current = null;
      }
      if (volumeHoldTimeoutRef.current) {
        clearTimeout(volumeHoldTimeoutRef.current);
        volumeHoldTimeoutRef.current = null;
      }
    };
  }, []);

  if (!currentTrack) {
    return (
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.animatedContainer, animatedStyle]}>
          <StatusBar style="light" translucent />
          <Animated.View
            style={[
              {
                position: "absolute",
                top: Platform.OS === "ios" ? -insets.top : 0,
                left: 0,
                right: 0,
                bottom: 0,
              },
              gradientAnimatedStyle,
            ]}
          >
            <LinearGradient
              colors={gradientColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            />
          </Animated.View>
          <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
              <Pressable style={styles.minimizeButton} onPress={minimizePlayer}>
                <Feather name="chevron-down" size={28} color="#FFFFFF" />
              </Pressable>
              <View style={styles.headerTitleContainer}>
                <ThemedText style={styles.headerTitle}>Now Playing</ThemedText>
                <Pressable onPress={() => navigation.navigate('Queue')}>
                  <ThemedText style={styles.queueLink}>Queue</ThemedText>
                </Pressable>
              </View>
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
      <Animated.View style={[styles.animatedContainer, animatedStyle]}>
        <StatusBar style="light" translucent />
        <Animated.View
          style={[
            {
              position: "absolute",
              top: Platform.OS === "ios" ? -insets.top : 0,
              left: 0,
              right: 0,
              bottom: 0,
            },
            gradientAnimatedStyle,
          ]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
        </Animated.View>
        <View style={styles.container} pointerEvents="box-none">
          {volumeOverlayVisible && volumeOverlayValue !== null && (
            <View style={styles.volumeOverlayContainer} pointerEvents="none">
              <View style={styles.volumeOverlay}>
                <Feather name="volume-2" size={24} color="#FFFFFF" />
                <ThemedText style={styles.volumeOverlayText}>
                  {volumeOverlayValue}%
                </ThemedText>
              </View>
            </View>
          )}

          {/* Header */}
          <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
            <Pressable style={styles.minimizeButton} onPress={minimizePlayer}>
              <Feather name="chevron-down" size={28} color="#FFFFFF" />
            </Pressable>
            <View style={styles.headerTitleContainer}>
              <View style={styles.headerTab}>
                <ThemedText style={styles.headerTitle}>Now Playing</ThemedText>
                <View style={styles.tabIndicator} />
              </View>
              <Pressable onPress={() => navigation.navigate('Queue')}>
                <View style={styles.headerTab}>
                  <ThemedText style={styles.queueLink}>Queue</ThemedText>
                  <View style={styles.tabIndicatorHidden} />
                </View>
              </Pressable>
            </View>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView
            style={styles.content}
            contentContainerStyle={[styles.contentContainer, {
              paddingBottom: Platform.OS === 'ios' ? 100 : insets.bottom + Spacing.xl,
              paddingTop: Platform.OS === 'ios' ? 0 : undefined,
              flexGrow: 1,
            }]}
            showsVerticalScrollIndicator={false}
            bounces={false}
            scrollEnabled={scrollViewEnabled}
            waitFor={panGesture}
          >
            <Pressable
              style={({ pressed }) => [
                styles.albumArtContainer,
                { opacity: pressed ? 0.7 : 1 }
              ]}
              onPress={() => {
                if (!currentTrack.isRadio && currentTrack.metadata) {
                  try {
                    const meta = JSON.parse(currentTrack.metadata);
                    if (meta.artistId) {
                      minimizePlayer();
                            navigation.navigate("Main", { 
                              screen: "BrowseTab",
                              params: {
                                screen: "Artist", 
                                params: { id: meta.artistId, name: currentTrack.artist } 
                              }
                            });
                    }
                  } catch {}
                }
              }}
              disabled={currentTrack.isRadio}
            >
              {currentTrack.isRadio && currentTrack.radioStationImage ? (
                <Image
                  source={{ uri: currentTrack.radioStationImage }}
                  style={styles.albumArt}
                  contentFit="contain"
                />
              ) : (
                <AlbumArtwork
                  source={currentTrack.albumArt}
                  style={styles.albumArt}
                  contentFit="cover"
                />
              )}
              <View style={styles.artworkBadges}>
                {currentTrack.source === "qobuz" ? (
                  <Image
                    source={require("../assets/images/qobuz-icon.png")}
                    style={styles.qobuzIconBadge}
                    contentFit="contain"
                  />
                ) : null}
              </View>
            </Pressable>

            <View style={styles.trackInfo}>
              <View
                style={styles.trackTitleContainer}
                onLayout={(e) => {
                  titleContainerWidthRef.current = e.nativeEvent.layout.width;
                  setShouldScrollTitle(
                    titleTextWidthRef.current > titleContainerWidthRef.current + 4
                  );
                }}
              >
                <Animated.View
                  style={[
                    styles.trackTitleMarquee,
                    shouldScrollTitle
                      ? { transform: [{ translateX: titleTranslateX }] }
                      : null,
                  ]}
                  onLayout={(e) => {
                    titleTextWidthRef.current = e.nativeEvent.layout.width;
                    if (titleContainerWidthRef.current > 0) {
                      setShouldScrollTitle(
                        titleTextWidthRef.current >
                          titleContainerWidthRef.current + 4
                      );
                    }
                  }}
                >
                  <ThemedText
                    style={styles.trackTitle}
                    numberOfLines={1}
                  >
                    {currentTrack.isRadio
                      ? currentTrack.radioStationName || currentTrack.title
                      : currentTrack.title}
                  </ThemedText>
                </Animated.View>
              </View>
              {currentTrack.isRadio ? (
                <ThemedText style={styles.trackArtistLink} numberOfLines={1}>
                  Radio Station
                </ThemedText>
              ) : (
                <View style={styles.trackMetaRow}>
                  <Pressable 
                    onPress={async () => {
                      if (!currentTrack.artist) return;
                      
                      minimizePlayer();
                      
                      // Try to get artist ID from metadata first
                      let artistId: string | undefined;
                      if (currentTrack.metadata) {
                        try {
                          const meta = JSON.parse(currentTrack.metadata);
                          artistId = meta.artistId;
                        } catch {}
                      }
                      
                      // If we have an ID, use it directly
                      if (artistId) {
                        navigation.navigate("Main", { 
                          screen: "BrowseTab",
                          params: {
                            screen: "Artist", 
                            params: { id: artistId, name: currentTrack.artist } 
                          }
                        });
                      } else {
                        // Otherwise, search for the artist by name and navigate to first result
                        try {
                          const results = await searchMusic(currentTrack.artist, { type: "artists" });
                          if (results.artists.length > 0) {
                            const artist = results.artists[0];
                            navigation.navigate("Main", { 
                              screen: "BrowseTab",
                              params: {
                                screen: "Artist", 
                                params: { id: artist.id, name: artist.name } 
                              }
                            });
                          } else {
                            // If no search results, try navigating with just the name
                            navigation.navigate("Main", { 
                              screen: "BrowseTab",
                              params: {
                                screen: "Artist", 
                                params: { id: currentTrack.artist, name: currentTrack.artist } 
                              }
                            });
                          }
                        } catch (error) {
                          // Fallback: navigate with name as ID
                          navigation.navigate("Main", { 
                            screen: "BrowseTab",
                            params: {
                              screen: "Artist", 
                              params: { id: currentTrack.artist, name: currentTrack.artist } 
                            }
                          });
                        }
                      }
                    }}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <ThemedText style={styles.trackArtistLink} numberOfLines={1}>
                      {currentTrack.artist}
                    </ThemedText>
                  </Pressable>
                  {currentTrack.album ? (
                    <>
                      <Pressable 
                        onPress={async () => {
                          if (!currentTrack.album) return;
                          
                          minimizePlayer();
                          
                          // Try to get album ID from metadata first
                          let albumId: string | undefined;
                          if (currentTrack.metadata) {
                            try {
                              const meta = JSON.parse(currentTrack.metadata);
                              albumId = meta.albumId;
                            } catch {}
                          }
                          
                          // If we have an ID, use it directly
                          if (albumId) {
                            navigation.navigate("Main", { 
                              screen: "BrowseTab",
                              params: {
                                screen: "Album", 
                                params: { id: albumId, name: currentTrack.album, artistName: currentTrack.artist } 
                              }
                            });
                          } else {
                            // Otherwise, search for the album by name and navigate to first result
                            try {
                              const searchQuery = `${currentTrack.album} ${currentTrack.artist}`;
                              const results = await searchMusic(searchQuery, { type: "albums" });
                              if (results.albums.length > 0) {
                                const album = results.albums.find(a => 
                                  a.name.toLowerCase() === currentTrack.album?.toLowerCase() &&
                                  a.artist.toLowerCase() === currentTrack.artist.toLowerCase()
                                ) || results.albums[0];
                                navigation.navigate("Main", { 
                                  screen: "BrowseTab",
                                  params: {
                                    screen: "Album", 
                                    params: { id: album.id, name: album.name, artistName: album.artist } 
                                  }
                                });
                              } else {
                                // If no search results, try navigating with just the name
                                navigation.navigate("Main", { 
                                  screen: "BrowseTab",
                                  params: {
                                    screen: "Album", 
                                    params: { id: currentTrack.album, name: currentTrack.album, artistName: currentTrack.artist } 
                                  }
                                });
                              }
                            } catch (error) {
                              // Fallback: navigate with name as ID
                              navigation.navigate("Main", { 
                                screen: "BrowseTab",
                                params: {
                                  screen: "Album", 
                                  params: { id: currentTrack.album, name: currentTrack.album, artistName: currentTrack.artist } 
                                }
                              });
                            }
                          }
                        }}
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                      >
                        <ThemedText style={styles.trackAlbumLink} numberOfLines={1}>
                          {currentTrack.album}
                        </ThemedText>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              )}
            </View>

            {/* Meta row (info, favorite) – info removed per design update */}

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
              <View style={styles.timeAndQualityRow}>
                <View style={styles.timeLabelWrapper}>
                  <ThemedText style={styles.timeLabel}>{formatTime(displayTime)}</ThemedText>
                </View>
                <View style={styles.qualityInlineContainer}>
                  {qualityInfo.label ? (
                    <View style={styles.qualityInlineBadge}>
                      <ThemedText style={styles.qualityInlineBadgeText}>
                        {qualityInfo.label}
                      </ThemedText>
                    </View>
                  ) : null}
                  {qualityInfo.details ? (
                    <ThemedText
                      style={styles.qualityInlineText}
                      numberOfLines={1}
                    >
                      {qualityInfo.details.replace(/^([A-Za-z-]+)\s+/, "")}
                    </ThemedText>
                  ) : null}
                </View>
                <View style={styles.timeLabelWrapperRight}>
                  <ThemedText style={styles.timeLabel}>-{formatTime(duration - displayTime)}</ThemedText>
                </View>
              </View>
            </View>

            {Platform.OS === 'ios' && <View style={{ height: Spacing.lg, width: '100%' }} />}

            <View style={styles.controls}>
              <Pressable
                style={({ pressed }) => [styles.sideControl, { opacity: pressed ? 0.5 : 1 }]}
                onPress={handleToggleFavorite}
                disabled={isCheckingQobuzFav}
              >
                <MaterialIcons
                  name={isFavorite ? "favorite" : "favorite-border"}
                  size={24}
                  color={isFavorite ? "#FF3B30" : "#FFFFFF"}
                  style={{ opacity: isCheckingQobuzFav ? 0.5 : (isFavorite ? 1 : 0.7) }}
                />
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.mainControl, { opacity: pressed ? 0.5 : 1 }]}
                onPress={previous}
              >
                <MaterialIcons name="skip-previous" size={56} color="#FFFFFF" />
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.playButton,
                  { opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] },
                ]}
                onPress={togglePlayPause}
              >
                <MaterialIcons
                  name={isPlaying ? "pause" : "play-arrow"}
                  size={36}
                  color="#000000"
                />
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.mainControl, { opacity: pressed ? 0.5 : 1 }]}
                onPress={next}
              >
                <MaterialIcons name="skip-next" size={56} color="#FFFFFF" />
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.sideControl, { opacity: pressed ? 0.5 : 1 }]}
                onPress={() => setShowAddMenu(true)}
              >
                <Feather
                  name="plus"
                  size={20}
                  color="#FFFFFF"
                />
              </Pressable>
            </View>

            <View style={styles.volumeRow}>
              <Feather name="volume" size={18} color="#FFFFFF" />
              <View style={styles.volumeSliderWrapper}>
                <Slider
                  style={styles.volumeSlider}
                  minimumValue={0}
                  maximumValue={1}
                  value={volume}
                  onValueChange={setVolume}
                  minimumTrackTintColor="#FFFFFF"
                  maximumTrackTintColor="rgba(255, 255, 255, 0.3)"
                  thumbTintColor="#FFFFFF"
                />
              </View>
              <View style={styles.volumeButtonsColumn}>
                <Pressable
                  style={({ pressed }) => [
                    styles.volumeButton,
                    { opacity: pressed ? 0.6 : 1 }
                  ]}
                  onPressIn={() => {
                    if (volumeHoldTimeoutRef.current) {
                      clearTimeout(volumeHoldTimeoutRef.current);
                    }
                    volumeHoldActiveRef.current = false;
                    volumeHoldTimeoutRef.current = setTimeout(() => {
                      volumeHoldActiveRef.current = true;
                      startContinuousVolumeAdjust("up");
                    }, 250);
                  }}
                  onPressOut={() => {
                    if (volumeHoldTimeoutRef.current) {
                      clearTimeout(volumeHoldTimeoutRef.current);
                      volumeHoldTimeoutRef.current = null;
                    }
                    if (volumeHoldActiveRef.current) {
                      stopVolumeAdjust();
                    } else {
                      // single tap
                      stepVolume(0.02);
                    }
                  }}
                >
                  <Feather name="plus" size={24} color="#FFFFFF" />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.volumeButton,
                    { opacity: pressed ? 0.6 : 1 }
                  ]}
                  onPressIn={() => {
                    if (volumeHoldTimeoutRef.current) {
                      clearTimeout(volumeHoldTimeoutRef.current);
                    }
                    volumeHoldActiveRef.current = false;
                    volumeHoldTimeoutRef.current = setTimeout(() => {
                      volumeHoldActiveRef.current = true;
                      startContinuousVolumeAdjust("down");
                    }, 250);
                  }}
                  onPressOut={() => {
                    if (volumeHoldTimeoutRef.current) {
                      clearTimeout(volumeHoldTimeoutRef.current);
                      volumeHoldTimeoutRef.current = null;
                    }
                    if (volumeHoldActiveRef.current) {
                      stopVolumeAdjust();
                    } else {
                      // single tap
                      stepVolume(-0.02);
                    }
                  }}
                >
                  <Feather name="minus" size={24} color="#FFFFFF" />
                </Pressable>
              </View>
            </View>

            <View style={styles.bottomRow}>
              <Pressable
                style={({ pressed }) => [styles.bottomButton, { opacity: pressed ? 0.6 : 1 }]}
                onPress={() => setShowZoneModal(true)}
              >
                <MaterialCommunityIcons name="speaker" size={22} color="#FFFFFF" />
              </Pressable>
            </View>
          </ScrollView>
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

        {/* Add menu (+) for playlist / radio actions */}
        <Modal
          visible={showAddMenu}
            animationType="slide"
            transparent
            onRequestClose={() => setShowAddMenu(false)}
          >
            <Pressable
              style={styles.modalOverlay}
              onPress={() => setShowAddMenu(false)}
            >
              <Pressable
                style={[styles.addMenuContent, { paddingBottom: insets.bottom + Spacing.lg }]}
                onPress={(e) => e.stopPropagation()}
              >
                <View style={styles.modalHandle} />
                <View style={styles.modalHeader}>
                  <ThemedText style={styles.modalTitle}>More</ThemedText>
                  <ThemedText style={styles.modalSubtitle}>Track actions</ThemedText>
                </View>
                <View style={styles.addMenuItems}>
                  <Pressable
                    style={({ pressed }) => [styles.addMenuItem, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => {
                      // TODO: Wire up "Add to playlist" behaviour
                      setShowAddMenu(false);
                    }}
                  >
                    <MaterialIcons name="playlist-add" size={22} color={Colors.light.text} />
                    <ThemedText style={styles.addMenuItemText}>Add to playlist</ThemedText>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.addMenuItem, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => {
                      // TODO: Wire up "Radio" behaviour (e.g. start artist/track radio)
                      setShowAddMenu(false);
                    }}
                  >
                    <MaterialCommunityIcons name="radio" size={22} color={Colors.light.text} />
                    <ThemedText style={styles.addMenuItemText}>Radio</ThemedText>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
        </Modal>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  animatedContainer: {
    flex: 1,
    backgroundColor: 'transparent', // Transparent so underlying screen shows through when swiping
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent', // Gradient will be the background
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
  headerTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  queueLink: {
    fontSize: 12,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  tabIndicator: {
    marginTop: 4,
    height: 3,
    width: 28,
    borderRadius: 2,
    backgroundColor: "#FFFFFF",
  },
  tabIndicatorHidden: {
    marginTop: 4,
    height: 3,
    width: 28,
    borderRadius: 2,
    backgroundColor: "transparent",
  },
  headerSpacer: {
    width: 44,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: Spacing.xl,
    justifyContent: "space-between",
    flexGrow: 1,
  },
  albumArtContainer: {
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  albumArt: {
    width: ALBUM_ART_SIZE,
    height: ALBUM_ART_SIZE,
    borderRadius: BorderRadius.md,
    ...Platform.select({
      web: {
        boxShadow: "0px 8px 24px rgba(0, 0, 0, 0.15)",
      },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 24,
        elevation: 8,
      },
    }),
  },
  artworkBadges: {
    position: "absolute",
    bottom: Spacing.sm,
    left: Spacing.sm,
    right: Spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  qobuzIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    padding: 4,
  },
  qualityOverlay: {
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.xs,
  },
  qualityOverlayText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFD700",
    letterSpacing: 0.5,
  },
  trackInfo: {
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  trackTitleContainer: {
    width: "100%",
    overflow: "hidden",
    marginBottom: 2,
    alignItems: "center",
  },
  trackTitleMarquee: {
    flexDirection: "row",
  },
  trackTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
    textAlign: "center",
  },
  trackArtistAlbum: {
    fontSize: 13,
    color: "#FFFFFF",
    textAlign: "center",
  },
  trackMetaRow: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  trackMetaColumn: {
    alignItems: "center",
  },
  trackArtistLink: {
    fontSize: 13,
    color: "#FFFFFF",
  },
  trackSeparator: {
    fontSize: 13,
    color: "#FFFFFF",
  },
  trackAlbumLink: {
    fontSize: 13,
    color: "#FFFFFF",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 0,
    marginBottom: Spacing.xs,
    gap: Spacing.md,
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
  volumeOverlayContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "40%",
    alignItems: "center",
    zIndex: 10,
  },
  volumeOverlay: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
    paddingVertical: Spacing.lg,
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: BorderRadius.lg,
  },
  volumeOverlayText: {
    marginLeft: Spacing.md,
    fontSize: 26,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  progressContainer: {
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
  },
  progressTapArea: {
    height: 30,
    justifyContent: "center",
  },
  progressTrack: {
    height: 5,
    backgroundColor: Colors.light.backgroundTertiary,
    borderRadius: 2.5,
    position: "relative",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 2.5,
  },
  progressThumb: {
    position: "absolute",
    top: -5.5,
    width: 15,
    height: 15,
    borderRadius: 7.5,
    backgroundColor: "#FFFFFF",
    marginLeft: -7.5,
  },
  timeAndQualityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 0,
    gap: Spacing.sm,
  },
  timeLabelWrapper: {
    width: 48,
    alignItems: "flex-start",
  },
  timeLabelWrapperRight: {
    width: 48,
    alignItems: "flex-end",
  },
  qualityInlineContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    flexShrink: 1,
    flexGrow: 1,
    justifyContent: "center",
  },
  timeLabel: {
    fontSize: 12,
    color: "#FFFFFF",
  },
  qualityInlineText: {
    fontSize: 12,
    color: "#FFFFFF",
    textAlign: "center",
    flexShrink: 1,
  },
  qualityInlineBadge: {
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  qualityInlineBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFD700",
    letterSpacing: 0.5,
  },
  qualityInlineSpacer: {
    flex: 1,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.lg + Spacing.sm,
    marginBottom: Platform.OS === 'web' ? Spacing.md : Spacing.md + Spacing.lg,
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
    backgroundColor: "#FFFFFF",
    borderWidth: 0,
    borderColor: "transparent",
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
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },
  repeatBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#000000",
  },
  volumeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 0,
    marginBottom: 0,
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
  volumeButton: {
    width: 35,
    height: 35,
    borderRadius: 17.5,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  volumeButtonsColumn: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  bottomButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  bottomButtonText: {
    fontSize: 14,
    color: "#FFFFFF",
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
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    fontSize: 15,
    color: "#FFFFFF",
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
    backgroundColor: "rgba(0, 0, 0, 0.06)",
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
    backgroundColor: "rgba(0, 0, 0, 0.12)",
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
    color: "#000",
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
    backgroundColor: "#000",
    borderColor: "#000",
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
    backgroundColor: "#FFFFFF",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000000",
  },
  addMenuContent: {
    backgroundColor: Colors.light.backgroundDefault,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    paddingTop: Spacing.md,
    maxHeight: "70%",
  },
  addMenuItems: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  addMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.light.backgroundSecondary,
    marginBottom: Spacing.sm,
    gap: Spacing.md,
  },
  addMenuItemText: {
    fontSize: 16,
    fontWeight: "500",
    color: Colors.light.text,
  },
});
