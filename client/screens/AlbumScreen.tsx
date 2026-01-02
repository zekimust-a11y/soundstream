import React, { useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  ActionSheetIOS,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { SourceBadge } from "@/components/SourceBadge";
import { AlbumArtwork } from "@/components/AlbumArtwork";
import { Button } from "@/components/Button";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback, type Track } from "@/hooks/usePlayback";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

type RouteProps = RouteProp<BrowseStackParamList, "Album">;

function formatDuration(duration: number): string {
  const totalSeconds = Math.round(duration);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function AlbumScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { width: windowWidth } = useWindowDimensions();
  const { getAlbumTracks, addToRecentlyPlayed } = useMusic();
  const { playTrack, addToQueue, currentTrack, isPlaying } = usePlayback();

  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [albumYear, setAlbumYear] = useState<number | undefined>();
  const [albumImageUrl, setAlbumImageUrl] = useState<string | undefined>();
  const [albumSource, setAlbumSource] = useState<"local"  | "tidal" | undefined>();

  useEffect(() => {
    async function loadTracks() {
      setIsLoading(true);
      try {
        // Prefer album-level source (route params / id prefix) so the badge doesn't
        // incorrectly inherit a stale value from a previous screen.
        const inferredSource =
          (route.params as any)?.source ||
          (route.params.id.startsWith("tidal-") ? "tidal" : "local");

        // Set immediately to avoid showing the wrong badge while tracks load
        setAlbumSource(inferredSource as any);
        
        const albumTracks = await getAlbumTracks(route.params.id, inferredSource as any);
        setAllTracks(albumTracks);
        if (albumTracks.length > 0) {
          if (albumTracks[0].albumArt || albumTracks[0].artwork_url) {
            setAlbumImageUrl(albumTracks[0].albumArt || albumTracks[0].artwork_url);
          }
          // Keep the album-level inferred source; do not override from track.source,
          // because track source detection can be imperfect for LMS metadata.
        }
      } catch (error) {
        console.error("Failed to load album tracks:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadTracks();
  }, [route.params.id, route.params.source, getAlbumTracks]);

  // No track quality filter UI on this page (requested).
  useEffect(() => {
    setTracks(allTracks);
  }, [allTracks]);

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks);
      addToRecentlyPlayed(tracks[0]);
    }
  };

  const handleTrackPress = (track: Track) => {
    playTrack(track, tracks);
    addToRecentlyPlayed(track);
  };

  const isDesktop = Platform.OS === "web" && windowWidth >= 900;
  const maxContentWidth = isDesktop ? 1180 : undefined;
  const albumArtSize = (() => {
    if (!isDesktop) return Math.max(180, Math.round(windowWidth * 0.6));
    const ideal = Math.round(windowWidth * 0.28);
    return Math.max(260, Math.min(420, ideal));
  })();

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.lg, paddingBottom: tabBarHeight + Spacing["5xl"] },
        ]}
      >
        <View style={styles.topRow}>
          <Pressable
            style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => (navigation as any).goBack()}
          >
            <Feather name="chevron-left" size={22} color={Colors.light.text} />
          </Pressable>
          <View style={styles.topRowSpacer} />
        </View>

        <View style={[styles.pageContainer, maxContentWidth ? { maxWidth: maxContentWidth } : null]}>
          <View style={[styles.albumHeader, isDesktop ? styles.albumHeaderDesktop : null]}>
            <View style={[styles.albumArtContainer, { width: albumArtSize }]}>
              <AlbumArtwork
                source={albumImageUrl}
                style={[styles.albumArt, { width: albumArtSize, height: albumArtSize }]}
                contentFit="cover"
              />
              <SourceBadge source={albumSource} size={24} />
            </View>

            <View style={[styles.albumInfo, isDesktop ? styles.albumInfoDesktop : null]}>
              <ThemedText style={[styles.albumTitle, isDesktop ? styles.albumTitleDesktop : null]}>
                {route.params.name}
              </ThemedText>
              <ThemedText style={[styles.albumArtist, isDesktop ? styles.albumArtistDesktop : null]}>
                {route.params.artistName}
              </ThemedText>
              {tracks.length > 0 || allTracks.length > 0 ? (
                <ThemedText style={[styles.albumMeta, isDesktop ? styles.albumMetaDesktop : null]}>
                  {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
                </ThemedText>
              ) : null}

              <View style={[styles.actions, isDesktop ? styles.actionsDesktop : null]}>
                <Button title="Play All" onPress={handlePlayAll} style={styles.playButton} disabled={tracks.length === 0}>
                  <Feather name="play" size={18} color={Colors.light.buttonText} style={styles.playIcon} />
                </Button>
                <Pressable
                  style={({ pressed }) => [styles.shuffleButton, { opacity: pressed ? 0.6 : 1 }]}
                  onPress={() => {
                    if (tracks.length > 0) {
                      const randomIndex = Math.floor(Math.random() * tracks.length);
                      playTrack(tracks[randomIndex], tracks);
                    }
                  }}
                  disabled={tracks.length === 0}
                >
                  <Feather name="shuffle" size={20} color={Colors.light.accent} />
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.trackList}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Colors.light.accent} />
              <ThemedText style={styles.loadingText}>Loading tracks...</ThemedText>
            </View>
          ) : tracks.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Feather name="music" size={48} color={Colors.light.textTertiary} />
              <ThemedText style={styles.emptyText}>No tracks found</ThemedText>
            </View>
          ) : (
            tracks.map((track, index) => {
              const isCurrentTrack = currentTrack?.id === track.id;
              return (
                <Pressable
                  key={track.id}
                  style={({ pressed }) => [
                    styles.trackRow,
                    { opacity: pressed ? 0.6 : 1 },
                    isCurrentTrack ? styles.trackRowActive : null,
                  ]}
                  onPress={() => handleTrackPress(track)}
                >
                  <View style={styles.trackNumber}>
                    {isCurrentTrack && isPlaying ? (
                      <Feather name="volume-2" size={14} color={Colors.light.accent} />
                    ) : (
                      <ThemedText style={styles.trackNumberText}>{index + 1}</ThemedText>
                    )}
                  </View>
                  <View style={styles.trackInfo}>
                    <ThemedText
                      style={[styles.trackTitle, isCurrentTrack ? styles.trackTitleActive : null]}
                      numberOfLines={1}
                    >
                      {track.title}
                    </ThemedText>
                    <ThemedText style={styles.trackArtist} numberOfLines={1}>
                      {track.artist}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.trackDuration}>
                    {formatDuration(track.duration)}
                  </ThemedText>
                  <Pressable
                    style={({ pressed }) => [styles.moreButton, { opacity: pressed ? 0.6 : 1 }]}
                    onPress={() => addToQueue(track)}
                  >
                    <Feather name="plus" size={18} color={Colors.light.textSecondary} />
                  </Pressable>
                </Pressable>
              );
            })
          )}
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundRoot,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.backgroundDefault,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
    justifyContent: "center",
    alignItems: "center",
  },
  topRowSpacer: {
    flex: 1,
  },
  pageContainer: {
    width: "100%",
    alignSelf: "center",
  },
  albumHeader: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  albumHeaderDesktop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    gap: Spacing["3xl"],
  },
  albumArtContainer: {
    position: "relative",
    marginBottom: Spacing.lg,
  },
  albumArt: {
    borderRadius: BorderRadius.xs,
    backgroundColor: Colors.light.backgroundSecondary,
  },
  albumInfo: {
    width: "100%",
    alignItems: "center",
  },
  albumInfoDesktop: {
    flex: 1,
    alignItems: "flex-start",
    paddingTop: Spacing.sm,
  },
  albumTitle: {
    ...Typography.title,
    color: Colors.light.text,
    textAlign: "center",
  },
  albumTitleDesktop: {
    textAlign: "left",
    fontSize: 28,
  },
  albumArtist: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    marginTop: Spacing.xs,
    textAlign: "center",
  },
  albumArtistDesktop: {
    textAlign: "left",
  },
  albumMeta: {
    ...Typography.caption,
    color: Colors.light.textTertiary,
    marginTop: Spacing.xs,
    textAlign: "center",
  },
  albumMetaDesktop: {
    textAlign: "left",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.lg,
    marginBottom: Spacing["2xl"],
  },
  actionsDesktop: {
    justifyContent: "flex-start",
    marginTop: Spacing.lg,
    marginBottom: 0,
  },
  playButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing["3xl"],
  },
  playIcon: {
    marginRight: Spacing.sm,
  },
  shuffleButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
    justifyContent: "center",
    alignItems: "center",
  },
  trackList: {
    marginBottom: Spacing.xl,
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["3xl"],
  },
  loadingText: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    marginTop: Spacing.md,
  },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  trackRowActive: {
    backgroundColor: Colors.light.backgroundSecondary,
    marginHorizontal: -Spacing.lg,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.xs,
  },
  trackNumber: {
    width: 28,
    alignItems: "center",
  },
  trackNumberText: {
    ...Typography.caption,
    color: Colors.light.textTertiary,
  },
  trackInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  trackTitle: {
    ...Typography.body,
    color: Colors.light.text,
  },
  trackTitleActive: {
    color: Colors.light.accent,
  },
  trackArtist: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
  },
  trackDuration: {
    ...Typography.caption,
    color: Colors.light.textTertiary,
    marginRight: Spacing.md,
  },
  moreButton: {
    padding: Spacing.sm,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["3xl"],
  },
  emptyText: {
    ...Typography.body,
    color: Colors.light.textTertiary,
    marginTop: Spacing.md,
  },
});
