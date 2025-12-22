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

type LibraryFilterKey = "local" | "qobuz" | "tidal" | "spotify";

export default function AllTracksScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { activeServer, recentlyPlayed } = useMusic();
  const { activePlayer, playTrack } = usePlayback();
  const { qobuzEnabled, spotifyEnabled, tidalEnabled } = useSettings();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortOption, setSortOption] = useState<SortOption>("alphabetical");
  const [activeFilterSheet, setActiveFilterSheet] = useState<"libraries" | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<Record<LibraryFilterKey, boolean>>({
    local: false,
    qobuz: false,
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
        const lmsTracks: LmsTrack[] = await lmsClient.getAllLibraryTracks(5000);
        
        // Tidal tracks from the Tidal API
        let tidalApiTracks: Track[] = [];
        if (tidalEnabled) {
          try {
            const { getApiUrl } = await import('@/lib/query-client');
            const apiUrl = getApiUrl();
            const cleanApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
            console.log(`[AllTracksScreen] Fetching Tidal tracks from: ${cleanApiUrl}/api/tidal/tracks`);
            const response = await fetch(`${cleanApiUrl}/api/tidal/tracks?limit=500`);
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
        const allTracks: Track[] = [...localTracks];
        const existingIds = new Set(localTracks.map(t => t.lmsTrackId || t.id));
        const existingKeys = new Set(localTracks.map(t => `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`));

        // Add Qobuz tracks
        qobuzTracks.forEach(t => {
          const key = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`;
          if (!existingIds.has(t.lmsTrackId || t.id) && !existingKeys.has(key)) {
            allTracks.push(t);
            existingIds.add(t.lmsTrackId || t.id);
            existingKeys.add(key);
          }
        });

        // Add Tidal API tracks
        tidalApiTracks.forEach(t => {
          const key = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`;
          if (!existingIds.has(t.lmsTrackId || t.id) && !existingKeys.has(key)) {
            allTracks.push(t);
            existingIds.add(t.lmsTrackId || t.id);
            existingKeys.add(key);
          }
        });

        console.log(`[AllTracksScreen] Final track count: ${allTracks.length} (Local: ${localTracks.length}, Qobuz: ${qobuzTracks.length}, Tidal: ${tidalApiTracks.length})`);
        setTracks(allTracks);
      } catch (e) {
        console.error("Failed to load all tracks:", e);
        setTracks([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadTracks();
  }, [activeServer, qobuzEnabled, spotifyEnabled, tidalEnabled]);

  const hasActiveLibraryFilter = libraryFilter.local || libraryFilter.qobuz;

  const sortedTracks = useMemo(() => {
    let list = [...tracks];

    // Apply library filter if any selected
    if (hasActiveLibraryFilter) {
      const allowedLibs: LibraryFilterKey[] = [];
      if (libraryFilter.local) allowedLibs.push("local");
      if (libraryFilter.qobuz) allowedLibs.push("qobuz");
      if (allowedLibs.length > 0) {
        list = list.filter((track) => {
          const src = (track.source || "local") as LibraryFilterKey;
          return allowedLibs.includes(src);
        });
      }
    }

    if (sortOption === "alphabetical") {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortOption === "recently_played") {
      const map = new Map<string, number>();
      recentlyPlayed.forEach((t, index) => {
        if (t.id) {
          const key = t.id;
          if (!map.has(key)) {
            map.set(key, index);
          }
        }
      });

      list.sort((a, b) => {
        const indexA = map.get(a.id) ?? Infinity;
        const indexB = map.get(b.id) ?? Infinity;
        if (indexA === Infinity && indexB === Infinity) {
          return a.title.localeCompare(b.title);
        }
        if (indexA === Infinity) return 1;
        if (indexB === Infinity) return -1;
        return indexA - indexB;
      });
    } else if (sortOption === "recently_added") {
      // No created-at metadata; fall back to alphabetical
      list.sort((a, b) => a.title.localeCompare(b.title));
    }

    return list;
  }, [tracks, sortOption, recentlyPlayed, hasActiveLibraryFilter, libraryFilter]);

  const handlePlayTrack = useCallback(
    (track: Track) => {
      if (!activePlayer) return;
      playTrack(track);
    },
    [activePlayer, playTrack],
  );

  const renderTrack = ({ item }: { item: Track }) => (
    <Pressable
      style={({ pressed }) => [
        styles.trackRow,
        { opacity: pressed ? 0.6 : 1 },
      ]}
      onPress={() => handlePlayTrack(item)}
    >
      <Image
        source={
          item.albumArt || require("../assets/images/placeholder-album.png")
        }
        style={styles.trackImage}
        contentFit="cover"
      />
      <View style={styles.trackInfo}>
        <ThemedText style={styles.trackTitle} numberOfLines={1}>
          {item.title}
        </ThemedText>
        <ThemedText style={styles.trackArtist} numberOfLines={1}>
          {item.artist}
        </ThemedText>
      </View>
      <ThemedText style={styles.trackDuration}>
        {formatDuration(item.duration)}
      </ThemedText>
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <ThemedText style={styles.headerTitle}>Tracks</ThemedText>
        <SortFilter value={sortOption} onChange={setSortOption} />
      </View>

      {/* Track filters: Libraries */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={{ paddingRight: Spacing.lg }}
      >
        <Pressable
          style={({ pressed }) => [
            styles.filterChip,
            (hasActiveLibraryFilter || activeFilterSheet === "libraries") && styles.filterChipActive,
            { opacity: pressed ? 0.7 : 1 },
          ]}
          onPress={() => setActiveFilterSheet("libraries")}
        >
          <ThemedText style={styles.filterChipText}>Libraries</ThemedText>
        </Pressable>
      </ScrollView>

      {isLoading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="small" color={Colors.light.accent} />
        </View>
      ) : (
        <FlatList
          data={sortedTracks}
          renderItem={renderTrack}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: tabBarHeight + Spacing["5xl"] },
          ]}
          {...(Platform.OS === 'ios' && { contentInsetAdjustmentBehavior: 'automatic' })}
        />
      )}

      {/* Filter selection modal */}
      {activeFilterSheet && (
        <Modal
          visible
          animationType="slide"
          transparent
          onRequestClose={() => setActiveFilterSheet(null)}
        >
          <Pressable
            style={styles.filterModalOverlay}
            onPress={() => setActiveFilterSheet(null)}
          >
            <Pressable
              style={[styles.filterModalContent, { paddingBottom: insets.bottom + Spacing.lg }]}
              onPress={(e) => e.stopPropagation()}
            >
              <ThemedText style={styles.filterModalTitle}>
                Filter by Library
              </ThemedText>

              {activeFilterSheet === "libraries" && (
                <>
                  <Pressable
                    style={({ pressed }) => [
                      styles.filterOptionRow,
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                    onPress={() =>
                      setLibraryFilter((prev) => ({
                        ...prev,
                        local: !prev.local,
                      }))
                    }
                  >
                    <Feather
                      name={libraryFilter.local ? "check-square" : "square"}
                      size={18}
                      color={Colors.light.accent}
                    />
                    <ThemedText style={styles.filterOptionText}>
                      Local (Music Folder)
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.filterOptionRow,
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                    onPress={() =>
                      setLibraryFilter((prev) => ({
                        ...prev,
                        qobuz: !prev.qobuz,
                      }))
                    }
                  >
                    <Feather
                      name={libraryFilter.qobuz ? "check-square" : "square"}
                      size={18}
                      color={Colors.light.accent}
                    />
                    <ThemedText style={styles.filterOptionText}>
                      Qobuz Favorites
                    </ThemedText>
                  </Pressable>
                </>
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.filterDoneButton,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={() => setActiveFilterSheet(null)}
              >
                <ThemedText style={styles.filterDoneButtonText}>
                  Done
                </ThemedText>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
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
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  headerTitle: {
    ...Typography.title,
    color: Colors.light.text,
  },
  loader: {
    paddingTop: Spacing["3xl"],
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  trackImage: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.xs,
  },
  trackInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  trackTitle: {
    ...Typography.body,
    color: Colors.light.text,
  },
  trackArtist: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
  },
  trackDuration: {
    ...Typography.caption,
    color: Colors.light.textTertiary,
    marginLeft: Spacing.md,
  },
  filterRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
    paddingVertical: Spacing.sm,
    borderRadius: 999,
    backgroundColor: Colors.light.backgroundSecondary,
    marginRight: Spacing.sm,
  },
  filterChipActive: {
    backgroundColor: Colors.light.text,
  },
  filterChipText: {
    ...Typography.body,
    color: Colors.light.text,
  },
  filterModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  filterModalContent: {
    backgroundColor: Colors.light.backgroundDefault,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    maxHeight: "70%",
  },
  filterModalTitle: {
    ...Typography.title,
    marginBottom: Spacing.md,
    color: Colors.light.text,
  },
  filterOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  filterOptionText: {
    ...Typography.body,
    color: Colors.light.text,
  },
  filterDoneButton: {
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    alignSelf: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.light.text,
  },
  filterDoneButtonText: {
    ...Typography.body,
    color: Colors.dark.text,
    fontWeight: "600",
  },
});


