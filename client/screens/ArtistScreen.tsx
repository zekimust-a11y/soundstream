import React, { useEffect, useState, useCallback, memo } from "react";
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
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic, type Album } from "@/hooks/useMusic";
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient } from "@/lib/lmsClient";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

const { width } = Dimensions.get("window");
const ALBUM_SIZE = (width - Spacing.lg * 3) / 2;

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

const AlbumGridCard = memo(({ album, onPress, onPlay, onShuffle }: { 
  album: Album; 
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
    <Animated.View style={[styles.gridItem, cardAnimatedStyle]}>
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
            style={styles.gridImage}
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
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { getArtistAlbums, activeServer } = useMusic();
  const { activePlayer } = usePlayback();

  const [albums, setAlbums] = useState<Album[]>([]);
  const [qobuzAlbums, setQobuzAlbums] = useState<Album[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingQobuz, setIsLoadingQobuz] = useState(false);
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
        
        // Load Qobuz albums for this artist (if enabled)
        setIsLoadingQobuz(true);
        try {
          // Check if Qobuz is enabled
          let qobuzEnabled = true;
          try {
            const settings = await AsyncStorage.getItem("@soundstream_settings");
            if (settings) {
              const parsed = JSON.parse(settings);
              qobuzEnabled = parsed.qobuzEnabled !== false;
            }
          } catch (e) {
            // Use default if settings can't be loaded
          }
          
          if (qobuzEnabled) {
            const qobuzResults = await lmsClient.searchQobuz(artistName);
            // Filter Qobuz albums to only include those by this artist and not in library
            const libraryAlbumNames = new Set(libraryAlbums.map(a => a.name.toLowerCase().trim()));
            const qobuzAlbumsFiltered = qobuzResults.albums
              .filter(qobuzAlbum => {
                const qobuzArtist = qobuzAlbum.artist.toLowerCase().trim();
                const artistNameLower = artistName.toLowerCase().trim();
                // Match if artist name matches (fuzzy match for variations)
                const artistMatches = qobuzArtist === artistNameLower || 
                                     qobuzArtist.includes(artistNameLower) ||
                                     artistNameLower.includes(qobuzArtist);
                if (!artistMatches) return false;
                
                // Exclude if already in library
                const albumName = qobuzAlbum.title.toLowerCase().trim();
                return !libraryAlbumNames.has(albumName);
              })
              .map(album => ({
                id: album.id,
                name: album.title,
                artist: album.artist,
                artistId: '',
                imageUrl: album.artwork_url,
                year: album.year,
                source: 'qobuz' as const,
              }));
            setQobuzAlbums(qobuzAlbumsFiltered);
          } else {
            setQobuzAlbums([]);
          }
        } catch (error) {
          console.error("Failed to load Qobuz albums:", error);
          setQobuzAlbums([]);
        } finally {
          setIsLoadingQobuz(false);
        }
        
        // Tidal albums are already included in libraryAlbums from getAlbumsByArtistName
        // They are identified by checking URL/ID/artwork_url for "tidal" in the standard library query
        // No need to fetch separately - Tidal content comes from LMS standard library queries
        
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
              {albums.length} album{albums.length !== 1 ? "s" : ""} in library
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>My Library</ThemedText>
          {isLoading ? (
            <ActivityIndicator color={Colors.light.accent} style={styles.loader} />
          ) : albums.length === 0 ? (
            <ThemedText style={styles.emptyText}>No albums in your library</ThemedText>
          ) : (
            <View style={styles.albumGrid}>
              {albums.map((album) => (
                <AlbumGridCard
                  key={album.id}
                  album={album}
                  onPress={() =>
                    navigation.navigate("Album", {
                      id: album.id,
                      name: album.name,
                      artistName: album.artist,
                    })
                  }
                  onPlay={() => handlePlayAlbum(album)}
                  onShuffle={() => handleShuffleAlbum(album)}
                />
              ))}
            </View>
          )}
        </View>

        {qobuzAlbums.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Discography</ThemedText>
            {isLoadingQobuz ? (
              <ActivityIndicator color={Colors.light.accent} style={styles.loader} />
            ) : (
              <View style={styles.albumGrid}>
                {qobuzAlbums.map((album) => (
                  <AlbumGridCard
                    key={album.id}
                    album={album}
                    onPress={() =>
                      navigation.navigate("Album", {
                        id: album.id,
                        name: album.name,
                        artistName: album.artist,
                      })
                    }
                    onPlay={() => handlePlayAlbum(album)}
                    onShuffle={() => handleShuffleAlbum(album)}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {artistBio && (artistBio.formedYear || artistBio.genre || artistBio.country) && (
          <View style={styles.section}>
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
          </View>
        )}

        {artistBio?.bio && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>About</ThemedText>
            <ThemedText style={styles.bioText}>{artistBio.bio}</ThemedText>
          </View>
        )}
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
    backgroundColor: "#4A4A4E", // Darker grey to match overlay behind play button
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
  gridItem: {
    width: ALBUM_SIZE,
  },
  gridImageContainer: {
    position: "relative",
    marginBottom: Spacing.sm,
  },
  gridImage: {
    width: ALBUM_SIZE,
    height: ALBUM_SIZE,
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
