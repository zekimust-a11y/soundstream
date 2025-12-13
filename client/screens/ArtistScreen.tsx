import React, { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic, type Album } from "@/hooks/useMusic";
import { lmsClient } from "@/lib/lmsClient";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

const { width } = Dimensions.get("window");
const ALBUM_SIZE = (width - Spacing.lg * 3) / 2;

type RouteProps = RouteProp<BrowseStackParamList, "Artist">;
type NavigationProp = NativeStackNavigationProp<BrowseStackParamList>;

export default function ArtistScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<NavigationProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { getArtistAlbums } = useMusic();

  const [albums, setAlbums] = useState<Album[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [artistImage, setArtistImage] = useState<string | undefined>(undefined);
  const [artistBio, setArtistBio] = useState<{ bio?: string; formedYear?: string; genre?: string; country?: string } | null>(null);
  const [isLoadingBio, setIsLoadingBio] = useState(true);

  const artistName = route.params.name;

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      setIsLoadingBio(true);
      
      try {
        // Load albums by artist name (since we use name as ID)
        const artistAlbums = await lmsClient.getAlbumsByArtistName(artistName);
        setAlbums(artistAlbums.map(album => ({
          id: album.id,
          name: album.title,
          artist: album.artist,
          imageUrl: lmsClient.getArtworkUrl(album),
          year: album.year,
          trackCount: album.trackCount,
        })));
        
        // Load artist image and bio from TheAudioDB
        const [image, bio] = await Promise.all([
          lmsClient.getArtistImage(artistName),
          lmsClient.getArtistBio(artistName),
        ]);
        
        setArtistImage(image);
        setArtistBio(bio);
      } catch (error) {
        console.error("Failed to load artist data:", error);
      } finally {
        setIsLoading(false);
        setIsLoadingBio(false);
      }
    }
    loadData();
  }, [artistName]);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.xl, paddingBottom: tabBarHeight + Spacing["5xl"] },
        ]}
      >
        <View style={styles.artistHeader}>
          <View style={styles.artistImageContainer}>
            {artistImage ? (
              <Image
                source={artistImage}
                style={styles.artistImage}
                contentFit="cover"
              />
            ) : (
              <View style={styles.artistImagePlaceholder}>
                <Feather name="user" size={64} color={Colors.light.textTertiary} />
              </View>
            )}
          </View>
          <ThemedText style={styles.artistName}>{artistName}</ThemedText>
          {!isLoading ? (
            <ThemedText style={styles.artistMeta}>
              {albums.length} album{albums.length !== 1 ? "s" : ""}
            </ThemedText>
          ) : null}
          {artistBio && (artistBio.formedYear || artistBio.genre || artistBio.country) && (
            <View style={styles.artistDetails}>
              {artistBio.formedYear && (
                <ThemedText style={styles.artistDetail}>
                  Formed: {artistBio.formedYear}
                </ThemedText>
              )}
              {artistBio.genre && (
                <ThemedText style={styles.artistDetail}>
                  {artistBio.genre}
                </ThemedText>
              )}
              {artistBio.country && (
                <ThemedText style={styles.artistDetail}>
                  {artistBio.country}
                </ThemedText>
              )}
            </View>
          )}
        </View>

        {artistBio?.bio && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>About</ThemedText>
            <ThemedText style={styles.bioText}>{artistBio.bio}</ThemedText>
          </View>
        )}

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Discography</ThemedText>
          {isLoading ? (
            <ActivityIndicator color={Colors.light.accent} style={styles.loader} />
          ) : (
            <View style={styles.albumGrid}>
              {albums.map((album) => (
                <Pressable
                  key={album.id}
                  style={({ pressed }) => [
                    styles.albumCard,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                  onPress={() =>
                    navigation.navigate("Album", {
                      id: album.id,
                      name: album.name,
                      artistName: album.artist,
                    })
                  }
                >
                  <Image
                    source={album.imageUrl || require("../assets/images/placeholder-album.png")}
                    style={styles.albumImage}
                    contentFit="cover"
                  />
                  <ThemedText style={styles.albumTitle} numberOfLines={1}>
                    {album.name}
                  </ThemedText>
                  {album.year ? (
                    <ThemedText style={styles.albumYear}>{album.year}</ThemedText>
                  ) : null}
                </Pressable>
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
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  artistHeader: {
    alignItems: "center",
    marginBottom: Spacing["3xl"],
  },
  artistImageContainer: {
    width: 160,
    height: 160,
    borderRadius: 80,
    marginBottom: Spacing.lg,
    overflow: "hidden",
    backgroundColor: Colors.light.backgroundSecondary,
  },
  artistImage: {
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  artistImagePlaceholder: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
  },
  artistDetails: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  artistDetail: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    paddingHorizontal: Spacing.sm,
  },
  bioText: {
    ...Typography.body,
    color: Colors.light.text,
    lineHeight: 22,
  },
  artistName: {
    ...Typography.display,
    color: Colors.light.text,
    textAlign: "center",
  },
  artistMeta: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    marginTop: Spacing.xs,
  },
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    ...Typography.title,
    color: Colors.light.text,
    marginBottom: Spacing.lg,
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
  albumYear: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: Spacing.xs,
  },
  loader: {
    padding: Spacing.xl,
  },
});
