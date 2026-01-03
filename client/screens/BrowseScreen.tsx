import React, { useCallback, useState, useMemo, useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { AlbumArtwork } from "@/components/AlbumArtwork";
import { AppHeader } from "@/components/AppHeader";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback, Track } from "@/hooks/usePlayback";
import { useSettings } from "@/hooks/useSettings";
import { lmsClient, type LmsAlbum } from "@/lib/lmsClient";
import { debugLog } from "@/lib/debugLog";
import { useInfiniteArtists, type Artist } from "@/hooks/useLibrary";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";
import { DESKTOP_SIDEBAR_WIDTH } from "@/constants/layout";

type NavigationProp = NativeStackNavigationProp<BrowseStackParamList>;
type BrowseRouteProp = RouteProp<BrowseStackParamList, "Browse">;

type RecentItem =
  | { kind: "track"; id: string; track: Track }
  | { kind: "album"; id: string; track: Track }
  | { kind: "playlist"; id: string; playlistId: string; name: string; artwork?: string };

type RecentTab = "played" | "added";
type RecentAddedAlbum = LmsAlbum & { source: "local" | "tidal" };

export default function BrowseScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<BrowseRouteProp>();
  const { width: windowWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [tidalSectionY, setTidalSectionY] = useState<number | null>(null);
  const didScrollRef = useRef(false);
  const {
    recentlyPlayed,
    recentlyPlayedItems,
    playlists,
    refreshLibrary,
    activeServer,
    tidalConnected,
    isLoading: musicLoading,
  } = useMusic();
  const { playTrack, playPlaylist, activePlayer, syncPlayerStatus } = usePlayback();
  const {  tidalEnabled } = useSettings();
  const { data: artistsData, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteArtists();
  
  // Flatten all artists from all pages safely
  const allArtists = useMemo(() => {
    if (!artistsData?.pages) return [];
    return artistsData.pages.flatMap(page => page?.artists || []);
  }, [artistsData]);
  const [isShuffling, setIsShuffling] = useState(false);
  const [recentTab, setRecentTab] = useState<RecentTab>("played");
  const [recentlyAdded, setRecentlyAdded] = useState<RecentAddedAlbum[]>([]);
  const [isLoadingRecentlyAdded, setIsLoadingRecentlyAdded] = useState(false);
  const [tidalAlbums, setTidalAlbums] = useState<LmsAlbum[]>([]);
  const [tidalPlaylists, setTidalPlaylists] = useState<LmsPlaylist[]>([]);
  const [tidalMixes, setTidalMixes] = useState<any[]>([]);

  // (Tidal browse data is loaded below in a single effect to avoid duplicate requests + rate limiting.)

  // Allow desktop sidebar "Tidal" menu item to jump to the Tidal section on Browse.
  useEffect(() => {
    if (didScrollRef.current) return;
    if (route.params?.scrollTo !== "tidal") return;
    if (tidalSectionY == null) return;
    didScrollRef.current = true;
    scrollRef.current?.scrollTo({
      y: Math.max(0, tidalSectionY - 20),
      animated: true,
    });
  }, [route.params?.scrollTo, tidalSectionY]);

  // Keep all artwork tiles on Browse the same size, and scale a bit up on desktop/web.
  // Match Browse tile sizing to the Albums screen sizing rules.
  const browseTileSize = useMemo(() => {
    const isLargeWeb = Platform.OS === "web" && windowWidth >= 900;
    const padding = Spacing.lg;
    const gap = Spacing.lg;
    const contentWidth = isLargeWeb ? Math.max(0, windowWidth - DESKTOP_SIDEBAR_WIDTH) : windowWidth;
    const available = Math.max(0, contentWidth - padding * 2);

    if (Platform.OS !== "web") {
      const cols = 3;
      const size = Math.floor((available - gap * (cols - 1)) / cols);
      return Math.max(90, size);
    }

    // +16% bigger tiles on large screens
    const min = 200;
    const max = 325;
    let cols = Math.max(3, Math.min(10, Math.floor((available + gap) / (min + gap)) || 3));
    let size = (available - gap * (cols - 1)) / cols;
    while (size > max && cols < 10) {
      cols += 1;
      size = (available - gap * (cols - 1)) / cols;
    }
    return Math.floor(Math.max(min, Math.min(max, size)));
  }, [windowWidth]);

  const recentItems: RecentItem[] = useMemo(() => {
    const items: RecentItem[] = [];
    const seen = new Set<string>();

    // First, add playlists from recentlyPlayedItems
    for (const item of recentlyPlayedItems) {
      if (item.type === 'playlist' && item.playlistId) {
        const key = `playlist-${item.playlistId}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({
            kind: "playlist",
            id: key,
            playlistId: item.playlistId,
            name: item.name,
            artwork: item.artwork,
          });
        }
      }
    }

    // Then add tracks/albums from recentlyPlayed (for backward compatibility)
    for (const track of recentlyPlayed) {
      if (!track) continue;

      // Prefer album grouping when we have an albumId
      if (track.albumId) {
        const key = `album-${track.albumId}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({ kind: "album", id: key, track });
        }
      } else {
        const key = `track-${track.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({ kind: "track", id: key, track });
        }
      }
    }

    // Limit to 30 items for the horizontal list
    return items.slice(0, 30);
  }, [recentlyPlayed, recentlyPlayedItems]);

  const handleRefresh = useCallback(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  const loadRecentlyAdded = useCallback(async () => {
    if (!activeServer) {
      setRecentlyAdded([]);
      return;
    }
    setIsLoadingRecentlyAdded(true);
    try {
      // Local LMS recently-added albums (best-effort; falls back to normal albums paging)
      lmsClient.setServer(activeServer.host, activeServer.port);
      const lmsRes = await lmsClient.getRecentlyAddedAlbumsPage(0, 20);
      const local = (lmsRes.albums || []).map((a) => ({ ...a, source: "local" as const }));

      // Tidal "My Albums" (already fetched for Browse; treat as "recently added" ordering from API)
      const tidal = (tidalAlbums || []).slice(0, 20).map((a) => ({ ...a, source: "tidal" as const }));

      const parseAddedAtMs = (iso?: string) => {
        if (!iso) return undefined;
        const t = Date.parse(iso);
        return Number.isFinite(t) ? t : undefined;
      };

      // If either source provides addedAt timestamps, sort globally by recency.
      const combinedRaw: RecentAddedAlbum[] = [...tidal, ...local];
      const anyHasTimestamp = combinedRaw.some((a) => parseAddedAtMs(a.addedAt) != null);
      if (anyHasTimestamp) {
        const combined = combinedRaw
          .map((a, idx) => ({
            a,
            ts: parseAddedAtMs(a.addedAt),
            // Preserve a stable fallback ordering (tidal first, then local) when timestamps are missing.
            fallback: (a.source === "tidal" ? 0 : 1) * 1000 + idx,
          }))
          .sort((x, y) => {
            const xt = x.ts ?? -Infinity;
            const yt = y.ts ?? -Infinity;
            if (yt !== xt) return yt - xt;
            return x.fallback - y.fallback;
          })
          .map((x) => x.a);
        setRecentlyAdded(combined.slice(0, 30));
      } else {
        // Fallback: interleave so both sources appear.
        const combined: RecentAddedAlbum[] = [];
        const max = Math.max(local.length, tidal.length);
        for (let i = 0; i < max; i++) {
          if (tidal[i]) combined.push(tidal[i]);
          if (local[i]) combined.push(local[i]);
        }
        setRecentlyAdded(combined.slice(0, 30));
      }
    } catch (e) {
      console.warn("[Browse] Failed to load recently added:", e instanceof Error ? e.message : String(e));
      setRecentlyAdded([]);
    } finally {
      setIsLoadingRecentlyAdded(false);
    }
  }, [activeServer, tidalAlbums]);

  useEffect(() => {
    if (recentTab === "added") {
      loadRecentlyAdded();
    }
  }, [recentTab, loadRecentlyAdded]);

  const handleShuffleAll = useCallback(async () => {
    if (!activePlayer || !activeServer || isShuffling) {
      if (!activePlayer) {
        Alert.alert('No Player', 'Please select a player first to shuffle the library.');
      }
      return;
    }

    setIsShuffling(true);
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);

      // Enable shuffle mode first
      await lmsClient.setShuffle(activePlayer.id, 1);

      // Build a combined pool from LMS (local library) + Tidal (direct API) and then pick ~1000 random tracks.
      const TARGET_TRACKS = 1000;

      // LMS local tracks (may be empty)
      const lmsTracks = await lmsClient.getAllLibraryTracks(5000);

      console.log(`[Shuffle] Found ${lmsTracks.length} tracks in library`);
      console.log(`[Shuffle] Sample track IDs:`, lmsTracks.slice(0, 3).map(t => t.id));

      // Convert to app Track format
      // Keep the original LMS track ID for adding to playlist
      const tracks: Track[] = lmsTracks.map(t => ({
        id: `${activeServer.id}-${t.id}`,
        title: t.title,
        artist: t.artist,
        album: t.album,
        albumArt: t.artwork_url ? lmsClient.getArtworkUrl(t as any) : undefined,
        duration: t.duration,
        source: 'local',
        uri: t.url,
        format: t.format,
        bitrate: t.bitrate,
        sampleRate: t.sampleRate,
        bitDepth: t.bitDepth,
        lmsTrackId: t.id, // This is the raw LMS track ID we need
      }));

      // Tidal tracks (sampled/paged server-side; may return fewer if rate-limited)
      let tidalTracks: Track[] = [];
      try {
        if (tidalEnabled && tidalConnected) {
          const { getApiUrl } = await import('@/lib/query-client');
          const apiUrl = getApiUrl();
          const resp = await fetch(`${apiUrl}/api/tidal/tracks/sample?limit=1000`);
          if (resp.ok) {
            const data = await resp.json();
            const items: any[] = Array.isArray(data?.items) ? data.items : [];
            tidalTracks = items.map((t: any) => ({
              id: `tidal-track-${t.id}`,
              title: t.title,
              artist: t.artist,
              album: t.album,
              albumId: t.albumId ? `tidal-${t.albumId}` : undefined,
              artistId: t.artistId ? `tidal-${t.artistId}` : undefined,
              albumArt: t.artwork_url || undefined,
              duration: Number(t.duration || 0),
              source: 'tidal',
              type: 'track',
              uri: t.lmsUri || t.uri || `tidal://${t.id}`,
              // We use lmsTrackId as the "thing to add to LMS playlist" in this flow.
              // For Tidal, that should be the plugin URI.
              lmsTrackId: (t.lmsUri || t.uri || `tidal://${t.id}`) as string,
            }));
          }
        }
      } catch (e) {
        console.warn('[Shuffle] Failed to fetch Tidal track sample:', e instanceof Error ? e.message : String(e));
        tidalTracks = [];
      }

      if (tracks.length === 0 && tidalTracks.length === 0) {
        Alert.alert('No Tracks', 'No tracks found (Local or Tidal) to shuffle.');
        setIsShuffling(false);
        return;
      }

      // Decide how many to pull from each source (prefer a mix when Tidal is available)
      const localAvail = tracks.length;
      const tidalAvail = tidalTracks.length;
      let tidalTarget = tidalAvail > 0 ? Math.min(tidalAvail, Math.floor(TARGET_TRACKS * 0.5)) : 0;
      let localTarget = TARGET_TRACKS - tidalTarget;
      if (localAvail < localTarget) {
        const missing = localTarget - localAvail;
        localTarget = localAvail;
        tidalTarget = Math.min(tidalAvail, tidalTarget + missing);
      }
      if (tidalAvail < tidalTarget) {
        const missing = tidalTarget - tidalAvail;
        tidalTarget = tidalAvail;
        localTarget = Math.min(localAvail, localTarget + missing);
      }

      const sample = <T,>(arr: T[], n: number): T[] => {
        if (n <= 0) return [];
        if (arr.length <= n) return [...arr];
        const picked = new Set<number>();
        while (picked.size < n) picked.add(Math.floor(Math.random() * arr.length));
        return Array.from(picked).map((i) => arr[i]);
      };

      const localSample = sample(tracks, localTarget);
      const tidalSample = sample(tidalTracks, tidalTarget);
      const pool = [...localSample, ...tidalSample];

      console.log(
        `[Shuffle] Selected ${pool.length} tracks (local=${localSample.length}, tidal=${tidalSample.length}) from (local=${tracks.length}, tidal=${tidalTracks.length}) available`
      );

      // Shuffle the pool using Fisher-Yates algorithm
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      // Ensure player is powered on
      await lmsClient.setPower(activePlayer.id, true);

      // Clear current playlist and load shuffled tracks directly into LMS
      await lmsClient.clearPlaylist(activePlayer.id);

      // Add tracks using LMS track ID (not app composite ID)
      const trackIds = shuffled
        .filter(t => t.lmsTrackId)
        .map(t => t.lmsTrackId!);

      if (trackIds.length === 0) {
        Alert.alert('No Tracks', 'No valid tracks to add to playlist.');
        setIsShuffling(false);
        return;
      }

      console.log(`[Shuffle] Adding ${trackIds.length} tracks to playlist...`);
      console.log(`[Shuffle] First few track IDs:`, trackIds.slice(0, 5));

      // Start playback ASAP:
      // - Clear playlist
      // - Add ONE track
      // - Jump to index 0 and play
      // Then enqueue the rest in the background so the first track starts quickly.
      const firstId = trackIds[0];
      const restIds = trackIds.slice(1);

      await lmsClient.addTrackToPlaylist(activePlayer.id, firstId);
      await lmsClient.playPlaylistIndex(activePlayer.id, 0);
      await lmsClient.play(activePlayer.id);

      console.log('[Shuffle] Started playback (first track), queue will fill in background');

      // Stop the spinner once playback is kicked off (don't wait for 1000 adds).
      setIsShuffling(false);

      // Enqueue remaining tracks in small batches with light backpressure.
      // Fire-and-forget so UI stays responsive.
      setTimeout(async () => {
        const BATCH_SIZE = 10;
        let added = 1;
        let failed = 0;
        for (let i = 0; i < restIds.length; i += BATCH_SIZE) {
          const batch = restIds.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map((id) => lmsClient.addTrackToPlaylist(activePlayer.id, id))
          );
          results.forEach((r, idx) => {
            if (r.status === 'fulfilled') {
              added += 1;
            } else {
              failed += 1;
              console.warn(`[Shuffle] Failed to add track ${batch[idx]}:`, r.reason);
            }
          });
          // Keep LMS responsive; small delay between batches.
          if (i + BATCH_SIZE < restIds.length) {
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
        }
        console.log(`[Shuffle] Queue fill complete: added=${added}/${trackIds.length}, failed=${failed}`);
      }, 0);

      // Sync status so UI updates quickly
      setTimeout(() => {
        syncPlayerStatus();
      }, 500);
    } catch (error) {
      console.error('Failed to shuffle all tracks:', error);
      // Show error to user
      Alert.alert(
        'Shuffle Failed',
        `Failed to shuffle library: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease try again or check your connection.`,
        [{ text: 'OK' }]
      );
    } finally {
      // Note: in the success path we already set this to false after starting playback.
      // Keep the safety net for error paths.
      setIsShuffling(false);
    }
  }, [activePlayer, activeServer, isShuffling, playTrack, syncPlayerStatus, tidalConnected, tidalEnabled]);

  // Allow global header Shuffle to route here and trigger Shuffle All.
  useEffect(() => {
    if ((route.params as any)?.autoShuffle) {
      // Clear flag first to avoid repeat triggers on re-render.
      (navigation as any).setParams?.({ autoShuffle: undefined });
      handleShuffleAll();
    }
  }, [route.params, navigation, handleShuffleAll]);

  const handleRecentItemPress = useCallback(
    async (item: RecentItem) => {
      if (!activePlayer || !activeServer) return;

      if (item.kind === "playlist") {
        // Play the playlist
        try {
          lmsClient.setServer(activeServer.host, activeServer.port);
          await playPlaylist(item.playlistId, item.name, item.artwork);
        } catch (error) {
          console.error("Failed to play playlist from Recently Played:", error);
        }
        return;
      }

      if (item.kind === "track") {
        // Replay the specific track
        playTrack(item.track);
        return;
      }

      // Album: play the whole album again if we have an albumId
      const { track } = item;
      if (!track.albumId) {
        // Fallback: just play the track if album id is missing
        playTrack(track);
        return;
      }

      try {
        lmsClient.setServer(activeServer.host, activeServer.port);
        await lmsClient.setPower(activePlayer.id, true);
        await lmsClient.playAlbum(activePlayer.id, track.albumId);
        await lmsClient.play(activePlayer.id);
      } catch (error) {
        console.error("Failed to play album from Recently Played:", error);
      }
    },
    [activePlayer, activeServer, playTrack, playPlaylist]
  );

  // Load Tidal albums for the Browse screen
  useEffect(() => {
    const loadTidalBrowseData = async () => {
      if (!tidalEnabled || !tidalConnected) {
        setTidalAlbums([]);
        setTidalPlaylists([]);
        setTidalMixes([]);
        return;
      }
      try {
        const { getApiUrl } = await import('@/lib/query-client');
        const base = getApiUrl();

        const [albumsResp, playlistsResp, mixesResp] = await Promise.all([
          fetch(`${base}/api/tidal/albums?limit=30`),
          fetch(`${base}/api/tidal/playlists?limit=20`),
          fetch(`${base}/api/tidal/mixes`),
        ]);

        // Albums
        if (albumsResp.ok) {
          const data = await albumsResp.json();
          const albums = (data.items || []).map((album: any) => ({
            id: `tidal-${album.id}`,
            title: album.title,
            artist: album.artist,
            artistId: album.artistId || '',
            artwork_url: album.artwork_url,
            year: album.year,
            trackCount: album.numberOfTracks,
            lmsUri: album.lmsUri,
            source: 'tidal' as const,
            addedAt: album.addedAt || undefined,
          }));
          setTidalAlbums(albums);
        } else {
          console.warn('Failed to fetch Tidal albums:', albumsResp.status);
          setTidalAlbums([]);
        }

        // Playlists (currently not rendered on Browse, but used elsewhere / future)
        if (playlistsResp.ok) {
          const data = await playlistsResp.json();
          const pls = (data.items || []).map((p: any) => ({
            id: `tidal-${p.id}`,
            name: p.title,
            url: p.lmsUri,
            artwork_url: p.artwork_url,
            trackCount: p.numberOfTracks,
            source: 'tidal' as const,
          }));
          setTidalPlaylists(pls);
        } else {
          setTidalPlaylists([]);
        }

        // Mixes
        if (mixesResp.ok) {
          const data = await mixesResp.json();
          const raw = Array.isArray(data?.items) ? data.items : [];
          const mixes = raw
            .map((m: any) => {
              const id = m?.id ? String(m.id) : "";
              if (!id) return null;
              return {
                id,
                title: m?.title || m?.name || "Mix",
                description: m?.description || m?.subtitle || "",
                artwork_url: m?.artwork_url || m?.artworkUrl || m?.imageUrl || m?.image || null,
                lmsUri: m?.lmsUri || m?.uri || (id ? `tidal://mix:${id}` : null),
              };
            })
            .filter(Boolean);
          setTidalMixes(mixes as any[]);
        } else {
          setTidalMixes([]);
        }
      } catch (e) {
        debugLog.info(
          "Tidal browse not available",
          e instanceof Error ? e.message : String(e),
        );
        setTidalAlbums([]);
        setTidalPlaylists([]);
        setTidalMixes([]);
      }
    };
    loadTidalBrowseData();
  }, [tidalEnabled, tidalConnected]);

  return (
    <ThemedView style={styles.container}>
      <AppHeader title="Browse" onPressShuffle={handleShuffleAll} />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: tabBarHeight + Spacing["5xl"] },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={musicLoading}
            onRefresh={handleRefresh}
            tintColor={Colors.light.accent}
          />
        }
      >

        {/* Recent selector (Played / Added) */}
        {(recentItems.length > 0 || recentlyAdded.length > 0) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.recentTabs}>
                <Pressable
                  style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => setRecentTab("played")}
                >
                  <View style={styles.recentTabItem}>
                    <ThemedText
                      style={[
                        styles.recentTabText,
                        recentTab === "played" && styles.recentTabTextActive,
                      ]}
                    >
                      Recently Played
                    </ThemedText>
                    {/* Always reserve underline space so the inactive tab doesn't "drop" vertically */}
                    <View
                      style={[
                        styles.recentTabIndicator,
                        recentTab !== "played" && styles.recentTabIndicatorHidden,
                      ]}
                    />
                  </View>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => setRecentTab("added")}
                >
                  <View style={styles.recentTabItem}>
                    <ThemedText
                      style={[
                        styles.recentTabText,
                        recentTab === "added" && styles.recentTabTextActive,
                      ]}
                    >
                      Recently Added
                    </ThemedText>
                    {/* Always reserve underline space so the inactive tab doesn't "drop" vertically */}
                    <View
                      style={[
                        styles.recentTabIndicator,
                        recentTab !== "added" && styles.recentTabIndicatorHidden,
                      ]}
                    />
                  </View>
                </Pressable>
              </View>
            </View>

            {recentTab === "played" ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              >
                {recentItems.map((item) => {
                  if (item.kind === "playlist") {
                    return (
                      <Pressable
                        key={item.id}
                        style={({ pressed }) => [
                          styles.smallCard,
                          { width: browseTileSize },
                          { opacity: pressed ? 0.6 : 1 },
                        ]}
                        onPress={() => handleRecentItemPress(item)}
                      >
                        <AlbumArtwork
                          source={item.artwork}
                          style={[styles.smallImage, { width: browseTileSize, height: browseTileSize }]}
                          contentFit="cover"
                        />
                        <ThemedText style={styles.smallTitle} numberOfLines={1}>
                          {item.name}
                        </ThemedText>
                        <ThemedText style={styles.smallSubtitle} numberOfLines={1}>
                          Playlist
                        </ThemedText>
                      </Pressable>
                    );
                  }

                  const track = item.track;
                  const title =
                    item.kind === "track"
                      ? track.title
                      : track.album || track.title;
                  const subtitle = track.artist;

                  return (
                    <Pressable
                      key={item.id}
                      style={({ pressed }) => [
                        styles.smallCard,
                        { width: browseTileSize },
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                      onPress={() => handleRecentItemPress(item)}
                    >
                      <AlbumArtwork
                        source={track.albumArt}
                        style={[styles.smallImage, { width: browseTileSize, height: browseTileSize }]}
                        contentFit="cover"
                      />
                      <ThemedText style={styles.smallTitle} numberOfLines={1}>
                        {title}
                      </ThemedText>
                      <ThemedText style={styles.smallSubtitle} numberOfLines={1}>
                        {subtitle}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              >
                {isLoadingRecentlyAdded ? (
                  <View style={[styles.smallCard, { width: browseTileSize, justifyContent: "center", alignItems: "center" }]}>
                    <ActivityIndicator size="small" color={Colors.light.accent} />
                  </View>
                ) : (
                  recentlyAdded.map((album) => (
                    <Pressable
                      key={`${album.source}-${album.id}`}
                      style={({ pressed }) => [
                        styles.smallCard,
                        { width: browseTileSize },
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                      onPress={() => {
                        navigation.navigate("Album", {
                          id: album.id,
                          name: album.title,
                          artistName: album.artist,
                          source: album.source === "tidal" ? "tidal" : "local",
                        });
                      }}
                    >
                      <AlbumArtwork
                        source={album.artwork_url}
                        style={[styles.smallImage, { width: browseTileSize, height: browseTileSize }]}
                        contentFit="cover"
                      />
                      <ThemedText style={styles.smallTitle} numberOfLines={1}>
                        {album.title}
                      </ThemedText>
                      <ThemedText style={styles.smallSubtitle} numberOfLines={1}>
                        {album.artist}
                      </ThemedText>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            )}
          </View>
        )}

        {/* Tidal Custom Mixes Section */}
        {(tidalEnabled && tidalConnected) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Custom Mixes</ThemedText>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {tidalMixes.length === 0 ? (
                <View style={[styles.smallCard, { width: browseTileSize, justifyContent: "center", alignItems: "center" }]}>
                  <ThemedText style={styles.smallSubtitle} numberOfLines={2}>
                    No mixes found
                  </ThemedText>
                </View>
              ) : tidalMixes.map((mix) => (
                <Pressable
                  key={mix.id}
                  style={({ pressed }) => [
                    styles.smallCard,
                    { width: browseTileSize },
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                  onPress={() => {
                    if (activePlayer && mix.lmsUri) {
                      // Mix URIs are not numeric LMS playlist ids; play as URI.
                      lmsClient.playUri(activePlayer.id, mix.lmsUri);
                    } else if (!activePlayer) {
                      Alert.alert('No Player', 'Please select a player first.');
                    }
                  }}
                >
                  <AlbumArtwork
                    source={mix.artwork_url}
                    style={[styles.smallImage, { width: browseTileSize, height: browseTileSize }]}
                    contentFit="cover"
                  />
                  <ThemedText style={styles.smallTitle} numberOfLines={1}>
                    {mix.title}
                  </ThemedText>
                  <ThemedText style={styles.smallSubtitle} numberOfLines={1}>
                    {mix.description || 'Tidal Mix'}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Artists Section */}
        {allArtists.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Artists A-Z</ThemedText>
              <Pressable
                onPress={() => navigation.navigate("AllArtists")}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <ThemedText style={styles.viewAll}>See all</ThemedText>
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              onScroll={(event) => {
                const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                // Load more when user scrolls near the end (within 200px)
                if (contentOffset.x + layoutMeasurement.width >= contentSize.width - 200) {
                  if (hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                  }
                }
              }}
              scrollEventThrottle={400}
            >
              {allArtists.map((artist: Artist) => (
                <Pressable
                  key={artist.id}
                  style={({ pressed }) => [
                    styles.smallCard,
                    { width: browseTileSize },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() =>
                    navigation.navigate("Artist", {
                      id: artist.id,
                      name: artist.name,
                    })
                  }
                >
                  {artist.imageUrl ? (
                    <Image
                      source={artist.imageUrl}
                      style={[styles.artistImageRound, { width: browseTileSize, height: browseTileSize, borderRadius: browseTileSize / 2 }]}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[styles.artistImageRoundPlaceholder, { width: browseTileSize, height: browseTileSize, borderRadius: browseTileSize / 2 }]}>
                      <Feather
                        name="user"
                        size={32}
                        color={Colors.light.textTertiary}
                      />
                    </View>
                  )}
                  <ThemedText
                    style={styles.smallTitle}
                    numberOfLines={1}
                  >
                    {artist.name}
                  </ThemedText>
                </Pressable>
              ))}
              {isFetchingNextPage && (
                <View style={[styles.smallCard, { width: browseTileSize, justifyContent: 'center', alignItems: 'center' }]}>
                  <ActivityIndicator size="small" color={Colors.light.textSecondary} />
                </View>
              )}
            </ScrollView>
          </View>
        ) : null}

        {/* Tidal Section - Shows when enabled */}
        {tidalEnabled && (
          <View
            style={styles.section}
            onLayout={(e) => setTidalSectionY(e.nativeEvent.layout.y)}
          >
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Tidal</ThemedText>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {tidalConnected && tidalAlbums.length > 0 ? (
                tidalAlbums.slice(0, 20).map((album) => (
                  <Pressable
                    key={album.id}
                    style={({ pressed }) => [
                      styles.smallCard,
                      { width: browseTileSize },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                    onPress={() => {
                      navigation.navigate('Album', {
                        id: album.id,
                        name: album.title,
                        artistName: album.artist,
                        source: 'tidal',
                      });
                    }}
                  >
                    <AlbumArtwork
                      source={album.artwork_url}
                      style={[styles.smallImage, { width: browseTileSize, height: browseTileSize }]}
                      contentFit="cover"
                    />
                    <ThemedText style={styles.smallTitle} numberOfLines={1}>
                      {album.title}
                    </ThemedText>
                    <ThemedText style={styles.smallSubtitle} numberOfLines={1}>
                      {album.artist}
                    </ThemedText>
                  </Pressable>
                ))
              ) : tidalConnected ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.smallCard,
                    { width: browseTileSize },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => navigation.navigate('TidalBrowse')}
                >
                  <View style={[styles.artistImageRoundPlaceholder, { width: browseTileSize, height: browseTileSize, borderRadius: browseTileSize / 2, backgroundColor: '#000000' }]}>
                    <Feather name="music" size={32} color="white" />
                  </View>
                  <ThemedText style={styles.smallTitle} numberOfLines={1}>
                    My Music
                  </ThemedText>
                  <ThemedText style={styles.smallSubtitle} numberOfLines={1}>
                    Tidal
                  </ThemedText>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.smallCard,
                    { width: browseTileSize },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => navigation.navigate('Settings')}
                >
                  <View style={[styles.artistImageRoundPlaceholder, { width: browseTileSize, height: browseTileSize, borderRadius: browseTileSize / 2, backgroundColor: '#1DB954' }]}>
                    <Feather name="log-in" size={32} color="white" />
                  </View>
                  <ThemedText style={styles.smallTitle} numberOfLines={1}>
                    Connect
                  </ThemedText>
                  <ThemedText style={styles.smallSubtitle} numberOfLines={1}>
                    Tidal
                  </ThemedText>
                </Pressable>
              )}
            </ScrollView>
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundRoot,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.title,
    color: Colors.light.text,
  },
  recentTabs: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.lg,
  },
  recentTabItem: {
    // Center the underline beneath the label (looks cleaner on web/large screens)
    alignItems: "center",
  },
  recentTabText: {
    ...Typography.title,
    fontSize: 20,
    fontWeight: "700",
    color: Colors.light.textSecondary,
  },
  recentTabTextActive: {
    color: Colors.light.text,
  },
  // Short underline indicator (not full text width)
  recentTabIndicator: {
    height: 4,
    width: 54,
    borderRadius: 2,
    marginTop: 6,
    backgroundColor: Colors.light.text,
    alignSelf: "center",
  },
  recentTabIndicatorHidden: {
    opacity: 0,
  },
  viewAll: {
    ...Typography.caption,
    color: Colors.light.accent,
  },
  horizontalList: {
    gap: Spacing.md,
    paddingRight: Spacing.lg,
  },
  smallCard: {
    // Width is set dynamically via browseTileSize for consistent sizing across sections
  },
  smallImage: {
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
    backgroundColor: Colors.light.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  smallTitle: {
    ...Typography.caption,
    color: Colors.light.text,
    fontWeight: "500",
  },
  smallSubtitle: {
    ...Typography.label,
    color: Colors.light.textSecondary,
  },
  artistImageRound: {
    marginBottom: Spacing.xs,
  },
  artistImageRoundPlaceholder: {
    backgroundColor: "#4A4A4E",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
});