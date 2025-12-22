import React from "react";
import { View, StyleSheet, Pressable, Platform, ActionSheetIOS } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";

export type SortOption = "alphabetical" | "recently_played" | "recently_added";

interface SortFilterProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
  options?: SortOption[];
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "alphabetical", label: "Alphabetical" },
  { value: "recently_played", label: "Recently Played" },
  { value: "recently_added", label: "Recently Added" },
];

export function SortFilter({ value, onChange, options = ["alphabetical", "recently_played", "recently_added"] }: SortFilterProps) {
  const availableOptions = SORT_OPTIONS.filter(opt => options.includes(opt.value));
  const currentLabel = availableOptions.find(opt => opt.value === value)?.label || "Alphabetical";

  const handlePress = () => {
    if (Platform.OS === "ios") {
      const optionLabels = availableOptions.map(opt => opt.label);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...optionLabels, "Cancel"],
          cancelButtonIndex: optionLabels.length,
        },
        (buttonIndex) => {
          if (buttonIndex < optionLabels.length) {
            onChange(availableOptions[buttonIndex].value);
          }
        }
      );
    } else {
      // Android/Web: Cycle through options
      const currentIndex = availableOptions.findIndex(opt => opt.value === value);
      const nextIndex = (currentIndex + 1) % availableOptions.length;
      onChange(availableOptions[nextIndex].value);
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.filterButton,
        { opacity: pressed ? 0.6 : 1 }
      ]}
    >
      <ThemedText style={styles.filterText}>{currentLabel}</ThemedText>
      <Feather name="chevron-down" size={16} color={Colors.light.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
  },
  filterText: {
    ...Typography.caption,
    color: Colors.light.text,
    fontWeight: "500",
  },
});

