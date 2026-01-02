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
    <View style={[styles.badge, { width: size, height: size }]}>
      {source === "qobuz" ? (
        <Image
          source={require("../assets/images/qobuz-icon.png")}
          style={[styles.icon, { width: size - 4, height: size - 4 }]}
          contentFit="contain"
        />
      ) : source === "soundcloud" ? (
        <Image
          source={require("../assets/images/soundcloud-icon.png")}
          style={[styles.icon, { width: size - 4, height: size - 4 }]}
          contentFit="contain"
        />
      ) : source === "tidal" ? (
        <Image
          source={require("../assets/images/tidal-icon.png")}
          style={[styles.icon, { width: size - 4, height: size - 4 }]}
          contentFit="contain"
        />
      ) : (
        <View style={[styles.libraryIconContainer, { width: size - 4, height: size - 4 }]}>
          <Feather name="folder" size={size - 8} color="#ffffff" />
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
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: BorderRadius.xs,
    padding: 2,
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
