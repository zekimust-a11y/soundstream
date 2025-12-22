import React from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";

const { width } = Dimensions.get("window");
const NUM_COLUMNS = 2;
const GRID_ITEM_SIZE = (width - Spacing.lg * 3) / NUM_COLUMNS;

const SkeletonItem = () => {
  const opacity = useSharedValue(0.3);

  React.useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.7, {
        duration: 1000,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <View style={styles.skeletonCard}>
      <Animated.View style={[styles.skeletonImage, animatedStyle]} />
      <Animated.View style={[styles.skeletonTitle, animatedStyle]} />
      <Animated.View style={[styles.skeletonSubtitle, animatedStyle]} />
    </View>
  );
};

export const AlbumGridSkeleton = () => {
  return (
    <View style={styles.gridContainer}>
      {Array.from({ length: 6 }).map((_, index) => (
        <SkeletonItem key={index} />
      ))}
    </View>
  );
};

const ListSkeletonRow = () => {
  const opacity = useSharedValue(0.3);

  React.useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.7, {
        duration: 1000,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <View style={styles.listSkeletonRow}>
      <Animated.View style={[styles.listSkeletonImage, animatedStyle]} />
      <View style={styles.listSkeletonContent}>
        <Animated.View style={[styles.listSkeletonTitle, animatedStyle]} />
        <Animated.View style={[styles.listSkeletonSubtitle, animatedStyle]} />
      </View>
    </View>
  );
};

export const AlbumListSkeleton = () => {
  return (
    <View style={styles.listContainer}>
      {Array.from({ length: 8 }).map((_, index) => (
        <ListSkeletonRow key={index} />
      ))}
    </View>
  );
};

const SkeletonRoundItem = () => {
  const opacity = useSharedValue(0.3);

  React.useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.7, {
        duration: 1000,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={styles.skeletonCard}>
      <Animated.View style={[styles.skeletonImageRound, animatedStyle]} />
      <Animated.View style={[styles.skeletonTitle, animatedStyle]} />
      <Animated.View style={[styles.skeletonSubtitle, animatedStyle]} />
    </Animated.View>
  );
};

export const ArtistGridSkeleton = () => {
  return (
    <View style={styles.gridContainer}>
      {Array.from({ length: 6 }).map((_, index) => (
        <SkeletonRoundItem key={index} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  skeletonCard: {
    width: GRID_ITEM_SIZE,
    marginBottom: Spacing.lg,
  },
  skeletonImage: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
    borderRadius: BorderRadius.xs,
    backgroundColor: Colors.light.backgroundSecondary,
    marginBottom: Spacing.sm,
  },
  skeletonImageRound: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
    borderRadius: GRID_ITEM_SIZE / 2,
    backgroundColor: Colors.light.backgroundSecondary,
    marginBottom: Spacing.sm,
  },
  skeletonTitle: {
    height: 16,
    borderRadius: 4,
    backgroundColor: Colors.light.backgroundSecondary,
    marginBottom: 4,
    width: "80%",
  },
  skeletonSubtitle: {
    height: 12,
    borderRadius: 4,
    backgroundColor: Colors.light.backgroundSecondary,
    width: "60%",
  },
  listContainer: {
    paddingHorizontal: Spacing.lg,
  },
  listSkeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  listSkeletonImage: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.xs,
    backgroundColor: Colors.light.backgroundSecondary,
    marginRight: Spacing.md,
  },
  listSkeletonContent: {
    flex: 1,
  },
  listSkeletonTitle: {
    height: 16,
    borderRadius: 4,
    backgroundColor: Colors.light.backgroundSecondary,
    marginBottom: 4,
    width: "70%",
  },
  listSkeletonSubtitle: {
    height: 12,
    borderRadius: 4,
    backgroundColor: Colors.light.backgroundSecondary,
    width: "50%",
  },
});

