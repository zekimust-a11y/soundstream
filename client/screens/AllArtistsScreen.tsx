import React, { useCallback, memo } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useInfiniteArtists, Artist } from "@/hooks/useLibrary";
import type { BrowseStackParamList } from "@/navigation/BrowseStackNavigator";

type NavigationProp = NativeStackNavigationProp<BrowseStackParamList>;

const ArtistRow = memo(({ artist, onPress }: { artist: Artist; onPress: () => void }) => (
  <Pressable
    style={({ pressed }) => [
      styles.artistRow,
      { opacity: pressed ? 0.6 : 1 },
    ]}
    onPress={onPress}
  >
    <View style={styles.artistAvatar}>
      <Feather name="user" size={24} color={Colors.light.textTertiary} />
    </View>
    <View style={styles.artistInfo}>
      <ThemedText style={styles.artistName} numberOfLines={1}>
        {artist.name}
      </ThemedText>
      <ThemedText style={styles.artistAlbums}>
        {artist.albumCount || 0} albums
      </ThemedText>
    </View>
    <Feather name="chevron-right" size={20} color={Colors.light.textTertiary} />
  </Pressable>
));

export default function AllArtistsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteArtists();

  const artists = data?.pages.flatMap(page => page.artists) || [];
  const total = data?.pages[0]?.total || 0;

  const handleArtistPress = useCallback((artist: Artist) => {
    navigation.navigate("Artist", { id: artist.id, name: artist.name });
  }, [navigation]);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderArtist = useCallback(({ item }: { item: Artist }) => (
    <ArtistRow artist={item} onPress={() => handleArtistPress(item)} />
  ), [handleArtistPress]);

  const keyExtractor = useCallback((item: Artist) => item.id, []);

  const ListFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={Colors.light.accent} />
      </View>
    );
  }, [isFetchingNextPage]);

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
      <View style={styles.headerInfo}>
        <ThemedText style={styles.count}>
          {artists.length.toLocaleString()} of {total.toLocaleString()} artists
        </ThemedText>
      </View>
      <FlatList
        data={artists}
        renderItem={renderArtist}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={ListFooter}
        ItemSeparatorComponent={ItemSeparator}
        removeClippedSubviews={true}
        maxToRenderPerBatch={20}
        windowSize={10}
        initialNumToRender={20}
        getItemLayout={(_, index) => ({
          length: 72 + StyleSheet.hairlineWidth,
          offset: (72 + StyleSheet.hairlineWidth) * index,
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
    paddingTop: Spacing.sm,
  },
  artistRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    height: 72,
  },
  artistAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  artistInfo: {
    flex: 1,
  },
  artistName: {
    ...Typography.body,
    color: Colors.light.text,
    fontWeight: "500",
  },
  artistAlbums: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.light.border,
    marginLeft: Spacing.lg + 48 + Spacing.md,
  },
  footer: {
    padding: Spacing.xl,
    alignItems: "center",
  },
});
