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
  showBack?: boolean;
  onPressBack?: () => void;
  onPressSearch?: (query?: string) => void;
  onPressShuffle?: () => void;
  onPressHistory?: () => void;
  onPressSettings?: () => void;
};

/**
 * Shared top header for consistency across pages.
 * - Right side: Search (box on large web, icon on small) then optional Shuffle then Settings.
 */
export function AppHeader({
  title,
  showBack,
  onPressBack,
  onPressSearch,
  onPressShuffle,
  onPressHistory,
  onPressSettings,
}: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<Nav>();
  const [q, setQ] = useState("");
  const redirectingRef = useRef(false);

  const isWide = Platform.OS === "web" && width >= 980;

  const withNavLock = (fn: () => void) => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    try {
      fn();
    } finally {
      setTimeout(() => {
        redirectingRef.current = false;
      }, 450);
    }
  };

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

  const goHistory = () => {
    if (onPressHistory) return onPressHistory();
    navigation.navigate("Main", { screen: "BrowseTab", params: { screen: "History" } } as any);
  };

  const goShuffle = () => {
    if (onPressShuffle) return onPressShuffle();
    navigation.navigate("Main", {
      screen: "BrowseTab",
      params: { screen: "Browse", params: { autoShuffle: true } },
    } as any);
  };

  const onSubmit = () => {
    const trimmed = q.trim();
    withNavLock(() => {
      goSearch(trimmed);
    });
    // Clear input after navigation to avoid stale text when returning
    setQ("");
  };

  const titleNode = useMemo(() => <ThemedText style={styles.title}>{title}</ThemedText>, [title]);

  return (
    <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
      <View style={styles.left}>
        {showBack ? (
          <Pressable
            style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => (onPressBack ? onPressBack() : (navigation as any).goBack())}
          >
            <Feather name="chevron-left" size={20} color={Colors.light.text} />
          </Pressable>
        ) : null}
        {title ? titleNode : null}
      </View>

      <View style={styles.right}>
        {/* Order: Shuffle, Search, History, Settings */}
        <Pressable
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
          onPress={goShuffle}
        >
          <Feather name="shuffle" size={20} color={Colors.light.text} />
        </Pressable>

        {isWide ? (
          <View style={styles.searchBox}>
            <Feather name="search" size={16} color={Colors.light.textSecondary} />
            <TextInput
              value={q}
              onChangeText={(text) => {
                setQ(text);
                // As soon as the user types, open the Search screen and show results there.
                if (text.trim().length > 0) {
                  withNavLock(() => {
                    goSearch(text);
                  });
                }
              }}
              placeholder="Search…"
              placeholderTextColor={Colors.light.textTertiary}
              style={styles.searchInput}
              returnKeyType="search"
              onSubmitEditing={onSubmit}
              onFocus={() => {
                // Clicking into the box should behave like Search page.
                withNavLock(() => {
                  goSearch(q);
                });
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

        <Pressable
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
          onPress={goHistory}
        >
          <Feather name="clock" size={20} color={Colors.light.text} />
        </Pressable>

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
    flexDirection: "row",
    alignItems: "center",
    flexGrow: 1,
    flexShrink: 1,
    paddingRight: Spacing.md,
    gap: Spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
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


