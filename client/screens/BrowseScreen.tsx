import React, { useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { HeaderTitle } from "@/components/HeaderTitle";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

const { width } = Dimensions.get("window");
const ALBUM_SIZE = (width - Spacing.lg * 3) / 2;

type NavigationProp = NativeStackNavigationProp<BrowseStackParamList>;

export default function BrowseScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const { artists, albums, recentlyPlayed, isLoading, refreshLibrary, activeServer } = useMusic();
  const { playTrack } = usePlayback();

  const handleArtistPress = useCallback((artist: { id: string; name: string }) => {
    navigation.navigate("Artist", { id: artist.id, name: artist.name });
  }, [navigation]);

  const handleAlbumPress = useCallback((album: { id: string; name: string; artist: string }) => {
    navigation.navigate("Album", { id: album.id, name: album.name, artistName: album.artist });
  }, [navigation]);

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <HeaderTitle />
        <View style={styles.headerRight}>
          {activeServer ? (
            <View style={styles.serverIndicator}>
              <View style={styles.serverDot} />
              <ThemedText style={styles.serverName}>{activeServer.name}</ThemedText>
            </View>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.filterButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather name="sliders" size={20} color={Colors.dark.text} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: tabBarHeight + Spacing["5xl"] },
        ]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refreshLibrary}
            tintColor={Colors.dark.accent}
          />
        }
      >
        {recentlyPlayed.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Recently Played</ThemedText>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {recentlyPlayed.slice(0, 10).map((track) => (
                <Pressable
                  key={track.id}
                  style={({ pressed }) => [
                    styles.recentCard,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                  onPress={() => playTrack(track)}
                >
                  <Image
                    source={track.albumArt || require("../assets/images/placeholder-album.png")}
                    style={styles.recentImage}
                    contentFit="cover"
                  />
                  <ThemedText style={styles.recentTitle} numberOfLines={1}>
                    {track.title}
                  </ThemedText>
                  <ThemedText style={styles.recentArtist} numberOfLines={1}>
                    {track.artist}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionTitle}>Artists</ThemedText>
            <Pressable style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <ThemedText style={styles.viewAll}>View All</ThemedText>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}
          >
            {artists.map((artist) => (
              <Pressable
                key={artist.id}
                style={({ pressed }) => [
                  styles.artistCard,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
                onPress={() => handleArtistPress(artist)}
              >
                <View style={styles.artistImageContainer}>
                  <View style={styles.artistPlaceholder}>
                    <Feather name="user" size={32} color={Colors.dark.textTertiary} />
                  </View>
                </View>
                <ThemedText style={styles.artistName} numberOfLines={1}>
                  {artist.name}
                </ThemedText>
                <ThemedText style={styles.artistAlbums}>
                  {artist.albumCount} albums
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionTitle}>Albums</ThemedText>
            <Pressable style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <ThemedText style={styles.viewAll}>View All</ThemedText>
            </Pressable>
          </View>
          <View style={styles.albumGrid}>
            {albums.map((album) => (
              <Pressable
                key={album.id}
                style={({ pressed }) => [
                  styles.albumCard,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
                onPress={() => handleAlbumPress(album)}
              >
                <Image
                  source={album.imageUrl || require("../assets/images/placeholder-album.png")}
                  style={styles.albumImage}
                  contentFit="cover"
                />
                <ThemedText style={styles.albumTitle} numberOfLines={1}>
                  {album.name}
                </ThemedText>
                <ThemedText style={styles.albumArtist} numberOfLines={1}>
                  {album.artist}
                </ThemedText>
                {album.year ? (
                  <ThemedText style={styles.albumYear}>{album.year}</ThemedText>
                ) : null}
              </Pressable>
            ))}
          </View>
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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  serverIndicator: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundSecondary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  serverDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.dark.success,
    marginRight: Spacing.xs,
  },
  serverName: {
    ...Typography.caption,
    color: Colors.dark.textSecondary,
  },
  filterButton: {
    padding: Spacing.sm,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    ...Typography.title,
    color: Colors.dark.text,
  },
  viewAll: {
    ...Typography.body,
    color: Colors.dark.accent,
  },
  horizontalList: {
    gap: Spacing.md,
  },
  recentCard: {
    width: 120,
  },
  recentImage: {
    width: 120,
    height: 120,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.sm,
  },
  recentTitle: {
    ...Typography.caption,
    color: Colors.dark.text,
    fontWeight: "500",
  },
  recentArtist: {
    ...Typography.label,
    color: Colors.dark.textSecondary,
  },
  artistCard: {
    width: 100,
    alignItems: "center",
  },
  artistImageContainer: {
    marginBottom: Spacing.sm,
  },
  artistPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.dark.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
  },
  artistName: {
    ...Typography.caption,
    color: Colors.dark.text,
    fontWeight: "500",
    textAlign: "center",
  },
  artistAlbums: {
    ...Typography.label,
    color: Colors.dark.textSecondary,
    textAlign: "center",
  },
  albumGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.lg,
  },
  albumCard: {
    width: ALBUM_SIZE,
  },
  albumImage: {
    width: ALBUM_SIZE,
    height: ALBUM_SIZE,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.sm,
  },
  albumTitle: {
    ...Typography.headline,
    color: Colors.dark.text,
  },
  albumArtist: {
    ...Typography.caption,
    color: Colors.dark.textSecondary,
  },
  albumYear: {
    ...Typography.label,
    color: Colors.dark.textTertiary,
    marginTop: Spacing.xs,
  },
});
