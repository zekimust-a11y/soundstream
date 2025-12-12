import React, { useCallback, memo } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Dimensions,
  ActivityIndicator,
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
import { useAlbumsPreview, useArtistsPreview, Album, Artist } from "@/hooks/useLibrary";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

const { width } = Dimensions.get("window");
const ALBUM_SIZE = (width - Spacing.lg * 3) / 2;

type NavigationProp = NativeStackNavigationProp<BrowseStackParamList>;

const AlbumCard = memo(({ album, onPress }: { album: Album; onPress: () => void }) => (
  <Pressable
    style={({ pressed }) => [
      styles.albumCard,
      { opacity: pressed ? 0.6 : 1 },
    ]}
    onPress={onPress}
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
));

const ArtistCard = memo(({ artist, onPress }: { artist: Artist; onPress: () => void }) => (
  <Pressable
    style={({ pressed }) => [
      styles.artistCard,
      { opacity: pressed ? 0.6 : 1 },
    ]}
    onPress={onPress}
  >
    <View style={styles.artistImageContainer}>
      <View style={styles.artistPlaceholder}>
        <Feather name="user" size={32} color={Colors.light.textTertiary} />
      </View>
    </View>
    <ThemedText style={styles.artistName} numberOfLines={1}>
      {artist.name}
    </ThemedText>
    <ThemedText style={styles.artistAlbums}>
      {artist.albumCount || 0} albums
    </ThemedText>
  </Pressable>
));

export default function BrowseScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const { recentlyPlayed, refreshLibrary } = useMusic();
  const { playTrack } = usePlayback();
  
  const { data: albumsData, isLoading: albumsLoading, refetch: refetchAlbums } = useAlbumsPreview(20);
  const { data: artistsData, isLoading: artistsLoading, refetch: refetchArtists } = useArtistsPreview(20);

  const isLoading = albumsLoading || artistsLoading;
  const albums = albumsData?.albums || [];
  const albumsTotal = albumsData?.total || 0;
  const artists = artistsData?.artists || [];
  const artistsTotal = artistsData?.total || 0;

  const handleRefresh = useCallback(() => {
    refetchAlbums();
    refetchArtists();
    refreshLibrary();
  }, [refetchAlbums, refetchArtists, refreshLibrary]);

  const handleArtistPress = useCallback((artist: Artist) => {
    navigation.navigate("Artist", { id: artist.id, name: artist.name });
  }, [navigation]);

  const handleAlbumPress = useCallback((album: Album) => {
    navigation.navigate("Album", { id: album.id, name: album.name, artistName: album.artist });
  }, [navigation]);

  const handleViewAllAlbums = useCallback(() => {
    navigation.navigate("AllAlbums");
  }, [navigation]);

  const handleViewAllArtists = useCallback(() => {
    navigation.navigate("AllArtists");
  }, [navigation]);

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <HeaderTitle />
        <View style={styles.headerRight}>
          <Pressable
            style={({ pressed }) => [styles.filterButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather name="sliders" size={20} color={Colors.light.text} />
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
            onRefresh={handleRefresh}
            tintColor={Colors.light.accent}
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
            <Pressable 
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              onPress={handleViewAllArtists}
            >
              <ThemedText style={styles.viewAll}>
                View All ({artistsTotal.toLocaleString()})
              </ThemedText>
            </Pressable>
          </View>
          {artistsLoading ? (
            <ActivityIndicator color={Colors.light.accent} style={styles.loader} />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {artists.map((artist) => (
                <ArtistCard
                  key={artist.id}
                  artist={artist}
                  onPress={() => handleArtistPress(artist)}
                />
              ))}
            </ScrollView>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionTitle}>Albums</ThemedText>
            <Pressable 
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              onPress={handleViewAllAlbums}
            >
              <ThemedText style={styles.viewAll}>
                View All ({albumsTotal.toLocaleString()})
              </ThemedText>
            </Pressable>
          </View>
          {albumsLoading ? (
            <ActivityIndicator color={Colors.light.accent} style={styles.loader} />
          ) : (
            <View style={styles.albumGrid}>
              {albums.map((album) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  onPress={() => handleAlbumPress(album)}
                />
              ))}
            </View>
          )}
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
    color: Colors.light.text,
  },
  viewAll: {
    ...Typography.body,
    color: Colors.light.accent,
  },
  horizontalList: {
    gap: Spacing.md,
  },
  loader: {
    padding: Spacing.xl,
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
    color: Colors.light.text,
    fontWeight: "500",
  },
  recentArtist: {
    ...Typography.label,
    color: Colors.light.textSecondary,
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
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
  },
  artistName: {
    ...Typography.caption,
    color: Colors.light.text,
    fontWeight: "500",
    textAlign: "center",
  },
  artistAlbums: {
    ...Typography.label,
    color: Colors.light.textSecondary,
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
    color: Colors.light.text,
  },
  albumArtist: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
  },
  albumYear: {
    ...Typography.label,
    color: Colors.light.textTertiary,
    marginTop: Spacing.xs,
  },
});
