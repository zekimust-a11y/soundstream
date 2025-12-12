import React, { useCallback, memo } from "react";
import {
  View,
  StyleSheet,
  FlatList,
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
import { useInfiniteAlbums, useArtistsPreview, Album, Artist } from "@/hooks/useLibrary";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

const { width } = Dimensions.get("window");
const NUM_COLUMNS = 2;
const ALBUM_SIZE = (width - Spacing.lg * 3) / NUM_COLUMNS;

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
      {artist.imageUrl ? (
        <Image
          source={artist.imageUrl}
          style={styles.artistImage}
          contentFit="cover"
        />
      ) : (
        <View style={styles.artistPlaceholder}>
          <Feather name="user" size={32} color={Colors.light.textTertiary} />
        </View>
      )}
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
  
  const { 
    data: albumsData, 
    isLoading: albumsLoading, 
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch: refetchAlbums 
  } = useInfiniteAlbums();
  
  const { data: artistsData, isLoading: artistsLoading, refetch: refetchArtists } = useArtistsPreview(20);

  const isLoading = albumsLoading || artistsLoading;
  const albums = albumsData?.pages.flatMap(page => page.albums) || [];
  const albumsTotal = albumsData?.pages[0]?.total || 0;
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

  const handleViewAllArtists = useCallback(() => {
    navigation.navigate("AllArtists");
  }, [navigation]);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderAlbum = useCallback(({ item, index }: { item: Album; index: number }) => (
    <AlbumCard album={item} onPress={() => handleAlbumPress(item)} />
  ), [handleAlbumPress]);

  const keyExtractor = useCallback((item: Album, index: number) => `album-${item.id}-${index}`, []);

  const ListHeader = useCallback(() => (
    <>
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

      {recentlyPlayed.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionTitle}>Recently Played</ThemedText>
          </View>
          <FlatList
            horizontal
            data={recentlyPlayed.slice(0, 10)}
            keyExtractor={(track) => `recent-${track.id}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}
            renderItem={({ item: track }) => (
              <Pressable
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
            )}
          />
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
          <FlatList
            horizontal
            data={artists}
            keyExtractor={(artist) => `artist-${artist.id}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}
            renderItem={({ item: artist }) => (
              <ArtistCard
                artist={artist}
                onPress={() => handleArtistPress(artist)}
              />
            )}
          />
        )}
      </View>

      <View style={styles.sectionHeader}>
        <ThemedText style={styles.sectionTitle}>Albums</ThemedText>
        <ThemedText style={styles.viewAll}>
          {albumsTotal.toLocaleString()} albums
        </ThemedText>
      </View>
    </>
  ), [insets.top, recentlyPlayed, playTrack, artistsLoading, artists, artistsTotal, albumsTotal, handleArtistPress, handleViewAllArtists]);

  const ListFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={Colors.light.accent} />
      </View>
    );
  }, [isFetchingNextPage]);

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={albums}
        renderItem={renderAlbum}
        keyExtractor={keyExtractor}
        numColumns={NUM_COLUMNS}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: tabBarHeight + Spacing["5xl"] },
        ]}
        columnWrapperStyle={styles.albumRow}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={handleRefresh}
            tintColor={Colors.light.accent}
          />
        }
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={10}
      />
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
    gap: Spacing.sm,
  },
  filterButton: {
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
  viewAll: {
    ...Typography.caption,
    color: Colors.light.accent,
  },
  horizontalList: {
    gap: Spacing.md,
    paddingRight: Spacing.lg,
  },
  recentCard: {
    width: 120,
  },
  recentImage: {
    width: 120,
    height: 120,
    borderRadius: BorderRadius.sm,
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
  artistImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
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
  },
  albumRow: {
    gap: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  albumCard: {
    width: ALBUM_SIZE,
  },
  albumImage: {
    width: ALBUM_SIZE,
    height: ALBUM_SIZE,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.sm,
  },
  albumTitle: {
    ...Typography.caption,
    color: Colors.light.text,
    fontWeight: "500",
  },
  albumArtist: {
    ...Typography.label,
    color: Colors.light.textSecondary,
  },
  albumYear: {
    ...Typography.label,
    color: Colors.light.textTertiary,
    marginTop: 2,
  },
  loader: {
    paddingVertical: Spacing.xl,
  },
  footer: {
    padding: Spacing.xl,
    alignItems: "center",
  },
});
