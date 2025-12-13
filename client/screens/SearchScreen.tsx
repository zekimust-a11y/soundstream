import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  FlatList,
  Pressable,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { SourceBadge } from "@/components/SourceBadge";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic, type Artist, type Album } from "@/hooks/useMusic";
import { usePlayback, type Track } from "@/hooks/usePlayback";
import type { SearchStackParamList } from "@/navigation/SearchStackNavigator";

type NavigationProp = NativeStackNavigationProp<SearchStackParamList>;
type FilterTab = "all" | "artists" | "albums" | "tracks";
type SourceFilter = "all" | "local" | "qobuz";

const RECENT_SEARCHES_KEY = "@soundstream_recent_searches";
const MAX_RECENT_SEARCHES = 10;

interface SearchResult {
  type: "artist" | "album" | "track";
  data: Artist | Album | Track;
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const searchInputRef = useRef<TextInput>(null);
  const { searchMusic, addToRecentlyPlayed, isFavoriteTrack, toggleFavoriteTrack, activeServer } = useMusic();
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
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    loadRecentSearches();
  }, []);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }, [])
  );

  const loadRecentSearches = async () => {
    try {
      const stored = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load recent searches:', error);
    }
  };

  const saveRecentSearch = async (searchQuery: string) => {
    if (searchQuery.length < 2) return;
    try {
      const updated = [searchQuery, ...recentSearches.filter(s => s !== searchQuery)].slice(0, MAX_RECENT_SEARCHES);
      setRecentSearches(updated);
      await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to save recent search:', error);
    }
  };

  const clearRecentSearches = async () => {
    try {
      setRecentSearches([]);
      await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch (error) {
      console.error('Failed to clear recent searches:', error);
    }
  };

  const removeRecentSearch = async (searchQuery: string) => {
    try {
      const updated = recentSearches.filter(s => s !== searchQuery);
      setRecentSearches(updated);
      await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to remove recent search:', error);
    }
  };

  const performSearch = useCallback(async (text: string, source: SourceFilter, type: FilterTab) => {
    if (text.length < 2) {
      setResults({ artists: [], albums: [], tracks: [] });
      return;
    }
    
    // Check if server is offline
    if (!activeServer || (activeServer && !activeServer.connected)) {
      setResults({ artists: [], albums: [], tracks: [] });
      setIsSearching(false);
      return;
    }
    
    setIsSearching(true);
    try {
      console.log('Performing search:', { 
        text, 
        source, 
        type, 
        hasServer: !!activeServer,
        serverHost: activeServer?.host,
        serverPort: activeServer?.port,
        serverConnected: activeServer?.connected
      });
      
      if (!activeServer || !activeServer.connected) {
        console.warn('Server not connected, cannot search');
        setResults({ artists: [], albums: [], tracks: [] });
        return;
      }
      
      const searchResults = await searchMusic(text, { source, type });
      console.log('Search results received:', { 
        artists: searchResults.artists.length, 
        albums: searchResults.albums.length, 
        tracks: searchResults.tracks.length,
        sampleArtists: searchResults.artists.slice(0, 3).map(a => a.name),
        sampleAlbums: searchResults.albums.slice(0, 3).map(a => a.name),
        sampleTracks: searchResults.tracks.slice(0, 3).map(t => t.title)
      });
      setResults(searchResults);
      saveRecentSearch(text);
    } catch (error) {
      console.error('Search failed:', error);
      if (error instanceof Error) {
        console.error('Search error details:', error.message, error.stack);
      }
      setResults({ artists: [], albums: [], tracks: [] });
    } finally {
      setIsSearching(false);
    }
  }, [searchMusic, activeServer]);

  const handleSearch = useCallback(async (text: string) => {
    setQuery(text);
    performSearch(text, sourceFilter, activeTab);
  }, [performSearch, sourceFilter, activeTab]);

  const handleRecentSearchPress = (searchText: string) => {
    setQuery(searchText);
    performSearch(searchText, sourceFilter, activeTab);
  };

  useEffect(() => {
    if (query.length >= 2) {
      performSearch(query, sourceFilter, activeTab);
    } else {
      setResults({ artists: [], albums: [], tracks: [] });
    }
  }, [sourceFilter, activeTab, query, performSearch]);

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
          <View style={styles.resultImageContainer}>
            <Image
              source={album.imageUrl || require("../assets/images/placeholder-album.png")}
              style={styles.resultImage}
              contentFit="cover"
            />
            <SourceBadge source={album.source} size={18} />
          </View>
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

  const renderRecentSearches = () => {
    if (recentSearches.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Feather name="search" size={48} color={Colors.light.textTertiary} />
          <ThemedText style={styles.emptyTitle}>Search your library</ThemedText>
          <ThemedText style={styles.emptySubtitle}>
            Find artists, albums, and tracks
          </ThemedText>
        </View>
      );
    }

    return (
      <View style={styles.recentContainer}>
        <View style={styles.recentHeader}>
          <ThemedText style={styles.recentTitle}>Recent Searches</ThemedText>
          <Pressable
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
            onPress={clearRecentSearches}
          >
            <ThemedText style={styles.clearText}>Clear</ThemedText>
          </Pressable>
        </View>
        {recentSearches.map((search, index) => (
          <Pressable
            key={`${search}-${index}`}
            style={({ pressed }) => [styles.recentItem, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => handleRecentSearchPress(search)}
          >
            <Feather name="clock" size={16} color={Colors.light.textTertiary} />
            <ThemedText style={styles.recentText} numberOfLines={1}>
              {search}
            </ThemedText>
            <Pressable
              style={({ pressed }) => [styles.removeButton, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => removeRecentSearch(search)}
            >
              <Feather name="x" size={16} color={Colors.light.textTertiary} />
            </Pressable>
          </Pressable>
        ))}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <View style={[styles.header, { paddingTop: insets.top + Spacing.md }]}>
          <View style={styles.searchContainer}>
            <Feather name="search" size={20} color={Colors.light.textSecondary} style={styles.searchIcon} />
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              placeholder="Search your library..."
              placeholderTextColor={Colors.light.textTertiary}
              value={query}
              onChangeText={handleSearch}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              blurOnSubmit={false}
            />
            {query.length > 0 ? (
              <Pressable
                style={({ pressed }) => [styles.clearButton, { opacity: pressed ? 0.6 : 1 }]}
                onPress={() => {
                  setQuery("");
                  setResults({ artists: [], albums: [], tracks: [] });
                  searchInputRef.current?.blur();
                }}
              >
                <Feather name="x" size={18} color={Colors.light.textSecondary} />
              </Pressable>
            ) : null}
          </View>

          {query.length > 0 && (!activeServer || (activeServer && !activeServer.connected)) ? (
            <View style={styles.offlineMessage}>
              <Feather name="wifi-off" size={16} color={Colors.light.error} />
              <ThemedText style={styles.offlineText}>Server is offline. Please connect to a server in Settings.</ThemedText>
            </View>
          ) : null}
          
          {query.length > 0 ? (
            <View style={styles.filtersRow}>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabsContainer}
              >
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
              </ScrollView>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.sourceFilters}
              >
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
                    All
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
              </ScrollView>
            </View>
          ) : null}
        </View>

        {query.length === 0 ? (
          <ScrollView
            style={styles.recentWrapper}
            contentContainerStyle={[styles.recentContent, { paddingBottom: tabBarHeight + Spacing.xl }]}
            keyboardShouldPersistTaps="handled"
          >
            {renderRecentSearches()}
          </ScrollView>
        ) : (
          <FlatList
            data={filteredResults}
            renderItem={renderResult}
            keyExtractor={(item) => `${item.type}-${(item.data as any).id}`}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: tabBarHeight + Spacing.xl },
              filteredResults.length === 0 && styles.emptyListContent,
            ]}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              !isSearching ? (
                <View style={styles.emptyState}>
                  {!activeServer || (activeServer && !activeServer.connected) ? (
                    <>
                      <Feather name="wifi-off" size={48} color={Colors.light.error} />
                      <ThemedText style={styles.emptyTitle}>Server Offline</ThemedText>
                      <ThemedText style={styles.emptySubtitle}>
                        Please connect to a server in Settings to search
                      </ThemedText>
                    </>
                  ) : (
                    <>
                      <Feather name="search" size={48} color={Colors.light.textTertiary} />
                      <ThemedText style={styles.emptyTitle}>No results found</ThemedText>
                      <ThemedText style={styles.emptySubtitle}>
                        Try a different search term
                      </ThemedText>
                    </>
                  )}
                </View>
              ) : null
            }
          />
        )}
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundRoot,
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.light.backgroundRoot,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    height: 44,
    marginBottom: Spacing.sm,
  },
  searchIcon: {
    marginRight: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    height: 44,
    color: Colors.light.text,
    ...Typography.body,
    fontSize: 16,
  },
  clearButton: {
    padding: Spacing.sm,
  },
  filtersRow: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  tabsContainer: {
    flexDirection: "row",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  tab: {
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.light.backgroundSecondary,
    marginRight: Spacing.xs,
  },
  tabActive: {
    backgroundColor: "#000",
  },
  tabText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.light.textSecondary,
    fontWeight: "500",
  },
  tabTextActive: {
    color: "#FFF",
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
  resultImageContainer: {
    position: "relative",
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
    paddingTop: Spacing["3xl"],
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
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
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
  recentWrapper: {
    flex: 1,
  },
  recentContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  recentContainer: {
    flex: 1,
    paddingTop: Spacing.md,
  },
  recentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  recentTitle: {
    ...Typography.headline,
    color: Colors.light.text,
  },
  clearText: {
    ...Typography.caption,
    color: Colors.light.accent,
  },
  recentItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
    gap: Spacing.md,
  },
  recentText: {
    flex: 1,
    ...Typography.body,
    color: Colors.light.text,
  },
  removeButton: {
    padding: Spacing.xs,
  },
  offlineMessage: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    backgroundColor: Colors.light.error + "15",
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.sm,
  },
  offlineText: {
    flex: 1,
    ...Typography.caption,
    color: Colors.light.error,
    fontSize: 13,
  },
});
