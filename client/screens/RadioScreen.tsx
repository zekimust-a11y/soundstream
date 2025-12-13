import React, { useCallback, memo, useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  Dimensions,
  ActivityIndicator,
  Platform,
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
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient } from "@/lib/lmsClient";

const { width } = Dimensions.get("window");
const NUM_COLUMNS = 2;
const GRID_ITEM_SIZE = (width - Spacing.lg * 3) / NUM_COLUMNS;

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

const RadioGridCard = memo(({ station, onPlay, baseUrl }: { 
  station: RadioStation; 
  onPlay: () => void;
  baseUrl: string;
}) => {
  const cardScale = useSharedValue(1);
  const overlayOpacity = useSharedValue(0.7);
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
    <Animated.View style={[styles.gridItem, cardAnimatedStyle]}>
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
            overlayOpacity.value = withSpring(0.7, springConfig);
          }}
        >
          {imageUrl ? (
            <Image
              source={imageUrl}
              style={styles.gridImage}
              contentFit="cover"
            />
          ) : (
            <View style={styles.gridImagePlaceholder}>
              <Feather name="radio" size={GRID_ITEM_SIZE * 0.3} color={Colors.light.textTertiary} />
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
            <Feather name="play" size={22} color="#fff" style={{ marginLeft: 2 }} />
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
  const { data: stations = [], isLoading } = useFavoriteRadios();
  const { activeServer } = useMusic();
  const { activePlayer, syncPlayerStatus } = usePlayback();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

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
      
      lmsClient.setServer(activeServer.host, activeServer.port);
      await lmsClient.setPower(activePlayer.id, true);
      
      // Stop and clear playlist first
      await lmsClient.stop(activePlayer.id);
      
      // Small delay to ensure stop command is processed
      await new Promise(resolve => setTimeout(resolve, 100));
      
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
      
      // Small delay before starting playback
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Start playback
      await lmsClient.play(activePlayer.id);
      console.log('Radio station play command sent successfully');
      
      // Sync status after a longer delay to allow stream to start
      setTimeout(() => {
        syncPlayerStatus();
      }, 1000);
    } catch (error) {
      console.error('Failed to play radio station:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message, error.stack);
      }
    }
  }, [activePlayer, activeServer, syncPlayerStatus]);

  const renderGridItem = useCallback(({ item }: { item: RadioStation }) => (
    <RadioGridCard 
      station={item} 
      onPlay={() => handlePlayStation(item)}
      baseUrl={baseUrl}
    />
  ), [handlePlayStation, baseUrl]);

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
          key="grid"
          data={stations}
          renderItem={renderGridItem}
          keyExtractor={keyExtractor}
          numColumns={NUM_COLUMNS}
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
    width: GRID_ITEM_SIZE,
  },
  gridImageContainer: {
    position: "relative",
    marginBottom: Spacing.sm,
    ...Shadows.small,
  },
  gridImage: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
    borderRadius: BorderRadius.xs,
  },
  gridImagePlaceholder: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
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
    backgroundColor: "rgba(0, 0, 0, 0.4)",
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
    width: 48,
    height: 48,
    borderRadius: 24,
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
});
