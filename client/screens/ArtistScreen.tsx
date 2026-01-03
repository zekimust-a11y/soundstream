import React, { useEffect, useState, useCallback, memo } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  WithSpringConfig,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { SourceBadge } from "@/components/SourceBadge";
import { AppHeader } from "@/components/AppHeader";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic, type Album } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient } from "@/lib/lmsClient";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

type RouteProps = RouteProp<BrowseStackParamList, "Artist">;
type NavigationProp = NativeStackNavigationProp<BrowseStackParamList>;

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
  energyThreshold: 0.001,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const AlbumGridCard = memo(({ album, size, onPress, onPlay, onShuffle }: { 
  album: Album; 
  size: number;
  onPress: () => void;
  onPlay: () => void;
  onShuffle: () => void;
}) => {
  const cardScale = useSharedValue(1);
  const overlayOpacity = useSharedValue(1);
  const shuffleScale = useSharedValue(1);
  const playScale = useSharedValue(1);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const shuffleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shuffleScale.value }],
  }));

  const playAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: playScale.value }],
  }));

  return (
    <Animated.View style={[styles.gridItem, { width: size }, cardAnimatedStyle]}>
      <View style={styles.gridImageContainer}>
        <AnimatedPressable
          style={cardAnimatedStyle}
          onPress={onPress}
          onPressIn={() => {
            cardScale.value = withSpring(0.96, springConfig);
            overlayOpacity.value = withSpring(1, springConfig);
          }}
          onPressOut={() => {
            cardScale.value = withSpring(1, springConfig);
            overlayOpacity.value = withSpring(0.7, springConfig);
          }}
        >
          <Image
            source={album.imageUrl || require("../assets/images/placeholder-album.png")}
            style={[styles.gridImage, { width: size, height: size }]}
            contentFit="cover"
          />
        </AnimatedPressable>
        <SourceBadge source={album.source} size={20} />
        <Animated.View style={[styles.gridOverlay, overlayAnimatedStyle]}>
          <AnimatedPressable
            style={[styles.gridOverlayButton, shuffleAnimatedStyle]}
            onPress={(e) => {
              e?.stopPropagation?.();
              onShuffle();
            }}
            onPressIn={(e) => {
              e?.stopPropagation?.();
              shuffleScale.value = withSpring(0.9, springConfig);
            }}
            onPressOut={() => {
              shuffleScale.value = withSpring(1, springConfig);
            }}
            hitSlop={8}
          >
            <Feather name="shuffle" size={18} color="#fff" />
          </AnimatedPressable>
          <AnimatedPressable
            style={[styles.gridOverlayButton, styles.gridPlayButton, playAnimatedStyle]}
            onPress={(e) => {
              e?.stopPropagation?.();
              onPlay();
            }}
            onPressIn={(e) => {
              e?.stopPropagation?.();
              playScale.value = withSpring(0.9, springConfig);
            }}
            onPressOut={() => {
              playScale.value = withSpring(1, springConfig);
            }}
            hitSlop={8}
          >
            <Feather name="play" size={22} color="#fff" style={{ marginLeft: 2 }} />
          </AnimatedPressable>
        </Animated.View>
      </View>
      <ThemedText style={styles.gridTitle} numberOfLines={2}>
        {album.name}
      </ThemedText>
      {album.year ? (
        <ThemedText style={styles.gridYear}>{album.year}</ThemedText>
      ) : null}
    </Animated.View>
  );
});

export default function ArtistScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<NavigationProp>();
  // `useBottomTabBarHeight()` throws if we're not within a BottomTabNavigator (e.g. modal contexts).
  // Guard it so header search navigation never hard-crashes the app.
  let tabBarHeight = 0;
  try {
    tabBarHeight = useBottomTabBarHeight();
  } catch {
    tabBarHeight = 0;
  }
  const { width: windowWidth } = useWindowDimensions();
  const { getArtistAlbums, activeServer } = useMusic();
  const { activePlayer } = usePlayback();

  const [albums, setAlbums] = useState<Album[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [artistImage, setArtistImage] = useState<string | undefined>(undefined);
  const [artistBio, setArtistBio] = useState<{ bio?: string; formedYear?: string; genre?: string; country?: string } | null>(null);
  const [isLoadingBio, setIsLoadingBio] = useState(true);

  const artistName = route.params.name;
  const isDesktop = Platform.OS === "web" && windowWidth >= 900;
  const maxContentWidth = isDesktop ? 1180 : undefined;

  const artistImageSize = (() => {
    if (!isDesktop) return 160;
    // Larger hero portrait on desktop
    const ideal = Math.round(windowWidth * 0.18);
    return Math.max(220, Math.min(320, ideal));
  })();

  const gridLayout = (() => {
    // Similar sizing rules to AllAlbumsScreen (bigger tiles on desktop)
    const padding = Spacing.lg;
    const gap = Spacing.lg;
    const available = Math.max(0, (maxContentWidth ?? windowWidth) - padding * 2);

    if (!isDesktop) {
      const cols = 2;
      const size = Math.floor((available - gap * (cols - 1)) / cols);
      return { numColumns: cols, itemSize: Math.max(140, size) };
    }

    const min = 200;
    const max = 325;
    let cols = Math.max(3, Math.min(8, Math.floor((available + gap) / (min + gap)) || 3));
    let size = (available - gap * (cols - 1)) / cols;
    while (size > max && cols < 8) {
      cols += 1;
      size = (available - gap * (cols - 1)) / cols;
    }
    return { numColumns: cols, itemSize: Math.floor(Math.max(min, Math.min(max, size))) };
  })();

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      setIsLoadingBio(true);
      
      try {
        // Load albums by artist name (since we use name as ID)
        const artistAlbums = await lmsClient.getAlbumsByArtistName(artistName);
        
        // Check if Spotify and Tidal are enabled
        let spotifyEnabled = true;
        let tidalEnabled = true;
        try {
          const settings = await AsyncStorage.getItem("@soundstream_settings");
          if (settings) {
            const parsed = JSON.parse(settings);
            spotifyEnabled = parsed.spotifyEnabled !== false;
            tidalEnabled = parsed.tidalEnabled !== false;
          }
        } catch (e) {
          // Use default if settings can't be loaded
        }
        
        // Filter out Spotify and Tidal albums if disabled
        const libraryAlbums = artistAlbums
          .filter(album => {
            if (!spotifyEnabled || !tidalEnabled) {
              const id = (album.id || '').toLowerCase();
              const artworkUrl = (album.artwork_url || '').toLowerCase();
              if (!spotifyEnabled && (id.includes('spotify') || artworkUrl.includes('spotify'))) {
                return false;
              }
              if (!tidalEnabled && (id.includes('tidal') || artworkUrl.includes('tidal'))) {
                return false;
              }
            }
            return true;
          })
          .map(album => ({
            id: album.id,
            name: album.title,
            artist: album.artist,
            artistId: album.artistId || '',
            imageUrl: lmsClient.getArtworkUrl(album),
            year: album.year,
            trackCount: album.trackCount,
            source: 'local' as const,
          }));
        setAlbums(libraryAlbums);
     
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

  const handlePlayAlbum = useCallback(async (album: Album) => {
    if (!activePlayer || !activeServer) return;
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      await lmsClient.setPower(activePlayer.id, true);
      await lmsClient.playAlbum(activePlayer.id, album.id);
      await lmsClient.play(activePlayer.id);
    } catch (error) {
      console.error('Failed to play album:', error);
    }
  }, [activePlayer, activeServer]);

  const handleShuffleAlbum = useCallback(async (album: Album) => {
    if (!activePlayer || !activeServer) return;
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      await lmsClient.setPower(activePlayer.id, true);
      await lmsClient.setShuffle(activePlayer.id, 1);
      await lmsClient.playAlbum(activePlayer.id, album.id);
      await lmsClient.play(activePlayer.id);
    } catch (error) {
      console.error('Failed to shuffle album:', error);
    }
  }, [activePlayer, activeServer]);

  return (
    <ThemedView style={styles.container}>
      <AppHeader title="" showBack />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.lg, paddingBottom: tabBarHeight + Spacing["5xl"] },
        ]}
      >
        <View style={[styles.pageContainer, maxContentWidth ? { maxWidth: maxContentWidth } : null]}>
          <View style={[styles.artistHeader, isDesktop ? styles.artistHeaderDesktop : null]}>
            <View
              style={[
                styles.artistImageContainer,
                { width: artistImageSize, height: artistImageSize, borderRadius: artistImageSize / 2 },
              ]}
            >
              {artistImage ? (
                <Image
                  source={artistImage}
                  style={{ width: artistImageSize, height: artistImageSize, borderRadius: artistImageSize / 2 }}
                  contentFit="cover"
                />
              ) : (
                <View
                  style={[
                    styles.artistImagePlaceholder,
                    { width: artistImageSize, height: artistImageSize, borderRadius: artistImageSize / 2 },
                  ]}
                >
                  <Feather name="user" size={Math.round(artistImageSize * 0.45)} color={Colors.light.textTertiary} />
                </View>
              )}
            </View>

            <View style={[styles.artistHeaderRight, isDesktop ? styles.artistHeaderRightDesktop : null]}>
              <ThemedText style={[styles.artistName, isDesktop ? styles.artistNameDesktop : null]}>
                {artistName}
              </ThemedText>

              {!isLoading ? (
                <ThemedText style={[styles.artistMeta, isDesktop ? styles.artistMetaDesktop : null]}>
                  {albums.length} album{albums.length !== 1 ? "s" : ""} in library
                </ThemedText>
              ) : null}

              {artistBio && (artistBio.formedYear || artistBio.genre || artistBio.country) ? (
                <View style={[styles.artistDetails, isDesktop ? styles.artistDetailsDesktop : null]}>
                  {artistBio.formedYear ? (
                    <ThemedText style={styles.artistDetail}>Formed: {artistBio.formedYear}</ThemedText>
                  ) : null}
                  {artistBio.genre ? (
                    <ThemedText style={styles.artistDetail}>{artistBio.genre}</ThemedText>
                  ) : null}
                  {artistBio.country ? (
                    <ThemedText style={styles.artistDetail}>{artistBio.country}</ThemedText>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>My Library</ThemedText>
            {isLoading ? (
              <ActivityIndicator color={Colors.light.accent} style={styles.loader} />
            ) : albums.length === 0 ? (
              <ThemedText style={styles.emptyText}>No albums in your library</ThemedText>
            ) : (
              <View style={[styles.albumGrid, isDesktop ? styles.albumGridDesktop : null]}>
                {albums.map((album) => (
                  <AlbumGridCard
                    key={album.id}
                    album={album}
                    size={gridLayout.itemSize}
                    onPress={() =>
                      navigation.navigate("Album", {
                        id: album.id,
                        name: album.name,
                        artistName: album.artist,
                        source: album.source,
                      })
                    }
                    onPlay={() => handlePlayAlbum(album)}
                    onShuffle={() => handleShuffleAlbum(album)}
                  />
                ))}
              </View>
            )}
          </View>

          {artistBio?.bio && (
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>About</ThemedText>
              <ThemedText style={styles.bioText}>{artistBio.bio}</ThemedText>
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
  pageContainer: {
    width: "100%",
    alignSelf: "center",
  },
  artistHeader: {
    alignItems: "center",
    marginBottom: Spacing["3xl"],
  },
  artistHeaderDesktop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: Spacing["3xl"],
  },
  artistImageContainer: {
    marginBottom: Spacing.lg,
    overflow: "hidden",
    backgroundColor: Colors.light.backgroundSecondary,
  },
  artistImagePlaceholder: {
    backgroundColor: "#4A4A4E", // Darker grey to match overlay behind play button
    justifyContent: "center",
    alignItems: "center",
  },
  artistHeaderRight: {
    width: "100%",
    alignItems: "center",
  },
  artistHeaderRightDesktop: {
    flex: 1,
    alignItems: "flex-start",
  },
  artistDetails: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  artistDetailsDesktop: {
    justifyContent: "flex-start",
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
  artistNameDesktop: {
    textAlign: "left",
    fontSize: 34,
  },
  artistMeta: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    marginTop: Spacing.xs,
  },
  artistMetaDesktop: {
    textAlign: "left",
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
  albumGridDesktop: {
    gap: Spacing.lg,
  },
  gridItem: {
    // width is dynamic via props
  },
  gridImageContainer: {
    position: "relative",
    marginBottom: Spacing.sm,
  },
  gridImage: {
    borderRadius: BorderRadius.xs,
  },
  gridOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.md,
  },
  gridOverlayButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  gridPlayButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.light.accent,
  },
  gridTitle: {
    ...Typography.headline,
    color: Colors.light.text,
    marginTop: Spacing.xs,
  },
  gridYear: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: Spacing.xs,
  },
  loader: {
    padding: Spacing.xl,
  },
  emptyText: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    textAlign: "center",
    paddingVertical: Spacing.xl,
  },
});
