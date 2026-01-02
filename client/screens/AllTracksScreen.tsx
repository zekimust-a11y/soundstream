import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { AlbumArtwork } from "@/components/AlbumArtwork";
import { LibraryToolbar, type SourceFilter, type ViewMode } from "@/components/LibraryToolbar";
import { AppHeader } from "@/components/AppHeader";
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
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [lmsOffset, setLmsOffset] = useState(0);
  const [lmsTotal, setLmsTotal] = useState<number | null>(null);
  const [tidalNext, setTidalNext] = useState<string | null>(null);
  const [hasMoreLms, setHasMoreLms] = useState(true);
  const [hasMoreTidal, setHasMoreTidal] = useState(true);
  const seenKeysRef = useRef<Set<string>>(new Set());
  const loadIdRef = useRef(0);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortKey, setSortKey] = useState<SortKey>("title_az");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [qualityFilter, setQualityFilter] = useState<QualityKey>("all");
  const [textFilter, setTextFilter] = useState("");

  const mergeInTracks = useCallback((incoming: Track[]) => {
    if (incoming.length === 0) return;
    setTracks((prev) => {
      const next = prev.slice();
      for (const t of incoming) {
        const key = `${(t.source || "local")}:${t.lmsTrackId || t.id}:${t.title.toLowerCase()}|${t.artist.toLowerCase()}`;
        if (seenKeysRef.current.has(key)) continue;
        seenKeysRef.current.add(key);
        next.push(t);
      }
      return next;
    });
  }, []);

  const fetchNextLmsPage = useCallback(async () => {
    if (!activeServer || !hasMoreLms) return;
    lmsClient.setServer(activeServer.host, activeServer.port);

    // Fetch total once (fast)
    if (lmsTotal === null) {
      try {
        const status: any = await (lmsClient as any).request("", ["serverstatus", "0", "1", "library_id:0"]);
        const total = Number(status?.["info total songs"] || 0);
        if (Number.isFinite(total) && total > 0) setLmsTotal(total);
      } catch {
        // ignore
      }
    }

    const PAGE = 500;
    const { tracks: fetched } = await lmsClient.getLibraryTracksPage(lmsOffset, PAGE);
    const mapped: Track[] = fetched.map((t: LmsTrack) => ({
      id: `${activeServer.id}-${t.id}`,
      title: t.title,
      artist: t.artist,
      album: t.album,
      albumId: t.albumId,
      duration: t.duration,
      albumArt: t.artwork_url ? lmsClient.getArtworkUrl(t as any) : undefined,
      source: "local" as const,
      uri: t.url,
      lmsTrackId: t.id,
      format: t.format,
      sampleRate: t.sampleRate,
      bitDepth: t.bitDepth,
      bitrate: t.bitrate,
    }));
    mergeInTracks(mapped);
    setLmsOffset((o) => o + fetched.length);
    if (fetched.length < PAGE) setHasMoreLms(false);
    if (lmsTotal !== null && lmsOffset + fetched.length >= lmsTotal) setHasMoreLms(false);
  }, [activeServer, hasMoreLms, lmsOffset, lmsTotal, mergeInTracks]);

  const fetchNextTidalPage = useCallback(async () => {
    if (!tidalEnabled || !hasMoreTidal) return;
    try {
      const { getApiUrl } = await import("@/lib/query-client");
      const apiUrl = getApiUrl();
      const cleanApiUrl = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
      const PAGE = 100;
      const url =
        `${cleanApiUrl}/api/tidal/tracks?limit=${PAGE}` + (tidalNext ? `&next=${encodeURIComponent(tidalNext)}` : "");
      const response = await fetch(url);
      if (!response.ok) {
        setHasMoreTidal(false);
        return;
      }
      const data = await response.json();
      const items: any[] = Array.isArray(data?.items) ? data.items : [];
      const mapped: Track[] = items.map((t: any) => ({
        id: `tidal-track-${t.id}`,
        title: t.title,
        artist: t.artist,
        album: t.album,
        albumId: t.albumId,
        duration: t.duration,
        albumArt: t.artwork_url,
        source: "tidal" as const,
        uri: t.lmsUri,
        lmsTrackId: t.id,
        format: t.format || t.audioQuality,
        sampleRate: t.sampleRate,
        bitDepth: t.bitDepth,
      }));
      mergeInTracks(mapped);
      const next = typeof data?.next === "string" && data.next ? data.next : null;
      setTidalNext(next);
      if (!next || items.length === 0) setHasMoreTidal(false);
    } catch {
      setHasMoreTidal(false);
    }
  }, [tidalEnabled, hasMoreTidal, tidalNext, mergeInTracks]);

  useEffect(() => {
    // Reset and load the first page quickly
    const loadId = ++loadIdRef.current;
    seenKeysRef.current = new Set();
    setTracks([]);
    setIsLoading(true);
    setIsLoadingMore(false);
    setLmsOffset(0);
    setLmsTotal(null);
    setHasMoreLms(true);
    setHasMoreTidal(true);
    setTidalNext(null);

    (async () => {
      try {
        await Promise.all([fetchNextLmsPage(), tidalEnabled ? fetchNextTidalPage() : Promise.resolve()]);
      } finally {
        if (loadId === loadIdRef.current) setIsLoading(false);
      }
    })();
  }, [activeServer?.id, tidalEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadMore = useCallback(async () => {
    if (isLoading || isLoadingMore) return;
    if (!hasMoreLms && !(tidalEnabled && hasMoreTidal)) return;
    setIsLoadingMore(true);
    try {
      if (hasMoreLms) {
        await fetchNextLmsPage();
      } else if (tidalEnabled && hasMoreTidal) {
        await fetchNextTidalPage();
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoading, isLoadingMore, hasMoreLms, hasMoreTidal, tidalEnabled, fetchNextLmsPage, fetchNextTidalPage]);

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

    const q = textFilter.trim().toLowerCase();
    if (q) {
      result = result.filter((t) => {
        const title = (t.title || "").toLowerCase();
        const artist = (t.artist || "").toLowerCase();
        const album = (t.album || "").toLowerCase();
        return title.includes(q) || artist.includes(q) || album.includes(q);
      });
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
  }, [tracks, sortKey, sourceFilter, qualityFilter, qualityKeyForTrack, textFilter]);

  const renderTrack = useCallback(({ item }: { item: Track }) => (
    <Pressable
      style={({ pressed }) => [
        styles.trackRow,
        { opacity: pressed ? 0.6 : 1 },
      ]}
      onPress={() => playTrack(item, filteredTracks)}
    >
      <View style={styles.trackImageContainer}>
        <AlbumArtwork source={item.albumArt} style={styles.trackImage} contentFit="cover" />
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
      <AppHeader
        // Don't show a misleading "loaded so far" number (e.g. 520) while totals are still loading.
        title={lmsTotal !== null ? `Tracks (${lmsTotal.toLocaleString()})` : "Tracks"}
      />

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
        showSearch
        searchQuery={textFilter}
        onSearchQueryChange={setTextFilter}
        searchPlaceholder="Filter tracks…"
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
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.6}
          ListFooterComponent={
            isLoadingMore ? (
              <View style={{ paddingVertical: Spacing.lg }}>
                <ActivityIndicator size="small" color={Colors.light.accent} />
              </View>
            ) : null
          }
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
              <AlbumArtwork source={item.albumArt} style={styles.gridImage} contentFit="cover" />
              <ThemedText style={styles.gridTitle} numberOfLines={1}>
                {item.title}
              </ThemedText>
              <ThemedText style={styles.gridSubtitle} numberOfLines={1}>
                {item.artist}
              </ThemedText>
            </Pressable>
          )}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.6}
          ListFooterComponent={
            isLoadingMore ? (
              <View style={{ paddingVertical: Spacing.lg }}>
                <ActivityIndicator size="small" color={Colors.light.accent} />
              </View>
            ) : null
          }
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
  // Header now standardized via `AppHeader`.
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
