import React, { useCallback, memo } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useFavoriteRadios } from "@/hooks/useLibrary";

interface RadioStation {
  id: string;
  name: string;
  url?: string;
  image?: string;
}

const RadioRow = memo(({ station, onPress }: { station: RadioStation; onPress: () => void }) => (
  <Pressable
    style={({ pressed }) => [
      styles.stationRow,
      { opacity: pressed ? 0.6 : 1 },
    ]}
    onPress={onPress}
  >
    <View style={styles.stationIcon}>
      <Feather name="radio" size={20} color={Colors.light.accent} />
    </View>
    <View style={styles.stationInfo}>
      <ThemedText style={styles.stationName} numberOfLines={1}>
        {station.name}
      </ThemedText>
    </View>
    <Feather name="play-circle" size={20} color={Colors.light.accent} />
  </Pressable>
));

export default function RadioScreen() {
  const insets = useSafeAreaInsets();
  const { data: stations = [], isLoading } = useFavoriteRadios();

  const handlePlayStation = useCallback((station: RadioStation) => {
    // TODO: Implement radio station playback
  }, []);

  const renderStation = useCallback(({ item }: { item: RadioStation }) => (
    <RadioRow station={item} onPress={() => handlePlayStation(item)} />
  ), [handlePlayStation]);

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
      <View style={[styles.headerInfo, { paddingTop: insets.top + Spacing.md }]}>
        <ThemedText style={styles.count}>
          {stations.length} favorite stations
        </ThemedText>
      </View>
      {stations.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="radio" size={40} color={Colors.light.textTertiary} />
          <ThemedText style={[styles.emptyText, { color: Colors.light.textSecondary }]}>
            No favorite radio stations
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={stations}
          renderItem={renderStation}
          keyExtractor={keyExtractor}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          onEndReachedThreshold={0.5}
          ItemSeparatorComponent={ItemSeparator}
          removeClippedSubviews={true}
          maxToRenderPerBatch={20}
          windowSize={10}
          initialNumToRender={20}
          getItemLayout={(_, index) => ({
            length: 60 + StyleSheet.hairlineWidth,
            offset: (60 + StyleSheet.hairlineWidth) * index,
            index,
          })}
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
    paddingHorizontal: 0,
  },
  stationRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  stationIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
    backgroundColor: Colors.light.accent + '10',
  },
  stationInfo: {
    flex: 1,
  },
  stationName: {
    ...Typography.body,
    fontWeight: "500",
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
  emptyText: {
    ...Typography.body,
  },
});
