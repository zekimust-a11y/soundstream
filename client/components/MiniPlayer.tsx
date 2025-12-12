import React from "react";
import { View, StyleSheet, Pressable, Image } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { ThemedText } from "@/components/ThemedText";
import { usePlayback } from "@/hooks/usePlayback";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { MainTabParamList } from "@/navigation/MainTabNavigator";

type NavigationProp = BottomTabNavigationProp<MainTabParamList>;

export default function MiniPlayer() {
  const navigation = useNavigation<NavigationProp>();
  const { currentTrack, isPlaying, togglePlayPause } = usePlayback();

  if (!currentTrack) return null;

  const handlePress = () => {
    navigation.navigate("QueueTab");
  };

  return (
    <Pressable onPress={handlePress} style={styles.container}>
      <BlurView intensity={90} tint="light" style={styles.blur}>
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
              togglePlayPause();
            }}
            style={styles.playButton}
            hitSlop={12}
          >
            <Feather
              name={isPlaying ? "pause" : "play"}
              size={24}
              color={Colors.light.text}
            />
          </Pressable>
        </View>
      </BlurView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 80,
    left: Spacing.md,
    right: Spacing.md,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  blur: {
    overflow: "hidden",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    backgroundColor: "rgba(255, 255, 255, 0.7)",
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
  playButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
});
