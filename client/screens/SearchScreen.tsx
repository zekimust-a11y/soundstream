import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  FlatList,
  Pressable,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic, type Artist, type Album } from "@/hooks/useMusic";
import { usePlayback, type Track } from "@/hooks/usePlayback";
import type { SearchStackParamList } from "@/navigation/SearchStackNavigator";

type NavigationProp = NativeStackNavigationProp<SearchStackParamList>;
type FilterTab = "all" | "artists" | "albums" | "tracks";
type SourceFilter = "all" | "local" | "qobuz";

interface SearchResult {
  type: "artist" | "album" | "track";
  data: Artist | Album | Track;
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const { searchMusic, addToRecentlyPlayed, isFavoriteTrack, toggleFavoriteTrack } = useMusic();
  const { playTrack } = usePlayback();

  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [results, setResults] = useState<{
    artists: Artist[];
    albums: Album[];
    tracks: Track[];
  }>({ artists: [], albums: [], tracks: [] });
  const [isSearching, setIsSearching] = useState(false);

  const performSearch = useCallback(async (text: string, source: SourceFilter, type: FilterTab) => {
    if (text.length < 2) {
      setResults({ artists: [], albums: [], tracks: [] });
      return;
    }
    setIsSearching(true);
    const searchResults = await searchMusic(text, { source, type });
    setResults(searchResults);
    setIsSearching(false);
  }, [searchMusic]);

  const handleSearch = useCallback(async (text: string) => {
    setQuery(text);
    performSearch(text, sourceFilter, activeTab);
  }, [performSearch, sourceFilter, activeTab]);

  useEffect(() => {
    if (query.length >= 2) {
      performSearch(query, sourceFilter, activeTab);
    }
  }, [sourceFilter, activeTab]);

  const getFilteredResults = (): SearchResult[] => {
    const allResults: SearchResult[] = [];

    if (activeTab === "all" || activeTab === "artists") {
      results.artists.forEach((artist) => {
        allResults.push({ type: "artist", data: artist });
      });
    }
    if (activeTab === "all" || activeTab === "albums") {
      results.albums.forEach((album) => {
        allResults.push({ type: "album", data: album });
      });
    }
    if (activeTab === "all" || activeTab === "tracks") {
      results.tracks.forEach((track) => {
        allResults.push({ type: "track", data: track });
      });
    }

    return allResults;
  };

  const handleResultPress = (result: SearchResult) => {
    if (result.type === "artist") {
      const artist = result.data as Artist;
      navigation.navigate("Artist", { id: artist.id, name: artist.name });
    } else if (result.type === "album") {
      const album = result.data as Album;
      navigation.navigate("Album", { id: album.id, name: album.name, artistName: album.artist });
    } else {
      const track = result.data as Track;
      playTrack(track);
      addToRecentlyPlayed(track);
    }
  };

  const renderResult = ({ item }: { item: SearchResult }) => {
    if (item.type === "artist") {
      const artist = item.data as Artist;
      return (
        <Pressable
          style={({ pressed }) => [styles.resultRow, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => handleResultPress(item)}
        >
          <View style={styles.artistPlaceholder}>
            <Feather name="user" size={20} color={Colors.light.textTertiary} />
          </View>
          <View style={styles.resultInfo}>
            <ThemedText style={styles.resultTitle}>{artist.name}</ThemedText>
            <ThemedText style={styles.resultSubtitle}>Artist</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={Colors.light.textTertiary} />
        </Pressable>
      );
    } else if (item.type === "album") {
      const album = item.data as Album;
      return (
        <Pressable
          style={({ pressed }) => [styles.resultRow, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => handleResultPress(item)}
        >
          <Image
            source={album.imageUrl || require("../assets/images/placeholder-album.png")}
            style={styles.resultImage}
            contentFit="cover"
          />
          <View style={styles.resultInfo}>
            <ThemedText style={styles.resultTitle} numberOfLines={1}>
              {album.name}
            </ThemedText>
            <ThemedText style={styles.resultSubtitle} numberOfLines={1}>
              Album • {album.artist}
            </ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={Colors.light.textTertiary} />
        </Pressable>
      );
    } else {
      const track = item.data as Track;
      const isFavorite = isFavoriteTrack(track.id);
      return (
        <Pressable
          style={({ pressed }) => [styles.resultRow, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => handleResultPress(item)}
        >
          <Image
            source={track.albumArt || require("../assets/images/placeholder-album.png")}
            style={styles.resultImage}
            contentFit="cover"
          />
          <View style={styles.resultInfo}>
            <View style={styles.trackTitleRow}>
              <ThemedText style={styles.resultTitle} numberOfLines={1}>
                {track.title}
              </ThemedText>
              {track.source === "qobuz" ? (
                <View style={styles.qobuzBadge}>
                  <ThemedText style={styles.qobuzBadgeText}>Q</ThemedText>
                </View>
              ) : null}
            </View>
            <ThemedText style={styles.resultSubtitle} numberOfLines={1}>
              Track • {track.artist}
            </ThemedText>
          </View>
          <Pressable
            style={({ pressed }) => [styles.favoriteButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => toggleFavoriteTrack(track.id)}
          >
            <Feather 
              name={isFavorite ? "heart" : "heart"} 
              size={18} 
              color={isFavorite ? Colors.light.error : Colors.light.textTertiary} 
              style={isFavorite ? { opacity: 1 } : { opacity: 0.5 }}
            />
          </Pressable>
          <Feather name="play-circle" size={24} color={Colors.light.accent} />
        </Pressable>
      );
    }
  };

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "artists", label: "Artists" },
    { key: "albums", label: "Albums" },
    { key: "tracks", label: "Tracks" },
  ];

  const filteredResults = getFilteredResults();

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <View style={styles.searchContainer}>
          <Feather name="search" size={18} color={Colors.light.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search music..."
            placeholderTextColor={Colors.light.textTertiary}
            value={query}
            onChangeText={handleSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 ? (
            <Pressable
              style={({ pressed }) => [styles.clearButton, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => {
                setQuery("");
                setResults({ artists: [], albums: [], tracks: [] });
              }}
            >
              <Feather name="x" size={18} color={Colors.light.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {query.length > 0 ? (
          <>
            <View style={styles.tabsContainer}>
              {tabs.map((tab) => (
                <Pressable
                  key={tab.key}
                  style={({ pressed }) => [
                    styles.tab,
                    activeTab === tab.key && styles.tabActive,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                  onPress={() => setActiveTab(tab.key)}
                >
                  <ThemedText
                    style={[
                      styles.tabText,
                      activeTab === tab.key && styles.tabTextActive,
                    ]}
                  >
                    {tab.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <View style={styles.sourceFilters}>
              <Pressable
                style={({ pressed }) => [
                  styles.sourceChip,
                  sourceFilter === "all" && styles.sourceChipActive,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
                onPress={() => setSourceFilter("all")}
              >
                <Feather name="globe" size={12} color={sourceFilter === "all" ? Colors.light.text : Colors.light.textSecondary} />
                <ThemedText style={[styles.sourceChipText, sourceFilter === "all" && styles.sourceChipTextActive]}>
                  All Sources
                </ThemedText>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.sourceChip,
                  sourceFilter === "local" && styles.sourceChipActive,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
                onPress={() => setSourceFilter("local")}
              >
                <Feather name="server" size={12} color={sourceFilter === "local" ? Colors.light.text : Colors.light.textSecondary} />
                <ThemedText style={[styles.sourceChipText, sourceFilter === "local" && styles.sourceChipTextActive]}>
                  Local
                </ThemedText>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.sourceChip,
                  sourceFilter === "qobuz" && styles.sourceChipActive,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
                onPress={() => setSourceFilter("qobuz")}
              >
                <ThemedText style={[styles.qobuzIcon, sourceFilter === "qobuz" && styles.qobuzIconActive]}>Q</ThemedText>
                <ThemedText style={[styles.sourceChipText, sourceFilter === "qobuz" && styles.sourceChipTextActive]}>
                  Qobuz
                </ThemedText>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>

      <FlatList
        data={filteredResults}
        renderItem={renderResult}
        keyExtractor={(item) => `${item.type}-${(item.data as any).id}`}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: tabBarHeight + Spacing["5xl"] },
          filteredResults.length === 0 && styles.emptyListContent,
        ]}
        ListEmptyComponent={
          query.length > 0 && !isSearching ? (
            <View style={styles.emptyState}>
              <Feather name="search" size={48} color={Colors.light.textTertiary} />
              <ThemedText style={styles.emptyTitle}>No results found</ThemedText>
              <ThemedText style={styles.emptySubtitle}>
                Try a different search term
              </ThemedText>
            </View>
          ) : query.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="search" size={48} color={Colors.light.textTertiary} />
              <ThemedText style={styles.emptyTitle}>Search your library</ThemedText>
              <ThemedText style={styles.emptySubtitle}>
                Find artists, albums, and tracks
              </ThemedText>
            </View>
          ) : null
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundRoot,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
  },
  searchIcon: {
    marginRight: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    height: Spacing.inputHeight,
    color: Colors.light.text,
    ...Typography.body,
  },
  clearButton: {
    padding: Spacing.sm,
  },
  tabsContainer: {
    flexDirection: "row",
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  tab: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.light.backgroundSecondary,
  },
  tabActive: {
    backgroundColor: Colors.light.accent,
  },
  tabText: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
  },
  tabTextActive: {
    color: Colors.light.text,
    fontWeight: "600",
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  resultImage: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.xs,
  },
  artistPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
  },
  resultInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  resultTitle: {
    ...Typography.headline,
    color: Colors.light.text,
  },
  resultSubtitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  emptyTitle: {
    ...Typography.title,
    color: Colors.light.text,
    textAlign: "center",
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
  sourceFilters: {
    flexDirection: "row",
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  sourceChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 4,
  },
  sourceChipActive: {
    backgroundColor: Colors.light.accentSecondary,
    borderColor: Colors.light.accentSecondary,
  },
  sourceChipText: {
    ...Typography.label,
    color: Colors.light.textSecondary,
  },
  sourceChipTextActive: {
    color: Colors.light.text,
  },
  qobuzIcon: {
    fontSize: 10,
    fontWeight: "700",
    color: Colors.light.textSecondary,
  },
  qobuzIconActive: {
    color: Colors.light.text,
  },
  trackTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  qobuzBadge: {
    backgroundColor: "#F99C38",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  qobuzBadgeText: {
    fontSize: 8,
    fontWeight: "700",
    color: "#000",
  },
  favoriteButton: {
    padding: Spacing.sm,
    marginRight: Spacing.xs,
  },
});
