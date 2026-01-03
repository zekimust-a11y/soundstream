import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { Colors, BorderRadius, Spacing } from "@/constants/theme";

interface SourceBadgeProps {
  source?: "local" | "qobuz" | "soundcloud" | "spotify" | "tidal";
  size?: number;
}

export function SourceBadge({ source, size = 24 }: SourceBadgeProps) {
  if (!source) return null;

  return (
    <View pointerEvents="none" style={[styles.badge, { width: size, height: size }]}>
      {source === "qobuz" ? (
        <Image
          source={require("../assets/images/qobuz-icon.png")}
          style={[styles.icon, { width: size - 8, height: size - 8 }]}
          contentFit="contain"
        />
      ) : source === "soundcloud" ? (
        <Image
          source={require("../assets/images/soundcloud-icon.png")}
          style={[styles.icon, { width: size - 8, height: size - 8 }]}
          contentFit="contain"
        />
      ) : source === "tidal" ? (
        <Image
          source={require("../assets/images/tidal-icon.png")}
          style={[styles.icon, { width: size - 8, height: size - 8 }]}
          contentFit="contain"
        />
      ) : (
        <View style={[styles.libraryIconContainer, { width: size - 8, height: size - 8 }]}>
          <Feather name="folder" size={size - 12} color="#000000" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    bottom: Spacing.xs,
    left: Spacing.xs,
    // Match Now Playing badge: readable on top of dark/bright artwork.
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 6,
    padding: 4,
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      web: {
        boxShadow: "0px 2px 4px rgba(0, 0, 0, 0.3)",
      },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 4,
      },
    }),
  },
  icon: {
    borderRadius: BorderRadius.xs,
  },
  libraryIconContainer: {
    justifyContent: "center",
    alignItems: "center",
  },
});
