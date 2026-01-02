import React, { useEffect, useState, useCallback, useRef, memo, useMemo } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Platform,
  useWindowDimensions,
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
import { AppHeader } from "@/components/AppHeader";
import { LibraryToolbar, type SourceFilter } from "@/components/LibraryToolbar";
import { AlbumArtwork } from "@/components/AlbumArtwork";
import { Colors, Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { AlbumGridSkeleton, AlbumListSkeleton } from "@/components/SkeletonLoader";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import { useSettings } from "@/hooks/useSettings";
import { lmsClient, type LmsPlaylist, type LmsTrack } from "@/lib/lmsClient";
import type { PlaylistsStackParamList } from "@/navigation/PlaylistsStackNavigator";
import { useTheme } from "@/hooks/useTheme";

type NavigationProp = NativeStackNavigationProp<PlaylistsStackParamList>;
type ViewMode = "grid" | "list";
type SortKey = "name_az" | "tracks_desc";

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
  size,
  onPress, 
  onPlay, 
  onShuffle 
}: { 
  item: LmsPlaylist;
  artworks: string[];
  size: number;
  onPress: () => void;
  onPlay: () => void;
  onShuffle: () => void;
}) => {
  const cardScale = useSharedValue(1);
  const overlayOpacity = useSharedValue(1);
  const shuffleScale = useSharedValue(1);
  const playScale = useSharedValue(1);
  const isSoundCloud = (item.url || '').includes('soundcloud') || item.name.toLowerCase().includes('soundcloud');
  const isTidal = (item.url || '').includes('tidal') || (item.id && String(item.id).startsWith('tidal-')) || item.name.toLowerCase().includes('tidal');
  const isSpotify = (item.url || '').includes('spotify') || item.name.toLowerCase().includes('spotify');

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
    <Animated.View style={[styles.gridItem, { width: size }, cardAnimatedStyle]}>
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
          <PlaylistMosaic artworks={artworks || []} size={size} />
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
        {isSoundCloud ? (
          <View style={styles.gridSourceBadge}>
            <Image
              source={require("../assets/images/soundcloud-icon.png")}
              style={styles.gridSourceIcon}
              contentFit="contain"
            />
          </View>
        ) : isTidal ? (
          <View style={styles.gridSourceBadge}>
            <Image
              source={require("../assets/images/tidal-icon.png")}
              style={styles.gridSourceIcon}
              contentFit="contain"
            />
          </View>
        ) : null}
      </View>
      <ThemedText style={styles.gridTitle} numberOfLines={2}>
        {item.name.replace(/^(SoundCloud|Tidal)\s*:?\s*/i, '').trim()}
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
        <AlbumArtwork
          source={artworks[0]}
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
        <AlbumArtwork
          source={tiles[0]}
          style={[styles.mosaicTile, { width: tileSize, height: tileSize }, styles.mosaicTopLeft]}
          contentFit="cover"
        />
        <AlbumArtwork
          source={tiles[1]}
          style={[styles.mosaicTile, { width: tileSize, height: tileSize }, styles.mosaicTopRight]}
          contentFit="cover"
        />
      </View>
      <View style={styles.mosaicRow}>
        <AlbumArtwork
          source={tiles[2]}
          style={[styles.mosaicTile, { width: tileSize, height: tileSize }, styles.mosaicBottomLeft]}
          contentFit="cover"
        />
        <AlbumArtwork
          source={tiles[3]}
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
  const { width: windowWidth } = useWindowDimensions();
  const { 
    playlists: contextPlaylists, 
    activeServer, 
    refreshLibrary,
    isLoading: musicLoading 
  } = useMusic();
  const { activePlayer, playPlaylist } = usePlayback();
  const {  soundcloudEnabled, spotifyEnabled, tidalEnabled } = useSettings();
  const { theme } = useTheme();
  
  const [playlistArtworks, setPlaylistArtworks] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortKey, setSortKey] = useState<SortKey>("name_az");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const loadingArtworksRef = useRef<Set<string>>(new Set());
  const loadedArtworksRef = useRef<Set<string>>(new Set());

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

  const playlistSource = useCallback((p: LmsPlaylist): Exclude<SourceFilter, "all"> => {
    const name = String(p.name || "").toLowerCase();
    const url = String((p as any).url || "").toLowerCase();
    const id = String(p.id || "").toLowerCase();
    if (url.includes("soundcloud") || name.includes("soundcloud") || id.includes("soundcloud")) return "soundcloud";
    if (url.includes("tidal") || name.includes("tidal") || id.startsWith("tidal-") || id.includes("tidal")) return "tidal";
    return "local";
  }, []);

  const filteredPlaylists = useMemo(() => {
    let result = contextPlaylists.slice();

    // Respect integration toggles
    result = result.filter((p) => {
      const src = playlistSource(p);
      if (src === "tidal" && !tidalEnabled) return false;
      if (src === "soundcloud" && !soundcloudEnabled) return false;
      return true;
    });

    if (sourceFilter !== "all") {
      result = result.filter((p) => playlistSource(p) === sourceFilter);
    }

    if (sortKey === "name_az") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortKey === "tracks_desc") {
      result.sort((a, b) => (Number(b.trackCount || 0) - Number(a.trackCount || 0)));
    }
    return result;
  }, [contextPlaylists, playlistSource, sourceFilter, sortKey, tidalEnabled, soundcloudEnabled]);

  const gridLayout = useMemo(() => {
    const padding = Spacing.lg;
    const gap = Spacing.lg;
    const available = Math.max(0, windowWidth - padding * 2);

    // Preserve mobile feel; scale up on desktop web.
    if (Platform.OS !== "web") {
      const cols = 2;
      const size = Math.floor((available - gap * (cols - 1)) / cols);
      return { numColumns: cols, itemSize: Math.max(160, size) };
    }

    // +16% bigger tiles on large screens
    const min = 245;
    const max = 395;
    let cols = Math.max(2, Math.min(8, Math.floor((available + gap) / (min + gap)) || 2));
    let size = (available - gap * (cols - 1)) / cols;
    while (size > max && cols < 8) {
      cols += 1;
      size = (available - gap * (cols - 1)) / cols;
    }
    return { numColumns: cols, itemSize: Math.floor(Math.max(min, Math.min(max, size))) };
  }, [windowWidth]);

  const hashString = (str: string): number => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  };
  
  const selectRandomArtworks = (artworks: string[], playlistId: string): string[] => {
    if (artworks.length <= 4) return artworks;
    const seed = hashString(playlistId);
    const selected: string[] = [];
    const available = [...artworks];
    for (let i = 0; i < 4 && available.length > 0; i++) {
      const randomIndex = (seed + i * 7919) % available.length;
      selected.push(available[randomIndex]);
      available.splice(randomIndex, 1);
    }
    return selected;
  };
  
  const loadPlaylistArtworks = useCallback(async (playlist: LmsPlaylist) => {
    if (loadedArtworksRef.current.has(playlist.id) || loadingArtworksRef.current.has(playlist.id)) return;
    if (!activeServer) return;
    
    loadingArtworksRef.current.add(playlist.id);
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      const tracks = await lmsClient.getPlaylistTracks(playlist.id, playlist.url, playlist.name);
      const uniqueArtworks: string[] = [];
      const seen = new Set<string>();
      
      for (const track of tracks) {
        let artworkUrl = track.artwork_url || (track as any).cover || (track as any).coverart;
        if (artworkUrl) {
          let normalizedUrl = artworkUrl;
          if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
            normalizedUrl = lmsClient.getArtworkUrl(track) || normalizedUrl;
          }
          if (normalizedUrl && !seen.has(normalizedUrl)) {
            seen.add(normalizedUrl);
            uniqueArtworks.push(normalizedUrl);
          }
        }
      }
      
      const selectedArtworks = selectRandomArtworks(uniqueArtworks, playlist.id);
      setPlaylistArtworks(prev => {
        if (prev[playlist.id] !== undefined) return prev;
        loadedArtworksRef.current.add(playlist.id);
        const updated = { ...prev, [playlist.id]: selectedArtworks };
        if (selectedArtworks.length > 0) {
          AsyncStorage.setItem(ARTWORK_CACHE_KEY, JSON.stringify(updated)).catch(() => {});
        }
        return updated;
      });
    } catch (error) {
      console.error(`Failed to load playlist artworks for ${playlist.name}:`, error);
    } finally {
      loadingArtworksRef.current.delete(playlist.id);
    }
  }, [activeServer]);

  const loadPlaylists = useCallback(async () => {
    if (!activeServer) return;
    refreshLibrary();
  }, [activeServer, refreshLibrary]);

  useEffect(() => {
    if (activeServer && contextPlaylists.length === 0 && !musicLoading) {
      setIsLoading(true);
      loadPlaylists().finally(() => setIsLoading(false));
    }
  }, [activeServer, contextPlaylists.length, musicLoading, loadPlaylists]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadPlaylists();
    setIsRefreshing(false);
  };

  const handlePlayPlaylist = async (playlist: LmsPlaylist) => {
    if (!activePlayer || !activeServer) return;
    lmsClient.setServer(activeServer.host, activeServer.port);
    try {
      const artworks = playlistArtworks[playlist.id] || [];
      const artwork = artworks.length > 0 ? artworks[0] : undefined;
      const playlistName = playlist.name.replace(/^(SoundCloud|Tidal)\s*:?\s*/i, '').trim();
      await playPlaylist(playlist.id, playlistName, artwork);
    } catch (error) {
      console.error('Failed to play playlist:', error);
    }
  };

  const handleShufflePlaylist = async (playlist: LmsPlaylist) => {
    if (!activePlayer || !activeServer || !activeServer.connected) return;
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      await lmsClient.setShuffle(activePlayer.id, 1);
      const artworks = playlistArtworks[playlist.id] || [];
      const artwork = artworks.length > 0 ? artworks[0] : undefined;
      const playlistName = playlist.name.replace(/^(SoundCloud|Tidal)\s*:?\s*/i, '').trim();
      await playPlaylist(playlist.id, playlistName, artwork);
    } catch (error) {
      console.error('Failed to shuffle playlist:', error);
    }
  };

  const handleOpenPlaylist = (playlist: LmsPlaylist) => {
    navigation.navigate("PlaylistDetail", { playlist });
  };

  const renderGridItem = ({ item }: { item: LmsPlaylist }) => {
    const artworks = playlistArtworks[item.id];
    if (artworks === undefined && !loadingArtworksRef.current.has(item.id) && !loadedArtworksRef.current.has(item.id)) {
      loadPlaylistArtworks(item);
    }
    let displayArtworks = artworks || [];
    // Fallback to playlist-level artwork if present (avoids empty mosaics).
    const playlistArtwork = (item as any).artwork || item.artwork_url;
    if (displayArtworks.length === 0 && playlistArtwork) displayArtworks = [String(playlistArtwork)];
    return (
      <PlaylistGridItem
        item={item}
        artworks={displayArtworks}
        size={gridLayout.itemSize}
        onPress={() => handleOpenPlaylist(item)}
        onPlay={() => handlePlayPlaylist(item)}
        onShuffle={() => handleShufflePlaylist(item)}
      />
    );
  };

  const renderListItem = ({ item }: { item: LmsPlaylist }) => {
    const artworks = playlistArtworks[item.id] || [];
    const playlistArtwork = (item as any).artwork || item.artwork_url;
    const thumb = artworks[0] || (playlistArtwork ? String(playlistArtwork) : undefined);
    const isSoundCloud = (item.url || '').includes('soundcloud') || item.name.toLowerCase().includes('soundcloud');
    const isTidal = (item.url || '').includes('tidal') || (item.id && String(item.id).startsWith('tidal-')) || item.name.toLowerCase().includes('tidal');
    return (
    <View style={styles.listRow}>
      <Pressable
        style={({ pressed }) => [styles.listMainArea, { opacity: pressed ? 0.6 : 1 }]}
        onPress={() => handleOpenPlaylist(item)}
      >
        <View style={styles.listThumb}>
          <AlbumArtwork
            source={thumb}
            style={styles.listThumbImage}
            contentFit="cover"
          />
        </View>
        <View style={styles.listInfo}>
          <View style={styles.listNameRow}>
            {isSoundCloud ? (
              <View style={styles.listSourceBadge}>
                <Image
                  source={require("../assets/images/soundcloud-icon.png")}
                  style={styles.listSourceIcon}
                  contentFit="contain"
                />
              </View>
            ) : isTidal ? (
              <View style={styles.listSourceBadge}>
                <Image
                  source={require("../assets/images/tidal-icon.png")}
                  style={styles.listSourceIcon}
                  contentFit="contain"
                />
              </View>
            ) : null}
            
            <ThemedText style={styles.listName} numberOfLines={1}>
              {item.name.replace(/^(SoundCloud|Tidal)\s*:?\s*/i, '').trim()}
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
        <Pressable style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.6 : 1 }]} onPress={() => handleShufflePlaylist(item)}>
          <Feather name="shuffle" size={20} color={Colors.light.accent} />
        </Pressable>
        <Pressable style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.6 : 1 }]} onPress={() => handlePlayPlaylist(item)}>
          <Feather name="play-circle" size={22} color={Colors.light.accent} />
        </Pressable>
      </View>
    </View>
    );
  };

  const renderEmptyState = () => {
    if (isLoading) return null;
    if (!activeServer) {
      return (
        <View style={styles.emptyState}>
          <Feather name="server" size={48} color={Colors.light.textTertiary} />
          <ThemedText style={styles.emptyTitle}>No server connected</ThemedText>
          <ThemedText style={styles.emptySubtitle}>Connect to your LMS server in Settings</ThemedText>
        </View>
      );
    }
    return (
      <View style={styles.emptyState}>
        <Feather name="list" size={48} color={Colors.light.textTertiary} />
        <ThemedText style={styles.emptyTitle}>No playlists found</ThemedText>
        <ThemedText style={styles.emptySubtitle}>{activeServer ? "Pull down to refresh or create playlists" : "Connect to a server to see playlists"}</ThemedText>
        {activeServer && (
          <Pressable style={({ pressed }) => [styles.emptyRefreshButton, { opacity: pressed ? 0.7 : 1 }]} onPress={handleRefresh}>
            <Feather name="refresh-cw" size={18} color={Colors.light.accent} />
            <ThemedText style={[styles.emptyRefreshButtonText, { color: Colors.light.accent }]}>Refresh Playlists</ThemedText>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <AppHeader title="Playlists" />

      <LibraryToolbar
        sortValue={sortKey}
        sortLabel="Sorting"
        sortOptions={[
          { label: "Name (A–Z)", value: "name_az" },
          { label: "Tracks (most)", value: "tracks_desc" },
        ]}
        onSortChange={(v) => setSortKey(v as SortKey)}
        sourceValue={sourceFilter}
        onSourceChange={setSourceFilter}
        showQuality={false}
        qualityValue="all"
        qualityOptions={[{ value: "all", label: "All" }]}
        onQualityChange={() => {}}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        showViewToggle
      />

      {isLoading && filteredPlaylists.length === 0 ? (
        viewMode === "grid" ? <AlbumGridSkeleton /> : <AlbumListSkeleton />
      ) : (
        <FlatList
          key={viewMode === "grid" ? `grid-${gridLayout.numColumns}` : "list"}
          data={filteredPlaylists}
          renderItem={viewMode === "grid" ? renderGridItem : renderListItem}
          keyExtractor={(item) => item.id}
          numColumns={viewMode === "grid" ? gridLayout.numColumns : 1}
          contentContainerStyle={[styles.gridContent, { paddingBottom: tabBarHeight + Spacing["5xl"] }, filteredPlaylists.length === 0 && styles.emptyListContent]}
          columnWrapperStyle={viewMode === "grid" ? styles.gridRow : undefined}
          ListEmptyComponent={renderEmptyState}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={Colors.light.accent} />}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.backgroundRoot },
  // Header now standardized via `AppHeader`; view toggle moved into `LibraryToolbar`.
  gridContent: { paddingHorizontal: Spacing.lg },
  gridRow: { gap: Spacing.lg, marginBottom: Spacing.lg },
  gridItem: { width: "100%" },
  gridImageContainer: { position: "relative", marginBottom: Spacing.sm, ...Shadows.small },
  gridOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.md, backgroundColor: "transparent", borderRadius: BorderRadius.sm, pointerEvents: "box-none", zIndex: 1 },
  gridOverlayButton: { pointerEvents: "auto", width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0, 0, 0, 0.6)", alignItems: "center", justifyContent: "center" },
  gridPlayButton: { width: 48, height: 48, borderRadius: 24 },
  mosaicContainer: { borderRadius: BorderRadius.sm, overflow: "hidden" },
  mosaicRow: { flexDirection: "row" },
  mosaicTile: {},
  mosaicTopLeft: { borderTopLeftRadius: BorderRadius.sm },
  mosaicTopRight: { borderTopRightRadius: BorderRadius.sm },
  mosaicBottomLeft: { borderBottomLeftRadius: BorderRadius.sm },
  mosaicBottomRight: { borderBottomRightRadius: BorderRadius.sm },
  mosaicPlaceholder: { backgroundColor: Colors.light.backgroundSecondary, alignItems: "center", justifyContent: "center", borderRadius: BorderRadius.sm },
  gridSourceBadge: { position: "absolute", bottom: Spacing.sm, left: Spacing.sm, width: 24, height: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff", borderRadius: 4, padding: 2 },
  gridSourceIcon: { width: 20, height: 20 },
  gridTitle: { ...Typography.body, color: Colors.light.text, fontWeight: "500" },
  gridSubtitle: { ...Typography.caption, color: Colors.light.textSecondary, marginTop: 2 },
  listContent: { paddingHorizontal: Spacing.lg },
  emptyListContent: { flexGrow: 1, justifyContent: "center" },
  emptyRefreshButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: Spacing.lg, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.light.accent, gap: Spacing.sm },
  emptyRefreshButtonText: { ...Typography.body, fontWeight: "500" },
  listRow: { flexDirection: "row", alignItems: "center", paddingVertical: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.light.border },
  listMainArea: { flex: 1, flexDirection: "row", alignItems: "center" },
  listThumb: { width: 52, height: 52, borderRadius: BorderRadius.sm, overflow: "hidden", backgroundColor: Colors.light.backgroundSecondary, marginRight: Spacing.md },
  listThumbImage: { width: "100%", height: "100%", borderRadius: BorderRadius.sm },
  listInfo: { flex: 1, marginRight: Spacing.sm },
  listNameRow: { flexDirection: "row", alignItems: "center" },
  listName: { ...Typography.body, color: Colors.light.text, flexShrink: 1 },
  listSourceBadge: { width: 20, height: 20, marginRight: Spacing.sm, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff", borderRadius: 3, padding: 2 },
  listSourceIcon: { width: 16, height: 16 },
  listTracks: { ...Typography.caption, color: Colors.light.textSecondary, marginTop: 2 },
  listActions: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  actionButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  emptyState: { alignItems: "center", justifyContent: "center", paddingHorizontal: Spacing["2xl"] },
  emptyTitle: { ...Typography.title, color: Colors.light.text, textAlign: "center", marginTop: Spacing.lg, marginBottom: Spacing.sm },
  emptySubtitle: { ...Typography.body, color: Colors.light.textSecondary, textAlign: "center", marginTop: Spacing.sm },
});
