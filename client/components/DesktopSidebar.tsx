import React from "react";
import { View, StyleSheet, Pressable, ScrollView } from "react-native";
import { CommonActions, useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";

import { ThemedText } from "@/components/ThemedText";
import { AlbumArtwork } from "@/components/AlbumArtwork";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { usePlayback } from "@/hooks/usePlayback";
import { useMusic } from "@/hooks/useMusic";

type Nav = any;

function stripPlaylistName(name: string) {
  return name.replace(/^(SoundCloud|Tidal|Qobuz)\s*:?\s*/i, "").trim();
}

function SidebarItem({
  label,
  icon,
  onPress,
  right,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  right?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.navItem,
        { opacity: pressed ? 0.65 : 1 },
      ]}
    >
      <View style={styles.navIcon}>{icon}</View>
      <ThemedText style={styles.navLabel} numberOfLines={1}>
        {label}
      </ThemedText>
      {right ? <View style={styles.navRight}>{right}</View> : null}
    </Pressable>
  );
}

export function DesktopSidebar() {
  const navigation = useNavigation<Nav>();
  const { currentTrack } = usePlayback();
  const { playlists } = useMusic();
  const [playlistsExpanded, setPlaylistsExpanded] = React.useState(false);

  const sortedPlaylists = React.useMemo(() => {
    const copy = [...(playlists || [])];
    copy.sort((a, b) => stripPlaylistName(a.name).localeCompare(stripPlaylistName(b.name)));
    return copy;
  }, [playlists]);

  const goNowPlaying = React.useCallback(() => {
    navigation.dispatch(
      CommonActions.navigate({
        name: "NowPlaying",
      })
    );
  }, [navigation]);

  return (
    <View style={styles.container}>
      <Pressable
        onPress={goNowPlaying}
        style={({ pressed }) => [
          styles.nowPlayingCard,
          { opacity: pressed ? 0.75 : 1 },
        ]}
      >
        {currentTrack?.albumArt ? (
          <AlbumArtwork
            source={currentTrack.albumArt}
            style={styles.nowPlayingArt}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.nowPlayingArt, styles.nowPlayingArtPlaceholder]}>
            <Feather name="music" size={22} color={Colors.light.textTertiary} />
          </View>
        )}
        <View style={styles.nowPlayingText}>
          <ThemedText style={styles.nowPlayingTitle} numberOfLines={2}>
            {currentTrack?.title || "Nothing playing"}
          </ThemedText>
          <ThemedText style={styles.nowPlayingArtist} numberOfLines={1}>
            {currentTrack?.artist || ""}
          </ThemedText>
        </View>
      </Pressable>

      <ScrollView
        style={styles.menuScroll}
        contentContainerStyle={styles.menuContent}
        showsVerticalScrollIndicator={false}
      >
        <SidebarItem
          label="Home"
          icon={<Feather name="home" size={18} color={Colors.light.text} />}
          onPress={() => navigation.navigate("BrowseTab", { screen: "Browse" })}
        />
        <SidebarItem
          label="Artists"
          icon={<Feather name="users" size={18} color={Colors.light.text} />}
          onPress={() => navigation.navigate("BrowseTab", { screen: "AllArtists" })}
        />
        <SidebarItem
          label="Albums"
          icon={<Feather name="disc" size={18} color={Colors.light.text} />}
          onPress={() => navigation.navigate("AlbumsTab")}
        />
        <SidebarItem
          label="Playlists"
          icon={<Feather name="list" size={18} color={Colors.light.text} />}
          onPress={() => setPlaylistsExpanded((v) => !v)}
          right={
            <Feather
              name={playlistsExpanded ? "chevron-up" : "chevron-down"}
              size={18}
              color={Colors.light.textSecondary}
            />
          }
        />
        {playlistsExpanded ? (
          <View style={styles.playlistsSubList}>
            {sortedPlaylists.map((p) => (
              <Pressable
                key={p.id}
                onPress={() =>
                  navigation.navigate("PlaylistsTab", {
                    screen: "PlaylistDetail",
                    params: { playlist: { id: p.id, name: p.name } },
                  })
                }
                style={({ pressed }) => [
                  styles.playlistSubItem,
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <ThemedText style={styles.playlistSubLabel} numberOfLines={1}>
                  {stripPlaylistName(p.name)}
                </ThemedText>
              </Pressable>
            ))}
            {sortedPlaylists.length === 0 ? (
              <ThemedText style={styles.playlistEmpty} numberOfLines={2}>
                No playlists loaded yet
              </ThemedText>
            ) : null}
          </View>
        ) : null}
        <SidebarItem
          label="Tracks"
          icon={<Feather name="music" size={18} color={Colors.light.text} />}
          onPress={() => navigation.navigate("TracksTab")}
        />
        <SidebarItem
          label="Radio"
          icon={<Feather name="radio" size={18} color={Colors.light.text} />}
          onPress={() => navigation.navigate("RadioTab")}
        />
        <SidebarItem
          label="Tidal"
          icon={
            <Image
              source={require("../assets/images/tidal-icon.png")}
              style={{ width: 18, height: 18 }}
              contentFit="contain"
            />
          }
          onPress={() =>
            navigation.navigate("BrowseTab", {
              screen: "Browse",
              params: { scrollTo: "tidal" },
            })
          }
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 320,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Colors.light.border,
    backgroundColor: Colors.light.backgroundDefault,
    padding: Spacing.lg,
    paddingRight: Spacing.md,
  },
  nowPlayingCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  nowPlayingArt: {
    width: 68,
    height: 68,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.light.backgroundTertiary,
  },
  nowPlayingArtPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  nowPlayingText: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  nowPlayingTitle: {
    ...Typography.title,
    fontSize: 16,
    lineHeight: 20,
    color: Colors.light.text,
  },
  nowPlayingArtist: {
    ...Typography.caption,
    marginTop: 4,
    color: Colors.light.textSecondary,
  },
  menuScroll: {
    flex: 1,
  },
  menuContent: {
    paddingBottom: Spacing.xl,
    gap: 2,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: BorderRadius.md,
  },
  navIcon: {
    width: 26,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  navLabel: {
    ...Typography.body,
    color: Colors.light.text,
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  navRight: {
    marginLeft: Spacing.sm,
  },
  playlistsSubList: {
    marginLeft: 36,
    marginTop: 6,
    marginBottom: 10,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: Colors.light.border,
    gap: 6,
  },
  playlistSubItem: {
    paddingVertical: 6,
    paddingRight: 10,
  },
  playlistSubLabel: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  playlistEmpty: {
    ...Typography.caption,
    color: Colors.light.textTertiary,
    paddingVertical: 6,
  },
});


