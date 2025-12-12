import React, { useCallback, memo } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useInfiniteAlbums, Album } from "@/hooks/useLibrary";
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

export default function AllAlbumsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteAlbums();

  const albums = data?.pages.flatMap(page => page.albums) || [];
  const total = data?.pages[0]?.total || 0;

  const handleAlbumPress = useCallback((album: Album) => {
    navigation.navigate("Album", { id: album.id, name: album.name, artistName: album.artist });
  }, [navigation]);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderAlbum = useCallback(({ item }: { item: Album }) => (
    <AlbumCard album={item} onPress={() => handleAlbumPress(item)} />
  ), [handleAlbumPress]);

  const keyExtractor = useCallback((item: Album) => item.id, []);

  const ListFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={Colors.light.accent} />
      </View>
    );
  }, [isFetchingNextPage]);

  if (isLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.accent} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.headerInfo, { paddingTop: insets.top + Spacing.md }]}>
        <ThemedText style={styles.count}>
          {albums.length.toLocaleString()} of {total.toLocaleString()} albums
        </ThemedText>
      </View>
      <FlatList
        data={albums}
        renderItem={renderAlbum}
        keyExtractor={keyExtractor}
        numColumns={NUM_COLUMNS}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        columnWrapperStyle={styles.row}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={ListFooter}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={10}
        getItemLayout={(_, index) => ({
          length: ALBUM_SIZE + Spacing.lg + 60,
          offset: (ALBUM_SIZE + Spacing.lg + 60) * Math.floor(index / NUM_COLUMNS),
          index,
        })}
      />
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
  headerInfo: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  count: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  row: {
    gap: Spacing.lg,
    marginBottom: Spacing.lg,
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
  footer: {
    padding: Spacing.xl,
    alignItems: "center",
  },
});
