import React from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { SelectMenu, type SelectOption } from "@/components/SelectMenu";

export type SourceFilter = "all" | "local" | "tidal" | "soundcloud";

export type ViewMode = "grid" | "list";

export type SortValue = string;

type LibraryToolbarProps = {
  sortLabel?: string;
  sortValue: SortValue;
  sortOptions: Array<SelectOption<SortValue>>;
  onSortChange: (value: SortValue) => void;

  sourceValue: SourceFilter;
  onSourceChange: (value: SourceFilter) => void;
  showSource?: boolean;

  qualityValue: string;
  qualityOptions: Array<SelectOption<string>>;
  onQualityChange: (value: string) => void;
  showQuality?: boolean;
  qualityDisabled?: boolean;

  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  showViewToggle?: boolean;
};

const SOURCE_OPTIONS: Array<SelectOption<SourceFilter>> = [
  { value: "all", label: "All" },
  { value: "local", label: "Local Library" },
  { value: "tidal", label: "Tidal" },
  { value: "soundcloud", label: "SoundCloud" },
];

export function LibraryToolbar({
  sortLabel = "Sorting",
  sortValue,
  sortOptions,
  onSortChange,
  sourceValue,
  onSourceChange,
  showSource = true,
  qualityValue,
  qualityOptions,
  onQualityChange,
  showQuality = true,
  qualityDisabled,
  viewMode,
  onViewModeChange,
  showViewToggle = true,
}: LibraryToolbarProps) {
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <SelectMenu label={sortLabel} value={sortValue} options={sortOptions} onChange={onSortChange} />

        {showSource ? (
          <SelectMenu label="Src" value={sourceValue} options={SOURCE_OPTIONS} onChange={onSourceChange} />
        ) : null}

        {showQuality ? (
          <SelectMenu
            label="Quality"
            value={qualityValue}
            options={qualityOptions}
            onChange={onQualityChange}
            disabled={qualityDisabled || qualityOptions.length <= 1}
          />
        ) : null}
      </View>

      {showViewToggle && viewMode && onViewModeChange ? (
        <View style={styles.viewToggle}>
          <Pressable
            style={({ pressed }) => [
              styles.toggleButton,
              viewMode === "grid" ? styles.toggleButtonActive : null,
              { opacity: pressed ? 0.75 : 1 },
            ]}
            onPress={() => onViewModeChange("grid")}
          >
            <Feather name="grid" size={18} color={viewMode === "grid" ? Colors.light.accent : Colors.light.textSecondary} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.toggleButton,
              viewMode === "list" ? styles.toggleButtonActive : null,
              { opacity: pressed ? 0.75 : 1 },
            ]}
            onPress={() => onViewModeChange("list")}
          >
            <Feather name="list" size={18} color={viewMode === "list" ? Colors.light.accent : Colors.light.textSecondary} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flexWrap: "wrap",
  },
  viewToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.md,
    padding: 2,
  },
  toggleButton: {
    width: 36,
    height: 32,
    borderRadius: BorderRadius.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  toggleButtonActive: {
    backgroundColor: Colors.light.backgroundRoot,
  },
});


