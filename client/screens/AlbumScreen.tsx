import React from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
} from "react-native";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

const { width } = Dimensions.get("window");
const ALBUM_ART_SIZE = width * 0.6;

type RouteProps = RouteProp<BrowseStackParamList, "Album">;

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function AlbumScreen() {
  const route = useRoute<RouteProps>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { getAlbumTracks, albums, addToRecentlyPlayed } = useMusic();
  const { playTrack, addToQueue, currentTrack, isPlaying } = usePlayback();

  const album = albums.find((a) => a.id === route.params.id);
  const tracks = getAlbumTracks(route.params.id);

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks);
      addToRecentlyPlayed(tracks[0]);
    }
  };

  const handleTrackPress = (track: typeof tracks[0]) => {
    playTrack(track, tracks);
    addToRecentlyPlayed(track);
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.xl, paddingBottom: tabBarHeight + Spacing["5xl"] },
        ]}
      >
        <View style={styles.albumHeader}>
          <Image
            source={album?.imageUrl || require("../assets/images/placeholder-album.png")}
            style={styles.albumArt}
            contentFit="cover"
          />
          <ThemedText style={styles.albumTitle}>{route.params.name}</ThemedText>
          <ThemedText style={styles.albumArtist}>{route.params.artistName}</ThemedText>
          {album?.year ? (
            <ThemedText style={styles.albumMeta}>
              {album.year} • {tracks.length} tracks
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Button title="Play All" onPress={handlePlayAll} style={styles.playButton}>
            <Feather name="play" size={18} color={Colors.dark.buttonText} style={styles.playIcon} />
          </Button>
          <Pressable
            style={({ pressed }) => [styles.shuffleButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => {
              if (tracks.length > 0) {
                const randomIndex = Math.floor(Math.random() * tracks.length);
                playTrack(tracks[randomIndex], tracks);
              }
            }}
          >
            <Feather name="shuffle" size={20} color={Colors.dark.accent} />
          </Pressable>
        </View>

        <View style={styles.trackList}>
          {tracks.map((track, index) => {
            const isCurrentTrack = currentTrack?.id === track.id;
            return (
              <Pressable
                key={track.id}
                style={({ pressed }) => [
                  styles.trackRow,
                  { opacity: pressed ? 0.6 : 1 },
                  isCurrentTrack && styles.trackRowActive,
                ]}
                onPress={() => handleTrackPress(track)}
              >
                <View style={styles.trackNumber}>
                  {isCurrentTrack && isPlaying ? (
                    <Feather name="volume-2" size={14} color={Colors.dark.accent} />
                  ) : (
                    <ThemedText style={styles.trackNumberText}>{index + 1}</ThemedText>
                  )}
                </View>
                <View style={styles.trackInfo}>
                  <ThemedText
                    style={[styles.trackTitle, isCurrentTrack && styles.trackTitleActive]}
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
                  <Feather name="plus" size={18} color={Colors.dark.textSecondary} />
                </Pressable>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  albumHeader: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  albumArt: {
    width: ALBUM_ART_SIZE,
    height: ALBUM_ART_SIZE,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.lg,
  },
  albumTitle: {
    ...Typography.title,
    color: Colors.dark.text,
    textAlign: "center",
  },
  albumArtist: {
    ...Typography.body,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.xs,
  },
  albumMeta: {
    ...Typography.caption,
    color: Colors.dark.textTertiary,
    marginTop: Spacing.xs,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.lg,
    marginBottom: Spacing["2xl"],
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
    borderColor: Colors.dark.border,
    justifyContent: "center",
    alignItems: "center",
  },
  trackList: {
    marginBottom: Spacing.xl,
  },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
  },
  trackRowActive: {
    backgroundColor: Colors.dark.backgroundSecondary,
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
    color: Colors.dark.textTertiary,
  },
  trackInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  trackTitle: {
    ...Typography.body,
    color: Colors.dark.text,
  },
  trackTitleActive: {
    color: Colors.dark.accent,
  },
  trackArtist: {
    ...Typography.caption,
    color: Colors.dark.textSecondary,
  },
  trackDuration: {
    ...Typography.caption,
    color: Colors.dark.textTertiary,
    marginRight: Spacing.md,
  },
  moreButton: {
    padding: Spacing.sm,
  },
});
