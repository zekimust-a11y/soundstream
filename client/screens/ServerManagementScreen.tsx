import React, { useState, useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  Animated,
  Platform,
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

interface DiscoveredServer {
  id: string;
  name: string;
  type: "upnp" | "lms";
  host: string;
  port: number;
  manufacturer?: string;
}

function ScanningIndicator() {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [rotation]);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <Feather name="loader" size={20} color={Colors.light.accent} />
    </Animated.View>
  );
}

export default function ServerManagementScreen() {
  const insets = useSafeAreaInsets();
  const { servers, activeServer, addServer, removeServer, setActiveServer } = useMusic();

  const [showAddForm, setShowAddForm] = useState(false);
  const [serverName, setServerName] = useState("");
  const [serverHost, setServerHost] = useState("");
  const [serverPort, setServerPort] = useState("9000");
  const [serverType, setServerType] = useState<"upnp" | "lms">("lms");

  const [isScanning, setIsScanning] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServer[]>([]);
  const [scanComplete, setScanComplete] = useState(false);

  const scanForServers = async () => {
    setIsScanning(true);
    setScanComplete(false);
    setDiscoveredServers([]);

    await new Promise((resolve) => setTimeout(resolve, 2000));

    setIsScanning(false);
    setScanComplete(true);
  };

  const filteredDiscoveredServers = discoveredServers.filter(
    (discovered) => !servers.some(
      (existing) => existing.host === discovered.host && existing.port === discovered.port
    )
  );

  const handleAddDiscoveredServer = (discovered: DiscoveredServer) => {
    addServer({
      name: discovered.name,
      host: discovered.host,
      port: discovered.port,
      type: discovered.type,
    });
  };

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

  const renderDiscoverySection = () => (
    <View style={styles.discoverySection}>
      <View style={styles.discoverySectionHeader}>
        <ThemedText style={styles.sectionTitle}>Network Discovery</ThemedText>
        {Platform.OS === "web" ? (
          <ThemedText style={styles.webNotice}>
            Simulated on web
          </ThemedText>
        ) : null}
      </View>
      
      <View style={styles.discoveryCard}>
        <Pressable
          style={({ pressed }) => [
            styles.scanButton,
            isScanning && styles.scanButtonScanning,
            { opacity: pressed && !isScanning ? 0.8 : 1 },
          ]}
          onPress={scanForServers}
          disabled={isScanning}
        >
          {isScanning ? (
            <ScanningIndicator />
          ) : (
            <Feather name="wifi" size={20} color={Colors.light.accent} />
          )}
          <ThemedText style={styles.scanButtonText}>
            {isScanning ? "Scanning network..." : "Scan for Servers"}
          </ThemedText>
        </Pressable>

        {isScanning ? (
          <View style={styles.scanningInfo}>
            <ThemedText style={styles.scanningText}>
              Searching for UPNP and LMS servers on your network...
            </ThemedText>
          </View>
        ) : null}

        {filteredDiscoveredServers.length > 0 ? (
          <View style={styles.discoveredList}>
            <ThemedText style={styles.discoveredTitle}>
              Found {filteredDiscoveredServers.length} server{filteredDiscoveredServers.length > 1 ? "s" : ""}
            </ThemedText>
            {filteredDiscoveredServers.map((server) => (
              <View key={server.id} style={styles.discoveredServerCard}>
                <View style={styles.discoveredServerIcon}>
                  <Feather
                    name={server.type === "upnp" ? "cast" : "server"}
                    size={18}
                    color={Colors.light.success}
                  />
                </View>
                <View style={styles.discoveredServerInfo}>
                  <ThemedText style={styles.discoveredServerName}>
                    {server.name}
                  </ThemedText>
                  <ThemedText style={styles.discoveredServerAddress}>
                    {server.host}:{server.port}
                  </ThemedText>
                  {server.manufacturer ? (
                    <ThemedText style={styles.discoveredServerManufacturer}>
                      {server.manufacturer}
                    </ThemedText>
                  ) : null}
                </View>
                <View style={styles.discoveredServerType}>
                  <ThemedText style={styles.serverTypeBadge}>
                    {server.type.toUpperCase()}
                  </ThemedText>
                </View>
                <Pressable
                  style={({ pressed }) => [
                    styles.addDiscoveredButton,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                  onPress={() => handleAddDiscoveredServer(server)}
                >
                  <Feather name="plus" size={18} color={Colors.light.buttonText} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : scanComplete && !isScanning ? (
          <View style={styles.noServersFound}>
            <Feather name="info" size={18} color={Colors.light.textTertiary} />
            <ThemedText style={styles.noServersText}>
              No new servers found on your network
            </ThemedText>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
      >
        {renderDiscoverySection()}

        {servers.length === 0 && !showAddForm ? (
          <View style={styles.emptyState}>
            <Image
              source={require("../assets/images/no-servers.png")}
              style={styles.emptyImage}
              contentFit="contain"
            />
            <ThemedText style={styles.emptyTitle}>No servers configured</ThemedText>
            <ThemedText style={styles.emptySubtitle}>
              Scan for servers above or add one manually
            </ThemedText>
            <Button
              title="Add Manually"
              onPress={() => setShowAddForm(true)}
              style={styles.addButton}
            />
          </View>
        ) : (
          <>
            {servers.length > 0 ? (
              <View style={styles.configuredSection}>
                <ThemedText style={styles.sectionTitle}>Configured Servers</ThemedText>
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
                          color={Colors.light.accent}
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
                        <ThemedText style={styles.serverTypeLabel}>
                          {server.type.toUpperCase()}
                        </ThemedText>
                      </View>
                      <View style={styles.serverStatus}>
                        <View
                          style={[
                            styles.statusDot,
                            { backgroundColor: server.connected ? Colors.light.success : Colors.light.error },
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
                      <Feather name="trash-2" size={18} color={Colors.light.error} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}

            {showAddForm ? (
              <View style={styles.addForm}>
                <ThemedText style={styles.formTitle}>Add Server Manually</ThemedText>

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
                    placeholderTextColor={Colors.light.textTertiary}
                    value={serverName}
                    onChangeText={setServerName}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.inputLabel}>Host Address</ThemedText>
                  <TextInput
                    style={styles.input}
                    placeholder="192.168.1.100"
                    placeholderTextColor={Colors.light.textTertiary}
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
                    placeholderTextColor={Colors.light.textTertiary}
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
                <Feather name="plus" size={20} color={Colors.light.accent} />
                <ThemedText style={styles.addServerButtonText}>
                  Add Server Manually
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
    backgroundColor: Colors.light.backgroundRoot,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
  },
  discoverySection: {
    marginBottom: Spacing.xl,
  },
  discoverySectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.headline,
    color: Colors.light.text,
  },
  webNotice: {
    ...Typography.label,
    color: Colors.light.textTertiary,
    fontStyle: "italic",
  },
  discoveryCard: {
    backgroundColor: Colors.light.backgroundDefault,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  scanButtonScanning: {
    backgroundColor: Colors.light.backgroundSecondary,
  },
  scanButtonText: {
    ...Typography.body,
    color: Colors.light.accent,
    fontWeight: "600",
  },
  scanningInfo: {
    padding: Spacing.md,
    alignItems: "center",
  },
  scanningText: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
  discoveredList: {
    padding: Spacing.md,
  },
  discoveredTitle: {
    ...Typography.caption,
    color: Colors.light.success,
    marginBottom: Spacing.md,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  discoveredServerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.xs,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  discoveredServerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.light.success + "20",
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  discoveredServerInfo: {
    flex: 1,
  },
  discoveredServerName: {
    ...Typography.body,
    color: Colors.light.text,
    fontWeight: "500",
  },
  discoveredServerAddress: {
    ...Typography.caption,
    color: Colors.light.accent,
    marginTop: 2,
  },
  discoveredServerManufacturer: {
    ...Typography.label,
    color: Colors.light.textTertiary,
    marginTop: 2,
  },
  discoveredServerType: {
    marginRight: Spacing.sm,
  },
  serverTypeBadge: {
    ...Typography.label,
    color: Colors.light.textSecondary,
    backgroundColor: Colors.light.backgroundTertiary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  addDiscoveredButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.light.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  noServersFound: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  noServersText: {
    ...Typography.caption,
    color: Colors.light.textTertiary,
  },
  configuredSection: {
    marginBottom: Spacing.lg,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["3xl"],
  },
  emptyImage: {
    width: 120,
    height: 120,
    marginBottom: Spacing.lg,
    opacity: 0.6,
  },
  emptyTitle: {
    ...Typography.title,
    color: Colors.light.text,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  addButton: {
    minWidth: 160,
  },
  serverCard: {
    flexDirection: "row",
    backgroundColor: Colors.light.backgroundDefault,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.md,
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
    backgroundColor: Colors.light.accent + "20",
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
    color: Colors.light.text,
  },
  activeBadge: {
    backgroundColor: Colors.light.accent,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  activeBadgeText: {
    ...Typography.label,
    color: Colors.light.buttonText,
  },
  serverHost: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  serverTypeLabel: {
    ...Typography.label,
    color: Colors.light.textTertiary,
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
    backgroundColor: Colors.light.backgroundSecondary,
  },
  addServerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.light.backgroundDefault,
    padding: Spacing.lg,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderStyle: "dashed",
    gap: Spacing.sm,
  },
  addServerButtonText: {
    ...Typography.body,
    color: Colors.light.accent,
  },
  addForm: {
    backgroundColor: Colors.light.backgroundDefault,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
  },
  formTitle: {
    ...Typography.title,
    color: Colors.light.text,
    marginBottom: Spacing.lg,
  },
  typeSelector: {
    flexDirection: "row",
    backgroundColor: Colors.light.backgroundSecondary,
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
    backgroundColor: Colors.light.accent,
  },
  typeText: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    fontWeight: "600",
  },
  typeTextActive: {
    color: Colors.light.buttonText,
  },
  inputGroup: {
    marginBottom: Spacing.lg,
  },
  inputLabel: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginBottom: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    height: Spacing.inputHeight,
    color: Colors.light.text,
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
    color: Colors.light.textSecondary,
  },
});
