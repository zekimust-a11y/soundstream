import React, { useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, Typography } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Nav = NativeStackNavigationProp<RootStackParamList>;

type AppHeaderProps = {
  title: string;
  onPressSearch?: (query?: string) => void;
  onPressShuffle?: () => void;
  showShuffle?: boolean;
  onPressSettings?: () => void;
  rightExtra?: React.ReactNode;
};

/**
 * Shared top header for consistency across pages.
 * - Right side: Search (box on large web, icon on small) then optional Shuffle then Settings.
 */
export function AppHeader({
  title,
  onPressSearch,
  onPressShuffle,
  showShuffle,
  onPressSettings,
  rightExtra,
}: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<Nav>();
  const [q, setQ] = useState("");
  const redirectingRef = useRef(false);

  const isWide = Platform.OS === "web" && width >= 980;

  const goSearch = (query?: string) => {
    if (onPressSearch) return onPressSearch(query);
    // Navigate to the nested Search screen so it behaves like the real Search page.
    navigation.navigate("SearchModal", {
      screen: "Search",
      params: { initialQuery: query || "" },
    } as any);
  };

  const goSettings = () => {
    if (onPressSettings) return onPressSettings();
    navigation.navigate("Main", { screen: "BrowseTab", params: { screen: "Settings" } } as any);
  };

  const onSubmit = () => {
    const trimmed = q.trim();
    if (!trimmed) return goSearch("");
    goSearch(trimmed);
    setQ("");
  };

  const titleNode = useMemo(() => <ThemedText style={styles.title}>{title}</ThemedText>, [title]);

  return (
    <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
      <View style={styles.left}>{titleNode}</View>

      <View style={styles.right}>
        {isWide ? (
          <View style={styles.searchBox}>
            <Feather name="search" size={16} color={Colors.light.textSecondary} />
            <TextInput
              value={q}
              onChangeText={(text) => {
                setQ(text);
                // As soon as the user types, open the Search screen and show results there.
                if (!redirectingRef.current && text.trim().length > 0) {
                  redirectingRef.current = true;
                  goSearch(text);
                  setQ("");
                  setTimeout(() => {
                    redirectingRef.current = false;
                  }, 400);
                }
              }}
              placeholder="Search…"
              placeholderTextColor={Colors.light.textTertiary}
              style={styles.searchInput}
              returnKeyType="search"
              onSubmitEditing={onSubmit}
              onFocus={() => {
                // Clicking into the box should behave like Search page.
                if (!redirectingRef.current) {
                  redirectingRef.current = true;
                  goSearch(q);
                  setQ("");
                  setTimeout(() => {
                    redirectingRef.current = false;
                  }, 400);
                }
              }}
            />
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => goSearch("")}
          >
            <Feather name="search" size={20} color={Colors.light.text} />
          </Pressable>
        )}

        {rightExtra}

        {showShuffle && onPressShuffle ? (
          <Pressable
            style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={onPressShuffle}
          >
            <Feather name="shuffle" size={20} color={Colors.light.text} />
          </Pressable>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
          onPress={goSettings}
        >
          <Feather name="settings" size={20} color={Colors.light.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    backgroundColor: Colors.light.backgroundRoot,
  },
  left: {
    flexGrow: 1,
    flexShrink: 1,
    paddingRight: Spacing.md,
  },
  title: {
    ...Typography.title,
    color: Colors.light.text,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: Spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.backgroundSecondary,
    width: 260,
  },
  searchInput: {
    flex: 1,
    ...Typography.body,
    color: Colors.light.text,
    paddingVertical: 0,
    outlineStyle: "none",
  } as any,
});


