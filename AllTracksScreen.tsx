import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Pressable,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Image } from "expo-image";

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

export default function AllTracksScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { activeServer, recentlyPlayed } = useMusic();
  const { activePlayer, playTrack } = usePlayback();
  const { qobuzEnabled, spotifyEnabled, tidalEnabled } = useSettings();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortOption, setSortOption] = useState<SortOption>("alphabetical");

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
        
        // Load tracks from standard LMS library (includes Tidal, Spotify, SoundCloud, Qobuz, and local)
        const lmsTracks: LmsTrack[] = await lmsClient.getAllLibraryTracks(5000);
        const localTracks: Track[] = lmsTracks
          .filter(t => {
            // Filter out Spotify and Tidal tracks if disabled
            if (!spotifyEnabled || !tidalEnabled) {
              const url = (t.url || '').toLowerCase();
              const id = (t.id || '').toLowerCase();
              if (!spotifyEnabled && (url.includes('spotify') || id.includes('spotify'))) {
                return false;
              }
              if (!tidalEnabled && (url.includes('tidal') || id.includes('tidal'))) {
                return false;
              }
            }
            return true;
          })
          .map((t) => {
            // Identify source from URL/ID
            const url = (t.url || '').toLowerCase();
            const id = (t.id || '').toLowerCase();
            let source: "local" | "qobuz" | "tidal" | "spotify" | "soundcloud" = "local";
            if (url.includes('tidal') || id.includes('tidal')) {
              source = 'tidal';
            } else if (url.includes('spotify') || id.includes('spotify')) {
              source = 'spotify';
            } else if (url.includes('qobuz') || id.includes('qobuz')) {
              source = 'qobuz';
            } else if (url.includes('soundcloud') || id.includes('soundcloud')) {
              source = 'soundcloud';
            }
            
            return {
              id: `${activeServer.id}-${t.id}`,
              title: t.title,
              artist: t.artist,
              album: t.album,
              albumId: t.albumId,
              albumArt: t.artwork_url ? lmsClient.getArtworkUrl(t as any) : undefined,
              duration: t.duration,
              source,
              uri: t.url,
              format: t.format,
              bitrate: t.bitrate,
              sampleRate: t.sampleRate,
              bitDepth: t.bitDepth,
              lmsTrackId: t.id,
            };
          });

        // Load Qobuz favorite tracks (only if enabled)
        let qobuzTracks: Track[] = [];
        if (qobuzEnabled) {
          try {
            const qobuzLmsTracks = await lmsClient.getQobuzFavoriteTracks();
            qobuzTracks = qobuzLmsTracks.map((t) => ({
              id: `qobuz-${t.id}`,
              title: t.title,
              artist: t.artist,
              album: t.album,
              albumId: t.albumId,
              albumArt: t.artwork_url ? lmsClient.getArtworkUrl(t as any) : undefined,
              duration: t.duration,
              source: "qobuz",
              uri: t.url,
              format: t.format,
              bitrate: t.bitrate,
              sampleRate: t.sampleRate,
              bitDepth: t.bitDepth,
              lmsTrackId: t.id,
            }));
          } catch (e) {
            console.error("Failed to load Qobuz favorite tracks:", e);
          }
        }

        // Tidal tracks are already included in localTracks from getAllLibraryTracks
        // They are identified by checking URL/ID for "tidal" in the standard library query
        // No need to fetch separately - Tidal content comes from LMS standard library queries
        // The filtering above already handles Tidal tracks based on tidalEnabled setting

        // Merge tracks, avoiding duplicates by ID
        // Tidal tracks are already included in localTracks from the standard library query
        const allTracks = [...localTracks];
        const existingIds = new Set(localTracks.map(t => t.lmsTrackId));
        qobuzTracks.forEach(t => {
          if (!existingIds.has(t.lmsTrackId)) {
            allTracks.push(t);
            existingIds.add(t.lmsTrackId);
          }
        });

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

  const sortedTracks = useMemo(() => {
    let list = [...tracks];

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
  }, [tracks, sortOption, recentlyPlayed]);

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
});
