import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { LibraryToolbar, type SourceFilter, type ViewMode } from "@/components/LibraryToolbar";
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

type SortKey = "title_az" | "artist_az" | "album_az" | "duration_desc";
type QualityKey = "all" | "cd" | "hires" | "lossy" | "unknown";

export default function AllTracksScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { activeServer } = useMusic();
  const { activePlayer, playTrack } = usePlayback();
  const { tidalEnabled } = useSettings();
  const { width } = useWindowDimensions();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortKey, setSortKey] = useState<SortKey>("title_az");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [qualityFilter, setQualityFilter] = useState<QualityKey>("all");

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
          format: t.format,
          sampleRate: t.sampleRate,
          bitDepth: t.bitDepth,
          bitrate: t.bitrate,
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
                  format: t.format || t.audioQuality,
                  sampleRate: t.sampleRate,
                  bitDepth: t.bitDepth,
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

  const qualityKeyForTrack = useCallback((t: Track): QualityKey => {
    const bit = t.bitDepth ? Number(String(t.bitDepth).replace(/[^\d.]/g, "")) : NaN;
    const sr = t.sampleRate ? Number(String(t.sampleRate).replace(/[^\d.]/g, "")) : NaN;

    if (Number.isFinite(bit) && Number.isFinite(sr)) {
      const srK = sr > 1000 ? sr / 1000 : sr;
      if (bit >= 24 || srK > 48) return "hires";
      if (bit <= 16 && srK <= 44.1 + 0.2) return "cd";
      return "unknown";
    }

    const fmt = (t.format || "").toLowerCase();
    if (fmt.includes("mp3") || fmt.includes("aac") || fmt.includes("ogg")) return "lossy";
    if (!fmt) return "unknown";
    return "unknown";
  }, []);

  const qualityOptions = useMemo(() => {
    const present = new Set<QualityKey>();
    for (const t of tracks) present.add(qualityKeyForTrack(t));
    const opts: Array<{ value: QualityKey; label: string }> = [{ value: "all", label: "All" }];
    if (present.has("cd")) opts.push({ value: "cd", label: "CD (16/44.1)" });
    if (present.has("hires")) opts.push({ value: "hires", label: "Hi-Res" });
    if (present.has("lossy")) opts.push({ value: "lossy", label: "Lossy" });
    if (present.has("unknown")) opts.push({ value: "unknown", label: "Unknown" });
    return opts;
  }, [tracks, qualityKeyForTrack]);

  const filteredTracks = useMemo(() => {
    let result = tracks.slice();

    if (sourceFilter !== "all") {
      result = result.filter((t) => t.source === sourceFilter);
    }

    if (qualityFilter !== "all") {
      result = result.filter((t) => qualityKeyForTrack(t) === qualityFilter);
    }

    if (sortKey === "title_az") {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortKey === "artist_az") {
      result.sort((a, b) => a.artist.localeCompare(b.artist));
    } else if (sortKey === "album_az") {
      result.sort((a, b) => a.album.localeCompare(b.album));
    } else if (sortKey === "duration_desc") {
      result.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    }

    return result;
  }, [tracks, sortKey, sourceFilter, qualityFilter, qualityKeyForTrack]);

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
      </View>

      <LibraryToolbar
        sortValue={sortKey}
        sortLabel="Sorting"
        sortOptions={[
          { label: "Title (A–Z)", value: "title_az" },
          { label: "Artist (A–Z)", value: "artist_az" },
          { label: "Album (A–Z)", value: "album_az" },
          { label: "Duration (longest)", value: "duration_desc" },
        ]}
        onSortChange={(v) => setSortKey(v as SortKey)}
        sourceValue={sourceFilter}
        onSourceChange={setSourceFilter}
        qualityValue={qualityFilter}
        qualityOptions={qualityOptions as any}
        onQualityChange={(v) => setQualityFilter(v as QualityKey)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showViewToggle
      />

      {viewMode === "list" ? (
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
      ) : (
        <FlatList
          key="grid"
          data={filteredTracks}
          keyExtractor={(item) => item.id}
          numColumns={Math.max(2, Math.min(6, Math.floor((width - Spacing.lg * 2) / 160)))}
          contentContainerStyle={[
            styles.gridContent,
            { paddingBottom: tabBarHeight + Spacing.xl },
          ]}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.gridCard, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => playTrack(item, filteredTracks)}
            >
              {item.albumArt ? (
                <Image source={item.albumArt} style={styles.gridImage} contentFit="cover" />
              ) : (
                <View style={styles.gridImagePlaceholder}>
                  <Feather name="music" size={22} color={Colors.light.textTertiary} />
                </View>
              )}
              <ThemedText style={styles.gridTitle} numberOfLines={1}>
                {item.title}
              </ThemedText>
              <ThemedText style={styles.gridSubtitle} numberOfLines={1}>
                {item.artist}
              </ThemedText>
            </Pressable>
          )}
        />
      )}
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
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  gridContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  gridCard: {
    flex: 1,
    margin: Spacing.sm,
    maxWidth: 220,
  },
  gridImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
    backgroundColor: Colors.light.backgroundTertiary,
  },
  gridImagePlaceholder: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
    backgroundColor: Colors.light.backgroundTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  gridTitle: {
    ...Typography.caption,
    color: Colors.light.text,
    fontWeight: "600",
  },
  gridSubtitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
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
});
