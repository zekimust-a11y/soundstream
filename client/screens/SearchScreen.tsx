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
import { useNavigation, useFocusEffect, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
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
import { lmsClient } from "@/lib/lmsClient";
import type { SearchStackParamList } from "@/navigation/SearchStackNavigator";

type NavigationProp = NativeStackNavigationProp<SearchStackParamList>;
type FilterTab = "all" | "artists" | "albums" | "tracks";
type SourceFilter = "all" | "local" | "qobuz";

const RECENT_SEARCHES_KEY = "@soundstream_recent_searches";
const MAX_RECENT_SEARCHES = 10;
const SEARCH_DEBOUNCE_MS = 500; // Only save search after user stops typing for 500ms

interface SearchResult {
  type: "artist" | "album" | "track";
  data: Artist | Album | Track;
}

interface RecentSearchItem {
  query: string;
  artwork?: string; // Artwork from first result (album or track)
  type?: "artist" | "album" | "track"; // Type of first result
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  // Search is now shown inside a modal stack ("SearchModal") as well as inside tab flows.
  // `useBottomTabBarHeight()` throws if we're not within a BottomTabNavigator, so guard it.
  let tabBarHeight = 0;
  try {
    tabBarHeight = useBottomTabBarHeight();
  } catch {
    tabBarHeight = 0;
  }
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<SearchStackParamList, "Search">>();
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
  const [recentSearches, setRecentSearches] = useState<RecentSearchItem[]>([]);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const artistThumbCacheRef = useRef<Map<string, string>>(new Map());
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    loadRecentSearches();
    
    // Cleanup debounce timer on unmount
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  // If opened from the global header search, prefill and run search
  useEffect(() => {
    const initial = (route.params as any)?.initialQuery;
    if (typeof initial === "string") {
      const next = initial.trim();
      if (next.length > 0) {
        setQuery(next);
        performSearch(next, sourceFilter, activeTab);
      }
    }
  }, [route.params]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const parsed = JSON.parse(stored);
        // Handle migration from old format (string[]) to new format (RecentSearchItem[])
        if (Array.isArray(parsed) && parsed.length > 0) {
          if (typeof parsed[0] === 'string') {
            // Old format - convert to new format
            setRecentSearches(parsed.map((q: string) => ({ query: q })));
          } else {
            // New format
            setRecentSearches(parsed);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load recent searches:', error);
    }
  };

  const saveRecentSearch = async (searchQuery: string, searchResults?: { artists: Artist[]; albums: Album[]; tracks: Track[] }) => {
    if (searchQuery.length < 2) return;
    
    // Clear any existing debounce timer
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    
    // Debounce: only save after user stops typing
    searchDebounceRef.current = setTimeout(async () => {
      try {
        // Get artwork from first result (prefer album, then track)
        let artwork: string | undefined;
        let resultType: "artist" | "album" | "track" | undefined;
        
        if (searchResults) {
          if (searchResults.albums.length > 0) {
            artwork = searchResults.albums[0].imageUrl;
            resultType = "album";
          } else if (searchResults.tracks.length > 0) {
            artwork = searchResults.tracks[0].albumArt;
            resultType = "track";
          } else if (searchResults.artists.length > 0) {
            artwork = searchResults.artists[0].imageUrl;
            resultType = "artist";
          }
        }
        
        const newItem: RecentSearchItem = {
          query: searchQuery,
          artwork,
          type: resultType,
        };
        
        setRecentSearches(prev => {
          const updated = [
            newItem,
            ...prev.filter(s => s.query !== searchQuery)
          ].slice(0, MAX_RECENT_SEARCHES);
          
          AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated)).catch((error) =>
            console.error("Failed to save recent search:", error)
          );
          return updated;
        });
      } catch (error) {
        console.error("Failed to save recent search:", error);
      }
    }, SEARCH_DEBOUNCE_MS);
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
      setRecentSearches(prev => {
        const updated = prev.filter(s => s.query !== searchQuery);
        AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated)).catch((error) =>
          console.error("Failed to remove recent search:", error)
        );
        return updated;
      });
    } catch (error) {
      console.error("Failed to remove recent search:", error);
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
    const reqId = ++searchRequestIdRef.current;
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
      // Save search with results for artwork
      saveRecentSearch(text, searchResults);

      // Enrich artist thumbnails (non-blocking). Only update if this is still the latest request.
      (async () => {
        try {
          const missing = searchResults.artists
            .filter(a => !a.imageUrl && a.name && a.name !== 'Unknown Artist')
            .slice(0, 12);
          if (missing.length === 0) return;

          const fetched = await Promise.all(
            missing.map(async (a) => {
              const key = a.name.toLowerCase().trim();
              const cached = artistThumbCacheRef.current.get(key);
              if (cached) return { key, url: cached };
              const url = await lmsClient.getArtistImage(a.name);
              if (url) artistThumbCacheRef.current.set(key, url);
              return { key, url };
            })
          );

          const map = new Map(fetched.filter(x => x.url).map(x => [x.key, x.url as string]));
          if (map.size === 0) return;
          if (searchRequestIdRef.current !== reqId) return; // stale

          setResults(prev => ({
            ...prev,
            artists: prev.artists.map(a => {
              if (a.imageUrl) return a;
              const key = a.name.toLowerCase().trim();
              const url = map.get(key);
              return url ? { ...a, imageUrl: url } : a;
            })
          }));
        } catch {
          // ignore thumbnail enrichment failures
        }
      })();
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

  const handleRecentSearchPress = (searchItem: RecentSearchItem) => {
    setQuery(searchItem.query);
    performSearch(searchItem.query, sourceFilter, activeTab);
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
          {artist.imageUrl ? (
            <Image
              source={{ uri: artist.imageUrl }}
              style={styles.artistImage}
              contentFit="cover"
            />
          ) : (
            <View style={styles.artistPlaceholder}>
              <Feather name="user" size={20} color={Colors.light.textTertiary} />
            </View>
          )}
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
        {recentSearches.map((searchItem, index) => (
          <Pressable
            key={`${searchItem.query}-${index}`}
            style={({ pressed }) => [styles.recentItem, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => handleRecentSearchPress(searchItem)}
          >
            {searchItem.artwork ? (
              <Image
                source={searchItem.artwork}
                style={styles.recentArtwork}
                contentFit="cover"
              />
            ) : (
              <View style={styles.recentArtworkPlaceholder}>
                <Feather 
                  name={searchItem.type === "artist" ? "user" : searchItem.type === "album" ? "disc" : "music"} 
                  size={16} 
                  color={Colors.light.textTertiary} 
                />
              </View>
            )}
            <ThemedText style={styles.recentText} numberOfLines={1}>
              {searchItem.query}
            </ThemedText>
            <Pressable
              style={({ pressed }) => [styles.removeButton, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => removeRecentSearch(searchItem.query)}
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
        <Pressable
          style={styles.searchContainer}
          onPress={() => {
            // Focus input when clicking anywhere in search container (especially for web)
            searchInputRef.current?.focus();
          }}
        >
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
            onTouchStart={() => {
              // Ensure input focuses on web when touched/clicked
              if (Platform.OS === 'web') {
                setTimeout(() => searchInputRef.current?.focus(), 0);
              }
            }}
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
          <Pressable
            style={({ pressed }) => [styles.cancelButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => {
              searchInputRef.current?.blur();
              navigation.goBack();
            }}
          >
            <ThemedText style={styles.cancelText}>Cancel</ThemedText>
          </Pressable>
        </Pressable>

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
    marginRight: Spacing.xs,
  },
  cancelButton: {
    paddingVertical: Spacing.xs,
    paddingLeft: Spacing.sm,
  },
  cancelText: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.light.accent,
    fontWeight: "500",
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
  artistImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  artistPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#4A4A4E", // Darker grey to match overlay behind play button
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
  recentArtwork: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.xs,
  },
  recentArtworkPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.xs,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
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
