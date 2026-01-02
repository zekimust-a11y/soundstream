import React, { useState, useEffect, useLayoutEffect } from "react";
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
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
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

type FilterType = "all" | "cd" | "hires";

function isHiRes(sampleRate?: string, bitDepth?: string): boolean {
  if (!sampleRate && !bitDepth) return false;
  
  const rate = sampleRate ? parseFloat(sampleRate.toString().replace(/[^0-9.]/g, '')) : 0;
  const bits = bitDepth ? parseInt(bitDepth.toString().replace(/[^0-9]/g, '')) : 0;
  
  // Hi-Res: > 48kHz or > 16-bit
  return rate > 48000 || bits > 16;
}

export default function AlbumScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation();
  const headerHeight = useHeaderHeight();
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
  const [filter, setFilter] = useState<FilterType>("all");

  useEffect(() => {
    async function loadTracks() {
      setIsLoading(true);
      try {
        // Use source from route params if available, otherwise detect from albumId
        const source = route.params.source || 
                      (route.params.id.startsWith('tidal-') ? "tidal" : 
                      undefined);
        
        const albumTracks = await getAlbumTracks(route.params.id, source as any);
        setAllTracks(albumTracks);
        if (albumTracks.length > 0) {
          if (albumTracks[0].albumArt || albumTracks[0].artwork_url) {
            setAlbumImageUrl(albumTracks[0].albumArt || albumTracks[0].artwork_url);
          }
          if (albumTracks[0].source) {
            setAlbumSource(albumTracks[0].source as any);
          } else if (source) {
            setAlbumSource(source as any);
          }
        }
      } catch (error) {
        console.error("Failed to load album tracks:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadTracks();
  }, [route.params.id, route.params.source, getAlbumTracks]);

  // Filter tracks based on selected filter
  useEffect(() => {
    if (filter === "all") {
      setTracks(allTracks);
    } else if (filter === "cd") {
      // CD Quality: <= 48kHz and <= 16-bit, or no sample rate info (assume CD quality)
      setTracks(allTracks.filter(track => {
        if (!track.sampleRate && !track.bitDepth) return true; // Unknown = show in CD
        return !isHiRes(track.sampleRate, track.bitDepth);
      }));
    } else if (filter === "hires") {
      // Hi-Res: > 48kHz or > 16-bit (must have sample rate info)
      setTracks(allTracks.filter(track => isHiRes(track.sampleRate, track.bitDepth)));
    }
  }, [filter, allTracks]);

  // Set up header filter button
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={handleFilterPress}
          style={({ pressed }) => [
            { marginRight: Spacing.md, padding: Spacing.xs, opacity: pressed ? 0.6 : 1 }
          ]}
        >
          <Feather 
            name="filter" 
            size={20} 
            color={filter !== "all" ? Colors.light.accent : Colors.light.text} 
          />
        </Pressable>
      ),
    });
  }, [navigation, filter]);

  const handleFilterPress = () => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "All", "CD Quality", "Hi-Res"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) setFilter("all");
          else if (buttonIndex === 2) setFilter("cd");
          else if (buttonIndex === 3) setFilter("hires");
        }
      );
    } else {
      // For Android/web, we'll use a simple toggle for now
      // Could implement a modal or bottom sheet here
      const filters: FilterType[] = ["all", "cd", "hires"];
      const currentIndex = filters.indexOf(filter);
      const nextIndex = (currentIndex + 1) % filters.length;
      setFilter(filters[nextIndex]);
    }
  };

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
          { paddingTop: headerHeight + Spacing.xl, paddingBottom: tabBarHeight + Spacing["5xl"] },
        ]}
      >
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
                  {filter !== "all" && (
                    <ThemedText style={[styles.albumMeta, { color: Colors.light.accent }]}>
                      {filter === "cd" ? "CD Quality" : "Hi-Res"} •{" "}
                    </ThemedText>
                  )}
                  {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
                  {filter !== "all" && allTracks.length > 0 && (
                    <ThemedText style={[styles.albumMeta, { color: Colors.light.textTertiary }]}>
                      {" "}(of {allTracks.length})
                    </ThemedText>
                  )}
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
