import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Modal,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { SortFilter, type SortOption } from "@/components/SortFilter";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback, type Track } from "@/hooks/usePlayback";
import { useSettings } from "@/hooks/useSettings";
import { lmsClient, type LmsTrack } from "@/lib/lmsClient";

function normalizeDuration(duration: number): number {
  if (!duration || !isFinite(duration) || duration <= 0) return 0;
  if (duration > 36000) {
    return Math.round(duration / 1000);
  }
  return duration;
}

function formatDuration(duration: number): string {
  const seconds = normalizeDuration(duration);
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

type LibraryFilterKey = "local"  | "tidal" | "spotify";

export default function AllTracksScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { activeServer } = useMusic();
  const { activePlayer, playTrack } = usePlayback();
  const {  spotifyEnabled, tidalEnabled } = useSettings();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortOption, setSortOption] = useState<SortOption>("alphabetical");
  const [activeFilterSheet, setActiveFilterSheet] = useState<"libraries" | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<Record<LibraryFilterKey, boolean>>({
    local: true,
    tidal: true,
    spotify: true
  });

  useEffect(() => {
    const loadTracks = async () => {
      if (!activeServer) {
        setTracks([]);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        lmsClient.setServer(activeServer.host, activeServer.port);
        
        // Load tracks from standard LMS library
        const fetchedLmsTracks: LmsTrack[] = await lmsClient.getAllLibraryTracks(5000);
        const lmsTracks: Track[] = fetchedLmsTracks.map(t => ({
          id: `${activeServer.id}-${t.id}`,
          title: t.title,
          artist: t.artist,
          album: t.album,
          albumId: t.albumId,
          duration: t.duration,
          albumArt: t.artwork_url ? lmsClient.getArtworkUrl(t as any) : undefined,
          source: 'local' as const,
          uri: t.url,
          lmsTrackId: t.id,
        }));

        // Tidal tracks from the Tidal API
        let tidalApiTracks: Track[] = [];
        if (tidalEnabled) {
          try {
            const { getApiUrl } = await import('@/lib/query-client');
            const apiUrl = getApiUrl();
            const cleanApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
            console.log(`[AllTracksScreen] Fetching Tidal tracks from: ${cleanApiUrl}/api/tidal/tracks`);
            const response = await fetch(`${cleanApiUrl}/api/tidal/tracks?limit=5000`);
            if (response.ok) {
              const data = await response.json();
              if (data.items) {
                tidalApiTracks = data.items.map((t: any) => ({
                  id: `tidal-track-${t.id}`,
                  title: t.title,
                  artist: t.artist,
                  album: t.album,
                  albumId: t.albumId,
                  duration: t.duration,
                  albumArt: t.artwork_url,
                  source: 'tidal' as const,
                  uri: t.lmsUri,
                  lmsTrackId: t.id,
                }));
                console.log(`[AllTracksScreen] Loaded ${tidalApiTracks.length} Tidal tracks`);
              }
            }
          } catch (e) {
            console.warn('[AllTracksScreen] Failed to fetch Tidal tracks from API:', e);
          }
        }

        // Merge tracks, avoiding duplicates by ID or title+artist
        const allTracks: Track[] = [...lmsTracks];
        const existingIds = new Set(lmsTracks.map(t => t.lmsTrackId || t.id));
        const existingKeys = new Set(lmsTracks.map(t => `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`));

        // Add Tidal API tracks
        tidalApiTracks.forEach(t => {
          const key = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`;
          if (!existingIds.has(t.lmsTrackId || t.id) && !existingKeys.has(key)) {
            allTracks.push(t);
            existingIds.add(t.lmsTrackId || t.id);
            existingKeys.add(key);
          }
        });

        setTracks(allTracks);
      } catch (e) {
        console.error("Failed to load tracks:", e);
      } finally {
        setIsLoading(false);
      }
    };

    loadTracks();
  }, [activeServer, tidalEnabled]);

  const filteredTracks = useMemo(() => {
    let result = tracks.filter(t => {
      if (t.source === 'local' && !libraryFilter.local) return false;
      if (t.source === 'tidal' && !libraryFilter.tidal) return false;
      if (t.source === 'spotify' && !libraryFilter.spotify) return false;
      return true;
    });

    if (sortOption === "alphabetical") {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortOption === "artist") {
      result.sort((a, b) => a.artist.localeCompare(b.artist));
    } else if (sortOption === "duration") {
      result.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    }

    return result;
  }, [tracks, sortOption, libraryFilter]);

  const renderTrack = useCallback(({ item }: { item: Track }) => (
    <Pressable
      style={({ pressed }) => [
        styles.trackRow,
        { opacity: pressed ? 0.6 : 1 },
      ]}
      onPress={() => playTrack(item, filteredTracks)}
    >
      <View style={styles.trackImageContainer}>
        {item.albumArt ? (
          <Image
            source={item.albumArt}
            style={styles.trackImage}
            contentFit="cover"
          />
        ) : (
          <View style={styles.trackImagePlaceholder}>
            <Feather name="music" size={20} color={Colors.light.textTertiary} />
          </View>
        )}
      </View>
      <View style={styles.trackInfo}>
        <ThemedText style={styles.trackTitle} numberOfLines={1}>
          {item.title}
        </ThemedText>
        <ThemedText style={styles.trackSubtitle} numberOfLines={1}>
          {item.artist} • {item.album}
        </ThemedText>
      </View>
      <ThemedText style={styles.trackDuration}>
        {formatDuration(item.duration)}
      </ThemedText>
    </Pressable>
  ), [playTrack, filteredTracks]);

  if (isLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.accent} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <ThemedText style={styles.headerTitle}>Tracks ({filteredTracks.length})</ThemedText>
        <View style={styles.headerActions}>
          <Pressable 
            style={styles.headerButton}
            onPress={() => setActiveFilterSheet("libraries")}
          >
            <Feather name="filter" size={20} color={Colors.light.text} />
          </Pressable>
        </View>
      </View>

      <View style={styles.sortContainer}>
        <SortFilter
          currentSort={sortOption}
          onSortChange={setSortOption}
          options={[
            { label: "A-Z", value: "alphabetical" },
            { label: "Artist", value: "artist" },
            { label: "Duration", value: "duration" },
          ]}
        />
      </View>

      <FlatList
        data={filteredTracks}
        renderItem={renderTrack}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: tabBarHeight + Spacing.xl },
        ]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      <Modal
        visible={activeFilterSheet === "libraries"}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveFilterSheet(null)}
      >
        <Pressable 
          style={styles.modalOverlay} 
          onPress={() => setActiveFilterSheet(null)} 
        />
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>Filter Libraries</ThemedText>
            <Pressable onPress={() => setActiveFilterSheet(null)}>
              <Feather name="x" size={24} color={Colors.light.text} />
            </Pressable>
          </View>
          <ScrollView>
            <Pressable 
              style={styles.filterOption}
              onPress={() => setLibraryFilter(prev => ({ ...prev, local: !prev.local }))}
            >
              <ThemedText style={styles.filterText}>Local Library</ThemedText>
              <Feather 
                name={libraryFilter.local ? "check-square" : "square"} 
                size={20} 
                color={libraryFilter.local ? Colors.light.accent : Colors.light.textTertiary} 
              />
            </Pressable>
            {tidalEnabled && (
              <Pressable 
                style={styles.filterOption}
                onPress={() => setLibraryFilter(prev => ({ ...prev, tidal: !prev.tidal }))}
              >
                <ThemedText style={styles.filterText}>Tidal</ThemedText>
                <Feather 
                  name={libraryFilter.tidal ? "check-square" : "square"} 
                  size={20} 
                  color={libraryFilter.tidal ? Colors.light.accent : Colors.light.textTertiary} 
                />
              </Pressable>
            )}
            {spotifyEnabled && (
              <Pressable 
                style={styles.filterOption}
                onPress={() => setLibraryFilter(prev => ({ ...prev, spotify: !prev.spotify }))}
              >
                <ThemedText style={styles.filterText}>Spotify</ThemedText>
                <Feather 
                  name={libraryFilter.spotify ? "check-square" : "square"} 
                  size={20} 
                  color={libraryFilter.spotify ? Colors.light.accent : Colors.light.textTertiary} 
                />
              </Pressable>
            )}
          </ScrollView>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerTitle: {
    ...Typography.title,
    color: Colors.light.text,
  },
  headerActions: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  headerButton: {
    padding: Spacing.sm,
  },
  sortContainer: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
  },
  trackImageContainer: {
    marginRight: Spacing.md,
  },
  trackImage: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.xs,
  },
  trackImagePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.xs,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
  },
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    ...Typography.body,
    fontWeight: "600",
    color: Colors.light.text,
  },
  trackSubtitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  trackDuration: {
    ...Typography.caption,
    color: Colors.light.textTertiary,
    marginLeft: Spacing.md,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.light.border,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalContent: {
    backgroundColor: Colors.light.backgroundDefault,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    padding: Spacing.lg,
    maxHeight: "60%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  modalTitle: {
    ...Typography.headline,
    color: Colors.light.text,
  },
  filterOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  filterText: {
    ...Typography.body,
    color: Colors.light.text,
  },
});
