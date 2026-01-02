import React, { useCallback, memo, useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { Colors, Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { useFavoriteRadios } from "@/hooks/useLibrary";
import { useMusic } from "@/hooks/useMusic";
import { usePlayback, type Track } from "@/hooks/usePlayback";
import { lmsClient } from "@/lib/lmsClient";

type ViewMode = "grid" | "list";

const VIEW_MODE_KEY = "@radio_view_mode";

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
  energyThreshold: 0.001,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface RadioStation {
  id: string;
  name: string;
  url?: string;
  image?: string;
}

const RadioGridCard = memo(({ station, size, onPlay, baseUrl }: { 
  station: RadioStation; 
  size: number;
  onPlay: () => void;
  baseUrl: string;
}) => {
  const cardScale = useSharedValue(1);
  const overlayOpacity = useSharedValue(1);
  const playScale = useSharedValue(1);
  const imageUrl = station.image 
    ? (station.image.startsWith('http') 
      ? station.image 
      : station.image.startsWith('/') 
        ? `${baseUrl}${station.image}`
        : `${baseUrl}/${station.image}`)
    : undefined;

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const playAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: playScale.value }],
  }));

  return (
    <Animated.View style={[styles.gridItem, { width: size }, cardAnimatedStyle]}>
      <View style={styles.gridImageContainer}>
        <AnimatedPressable
          style={cardAnimatedStyle}
          onPress={onPlay}
          onPressIn={() => {
            cardScale.value = withSpring(0.96, springConfig);
            overlayOpacity.value = withSpring(1, springConfig);
          }}
          onPressOut={() => {
            cardScale.value = withSpring(1, springConfig);
          }}
        >
          {imageUrl ? (
            <Image
              source={imageUrl}
              style={[styles.gridImage, { width: size, height: size }]}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.gridImagePlaceholder, { width: size, height: size }]}>
              <Feather name="radio" size={Math.max(20, size * 0.3)} color={Colors.light.textTertiary} />
            </View>
          )}
        </AnimatedPressable>
        <Animated.View style={[styles.gridOverlay, overlayAnimatedStyle]}>
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
            <Feather name="play" size={18} color="#fff" style={{ marginLeft: 2 }} />
          </AnimatedPressable>
        </Animated.View>
      </View>
      <ThemedText style={styles.gridTitle} numberOfLines={2}>
        {station.name}
      </ThemedText>
    </Animated.View>
  );
});

const RadioListRow = memo(({ station, onPlay, baseUrl }: { 
  station: RadioStation; 
  onPlay: () => void;
  baseUrl: string;
}) => {
  const imageUrl = station.image 
    ? (station.image.startsWith('http') 
      ? station.image 
      : station.image.startsWith('/') 
        ? `${baseUrl}${station.image}`
        : `${baseUrl}/${station.image}`)
    : undefined;

  return (
    <View style={styles.listRow}>
  <Pressable
    style={({ pressed }) => [
          styles.listMainArea,
      { opacity: pressed ? 0.6 : 1 },
    ]}
        onPress={onPlay}
      >
        {imageUrl ? (
          <Image
            source={imageUrl}
            style={styles.listImage}
            contentFit="cover"
          />
        ) : (
          <View style={styles.listImagePlaceholder}>
      <Feather name="radio" size={20} color={Colors.light.accent} />
    </View>
        )}
        <View style={styles.listInfo}>
          <ThemedText style={styles.listTitle} numberOfLines={1}>
        {station.name}
      </ThemedText>
    </View>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          styles.actionButton,
          { opacity: pressed ? 0.6 : 1 },
        ]}
        onPress={onPlay}
      >
        <Feather name="play-circle" size={22} color={Colors.light.accent} />
  </Pressable>
    </View>
  );
});

export default function RadioScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { data: stations = [], isLoading, error } = useFavoriteRadios();
  const { activeServer } = useMusic();
  const { activePlayer, syncPlayerStatus, setCurrentTrack } = usePlayback();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const { width: windowWidth } = useWindowDimensions();

  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY).then((mode) => {
      if (mode === "list" || mode === "grid") {
        setViewMode(mode);
      }
    });
  }, []);

  // Get base URL for constructing image URLs
  const baseUrl = activeServer 
    ? `http://${activeServer.host}:${activeServer.port}`
    : 'http://localhost:9000';

  const gridLayout = React.useMemo(() => {
    const padding = Spacing.lg;
    const gap = Spacing.lg;
    const available = Math.max(0, windowWidth - padding * 2);

    if (Platform.OS !== "web") {
      const cols = 3;
      const size = Math.floor((available - gap * (cols - 1)) / cols);
      return { numColumns: cols, itemSize: Math.max(90, size) };
    }

    // Desktop/web: allow more columns, larger tiles.
    // +16% bigger tiles on large screens
    const min = 175;
    const max = 300;
    let cols = Math.max(3, Math.min(10, Math.floor((available + gap) / (min + gap)) || 3));
    let size = (available - gap * (cols - 1)) / cols;
    while (size > max && cols < 10) {
      cols += 1;
      size = (available - gap * (cols - 1)) / cols;
    }
    return { numColumns: cols, itemSize: Math.floor(Math.max(min, Math.min(max, size))) };
  }, [windowWidth]);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const handlePlayStation = useCallback(async (station: RadioStation) => {
    if (!activePlayer || !activeServer) {
      console.log('Cannot play station: missing player or server', {
        hasPlayer: !!activePlayer,
        hasServer: !!activeServer,
        stationName: station.name
      });
      return;
    }
    
    // Check if server is offline
    if (activeServer && !activeServer.connected) {
      console.log('Cannot play station: server is offline');
      return;
    }
    try {
      console.log('Starting radio playback:', {
        stationName: station.name,
        stationId: station.id,
        hasUrl: !!station.url,
        urlPreview: station.url ? station.url.substring(0, 80) + '...' : 'none'
      });

      // Set a temporary current track so mini player appears immediately
      const radioTrack: Track = {
        id: station.id || `radio-${Date.now()}`,
        title: station.name,
        artist: 'Radio Station',
        album: '',
        duration: 0,
        source: 'local',
        isRadio: true,
        radioStationName: station.name,
        radioStationImage: station.image
          ? (station.image.startsWith('http')
            ? station.image
            : station.image.startsWith('/')
              ? `${baseUrl}${station.image}`
              : `${baseUrl}/${station.image}`)
          : undefined
      };
      setCurrentTrack(radioTrack);

      lmsClient.setServer(activeServer.host, activeServer.port);

      // Ensure player is powered on
      await lmsClient.setPower(activePlayer.id, true);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Clear playlist first
      await lmsClient.request(activePlayer.id, ['playlist', 'clear']);

      // Prefer using favorite ID if available, otherwise use URL
      if (station.id) {
        console.log('Playing radio station by favorite ID:', station.name, 'ID:', station.id);
        await lmsClient.playRadioFavorite(activePlayer.id, station.id);
      } else if (station.url) {
        console.log('Playing radio station by URL:', station.name, 'URL:', station.url);
        await lmsClient.playRadioUrl(activePlayer.id, station.url);
      } else {
        console.error('Cannot play station: no ID or URL available', station);
        return;
      }

      // Give LMS time to process the radio load, then start playback
      await new Promise(resolve => setTimeout(resolve, 300));
      await lmsClient.play(activePlayer.id);
      console.log('Radio station play command sent successfully');

      // Trigger sync to get real track info
      setTimeout(() => {
        syncPlayerStatus();
      }, 1500);
    } catch (error) {
      console.error('Failed to play radio station:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message, error.stack);
      }
    }
  }, [activePlayer, activeServer, syncPlayerStatus, setCurrentTrack, baseUrl]);

  const renderGridItem = useCallback(({ item }: { item: RadioStation }) => (
    <RadioGridCard 
      station={item} 
      size={gridLayout.itemSize}
      onPlay={() => handlePlayStation(item)}
      baseUrl={baseUrl}
    />
  ), [handlePlayStation, baseUrl, gridLayout.itemSize]);

  const renderListItem = useCallback(({ item }: { item: RadioStation }) => (
    <RadioListRow 
      station={item} 
      onPlay={() => handlePlayStation(item)}
      baseUrl={baseUrl}
    />
  ), [handlePlayStation, baseUrl]);

  const keyExtractor = useCallback((item: RadioStation) => item.id, []);

  const ItemSeparator = useCallback(() => (
    <View style={styles.separator} />
  ), []);

  if (isLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.accent} />
      </ThemedView>
    );
  }

  // Handle errors gracefully instead of crashing
  if (error) {
    console.error('Radio query error:', error);
    return (
      <ThemedView style={styles.centered}>
        <ThemedText style={styles.errorTitle}>Error Loading Radio</ThemedText>
        <ThemedText style={styles.errorMessage}>
          {error instanceof Error ? error.message : 'Failed to load radio stations'}
        </ThemedText>
        <Pressable
          onPress={() => window.location.reload()}
          style={({ pressed }) => [
            styles.retryButton,
            { opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <ThemedText style={styles.retryText}>Retry</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <ThemedText style={styles.headerTitle}>Radio</ThemedText>
        <View style={styles.viewToggle}>
          <Pressable
            style={[
              styles.toggleButton,
              viewMode === "grid" && styles.toggleButtonActive,
            ]}
            onPress={() => handleViewModeChange("grid")}
          >
            <Feather
              name="grid"
              size={18}
              color={viewMode === "grid" ? Colors.light.accent : Colors.light.textSecondary}
            />
          </Pressable>
          <Pressable
            style={[
              styles.toggleButton,
              viewMode === "list" && styles.toggleButtonActive,
            ]}
            onPress={() => handleViewModeChange("list")}
          >
            <Feather
              name="list"
              size={18}
              color={viewMode === "list" ? Colors.light.accent : Colors.light.textSecondary}
            />
          </Pressable>
        </View>
      </View>

      {!activeServer || (activeServer && !activeServer.connected) ? (
        <View style={styles.emptyState}>
          <Feather name="wifi-off" size={48} color={Colors.light.error} />
          <ThemedText style={styles.emptyTitle}>Server Offline</ThemedText>
          <ThemedText style={[styles.emptyText, { color: Colors.light.textSecondary }]}>
            Please connect to a server in Settings to access radio stations
          </ThemedText>
        </View>
      ) : stations.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="radio" size={40} color={Colors.light.textTertiary} />
          <ThemedText style={[styles.emptyText, { color: Colors.light.textSecondary }]}>
            No favorite radio stations
          </ThemedText>
        </View>
      ) : viewMode === "grid" ? (
        <FlatList
          key={`grid-${gridLayout.numColumns}`}
          data={stations}
          renderItem={renderGridItem}
          keyExtractor={keyExtractor}
          numColumns={gridLayout.numColumns}
          contentContainerStyle={[
            styles.gridContent,
            { 
              paddingTop: Spacing.md,
              paddingBottom: tabBarHeight + Spacing["5xl"] 
            },
          ]}
          columnWrapperStyle={styles.gridRow}
          removeClippedSubviews={false}
          maxToRenderPerBatch={20}
          windowSize={10}
          initialNumToRender={20}
          {...(Platform.OS === 'ios' && { contentInsetAdjustmentBehavior: 'automatic' })}
        />
      ) : (
        <FlatList
          key="list"
          data={stations}
          renderItem={renderListItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={[
            styles.listContent,
            { 
              paddingTop: Spacing.md,
              paddingBottom: tabBarHeight + Spacing["5xl"] 
            },
          ]}
          ItemSeparatorComponent={ItemSeparator}
          removeClippedSubviews={true}
          maxToRenderPerBatch={20}
          windowSize={10}
          initialNumToRender={20}
          {...(Platform.OS === 'ios' && { contentInsetAdjustmentBehavior: 'automatic' })}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundRoot,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.light.backgroundRoot,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  headerTitle: {
    fontSize: 22.4, // 30% smaller than Typography.display (32px * 0.7)
    fontWeight: "700",
    color: Colors.light.text,
    textAlign: "left",
    alignSelf: "flex-start",
  },
  viewToggle: {
    flexDirection: "row",
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    padding: 2,
  },
  toggleButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
  },
  toggleButtonActive: {
    backgroundColor: Colors.light.backgroundDefault,
  },
  gridContent: {
    paddingHorizontal: Spacing.lg,
  },
  gridRow: {
    gap: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  gridItem: {
    // width is set dynamically (gridLayout.itemSize) to be responsive on web
  },
  gridImageContainer: {
    position: "relative",
    marginBottom: Spacing.sm,
    ...Shadows.small,
  },
  gridImage: {
    borderRadius: BorderRadius.xs,
  },
  gridImagePlaceholder: {
    borderRadius: BorderRadius.xs,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
  },
  gridOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderRadius: BorderRadius.xs,
    pointerEvents: "box-none",
  },
  gridOverlayButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  gridPlayButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  gridTitle: {
    ...Typography.headline,
    color: Colors.light.text,
    marginTop: Spacing.xs,
    textAlign: "center",
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  listMainArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  listImage: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.xs,
    marginRight: Spacing.md,
  },
  listImagePlaceholder: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.xs,
    backgroundColor: Colors.light.accent + '10',
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  listInfo: {
    flex: 1,
  },
  listTitle: {
    ...Typography.body,
    fontWeight: "500",
  },
  actionButton: {
    padding: Spacing.sm,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.light.border,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.md,
  },
  emptyTitle: {
    ...Typography.title,
    color: Colors.light.text,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptyText: {
    ...Typography.body,
    textAlign: "center",
  },
  errorTitle: {
    ...Typography.title,
    color: Colors.light.text,
    marginBottom: Spacing.sm,
  },
  errorMessage: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  retryButton: {
    backgroundColor: Colors.light.accent,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  retryText: {
    color: Colors.light.buttonText,
    fontWeight: "600",
    textAlign: "center",
  },
});
