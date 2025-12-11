import React from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
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
import { useMusic } from "@/hooks/useMusic";
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
  const { getArtistAlbums, artists } = useMusic();

  const artist = artists.find((a) => a.id === route.params.id);
  const albums = getArtistAlbums(route.params.id);

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
            <Feather name="user" size={64} color={Colors.dark.textTertiary} />
          </View>
          <ThemedText style={styles.artistName}>{route.params.name}</ThemedText>
          <ThemedText style={styles.artistMeta}>
            {albums.length} album{albums.length !== 1 ? "s" : ""}
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Discography</ThemedText>
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
  artistHeader: {
    alignItems: "center",
    marginBottom: Spacing["3xl"],
  },
  artistImagePlaceholder: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: Colors.dark.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  artistName: {
    ...Typography.display,
    color: Colors.dark.text,
    textAlign: "center",
  },
  artistMeta: {
    ...Typography.body,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.xs,
  },
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    ...Typography.title,
    color: Colors.dark.text,
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
    color: Colors.dark.text,
  },
  albumYear: {
    ...Typography.caption,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.xs,
  },
});
