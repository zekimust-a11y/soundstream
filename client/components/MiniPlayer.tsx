import React from "react";
import { View, StyleSheet, Pressable, Image, Platform, useWindowDimensions } from "react-native";
import { useNavigation, CommonActions } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { extractDominantColor, lightenColor, darkenColor } from "@/utils/colorExtractor";
import { ThemedText } from "@/components/ThemedText";
import { usePlayback } from "@/hooks/usePlayback";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";

export default function MiniPlayer() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { currentTrack, isPlaying, togglePlayPause, next, currentTime } = usePlayback();
  const [gradientColors, setGradientColors] = React.useState<[string, string]>(['#F2F2F7', '#1C1C1E']);
  
  // Position relative to the bottom tab bar so it doesn't cover nav buttons
  // iOS tab bar height: 88, Web tab bar height: 64
  const bottomOffset = Platform.select({
    ios: 88,                     // sit flush against the top of the tab bar
    web: 64 + Spacing.xs,        // sit just above the web tab bar
    default: Spacing.lg,         // Android and others: small offset
  });

  React.useEffect(() => {
    if (!currentTrack || !currentTrack.albumArt) {
      setGradientColors(['#F2F2F7', '#1C1C1E']);
      return;
    }

    let isMounted = true;
    extractDominantColor(currentTrack.albumArt)
      .then((color) => {
        if (!isMounted) return;
        const darkerBase = darkenColor(color, 0.4, true);
        const lightColor = lightenColor(darkerBase, 0.3);
        const darkColor = darkenColor(darkerBase, 0.15, true);
        setGradientColors([lightColor, darkColor]);
      })
      .catch(() => {
        if (!isMounted) return;
        setGradientColors(['#F2F2F7', '#1C1C1E']);
      });

    return () => {
      isMounted = false;
    };
  }, [currentTrack?.id, currentTrack?.albumArt]);

  if (!currentTrack) return null;

  const handlePress = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: "NowPlaying",
      })
    );
  };

  const content = (
    <View style={styles.content}>
      {currentTrack.albumArt ? (
        <Image source={{ uri: currentTrack.albumArt }} style={styles.artwork} />
      ) : (
        <View style={[styles.artwork, styles.placeholderArtwork]}>
          <Feather name="music" size={20} color={Colors.light.textSecondary} />
        </View>
      )}
      
      <View style={styles.info}>
        <ThemedText style={styles.title} numberOfLines={1}>
          {currentTrack.title}
        </ThemedText>
        <ThemedText style={styles.artist} numberOfLines={1}>
          {currentTrack.artist}
        </ThemedText>
      </View>

      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          next();
        }}
        style={styles.controlButton}
        hitSlop={8}
      >
        <Feather
          name="skip-forward"
          size={20}
          color={Colors.light.text}
        />
      </Pressable>
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          togglePlayPause();
        }}
        style={styles.playButtonContainer}
        hitSlop={8}
      >
        <CircularProgressButton
          isPlaying={isPlaying}
          progress={currentTrack.duration > 0 ? currentTime / currentTrack.duration : 0}
        />
      </Pressable>
    </View>
  );

  const containerStyle = Platform.OS === 'ios' 
    ? [
        styles.container,
        styles.containerIOS,
        {
          width: screenWidth,
          bottom: bottomOffset,
          zIndex: 1000 
        }
      ]
    : [
        styles.container,
        { 
          bottom: bottomOffset,
          zIndex: 1000 
        }
      ];

  return (
    <Pressable onPress={handlePress} style={containerStyle}>
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.gradientBackground}
      >
        {Platform.OS === "web" ? (
          <View style={[styles.blur, { backgroundColor: "transparent" }]}>
            {content}
          </View>
        ) : (
          <BlurView intensity={60} tint="light" style={styles.blur}>
            {content}
          </BlurView>
        )}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    overflow: "hidden",
    ...Platform.select({
      web: {
        left: Spacing.md,
        right: Spacing.md,
        borderRadius: BorderRadius.lg,
        boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.15)",
      },
      android: {
        left: Spacing.md,
        right: Spacing.md,
        borderRadius: BorderRadius.lg,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
      },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
      },
    }),
  },
  containerIOS: {
    left: 0,
    right: 0,
    marginLeft: 0,
    marginRight: 0,
    paddingLeft: 0,
    paddingRight: 0,
    borderRadius: 0,
    height: 64, // Fixed height for iOS: 48px artwork + 8px padding top + 8px padding bottom
  },
  gradientBackground: {
    width: "100%",
    height: "100%",
  },
  blur: {
    width: "100%",
    ...Platform.select({
      ios: {
        height: 64, // Match container height
        borderRadius: 0,
        overflow: "hidden",
      },
      default: {
        borderRadius: BorderRadius.lg,
        overflow: "hidden",
      },
    }),
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    width: "100%",
    ...Platform.select({
      ios: {
        paddingHorizontal: Spacing.md,
        height: 64, // Match container height
        backgroundColor: "transparent",
      },
      default: {
        backgroundColor: "rgba(255, 255, 255, 0.7)",
      },
    }),
  },
  artwork: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.sm,
  },
  placeholderArtwork: {
    backgroundColor: Colors.light.backgroundDefault,
    justifyContent: "center",
    alignItems: "center",
  },
  info: {
    flex: 1,
    marginLeft: Spacing.md,
    marginRight: Spacing.sm,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.light.text,
  },
  artist: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  controlButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  playButtonContainer: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  progressButtonWrapper: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  progressRing: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 5,
    borderColor: "rgba(255, 255, 255, 0.2)",
    overflow: "hidden",
  },
  progressHalf: {
    position: "absolute",
    width: "100%",
    height: "50%",
    backgroundColor: "#FF9500", // Orange color
  },
  progressTop: {
    top: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  progressBottom: {
    bottom: 0,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    transformOrigin: "center top",
  },
  playButtonInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
});

// Circular progress button component
function CircularProgressButton({ isPlaying, progress }: { isPlaying: boolean; progress: number }) {
  // Clamp progress between 0 and 1
  const clampedProgress = Math.max(0, Math.min(1, progress));
  
  // For circular progress starting from top (12 o'clock), we use two semicircles:
  // - Top semicircle shows when progress > 50%
  // - Bottom semicircle rotates from -180deg (hidden) to 0deg (visible) for 0-50%
  //   Then stays visible for 50-100% while top semicircle appears
  const showTopHalf = clampedProgress > 0.5;
  
  // Bottom semicircle rotation:
  // - At 0%: -180deg (completely hidden, pointing up)
  // - At 50%: 0deg (half visible, pointing down)
  // - At 100%: 0deg (fully visible)
  const bottomRotation = clampedProgress <= 0.5 
    ? -180 + (clampedProgress * 2 * 180) // -180 to 0 degrees
    : 0; // Fully visible when progress > 50%
  
  return (
    <View style={styles.progressButtonWrapper}>
      {/* Progress ring background (gray border) */}
      <View style={styles.progressRing}>
        {/* Top half - shows when progress >= 50% */}
        {showTopHalf && (
          <View style={[styles.progressHalf, styles.progressTop]} />
        )}
        {/* Bottom half - rotates to show progress from 0-100% */}
        {clampedProgress > 0 && (
          <View
            style={[
              styles.progressHalf,
              styles.progressBottom,
              {
                transform: [{ rotate: `${bottomRotation}deg` }],
              },
            ]}
          />
        )}
      </View>
      {/* White circular button */}
      <View style={styles.playButtonInner}>
        <Feather
          name={isPlaying ? "pause" : "play"}
          size={20}
          color="#000000"
        />
      </View>
    </View>
  );
}
