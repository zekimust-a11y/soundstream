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

  useEffect(() => {
    async function loadAlbums() {
      setIsLoading(true);
      try {
        const artistAlbums = await getArtistAlbums(route.params.id);
        setAlbums(artistAlbums);
      } catch (error) {
        console.error("Failed to load artist albums:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadAlbums();
  }, [route.params.id, getArtistAlbums]);

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
          <View style={styles.artistImagePlaceholder}>
            <Feather name="user" size={64} color={Colors.light.textTertiary} />
          </View>
          <ThemedText style={styles.artistName}>{route.params.name}</ThemedText>
          {!isLoading ? (
            <ThemedText style={styles.artistMeta}>
              {albums.length} album{albums.length !== 1 ? "s" : ""}
            </ThemedText>
          ) : null}
        </View>

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
  artistImagePlaceholder: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.lg,
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
