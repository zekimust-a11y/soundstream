import React, { useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic, type Server } from "@/hooks/useMusic";
import { Image } from "expo-image";

export default function ServerManagementScreen() {
  const insets = useSafeAreaInsets();
  const { servers, activeServer, addServer, removeServer, setActiveServer } = useMusic();

  const [showAddForm, setShowAddForm] = useState(false);
  const [serverName, setServerName] = useState("");
  const [serverHost, setServerHost] = useState("");
  const [serverPort, setServerPort] = useState("9000");
  const [serverType, setServerType] = useState<"upnp" | "lms">("lms");

  const handleAddServer = () => {
    if (!serverName.trim() || !serverHost.trim()) {
      Alert.alert("Error", "Please enter a server name and host address");
      return;
    }

    addServer({
      name: serverName.trim(),
      host: serverHost.trim(),
      port: parseInt(serverPort, 10) || 9000,
      type: serverType,
    });

    setServerName("");
    setServerHost("");
    setServerPort("9000");
    setShowAddForm(false);
  };

  const handleRemoveServer = (server: Server) => {
    Alert.alert(
      "Remove Server",
      `Are you sure you want to remove "${server.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeServer(server.id),
        },
      ]
    );
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
      >
        {servers.length === 0 && !showAddForm ? (
          <View style={styles.emptyState}>
            <Image
              source={require("../assets/images/no-servers.png")}
              style={styles.emptyImage}
              contentFit="contain"
            />
            <ThemedText style={styles.emptyTitle}>No servers configured</ThemedText>
            <ThemedText style={styles.emptySubtitle}>
              Add a UPNP or LMS server to browse your music library
            </ThemedText>
            <Button
              title="Add Server"
              onPress={() => setShowAddForm(true)}
              style={styles.addButton}
            />
          </View>
        ) : (
          <>
            {servers.map((server) => (
              <View key={server.id} style={styles.serverCard}>
                <Pressable
                  style={({ pressed }) => [
                    styles.serverContent,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                  onPress={() => setActiveServer(server)}
                >
                  <View style={styles.serverIcon}>
                    <Feather
                      name={server.type === "upnp" ? "cast" : "server"}
                      size={20}
                      color={Colors.dark.accent}
                    />
                  </View>
                  <View style={styles.serverInfo}>
                    <View style={styles.serverNameRow}>
                      <ThemedText style={styles.serverName}>{server.name}</ThemedText>
                      {activeServer?.id === server.id ? (
                        <View style={styles.activeBadge}>
                          <ThemedText style={styles.activeBadgeText}>Active</ThemedText>
                        </View>
                      ) : null}
                    </View>
                    <ThemedText style={styles.serverHost}>
                      {server.host}:{server.port}
                    </ThemedText>
                    <ThemedText style={styles.serverType}>
                      {server.type.toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={styles.serverStatus}>
                    <View
                      style={[
                        styles.statusDot,
                        { backgroundColor: server.connected ? Colors.dark.success : Colors.dark.error },
                      ]}
                    />
                  </View>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.removeButton,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                  onPress={() => handleRemoveServer(server)}
                >
                  <Feather name="trash-2" size={18} color={Colors.dark.error} />
                </Pressable>
              </View>
            ))}

            {showAddForm ? (
              <View style={styles.addForm}>
                <ThemedText style={styles.formTitle}>Add New Server</ThemedText>

                <View style={styles.typeSelector}>
                  <Pressable
                    style={[
                      styles.typeOption,
                      serverType === "lms" && styles.typeOptionActive,
                    ]}
                    onPress={() => setServerType("lms")}
                  >
                    <ThemedText
                      style={[
                        styles.typeText,
                        serverType === "lms" && styles.typeTextActive,
                      ]}
                    >
                      LMS
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.typeOption,
                      serverType === "upnp" && styles.typeOptionActive,
                    ]}
                    onPress={() => setServerType("upnp")}
                  >
                    <ThemedText
                      style={[
                        styles.typeText,
                        serverType === "upnp" && styles.typeTextActive,
                      ]}
                    >
                      UPNP
                    </ThemedText>
                  </Pressable>
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.inputLabel}>Server Name</ThemedText>
                  <TextInput
                    style={styles.input}
                    placeholder="My Music Server"
                    placeholderTextColor={Colors.dark.textTertiary}
                    value={serverName}
                    onChangeText={setServerName}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.inputLabel}>Host Address</ThemedText>
                  <TextInput
                    style={styles.input}
                    placeholder="192.168.1.100"
                    placeholderTextColor={Colors.dark.textTertiary}
                    value={serverHost}
                    onChangeText={setServerHost}
                    autoCapitalize="none"
                    keyboardType="url"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.inputLabel}>Port</ThemedText>
                  <TextInput
                    style={styles.input}
                    placeholder="9000"
                    placeholderTextColor={Colors.dark.textTertiary}
                    value={serverPort}
                    onChangeText={setServerPort}
                    keyboardType="number-pad"
                  />
                </View>

                <View style={styles.formActions}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.cancelButton,
                      { opacity: pressed ? 0.6 : 1 },
                    ]}
                    onPress={() => setShowAddForm(false)}
                  >
                    <ThemedText style={styles.cancelButtonText}>Cancel</ThemedText>
                  </Pressable>
                  <Button title="Add Server" onPress={handleAddServer} />
                </View>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.addServerButton,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
                onPress={() => setShowAddForm(true)}
              >
                <Feather name="plus" size={20} color={Colors.dark.accent} />
                <ThemedText style={styles.addServerButtonText}>
                  Add Server
                </ThemedText>
              </Pressable>
            )}
          </>
        )}
      </KeyboardAwareScrollViewCompat>
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
    padding: Spacing.lg,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["5xl"],
  },
  emptyImage: {
    width: 160,
    height: 160,
    marginBottom: Spacing.xl,
    opacity: 0.6,
  },
  emptyTitle: {
    ...Typography.title,
    color: Colors.dark.text,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  addButton: {
    minWidth: 160,
  },
  serverCard: {
    flexDirection: "row",
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
    overflow: "hidden",
  },
  serverContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
  },
  serverIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.dark.accent + "20",
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  serverInfo: {
    flex: 1,
  },
  serverNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  serverName: {
    ...Typography.headline,
    color: Colors.dark.text,
  },
  activeBadge: {
    backgroundColor: Colors.dark.accent,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  activeBadgeText: {
    ...Typography.label,
    color: Colors.dark.buttonText,
  },
  serverHost: {
    ...Typography.caption,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  serverType: {
    ...Typography.label,
    color: Colors.dark.textTertiary,
    marginTop: 2,
  },
  serverStatus: {
    padding: Spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  removeButton: {
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  addServerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.backgroundDefault,
    padding: Spacing.lg,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderStyle: "dashed",
    gap: Spacing.sm,
  },
  addServerButtonText: {
    ...Typography.body,
    color: Colors.dark.accent,
  },
  addForm: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
  },
  formTitle: {
    ...Typography.title,
    color: Colors.dark.text,
    marginBottom: Spacing.lg,
  },
  typeSelector: {
    flexDirection: "row",
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.lg,
    padding: 4,
  },
  typeOption: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: "center",
    borderRadius: BorderRadius.xs,
  },
  typeOptionActive: {
    backgroundColor: Colors.dark.accent,
  },
  typeText: {
    ...Typography.body,
    color: Colors.dark.textSecondary,
    fontWeight: "600",
  },
  typeTextActive: {
    color: Colors.dark.buttonText,
  },
  inputGroup: {
    marginBottom: Spacing.lg,
  },
  inputLabel: {
    ...Typography.caption,
    color: Colors.dark.textSecondary,
    marginBottom: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    height: Spacing.inputHeight,
    color: Colors.dark.text,
    ...Typography.body,
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  cancelButton: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  cancelButtonText: {
    ...Typography.body,
    color: Colors.dark.textSecondary,
  },
});
