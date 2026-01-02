import React from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";

import { usePlayback } from "@/hooks/usePlayback";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";

/**
 * Web-only volume overlay shown briefly when volume changes.
 * Positioned bottom-right, above the desktop bottom bar.
 */
export function VolumeToast() {
  const { width } = useWindowDimensions();
  const { volume } = usePlayback();

  const [visible, setVisible] = React.useState(false);
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRef = React.useRef(true);

  const percent = Math.max(0, Math.min(100, Math.round((volume ?? 0) * 100)));

  React.useEffect(() => {
    // Skip initial mount so we don't flash on first sync.
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }

    setVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setVisible(false), 900);
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [percent]);

  if (Platform.OS !== "web") return null;
  if (!visible) return null;

  const isDesktop = width >= 980;
  const bottomOffset = isDesktop ? 120 + Spacing.lg : 64 + Spacing.lg;

  return (
    <View pointerEvents="none" style={[styles.container, { bottom: bottomOffset }]}>
      <View style={styles.pill}>
        <Feather name="volume-2" size={16} color={Colors.light.text} />
        <ThemedText style={styles.text}>{percent}%</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: Spacing.lg,
    zIndex: 9999,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xl,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
  text: {
    ...Typography.body,
    color: "#fff",
    fontWeight: "700",
  },
});


