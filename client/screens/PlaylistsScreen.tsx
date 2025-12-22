import React, { useEffect, useState, useCallback, useRef, memo } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  WithSpringConfig,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { AlbumGridSkeleton, AlbumListSkeleton } from "@/components/SkeletonLoader";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import { useSettings } from "@/hooks/useSettings";
import { lmsClient, type LmsPlaylist, type LmsTrack } from "@/lib/lmsClient";
import type { PlaylistsStackParamList } from "@/navigation/PlaylistsStackNavigator";

const { width } = Dimensions.get("window");
const NUM_COLUMNS = 2;
const GRID_ITEM_SIZE = (width - Spacing.lg * 3) / NUM_COLUMNS;
const TILE_SIZE = GRID_ITEM_SIZE / 2;

type NavigationProp = NativeStackNavigationProp<PlaylistsStackParamList>;
type ViewMode = "grid" | "list";

const VIEW_MODE_KEY = "@playlists_view_mode";
const ARTWORK_CACHE_KEY = "@playlists_artworks";

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
  energyThreshold: 0.001,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PlaylistGridItem = memo(({ 
  item, 
  artworks, 
  onPress, 
  onPlay, 
  onShuffle 
}: { 
  item: LmsPlaylist;
  artworks: string[];
  onPress: () => void;
  onPlay: () => void;
  onShuffle: () => void;
}) => {
  const cardScale = useSharedValue(1);
  const overlayOpacity = useSharedValue(1);
  const shuffleScale = useSharedValue(1);
  const playScale = useSharedValue(1);
  const isQobuz = item.url?.includes('qobuz') || item.name.toLowerCase().includes('qobuz');
  const isSoundCloud = item.url?.includes('soundcloud') || item.name.toLowerCase().includes('soundcloud');

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const shuffleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shuffleScale.value }],
  }));

  const playAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: playScale.value }],
  }));

  return (
    <Animated.View style={[styles.gridItem, cardAnimatedStyle]}>
      <View style={styles.gridImageContainer}>
        <AnimatedPressable
          style={[{ flex: 1 }, cardAnimatedStyle]}
          onPress={onPress}
          onPressIn={() => {
            cardScale.value = withSpring(0.96, springConfig);
            overlayOpacity.value = withSpring(1, springConfig);
          }}
          onPressOut={() => {
            cardScale.value = withSpring(1, springConfig);
          }}
        >
          <PlaylistMosaic artworks={artworks || []} size={GRID_ITEM_SIZE} />
        </AnimatedPressable>
        <Animated.View style={[styles.gridOverlay, overlayAnimatedStyle]} pointerEvents="box-none">
          <AnimatedPressable
            style={[styles.gridOverlayButton, shuffleAnimatedStyle]}
            onPress={(e) => {
              console.log('[PlaylistGridItem] Shuffle button pressed for:', item.name);
              e?.stopPropagation?.();
              onShuffle();
            }}
            onPressIn={(e) => {
              e?.stopPropagation?.();
              shuffleScale.value = withSpring(0.9, springConfig);
            }}
            onPressOut={() => {
              shuffleScale.value = withSpring(1, springConfig);
            }}
            hitSlop={8}
          >
            <Feather name="shuffle" size={18} color="#fff" />
          </AnimatedPressable>
          <AnimatedPressable
            style={[styles.gridOverlayButton, styles.gridPlayButton, playAnimatedStyle]}
            onPress={(e) => {
              console.log('[PlaylistGridItem] Play button pressed for:', item.name);
              e?.stopPropagation?.();
              onPlay();
            }}
            onPressIn={(e) => {
              e?.stopPropagation?.();
              playScale.value = withSpring(0.9, springConfig);
            }}
            onPressOut={() => {
              playScale.value = withSpring(1, springConfig);
            }}
            hitSlop={8}
          >
            <Feather name="play" size={22} color="#fff" style={{ marginLeft: 2 }} />
          </AnimatedPressable>
        </Animated.View>
        {isQobuz ? (
          <View style={styles.gridSourceBadge}>
            <Image
              source={require("../assets/images/qobuz-icon.png")}
              style={styles.gridSourceIcon}
              contentFit="contain"
            />
          </View>
        ) : isSoundCloud ? (
          <View style={styles.gridSourceBadge}>
            <Image
              source={require("../assets/images/soundcloud-icon.png")}
              style={styles.gridSourceIcon}
              contentFit="contain"
            />
          </View>
        ) : null}
      </View>
      <ThemedText style={styles.gridTitle} numberOfLines={2}>
        {item.name.replace(/^(Qobuz|SoundCloud)\s*:?\s*/i, '').trim()}
      </ThemedText>
      {item.trackCount !== undefined ? (
        <ThemedText style={styles.gridSubtitle}>
          {item.trackCount} {item.trackCount === 1 ? "track" : "tracks"}
        </ThemedText>
      ) : null}
    </Animated.View>
  );
});

const PlaylistMosaic = memo(({ artworks, size }: { artworks: string[]; size: number }) => {
  const tileSize = size / 2;
  
  if (artworks.length === 0) {
    return (
      <View style={[styles.mosaicContainer, { width: size, height: size }]}>
        <View style={[
          styles.mosaicPlaceholder, 
          { 
            width: size, 
            height: size,
            backgroundColor: Colors.light.backgroundTertiary,
          }
        ]}>
          <Feather name="music" size={size * 0.3} color={Colors.light.textTertiary} />
        </View>
      </View>
    );
  }
  
  if (artworks.length === 1) {
    return (
      <View style={[styles.mosaicContainer, { width: size, height: size }]}>
        <Image
          source={{ uri: artworks[0] }}
          style={{ width: size, height: size, borderRadius: BorderRadius.sm }}
          contentFit="cover"
        />
      </View>
    );
  }
  
  const tiles = artworks.slice(0, 4);
  while (tiles.length < 4) {
    tiles.push(tiles[tiles.length % artworks.length] || tiles[0]);
  }
  
  return (
    <View style={[styles.mosaicContainer, { width: size, height: size }]}>
      <View style={styles.mosaicRow}>
        <Image
          source={{ uri: tiles[0] }}
          style={[styles.mosaicTile, { width: tileSize, height: tileSize }, styles.mosaicTopLeft]}
          contentFit="cover"
        />
        <Image
          source={{ uri: tiles[1] }}
          style={[styles.mosaicTile, { width: tileSize, height: tileSize }, styles.mosaicTopRight]}
          contentFit="cover"
        />
      </View>
      <View style={styles.mosaicRow}>
        <Image
          source={{ uri: tiles[2] }}
          style={[styles.mosaicTile, { width: tileSize, height: tileSize }, styles.mosaicBottomLeft]}
          contentFit="cover"
        />
        <Image
          source={{ uri: tiles[3] }}
          style={[styles.mosaicTile, { width: tileSize, height: tileSize }, styles.mosaicBottomRight]}
          contentFit="cover"
        />
      </View>
    </View>
  );
});

export default function PlaylistsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const { activeServer } = useMusic();
  const { activePlayer, playPlaylist } = usePlayback();
  const { qobuzEnabled, soundcloudEnabled, spotifyEnabled, tidalEnabled } = useSettings();
  const [playlists, setPlaylists] = useState<LmsPlaylist[]>([]);
  const [playlistArtworks, setPlaylistArtworks] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY).then((mode) => {
      if (mode === "list" || mode === "grid") {
        setViewMode(mode);
      }
    });
    // Load cached artworks immediately
    AsyncStorage.getItem(ARTWORK_CACHE_KEY).then((cached) => {
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          // Only mark playlists with non-empty artwork arrays as loaded
          const validArtworks: Record<string, string[]> = {};
          Object.keys(parsed).forEach(id => {
            if (Array.isArray(parsed[id]) && parsed[id].length > 0) {
              validArtworks[id] = parsed[id];
              loadedArtworksRef.current.add(id);
            }
          });
          setPlaylistArtworks(validArtworks);
        } catch (e) {
          // ignore parse errors
        }
      }
    });
  }, []);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const loadingArtworksRef = useRef<Set<string>>(new Set());
  const loadedArtworksRef = useRef<Set<string>>(new Set());
  
  // Simple hash function to generate consistent "random" selection based on playlist ID
  const hashString = (str: string): number => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  };
  
  // Select 4 random artworks consistently based on playlist ID
  const selectRandomArtworks = (artworks: string[], playlistId: string): string[] => {
    if (artworks.length <= 4) {
      return artworks;
    }
    
    const seed = hashString(playlistId);
    const selected: string[] = [];
    const available = [...artworks];
    
    // Use seeded random selection
    for (let i = 0; i < 4 && available.length > 0; i++) {
      const randomIndex = (seed + i * 7919) % available.length; // 7919 is a prime for better distribution
      selected.push(available[randomIndex]);
      available.splice(randomIndex, 1);
    }
    
    return selected;
  };
  
  const loadPlaylistArtworks = useCallback(async (playlist: LmsPlaylist) => {
    // Skip if already loaded or currently loading (using refs to avoid stale closures)
    if (loadedArtworksRef.current.has(playlist.id) || loadingArtworksRef.current.has(playlist.id)) {
      return;
    }
    
    if (!activeServer) {
      return;
    }
    
    loadingArtworksRef.current.add(playlist.id);
    
    try {
      // Ensure server is set before fetching tracks
      lmsClient.setServer(activeServer.host, activeServer.port);
      console.log(`Loading artworks for playlist: ${playlist.name} (ID: ${playlist.id}, URL: ${playlist.url})`);
      const tracks = await lmsClient.getPlaylistTracks(playlist.id, playlist.url, playlist.name);
      console.log(`Found ${tracks.length} tracks for playlist ${playlist.name}`);
      const uniqueArtworks: string[] = [];
      const seen = new Set<string>();
      
      // Collect all unique artworks and normalize URLs
      for (const track of tracks) {
        // Try multiple ways to get artwork URL
        let artworkUrl = track.artwork_url || (track as any).cover || (track as any).coverart;
        
        if (artworkUrl) {
          // Normalize the artwork URL to ensure it's a full URL
          let normalizedUrl = artworkUrl;
          if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
            // If it's a relative URL, use getArtworkUrl to normalize it
            normalizedUrl = lmsClient.getArtworkUrl(track) || normalizedUrl;
          }
          
          if (normalizedUrl && !seen.has(normalizedUrl)) {
            seen.add(normalizedUrl);
            uniqueArtworks.push(normalizedUrl);
          }
        }
      }
      
      console.log(`Found ${uniqueArtworks.length} unique artworks for playlist ${playlist.name}`);
      
      // Select 4 random artworks consistently based on playlist ID
      const selectedArtworks = selectRandomArtworks(uniqueArtworks, playlist.id);
      console.log(`Selected ${selectedArtworks.length} artworks for playlist ${playlist.name}:`, selectedArtworks);
      
      setPlaylistArtworks(prev => {
        // Double-check it's still not loaded (race condition protection)
        if (prev[playlist.id] !== undefined) {
          return prev;
        }
        loadedArtworksRef.current.add(playlist.id);
        const updated = { ...prev, [playlist.id]: selectedArtworks };
        // Only cache if we have artworks (don't cache empty arrays)
        if (selectedArtworks.length > 0) {
          AsyncStorage.setItem(ARTWORK_CACHE_KEY, JSON.stringify(updated)).catch(() => {});
        }
        return updated;
      });
    } catch (error) {
      console.error(`Failed to load playlist artworks for ${playlist.name}:`, error);
      // Don't set empty array and don't mark as loaded - allow retry
      // The error might be transient (network issue, etc.)
    } finally {
      loadingArtworksRef.current.delete(playlist.id);
    }
  }, [activeServer]);

  const loadPlaylists = useCallback(async () => {
    if (!activeServer) {
      console.log('[Playlists] No active server');
      setPlaylists([]);
      return;
    }
    
    try {
      console.log('[Playlists] Loading playlists from server:', activeServer.host, activeServer.port);
      lmsClient.setServer(activeServer.host, activeServer.port);
      const fetchedPlaylists = await lmsClient.getPlaylists();
      console.log('[Playlists] Fetched playlists:', fetchedPlaylists.length);
      
      // Filter out Qobuz, SoundCloud, Spotify, and Tidal playlists if disabled
      const filteredPlaylists = fetchedPlaylists.filter(playlist => {
        const name = playlist.name.toLowerCase();
        const url = (playlist.url || '').toLowerCase();
        const isQobuz = name.includes('qobuz:') || name.startsWith('qobuz') || url.includes('qobuz');
        const isSoundCloud = name.includes('soundcloud:') || name.startsWith('soundcloud') || url.includes('soundcloud');
        const isSpotify = name.includes('spotify:') || name.startsWith('spotify') || url.includes('spotify');
        const isTidal = name.includes('tidal:') || name.startsWith('tidal') || url.includes('tidal');
        
        if (isQobuz && !qobuzEnabled) return false;
        if (isSoundCloud && !soundcloudEnabled) return false;
        if (isSpotify && !spotifyEnabled) return false;
        if (isTidal && !tidalEnabled) return false;
        return true;
      });
      
      console.log('[Playlists] Filtered playlists:', filteredPlaylists.length);
      setPlaylists(filteredPlaylists);
      
      // Load artworks for first 20 playlists
      // The loadPlaylistArtworks function will check if already loaded/loading internally
      // Use a small delay between requests to avoid overwhelming the server
      filteredPlaylists.slice(0, 20).forEach((playlist, index) => {
        // Stagger the requests to avoid overwhelming the server
        setTimeout(() => {
          loadPlaylistArtworks(playlist);
        }, index * 100); // 100ms delay between each request
      });
    } catch (error) {
      console.error("[Playlists] Failed to load playlists:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Playlists] Error details:", errorMessage);
      // Set empty array on error so UI shows empty state
      setPlaylists([]);
    }
  }, [activeServer, loadPlaylistArtworks, qobuzEnabled, soundcloudEnabled, spotifyEnabled, tidalEnabled]);

  useEffect(() => {
    if (activeServer) {
      setIsLoading(true);
      loadPlaylists().finally(() => setIsLoading(false));
    } else {
      setPlaylists([]);
      setPlaylistArtworks({});
    }
  }, [activeServer, loadPlaylists]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadPlaylists();
    setIsRefreshing(false);
  };

  const handlePlayPlaylist = async (playlist: LmsPlaylist) => {
    console.log('[Playlists] PLAY button clicked for playlist:', playlist.name, playlist.id);
    if (!activePlayer) {
      console.log('[Playlists] No active player');
      return;
    }
    if (!activeServer) {
      console.log('[Playlists] No active server');
      return;
    }
    // Ensure server is set in lmsClient
    lmsClient.setServer(activeServer.host, activeServer.port);
    console.log('Playing playlist:', playlist.id);
    try {
      // Get playlist artwork if available
      const artworks = playlistArtworks[playlist.id] || [];
      const artwork = artworks.length > 0 ? artworks[0] : undefined;
      const playlistName = playlist.name.replace(/^(Qobuz|SoundCloud)\s*:?\s*/i, '').trim();
      await playPlaylist(playlist.id, playlistName, artwork);
    } catch (error) {
      console.error('Failed to play playlist:', error);
    }
  };

  const handleShufflePlaylist = async (playlist: LmsPlaylist) => {
    console.log('[Playlists] SHUFFLE button clicked for playlist:', playlist.name, playlist.id);
    if (!activePlayer) {
      console.log('[Playlists] No active player');
      return;
    }
    if (!activeServer) {
      console.log('[Playlists] No active server');
      return;
    }
    if (!activeServer.connected) {
      console.log('[Playlists] Server is not connected');
      return;
    }
    
    try {
      // Ensure server is set in lmsClient
      lmsClient.setServer(activeServer.host, activeServer.port);
      console.log('Shuffling playlist:', playlist.id);
      
      // Set shuffle mode first
      await lmsClient.setShuffle(activePlayer.id, 1);
      
      // Get playlist artwork if available
      const artworks = playlistArtworks[playlist.id] || [];
      const artwork = artworks.length > 0 ? artworks[0] : undefined;
      const playlistName = playlist.name.replace(/^(Qobuz|SoundCloud)\s*:?\s*/i, '').trim();
      
      // Then play the playlist
      await playPlaylist(playlist.id, playlistName, artwork);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Failed to shuffle playlist:', errorMessage);
      // Don't show error screen for network errors - they're expected when server is offline
      if (!errorMessage.includes('Network request failed') && 
          !errorMessage.includes('Failed to fetch')) {
        // Only log non-network errors as actual errors
        console.error('Shuffle playlist error:', error);
      }
    }
  };

  const handleOpenPlaylist = (playlist: LmsPlaylist) => {
    navigation.navigate("PlaylistDetail", { playlist });
  };

  const renderGridItem = ({ item }: { item: LmsPlaylist }) => {
    const artworks = playlistArtworks[item.id];
    
    // Load artworks if not loaded yet (undefined) or if empty and not currently loading/loaded
    const shouldLoad = artworks === undefined || 
      (artworks.length === 0 && 
       !loadingArtworksRef.current.has(item.id) && 
       !loadedArtworksRef.current.has(item.id));
    
    if (shouldLoad) {
      loadPlaylistArtworks(item);
    }
    
    // Use loaded artworks if available, otherwise fallback to playlist's own artwork
    let displayArtworks = artworks || [];
    if (displayArtworks.length === 0 && item.artwork_url) {
      displayArtworks = [item.artwork_url];
    }
    
    return (
      <PlaylistGridItem
        item={item}
        artworks={displayArtworks}
        onPress={() => handleOpenPlaylist(item)}
        onPlay={() => handlePlayPlaylist(item)}
        onShuffle={() => handleShufflePlaylist(item)}
      />
    );
  };

  const renderListItem = ({ item }: { item: LmsPlaylist }) => (
    <View style={styles.listRow}>
      <Pressable
        style={({ pressed }) => [
          styles.listMainArea,
          { opacity: pressed ? 0.6 : 1 },
        ]}
        onPress={() => handleOpenPlaylist(item)}
      >
        <View style={styles.listInfo}>
          <View style={styles.listNameRow}>
            {item.url?.includes('qobuz') || item.name.toLowerCase().includes('qobuz') ? (
              <View style={styles.listSourceBadge}>
                <Image
                  source={require("../assets/images/qobuz-icon.png")}
                  style={styles.listSourceIcon}
                  contentFit="contain"
                />
              </View>
            ) : item.url?.includes('soundcloud') || item.name.toLowerCase().includes('soundcloud') ? (
              <View style={styles.listSourceBadge}>
                <Image
                  source={require("../assets/images/soundcloud-icon.png")}
                  style={styles.listSourceIcon}
                  contentFit="contain"
                />
              </View>
            ) : null}
            <ThemedText style={styles.listName} numberOfLines={1}>
              {item.name.replace(/^(Qobuz|SoundCloud)\s*:?\s*/i, '').trim()}
            </ThemedText>
          </View>
          {item.trackCount !== undefined ? (
            <ThemedText style={styles.listTracks}>
              {item.trackCount} {item.trackCount === 1 ? "track" : "tracks"}
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
      <View style={styles.listActions}>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          onPress={() => handleShufflePlaylist(item)}
        >
          <Feather name="shuffle" size={20} color={Colors.light.accent} />
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          onPress={() => handlePlayPlaylist(item)}
        >
          <Feather name="play-circle" size={22} color={Colors.light.accent} />
        </Pressable>
      </View>
    </View>
  );

  const renderEmptyState = () => {
    if (isLoading) {
      return null; // Skeleton will be shown instead
    }

    if (!activeServer) {
      return (
        <View style={styles.emptyState}>
          <Feather name="server" size={48} color={Colors.light.textTertiary} />
          <ThemedText style={styles.emptyTitle}>No server connected</ThemedText>
          <ThemedText style={styles.emptySubtitle}>
            Connect to your LMS server in Settings
          </ThemedText>
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <Feather name="list" size={48} color={Colors.light.textTertiary} />
        <ThemedText style={styles.emptyTitle}>No playlists found</ThemedText>
        <ThemedText style={styles.emptySubtitle}>
          {activeServer 
            ? "Pull down to refresh or create playlists in your LMS"
            : "Connect to an LMS server to see playlists"
          }
        </ThemedText>
        {activeServer && (
          <Pressable
            style={({ pressed }) => [
              styles.emptyRefreshButton,
              { opacity: pressed ? 0.7 : 1 }
            ]}
            onPress={handleRefresh}
          >
            <Feather name="refresh-cw" size={18} color={Colors.light.accent} />
            <ThemedText style={[styles.emptyRefreshButtonText, { color: Colors.light.accent }]}>
              Refresh Playlists
            </ThemedText>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <ThemedText style={styles.headerTitle}>Playlists</ThemedText>
        <View style={styles.viewToggle}>
          <Pressable
            style={[
              styles.toggleButton,
              viewMode === "grid" && styles.toggleButtonActive,
            ]}
            onPress={() => handleViewModeChange("grid")}
          >
            <Feather
              name="grid"
              size={18}
              color={viewMode === "grid" ? Colors.light.accent : Colors.light.textSecondary}
            />
          </Pressable>
          <Pressable
            style={[
              styles.toggleButton,
              viewMode === "list" && styles.toggleButtonActive,
            ]}
            onPress={() => handleViewModeChange("list")}
          >
            <Feather
              name="list"
              size={18}
              color={viewMode === "list" ? Colors.light.accent : Colors.light.textSecondary}
            />
          </Pressable>
        </View>
      </View>

      {isLoading && playlists.length === 0 ? (
        viewMode === "grid" ? (
          <AlbumGridSkeleton />
        ) : (
          <AlbumListSkeleton />
        )
      ) : viewMode === "grid" ? (
        <FlatList
          key="grid"
          data={playlists}
          renderItem={renderGridItem}
          keyExtractor={(item) => item.id}
          numColumns={NUM_COLUMNS}
          contentContainerStyle={[
            styles.gridContent,
            { paddingBottom: tabBarHeight + Spacing["5xl"] },
            playlists.length === 0 && styles.emptyListContent,
          ]}
          columnWrapperStyle={styles.gridRow}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.light.accent}
            />
          }
        />
      ) : (
        <FlatList
          key="list"
          data={playlists}
          renderItem={renderListItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: tabBarHeight + Spacing["5xl"] },
            playlists.length === 0 && styles.emptyListContent,
          ]}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.light.accent}
            />
          }
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundRoot,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  headerTitle: {
    fontSize: 22.4, // 30% smaller than Typography.display (32px * 0.7)
    fontWeight: "700",
    color: Colors.light.text,
    textAlign: "left",
    alignSelf: "flex-start",
  },
  viewToggle: {
    flexDirection: "row",
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    padding: 2,
  },
  toggleButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
  },
  toggleButtonActive: {
    backgroundColor: Colors.light.backgroundDefault,
  },
  gridContent: {
    paddingHorizontal: Spacing.lg,
  },
  gridRow: {
    gap: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  gridItem: {
    width: GRID_ITEM_SIZE,
  },
  gridImageContainer: {
    position: "relative",
    marginBottom: Spacing.sm,
    ...Shadows.small,
  },
  gridOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    backgroundColor: "transparent",
    borderRadius: BorderRadius.sm,
    pointerEvents: "box-none",
    zIndex: 1,
  },
  gridOverlayButton: {
    pointerEvents: "auto",
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  gridPlayButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  mosaicContainer: {
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  mosaicRow: {
    flexDirection: "row",
  },
  mosaicTile: {
  },
  mosaicTopLeft: {
    borderTopLeftRadius: BorderRadius.sm,
  },
  mosaicTopRight: {
    borderTopRightRadius: BorderRadius.sm,
  },
  mosaicBottomLeft: {
    borderBottomLeftRadius: BorderRadius.sm,
  },
  mosaicBottomRight: {
    borderBottomRightRadius: BorderRadius.sm,
  },
  mosaicPlaceholder: {
    backgroundColor: Colors.light.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.sm,
  },
  gridSourceBadge: {
    position: "absolute",
    bottom: Spacing.sm,
    left: Spacing.sm,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderRadius: 4,
    padding: 2,
  },
  gridSourceIcon: {
    width: 20,
    height: 20,
  },
  gridTitle: {
    ...Typography.body,
    color: Colors.light.text,
    fontWeight: "500",
  },
  gridSubtitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  emptyRefreshButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.light.accent,
    gap: Spacing.sm,
  },
  emptyRefreshButtonText: {
    ...Typography.body,
    fontWeight: "500",
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  listMainArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  listInfo: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  listNameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  listName: {
    ...Typography.body,
    color: Colors.light.text,
    flexShrink: 1,
  },
  listSourceBadge: {
    width: 20,
    height: 20,
    marginRight: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderRadius: 3,
    padding: 2,
  },
  listSourceIcon: {
    width: 16,
    height: 16,
  },
  listTracks: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  listActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  actionButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
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
    marginTop: Spacing.sm,
  },
});
