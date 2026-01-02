import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemedText } from "@/components/ThemedText";
import { AlbumArtwork } from "@/components/AlbumArtwork";
import { useMusic, type Album, type Artist } from "@/hooks/useMusic";
import { usePlayback, type Track } from "@/hooks/usePlayback";
import { Colors, Spacing, Typography } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const RECENT_SEARCHES_KEY = "@soundstream_recent_searches";

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
  const { searchMusic, addToRecentlyPlayed } = useMusic();
  const { playTrack } = usePlayback();
  const [q, setQ] = useState("");
  const redirectingRef = useRef(false);

  const isWide = Platform.OS === "web" && width >= 980;
  const isWeb = Platform.OS === "web";

  // Web-wide: show dropdown results instead of navigating to full Search page.
  const [searchOpen, setSearchOpen] = useState(false);
  const [recent, setRecent] = useState<Array<{ query: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<{ artists: Artist[]; albums: Album[]; tracks: Track[] }>({
    artists: [],
    albums: [],
    tracks: [],
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (!isWeb || !isWide) return;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return;
        const items = parsed
          .map((x: any) => ({ query: typeof x === "string" ? x : String(x?.query || "") }))
          .filter((x: any) => x.query && x.query.length > 0)
          .slice(0, 6);
        setRecent(items);
      } catch {
        // ignore
      }
    })();
  }, [isWeb, isWide]);

  const runSearch = useMemo(() => {
    return async (text: string) => {
      const trimmed = (text || "").trim();
      if (trimmed.length < 2) {
        setResults({ artists: [], albums: [], tracks: [] });
        setIsSearching(false);
        return;
      }
      setIsSearching(true);
      try {
        const r = await searchMusic(trimmed, { source: "all", type: "all" });
        setResults(r);
      } catch {
        setResults({ artists: [], albums: [], tracks: [] });
      } finally {
        setIsSearching(false);
      }
    };
  }, [searchMusic]);

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
    if (isWeb && isWide) {
      setSearchOpen(true);
      runSearch(trimmed);
      return;
    }
    withNavLock(() => goSearch(trimmed));
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
                // Web: show dropdown results instead of taking over the whole page.
                if (isWeb) {
                  setSearchOpen(true);
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  debounceRef.current = setTimeout(() => runSearch(text), 220);
                } else if (text.trim().length > 0) {
                  withNavLock(() => goSearch(text));
                }
              }}
              placeholder="Search…"
              placeholderTextColor={Colors.light.textTertiary}
              style={styles.searchInput}
              returnKeyType="search"
              onSubmitEditing={onSubmit}
              onFocus={() => {
                if (isWeb) {
                  setSearchOpen(true);
                  if (q.trim().length >= 2) runSearch(q);
                } else {
                  withNavLock(() => goSearch(q));
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

      {/* Web-only search dropdown (does not take over the whole page) */}
      {isWeb && isWide && searchOpen ? (
        <View style={styles.searchOverlayRoot} pointerEvents="box-none">
          <Pressable style={styles.searchBackdrop as any} onPress={() => setSearchOpen(false)} />
          <View style={styles.searchDropdown as any}>
            {q.trim().length < 2 ? (
              <View style={styles.searchSection}>
                <View style={styles.searchSectionHeader}>
                  <ThemedText style={styles.searchSectionTitle}>Recent Searches</ThemedText>
                  {recent.length > 0 ? (
                    <Pressable
                      onPress={async () => {
                        setRecent([]);
                        await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
                      }}
                      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
                    >
                      <ThemedText style={styles.searchClear}>Clear</ThemedText>
                    </Pressable>
                  ) : null}
                </View>
                {recent.length === 0 ? (
                  <ThemedText style={styles.searchEmpty}>Type to search…</ThemedText>
                ) : (
                  recent.map((r) => (
                    <Pressable
                      key={r.query}
                      style={({ pressed }) => [styles.searchRow, { opacity: pressed ? 0.7 : 1 }]}
                      onPress={() => {
                        setQ(r.query);
                        runSearch(r.query);
                      }}
                    >
                      <Feather name="search" size={18} color="rgba(255,255,255,0.65)" />
                      <ThemedText style={styles.searchRowText} numberOfLines={1}>
                        {r.query}
                      </ThemedText>
                    </Pressable>
                  ))
                )}
              </View>
            ) : (
              <View style={styles.searchSection}>
                {isSearching ? <ThemedText style={styles.searchEmpty}>Searching…</ThemedText> : null}

                {results.artists.slice(0, 3).map((a) => (
                  <Pressable
                    key={`artist-${a.id}`}
                    style={({ pressed }) => [styles.resultRow, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => {
                      setSearchOpen(false);
                      navigation.navigate("Main", {
                        screen: "BrowseTab",
                        params: { screen: "Artist", params: { id: a.id, name: a.name } },
                      } as any);
                    }}
                  >
                    <AlbumArtwork source={a.imageUrl} style={styles.resultThumbRound} contentFit="cover" />
                    <View style={styles.resultText}>
                      <ThemedText style={styles.resultTitle} numberOfLines={1}>
                        {a.name}
                      </ThemedText>
                      <ThemedText style={styles.resultSubtitle} numberOfLines={1}>
                        Artist
                      </ThemedText>
                    </View>
                  </Pressable>
                ))}

                {results.albums.slice(0, 4).map((al) => (
                  <Pressable
                    key={`album-${al.id}`}
                    style={({ pressed }) => [styles.resultRow, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => {
                      setSearchOpen(false);
                      navigation.navigate("Main", {
                        screen: "BrowseTab",
                        params: {
                          screen: "Album",
                          params: { id: al.id, name: al.name, artistName: al.artist, source: (al as any).source },
                        },
                      } as any);
                    }}
                  >
                    <AlbumArtwork source={al.imageUrl} style={styles.resultThumb} contentFit="cover" />
                    <View style={styles.resultText}>
                      <ThemedText style={styles.resultTitle} numberOfLines={1}>
                        {al.name}
                      </ThemedText>
                      <ThemedText style={styles.resultSubtitle} numberOfLines={1}>
                        Album • {al.artist}
                      </ThemedText>
                    </View>
                  </Pressable>
                ))}

                {results.tracks.slice(0, 6).map((t) => (
                  <Pressable
                    key={`track-${t.id}`}
                    style={({ pressed }) => [styles.resultRow, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => {
                      setSearchOpen(false);
                      try {
                        playTrack(t);
                        addToRecentlyPlayed(t);
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    <AlbumArtwork source={t.albumArt} style={styles.resultThumb} contentFit="cover" />
                    <View style={styles.resultText}>
                      <ThemedText style={styles.resultTitle} numberOfLines={1}>
                        {t.title}
                      </ThemedText>
                      <ThemedText style={styles.resultSubtitle} numberOfLines={1}>
                        Track • {t.artist}
                      </ThemedText>
                    </View>
                  </Pressable>
                ))}

                {results.artists.length === 0 && results.albums.length === 0 && results.tracks.length === 0 && !isSearching ? (
                  <ThemedText style={styles.searchEmpty}>No results</ThemedText>
                ) : null}
              </View>
            )}
          </View>
        </View>
      ) : null}
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
    position: "relative",
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

  // --- Web search dropdown ---
  searchOverlayRoot: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "100%" as any,
    zIndex: 9999,
  },
  searchBackdrop: {
    position: "fixed" as any,
    inset: 0,
    backgroundColor: "transparent",
  },
  searchDropdown: {
    position: "absolute" as any,
    right: Spacing.lg,
    top: 10,
    width: 560,
    maxWidth: "calc(100vw - 360px)" as any,
    maxHeight: "70vh" as any,
    overflow: "auto" as any,
    borderRadius: 22,
    backgroundColor: "rgba(20, 20, 22, 0.92)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.16)",
    boxShadow: "0px 18px 60px rgba(0,0,0,0.55)" as any,
    padding: Spacing.md,
  },
  searchSection: {
    gap: 6,
  },
  searchSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 6,
    paddingBottom: 6,
  },
  searchSectionTitle: {
    ...Typography.caption,
    color: "rgba(255,255,255,0.75)",
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  searchClear: {
    ...Typography.caption,
    color: "rgba(255,255,255,0.7)",
    fontWeight: "600",
  },
  searchEmpty: {
    ...Typography.body,
    color: "rgba(255,255,255,0.65)",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  searchRowText: {
    ...Typography.body,
    color: "#fff",
    fontWeight: "700",
    flex: 1,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  resultThumb: {
    width: 46,
    height: 46,
    borderRadius: 10,
  },
  resultThumbRound: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  resultText: {
    flex: 1,
    minWidth: 0,
  },
  resultTitle: {
    ...Typography.body,
    color: "#fff",
    fontWeight: "700",
  },
  resultSubtitle: {
    ...Typography.caption,
    color: "rgba(255,255,255,0.65)",
    marginTop: 2,
  },
});


