import React, { useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  FlatList,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic, type Playlist } from "@/hooks/useMusic";
import { usePlayback, type Track } from "@/hooks/usePlayback";

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function PlaylistCard({ 
  playlist, 
  onPress, 
  onDelete 
}: { 
  playlist: Playlist; 
  onPress: () => void; 
  onDelete: () => void;
}) {
  const totalDuration = playlist.tracks.reduce((acc, t) => acc + t.duration, 0);
  const coverArt = playlist.tracks[0]?.albumArt;

  return (
    <Pressable
      style={({ pressed }) => [styles.playlistCard, { opacity: pressed ? 0.7 : 1 }]}
      onPress={onPress}
    >
      <View style={styles.playlistCover}>
        {coverArt ? (
          <Image source={coverArt} style={styles.coverImage} contentFit="cover" />
        ) : (
          <View style={styles.coverPlaceholder}>
            <Feather name="music" size={32} color={Colors.dark.textTertiary} />
          </View>
        )}
        {playlist.tracks.length > 0 ? (
          <View style={styles.playlistOverlay}>
            <Feather name="play" size={24} color={Colors.dark.text} />
          </View>
        ) : null}
      </View>
      <View style={styles.playlistInfo}>
        <ThemedText style={styles.playlistName} numberOfLines={1}>
          {playlist.name}
        </ThemedText>
        <ThemedText style={styles.playlistMeta}>
          {playlist.tracks.length} track{playlist.tracks.length !== 1 ? "s" : ""}
          {playlist.tracks.length > 0 ? ` • ${Math.floor(totalDuration / 60)} min` : ""}
        </ThemedText>
      </View>
      <Pressable
        style={({ pressed }) => [styles.deleteButton, { opacity: pressed ? 0.6 : 1 }]}
        onPress={onDelete}
      >
        <Feather name="trash-2" size={18} color={Colors.dark.error} />
      </Pressable>
    </Pressable>
  );
}

export default function PlaylistsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { playlists, createPlaylist, deletePlaylist, removeFromPlaylist, reorderPlaylist } = useMusic();
  const { playTrack } = usePlayback();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);

  useEffect(() => {
    if (selectedPlaylist) {
      const updated = playlists.find(p => p.id === selectedPlaylist.id);
      if (updated) {
        setSelectedPlaylist(updated);
      } else {
        setSelectedPlaylist(null);
      }
    }
  }, [playlists]);

  const handleCreatePlaylist = () => {
    if (newPlaylistName.trim()) {
      createPlaylist(newPlaylistName.trim());
      setNewPlaylistName("");
      setShowCreateModal(false);
    }
  };

  const handleDeletePlaylist = (playlist: Playlist) => {
    Alert.alert(
      "Delete Playlist",
      `Are you sure you want to delete "${playlist.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deletePlaylist(playlist.id) },
      ]
    );
  };

  const handlePlayPlaylist = (playlist: Playlist) => {
    if (playlist.tracks.length > 0) {
      playTrack(playlist.tracks[0], playlist.tracks);
    }
  };

  const handleMoveTrackUp = (index: number) => {
    if (selectedPlaylist && index > 0) {
      reorderPlaylist(selectedPlaylist.id, index, index - 1);
    }
  };

  const handleMoveTrackDown = (index: number) => {
    if (selectedPlaylist && index < selectedPlaylist.tracks.length - 1) {
      reorderPlaylist(selectedPlaylist.id, index, index + 1);
    }
  };

  const renderTrack = ({ item, index }: { item: Track; index: number }) => (
    <Pressable
      style={({ pressed }) => [styles.trackRow, { opacity: pressed ? 0.6 : 1 }]}
      onPress={() => selectedPlaylist && playTrack(item, selectedPlaylist.tracks)}
    >
      <View style={styles.reorderControls}>
        <Pressable
          style={({ pressed }) => [styles.reorderButton, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => handleMoveTrackUp(index)}
          disabled={index === 0}
        >
          <Feather name="chevron-up" size={16} color={index === 0 ? Colors.dark.textTertiary + "40" : Colors.dark.textSecondary} />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.reorderButton, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => handleMoveTrackDown(index)}
          disabled={!selectedPlaylist || index === selectedPlaylist.tracks.length - 1}
        >
          <Feather name="chevron-down" size={16} color={!selectedPlaylist || index === selectedPlaylist.tracks.length - 1 ? Colors.dark.textTertiary + "40" : Colors.dark.textSecondary} />
        </Pressable>
      </View>
      <Image
        source={item.albumArt || require("../assets/images/placeholder-album.png")}
        style={styles.trackImage}
        contentFit="cover"
      />
      <View style={styles.trackInfo}>
        <ThemedText style={styles.trackTitle} numberOfLines={1}>{item.title}</ThemedText>
        <ThemedText style={styles.trackArtist} numberOfLines={1}>{item.artist}</ThemedText>
      </View>
      <ThemedText style={styles.trackDuration}>{formatDuration(item.duration)}</ThemedText>
      <Pressable
        style={({ pressed }) => [styles.removeButton, { opacity: pressed ? 0.6 : 1 }]}
        onPress={() => selectedPlaylist && removeFromPlaylist(selectedPlaylist.id, item.id)}
      >
        <Feather name="x" size={16} color={Colors.dark.textTertiary} />
      </Pressable>
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.lg, paddingBottom: tabBarHeight + Spacing["5xl"] },
        ]}
      >
        <View style={styles.header}>
          <ThemedText style={styles.title}>Playlists</ThemedText>
          <Pressable
            style={({ pressed }) => [styles.createButton, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => setShowCreateModal(true)}
          >
            <Feather name="plus" size={20} color={Colors.dark.buttonText} />
            <ThemedText style={styles.createButtonText}>New</ThemedText>
          </Pressable>
        </View>

        {playlists.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Feather name="list" size={48} color={Colors.dark.textTertiary} />
            </View>
            <ThemedText style={styles.emptyTitle}>No playlists yet</ThemedText>
            <ThemedText style={styles.emptySubtitle}>
              Create your first playlist to organize your music
            </ThemedText>
            <Pressable
              style={({ pressed }) => [styles.emptyButton, { opacity: pressed ? 0.8 : 1 }]}
              onPress={() => setShowCreateModal(true)}
            >
              <Feather name="plus" size={18} color={Colors.dark.buttonText} />
              <ThemedText style={styles.emptyButtonText}>Create Playlist</ThemedText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.playlistGrid}>
            {playlists.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                onPress={() => setSelectedPlaylist(playlist)}
                onDelete={() => handleDeletePlaylist(playlist)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={showCreateModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowCreateModal(false)}
      >
        <Pressable 
          style={styles.modalOverlay}
          onPress={() => setShowCreateModal(false)}
        >
          <Pressable style={styles.createModalContent} onPress={(e) => e.stopPropagation()}>
            <ThemedText style={styles.modalTitle}>New Playlist</ThemedText>
            <TextInput
              style={styles.modalInput}
              placeholder="Playlist name"
              placeholderTextColor={Colors.dark.textTertiary}
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <Pressable
                style={({ pressed }) => [styles.modalButton, styles.cancelButton, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => {
                  setNewPlaylistName("");
                  setShowCreateModal(false);
                }}
              >
                <ThemedText style={styles.cancelButtonText}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalButton, 
                  styles.confirmButton,
                  { opacity: pressed ? 0.8 : 1 },
                  !newPlaylistName.trim() && styles.buttonDisabled,
                ]}
                onPress={handleCreatePlaylist}
                disabled={!newPlaylistName.trim()}
              >
                <ThemedText style={styles.confirmButtonText}>Create</ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!selectedPlaylist}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedPlaylist(null)}
      >
        <Pressable 
          style={styles.modalOverlay}
          onPress={() => setSelectedPlaylist(null)}
        >
          <Pressable 
            style={[styles.detailModalContent, { paddingBottom: insets.bottom + Spacing.lg }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHandle} />
            {selectedPlaylist ? (
              <>
                <View style={styles.detailHeader}>
                  <View style={styles.detailCover}>
                    {selectedPlaylist.tracks[0]?.albumArt ? (
                      <Image 
                        source={selectedPlaylist.tracks[0].albumArt} 
                        style={styles.detailCoverImage} 
                        contentFit="cover" 
                      />
                    ) : (
                      <View style={styles.detailCoverPlaceholder}>
                        <Feather name="music" size={40} color={Colors.dark.textTertiary} />
                      </View>
                    )}
                  </View>
                  <View style={styles.detailInfo}>
                    <ThemedText style={styles.detailName}>{selectedPlaylist.name}</ThemedText>
                    <ThemedText style={styles.detailMeta}>
                      {selectedPlaylist.tracks.length} tracks
                    </ThemedText>
                    {selectedPlaylist.tracks.length > 0 ? (
                      <Pressable
                        style={({ pressed }) => [styles.playAllButton, { opacity: pressed ? 0.8 : 1 }]}
                        onPress={() => handlePlayPlaylist(selectedPlaylist)}
                      >
                        <Feather name="play" size={16} color={Colors.dark.buttonText} />
                        <ThemedText style={styles.playAllButtonText}>Play All</ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                {selectedPlaylist.tracks.length === 0 ? (
                  <View style={styles.emptyPlaylist}>
                    <Feather name="music" size={32} color={Colors.dark.textTertiary} />
                    <ThemedText style={styles.emptyPlaylistText}>
                      No tracks in this playlist yet
                    </ThemedText>
                    <ThemedText style={styles.emptyPlaylistSubtext}>
                      Add tracks from search or browse
                    </ThemedText>
                  </View>
                ) : (
                  <FlatList
                    data={selectedPlaylist.tracks}
                    renderItem={renderTrack}
                    keyExtractor={(item) => item.id}
                    style={styles.trackList}
                  />
                )}
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  title: {
    ...Typography.display,
    color: Colors.dark.text,
  },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.accent,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    gap: Spacing.xs,
  },
  createButtonText: {
    ...Typography.caption,
    color: Colors.dark.buttonText,
    fontWeight: "600",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 100,
  },
  emptyIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.dark.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  emptyTitle: {
    ...Typography.title,
    color: Colors.dark.text,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  emptyButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.accent,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
  },
  emptyButtonText: {
    ...Typography.bodyBold,
    color: Colors.dark.buttonText,
  },
  playlistGrid: {
    gap: Spacing.md,
  },
  playlistCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
  },
  playlistCover: {
    width: 60,
    height: 60,
    borderRadius: BorderRadius.xs,
    overflow: "hidden",
  },
  coverImage: {
    width: "100%",
    height: "100%",
  },
  coverPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: Colors.dark.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
  },
  playlistOverlay: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.dark.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  playlistInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  playlistName: {
    ...Typography.headline,
    color: Colors.dark.text,
  },
  playlistMeta: {
    ...Typography.caption,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  deleteButton: {
    padding: Spacing.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  createModalContent: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.md,
    padding: Spacing.xl,
    width: "85%",
    maxWidth: 340,
  },
  modalTitle: {
    ...Typography.title,
    color: Colors.dark.text,
    marginBottom: Spacing.lg,
    textAlign: "center",
  },
  modalInput: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    color: Colors.dark.text,
    ...Typography.body,
    marginBottom: Spacing.lg,
  },
  modalButtons: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  modalButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  cancelButtonText: {
    ...Typography.body,
    color: Colors.dark.textSecondary,
  },
  confirmButton: {
    backgroundColor: Colors.dark.accent,
  },
  confirmButtonText: {
    ...Typography.bodyBold,
    color: Colors.dark.buttonText,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  detailModalContent: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderTopLeftRadius: BorderRadius.md,
    borderTopRightRadius: BorderRadius.md,
    paddingTop: Spacing.md,
    width: "100%",
    maxHeight: "80%",
    position: "absolute",
    bottom: 0,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.dark.textTertiary,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: Spacing.lg,
  },
  detailHeader: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  detailCover: {
    width: 100,
    height: 100,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  detailCoverImage: {
    width: "100%",
    height: "100%",
  },
  detailCoverPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: Colors.dark.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
  },
  detailInfo: {
    flex: 1,
    marginLeft: Spacing.lg,
    justifyContent: "center",
  },
  detailName: {
    ...Typography.title,
    color: Colors.dark.text,
  },
  detailMeta: {
    ...Typography.caption,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.xs,
  },
  playAllButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.accent,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    gap: Spacing.xs,
    alignSelf: "flex-start",
    marginTop: Spacing.md,
  },
  playAllButtonText: {
    ...Typography.caption,
    color: Colors.dark.buttonText,
    fontWeight: "600",
  },
  emptyPlaylist: {
    alignItems: "center",
    paddingVertical: Spacing["3xl"],
  },
  emptyPlaylistText: {
    ...Typography.body,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.md,
  },
  emptyPlaylistSubtext: {
    ...Typography.caption,
    color: Colors.dark.textTertiary,
    marginTop: Spacing.xs,
  },
  trackList: {
    paddingHorizontal: Spacing.lg,
  },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
  },
  trackNumber: {
    ...Typography.caption,
    color: Colors.dark.textTertiary,
    width: 24,
  },
  trackImage: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.xs,
  },
  trackInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  trackTitle: {
    ...Typography.body,
    color: Colors.dark.text,
  },
  trackArtist: {
    ...Typography.caption,
    color: Colors.dark.textSecondary,
  },
  trackDuration: {
    ...Typography.caption,
    color: Colors.dark.textTertiary,
    marginRight: Spacing.sm,
  },
  removeButton: {
    padding: Spacing.sm,
  },
  reorderControls: {
    flexDirection: "column",
    alignItems: "center",
    marginRight: Spacing.sm,
  },
  reorderButton: {
    padding: 2,
  },
});
