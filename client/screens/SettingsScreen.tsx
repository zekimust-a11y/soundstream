import React, { useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SETTINGS_KEY = "@soundstream_settings";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic } from "@/hooks/useMusic";
import { useTheme } from "@/hooks/useTheme";
import { useSsdpDiscovery } from "@/hooks/useSsdpDiscovery";
import { usePlayback } from "@/hooks/usePlayback";
import * as upnpClient from "@/lib/upnpClient";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList>;

interface SettingRowProps {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  showChevron?: boolean;
  rightElement?: React.ReactNode;
  iconColor?: string;
}

function SettingRow({
  icon,
  title,
  subtitle,
  value,
  onPress,
  showChevron = true,
  rightElement,
  iconColor = Colors.light.text,
}: SettingRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.settingRow,
        { opacity: pressed && onPress ? 0.6 : 1 },
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={[styles.iconContainer, { backgroundColor: iconColor + "20" }]}>
        <Feather name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.settingContent}>
        <ThemedText style={styles.settingTitle}>{title}</ThemedText>
        {subtitle ? (
          <ThemedText style={styles.settingSubtitle}>{subtitle}</ThemedText>
        ) : null}
      </View>
      {rightElement}
      {value ? (
        <ThemedText style={styles.settingValue}>{value}</ThemedText>
      ) : null}
      {showChevron && onPress ? (
        <Feather name="chevron-right" size={20} color={Colors.light.textTertiary} />
      ) : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NavigationProp>();
  const { servers, qobuzConnected, refreshLibrary, clearAllData, isLoading, artists, albums, addServer } = useMusic();
  const { theme } = useTheme();
  const { devices, isDiscovering, error: discoveryError, timeRemaining, startDiscovery, getMediaServers, getMediaRenderers, getContentDirectoryUrl, getAVTransportUrl } = useSsdpDiscovery();
  const { runOpenHomeDiagnostic, bridgeUrl, bridgeConnected, discoveredRenderers, setBridgeUrl, refreshBridgeDevices } = usePlayback();
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isDiscoveringDevice, setIsDiscoveringDevice] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<upnpClient.DeviceDiscoveryResult | null>(null);
  const [isRefreshingBridge, setIsRefreshingBridge] = useState(false);
  const [showBridgeUrlInput, setShowBridgeUrlInput] = useState(false);
  const [tempBridgeUrl, setTempBridgeUrl] = useState(bridgeUrl);

  const [gapless, setGapless] = useState(true);
  const [crossfade, setCrossfade] = useState(false);
  const [normalization, setNormalization] = useState(false);
  const [streamingQuality, setStreamingQuality] = useState<"cd" | "hires">("cd");
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (settingsLoaded) {
      saveSettings();
    }
  }, [gapless, crossfade, normalization, streamingQuality, settingsLoaded]);

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const settings = JSON.parse(stored);
        setGapless(settings.gapless ?? true);
        setCrossfade(settings.crossfade ?? false);
        setNormalization(settings.normalization ?? false);
        setStreamingQuality(settings.streamingQuality ?? "cd");
      }
      setSettingsLoaded(true);
    } catch (e) {
      console.error("Failed to load settings:", e);
      setSettingsLoaded(true);
    }
  };

  const saveSettings = async () => {
    try {
      await AsyncStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ gapless, crossfade, normalization, streamingQuality })
      );
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  };

  const mediaServers = getMediaServers();
  const mediaRenderers = getMediaRenderers();

  const handleAddDiscoveredServer = (device: typeof devices[0]) => {
    const contentDirectoryUrl = getContentDirectoryUrl(device);
    console.log('Adding server with ContentDirectory URL:', contentDirectoryUrl);
    addServer({
      name: device.name,
      host: device.host,
      port: device.port,
      type: 'upnp',
      contentDirectoryUrl: contentDirectoryUrl || undefined,
    });
    Alert.alert('Server Added', `${device.name} has been added.\n\nContentDirectory URL:\n${contentDirectoryUrl || 'Not found'}`);
  };

  const handleAddDiscoveredRenderer = (device: typeof devices[0]) => {
    const avTransportUrl = getAVTransportUrl(device);
    console.log('Adding renderer with AVTransport URL:', avTransportUrl);
    Alert.alert(
      'Renderer Found',
      `${device.name}\n\nAVTransport URL:\n${avTransportUrl || 'Not found'}\n\nRenderer will be used for playback.`
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: tabBarHeight + Spacing["5xl"] },
        ]}
      >
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Network Discovery</ThemedText>
          <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
            <Pressable
              style={({ pressed }) => [
                styles.discoveryButton,
                { 
                  backgroundColor: theme.accent,
                  opacity: pressed || isDiscovering ? 0.7 : 1,
                },
              ]}
              onPress={startDiscovery}
              disabled={isDiscovering}
            >
              {isDiscovering ? (
                <ActivityIndicator size="small" color={theme.buttonText} />
              ) : (
                <Feather name="wifi" size={18} color={theme.buttonText} />
              )}
              <ThemedText style={[styles.discoveryButtonText, { color: theme.buttonText }]}>
                {isDiscovering ? `Scanning... ${timeRemaining}s` : "Discover Devices"}
              </ThemedText>
            </Pressable>
            
            {Platform.OS === 'web' ? (
              <ThemedText style={[styles.discoveryHint, { color: theme.warning }]}>
                Network discovery requires running on a mobile device via Expo Go or a development build.
              </ThemedText>
            ) : null}
            
            {discoveryError ? (
              <ThemedText style={[styles.discoveryHint, { color: theme.error }]}>
                {discoveryError}
              </ThemedText>
            ) : null}
            
            {mediaServers.length > 0 ? (
              <View style={styles.discoveredSection}>
                <ThemedText style={[styles.discoveredLabel, { color: theme.textSecondary }]}>
                  Media Servers ({mediaServers.length})
                </ThemedText>
                {mediaServers.map((server) => (
                  <Pressable
                    key={server.id}
                    style={({ pressed }) => [
                      styles.discoveredDevice,
                      { opacity: pressed ? 0.7 : 1, borderColor: theme.border },
                    ]}
                    onPress={() => handleAddDiscoveredServer(server)}
                  >
                    <View style={[styles.deviceIcon, { backgroundColor: theme.accent + '20' }]}>
                      <Feather name="server" size={16} color={theme.accent} />
                    </View>
                    <View style={styles.deviceInfo}>
                      <ThemedText style={[styles.deviceName, { color: theme.text }]}>
                        {server.name}
                      </ThemedText>
                      <ThemedText style={[styles.deviceAddress, { color: theme.textSecondary }]}>
                        {server.host}:{server.port}
                      </ThemedText>
                    </View>
                    <Feather name="plus-circle" size={20} color={theme.accent} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            
            {mediaRenderers.length > 0 ? (
              <View style={styles.discoveredSection}>
                <ThemedText style={[styles.discoveredLabel, { color: theme.textSecondary }]}>
                  Audio Renderers ({mediaRenderers.length})
                </ThemedText>
                {mediaRenderers.map((renderer) => (
                  <Pressable
                    key={renderer.id}
                    style={({ pressed }) => [
                      styles.discoveredDevice,
                      { opacity: pressed ? 0.7 : 1, borderColor: theme.border },
                    ]}
                    onPress={() => handleAddDiscoveredRenderer(renderer)}
                  >
                    <View style={[styles.deviceIcon, { backgroundColor: theme.success + '20' }]}>
                      <Feather name="speaker" size={16} color={theme.success} />
                    </View>
                    <View style={styles.deviceInfo}>
                      <ThemedText style={[styles.deviceName, { color: theme.text }]}>
                        {renderer.name}
                      </ThemedText>
                      <ThemedText style={[styles.deviceAddress, { color: theme.textSecondary }]}>
                        {renderer.host}:{renderer.port}
                      </ThemedText>
                    </View>
                    <Feather name="check-circle" size={20} color={theme.success} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            
            {devices.length === 0 && !isDiscovering ? (
              <ThemedText style={[styles.discoveryHint, { color: theme.textTertiary }]}>
                Tap "Discover Devices" to find music servers and audio devices on your network.
              </ThemedText>
            ) : null}
            
            <Pressable
              style={({ pressed }) => [
                styles.manualAddButton,
                { 
                  borderColor: theme.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              onPress={() => {
                Alert.prompt(
                  "Add Server Manually",
                  "Enter the server IP address (e.g., 192.168.0.19)",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Add",
                      onPress: (ip: string | undefined) => {
                        if (ip && ip.trim()) {
                          const port = 9790;
                          addServer({
                            name: `MinimServer (${ip.trim()})`,
                            host: ip.trim(),
                            port,
                            type: 'upnp',
                            contentDirectoryUrl: `http://${ip.trim()}:${port}/dev/srv0/ctl/ContentDirectory`,
                          });
                          Alert.alert('Server Added', `Server at ${ip.trim()}:${port} has been added.`);
                        }
                      },
                    },
                  ],
                  "plain-text",
                  "",
                  "default"
                );
              }}
            >
              <Feather name="plus" size={18} color={theme.textSecondary} />
              <ThemedText style={[styles.manualAddText, { color: theme.textSecondary }]}>
                Add Server Manually
              </ThemedText>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Sources</ThemedText>
          <View style={styles.sectionContent}>
            <SettingRow
              icon="server"
              iconColor={Colors.light.accent}
              title="Music Servers"
              subtitle={
                servers.length > 0
                  ? `${servers.length} server${servers.length > 1 ? "s" : ""} configured`
                  : "No servers configured"
              }
              onPress={() => navigation.navigate("ServerManagement")}
            />
            <SettingRow
              icon="headphones"
              iconColor="#F99C38"
              title="Qobuz"
              subtitle={qobuzConnected ? "Connected" : "Not connected"}
              onPress={() => navigation.navigate("QobuzLogin")}
              rightElement={
                qobuzConnected ? (
                  <View style={styles.connectedBadge}>
                    <Feather name="check" size={12} color={theme.success} />
                  </View>
                ) : null
              }
            />
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Library</ThemedText>
          <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.libraryStats}>
              <View style={styles.libraryStat}>
                <ThemedText style={[styles.libraryStatNumber, { color: theme.text }]}>
                  {artists.length}
                </ThemedText>
                <ThemedText style={[styles.libraryStatLabel, { color: theme.textSecondary }]}>
                  Artists
                </ThemedText>
              </View>
              <View style={[styles.libraryStatDivider, { backgroundColor: theme.border }]} />
              <View style={styles.libraryStat}>
                <ThemedText style={[styles.libraryStatNumber, { color: theme.text }]}>
                  {albums.length}
                </ThemedText>
                <ThemedText style={[styles.libraryStatLabel, { color: theme.textSecondary }]}>
                  Albums
                </ThemedText>
              </View>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.refreshButton,
                { 
                  backgroundColor: theme.accent,
                  opacity: pressed || isLoading ? 0.7 : 1,
                },
              ]}
              onPress={refreshLibrary}
              disabled={isLoading || servers.length === 0}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={theme.buttonText} />
              ) : (
                <Feather name="refresh-cw" size={18} color={theme.buttonText} />
              )}
              <ThemedText style={[styles.refreshButtonText, { color: theme.buttonText }]}>
                {isLoading ? "Refreshing..." : "Refresh Library"}
              </ThemedText>
            </Pressable>
            {servers.length === 0 ? (
              <ThemedText style={[styles.refreshHint, { color: theme.textTertiary }]}>
                Add a server to load music
              </ThemedText>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Playback</ThemedText>
          <View style={styles.sectionContent}>
            <SettingRow
              icon="disc"
              iconColor={Colors.light.accentSecondary}
              title="Gapless Playback"
              subtitle="Seamless transitions between tracks"
              showChevron={false}
              rightElement={
                <Switch
                  value={gapless}
                  onValueChange={setGapless}
                  trackColor={{
                    false: Colors.light.backgroundTertiary,
                    true: Colors.light.accent,
                  }}
                  thumbColor={Colors.light.text}
                />
              }
            />
            <SettingRow
              icon="git-merge"
              iconColor={Colors.light.accentSecondary}
              title="Crossfade"
              subtitle="Blend tracks together"
              showChevron={false}
              rightElement={
                <Switch
                  value={crossfade}
                  onValueChange={setCrossfade}
                  trackColor={{
                    false: Colors.light.backgroundTertiary,
                    true: Colors.light.accent,
                  }}
                  thumbColor={Colors.light.text}
                />
              }
            />
            <SettingRow
              icon="bar-chart-2"
              iconColor={Colors.light.accentSecondary}
              title="Volume Normalization"
              subtitle="Balance volume across tracks"
              showChevron={false}
              rightElement={
                <Switch
                  value={normalization}
                  onValueChange={setNormalization}
                  trackColor={{
                    false: Colors.light.backgroundTertiary,
                    true: Colors.light.accent,
                  }}
                  thumbColor={Colors.light.text}
                />
              }
            />
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Streaming Quality</ThemedText>
          <View style={styles.sectionContent}>
            <Pressable
              style={({ pressed }) => [
                styles.qualityOption,
                streamingQuality === "cd" && styles.qualityOptionActive,
                { opacity: pressed ? 0.6 : 1 },
              ]}
              onPress={() => setStreamingQuality("cd")}
            >
              <View style={styles.qualityInfo}>
                <ThemedText style={styles.qualityTitle}>CD Quality</ThemedText>
                <ThemedText style={styles.qualitySubtitle}>
                  16-bit / 44.1kHz FLAC
                </ThemedText>
              </View>
              {streamingQuality === "cd" ? (
                <Feather name="check-circle" size={20} color={Colors.light.accent} />
              ) : (
                <View style={styles.radioEmpty} />
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.qualityOption,
                streamingQuality === "hires" && styles.qualityOptionActive,
                { opacity: pressed ? 0.6 : 1 },
              ]}
              onPress={() => setStreamingQuality("hires")}
            >
              <View style={styles.qualityInfo}>
                <View style={styles.qualityTitleRow}>
                  <ThemedText style={styles.qualityTitle}>Hi-Res</ThemedText>
                  <View style={styles.hiResBadge}>
                    <ThemedText style={styles.hiResBadgeText}>Hi-Res</ThemedText>
                  </View>
                </View>
                <ThemedText style={styles.qualitySubtitle}>
                  Up to 24-bit / 192kHz FLAC
                </ThemedText>
              </View>
              {streamingQuality === "hires" ? (
                <Feather name="check-circle" size={20} color={Colors.light.accent} />
              ) : (
                <View style={styles.radioEmpty} />
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Data</ThemedText>
          <View style={styles.sectionContent}>
            <SettingRow
              icon="trash-2"
              iconColor="#E53935"
              title="Clear All Data"
              subtitle="Remove all servers, library, and settings"
              onPress={() => {
                Alert.alert(
                  "Clear All Data",
                  "This will remove all servers, library data, favorites, and playlists. This cannot be undone.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Clear All",
                      style: "destructive",
                      onPress: clearAllData,
                    },
                  ]
                );
              }}
            />
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>About</ThemedText>
          <View style={styles.sectionContent}>
            <SettingRow
              icon="info"
              iconColor={Colors.light.textSecondary}
              title="Version"
              value="1.0.0"
              showChevron={false}
            />
            <SettingRow
              icon="file-text"
              iconColor={Colors.light.textSecondary}
              title="Privacy Policy"
              onPress={() => {}}
            />
            <SettingRow
              icon="file"
              iconColor={Colors.light.textSecondary}
              title="Terms of Service"
              onPress={() => {}}
            />
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>SSDP Bridge</ThemedText>
          <View style={styles.sectionContent}>
            <SettingRow
              icon="server"
              iconColor={bridgeConnected ? Colors.light.success : Colors.light.textSecondary}
              title="Bridge Status"
              subtitle={bridgeConnected ? `Connected - ${discoveredRenderers.length} renderer(s) found` : "Not connected (run bridge on your Mac)"}
              rightElement={
                bridgeConnected ? (
                  <View style={styles.connectedBadge}>
                    <Feather name="check" size={12} color={Colors.light.success} />
                  </View>
                ) : null
              }
              showChevron={false}
            />
            <SettingRow
              icon="refresh-cw"
              iconColor="#2196F3"
              title="Refresh Bridge Devices"
              subtitle="Fetch discovered devices from bridge"
              onPress={async () => {
                setIsRefreshingBridge(true);
                try {
                  await refreshBridgeDevices();
                  if (bridgeConnected) {
                    Alert.alert("Bridge Connected", `Found ${discoveredRenderers.length} renderer(s)`);
                  } else {
                    Alert.alert(
                      "Bridge Not Available",
                      "Make sure the SSDP Bridge is running on your Mac. Run: npx tsx server/ssdp-bridge.ts"
                    );
                  }
                } catch (error) {
                  Alert.alert("Error", String(error));
                } finally {
                  setIsRefreshingBridge(false);
                }
              }}
              rightElement={isRefreshingBridge ? <ActivityIndicator size="small" /> : null}
            />
            <SettingRow
              icon="edit-2"
              iconColor={Colors.light.textSecondary}
              title="Bridge URL"
              subtitle={showBridgeUrlInput ? "Enter your Mac's IP address" : bridgeUrl}
              onPress={() => {
                setTempBridgeUrl(bridgeUrl);
                setShowBridgeUrlInput(!showBridgeUrlInput);
              }}
            />
            {showBridgeUrlInput ? (
              <View style={styles.bridgeUrlInputContainer}>
                <TextInput
                  style={styles.bridgeUrlInput}
                  value={tempBridgeUrl}
                  onChangeText={setTempBridgeUrl}
                  placeholder="http://192.168.0.17:3847"
                  placeholderTextColor={Colors.light.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <Pressable
                  style={styles.bridgeUrlSaveButton}
                  onPress={async () => {
                    await setBridgeUrl(tempBridgeUrl);
                    setShowBridgeUrlInput(false);
                    Alert.alert("Saved", "Bridge URL updated. Tap 'Refresh Bridge Devices' to connect.");
                  }}
                >
                  <ThemedText style={styles.bridgeUrlSaveText}>Save</ThemedText>
                </Pressable>
              </View>
            ) : null}
            {discoveredRenderers.length > 0 ? (
              discoveredRenderers.map((renderer, index) => (
                <SettingRow
                  key={index}
                  icon="speaker"
                  iconColor="#FF5722"
                  title={renderer.name}
                  subtitle={`${renderer.manufacturer || ''} ${renderer.model || ''}\n${renderer.avTransportUrl ? 'AVTransport available' : 'No AVTransport'}`}
                  showChevron={false}
                />
              ))
            ) : null}
          </View>
          <ThemedText style={styles.refreshHint}>
            The SSDP Bridge runs on your Mac and discovers UPnP devices on your network. Change the URL to your Mac's IP if connecting from your iPhone.
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Developer</ThemedText>
          <View style={styles.sectionContent}>
            <SettingRow
              icon="search"
              iconColor="#2196F3"
              title="Discover Varese Services (JRiver-style)"
              subtitle="Find device description and UPnP service URLs"
              onPress={async () => {
                setIsDiscoveringDevice(true);
                setDiscoveryResult(null);
                try {
                  const result = await upnpClient.discoverDeviceServices('http://192.168.0.17:16500');
                  setDiscoveryResult(result);
                  
                  if (result.success) {
                    const serviceList = result.services.map(s => `- ${s.name}`).join('\n');
                    Alert.alert(
                      "Device Found",
                      `${result.friendlyName || 'Unknown'}\n${result.manufacturer || ''} ${result.modelName || ''}\n\nServices:\n${serviceList}\n\nAVTransport: ${result.avTransportUrl ? 'Found' : 'Not found'}\n\nTest: ${result.testResult?.success ? 'SUCCESS' : result.testResult?.error || 'Not tested'}`
                    );
                  } else {
                    Alert.alert(
                      "Discovery Failed",
                      result.error || "Could not find device description.\n\nThis is expected when running from Replit. Try running the app on your iPhone via Expo Go while on the same WiFi network as your Varese."
                    );
                  }
                } catch (error) {
                  Alert.alert("Error", String(error));
                } finally {
                  setIsDiscoveringDevice(false);
                }
              }}
              rightElement={isDiscoveringDevice ? <ActivityIndicator size="small" /> : null}
            />
            <SettingRow
              icon="activity"
              iconColor="#9C27B0"
              title="Run OpenHome Diagnostic"
              subtitle="Probe Varese for available OpenHome services"
              onPress={async () => {
                setIsDiagnosing(true);
                try {
                  await runOpenHomeDiagnostic();
                  Alert.alert(
                    "Diagnostic Complete",
                    "Check the console logs for results. Look for SUCCESS entries to see which services work."
                  );
                } catch (error) {
                  Alert.alert("Error", String(error));
                } finally {
                  setIsDiagnosing(false);
                }
              }}
              rightElement={isDiagnosing ? <ActivityIndicator size="small" /> : null}
            />
          </View>
          {discoveryResult ? (
            <ThemedText style={styles.refreshHint}>
              Last discovery: {discoveryResult.success ? `Found ${discoveryResult.friendlyName || 'device'} with ${discoveryResult.services.length} services` : discoveryResult.error}
            </ThemedText>
          ) : null}
          <ThemedText style={styles.refreshHint}>
            JRiver successfully controls the Varese via standard UPnP. Run "Discover Varese Services" from your iPhone (on the same WiFi) to find the correct AVTransport URL. The OpenHome diagnostic tests specific service actions.
          </ThemedText>
        </View>
      </ScrollView>
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
    paddingTop: Spacing.lg,
  },
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  sectionContent: {
    backgroundColor: Colors.light.backgroundDefault,
    marginHorizontal: Spacing.lg,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    ...Typography.body,
    color: Colors.light.text,
  },
  settingSubtitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  settingValue: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    marginRight: Spacing.sm,
  },
  connectedBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.light.success + "30",
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.sm,
  },
  qualityOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  qualityOptionActive: {
    backgroundColor: Colors.light.backgroundSecondary,
  },
  qualityInfo: {
    flex: 1,
  },
  qualityTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  qualityTitle: {
    ...Typography.body,
    color: Colors.light.text,
  },
  qualitySubtitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  radioEmpty: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.light.textTertiary,
  },
  hiResBadge: {
    backgroundColor: Colors.light.warning + "30",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  hiResBadgeText: {
    ...Typography.label,
    color: Colors.light.warning,
  },
  libraryStats: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    gap: Spacing.xl,
  },
  libraryStat: {
    alignItems: "center",
  },
  libraryStatNumber: {
    ...Typography.title,
    fontWeight: "700",
  },
  libraryStatLabel: {
    ...Typography.caption,
    marginTop: 2,
  },
  libraryStatDivider: {
    width: 1,
    height: 40,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  refreshButtonText: {
    ...Typography.body,
    fontWeight: "600",
  },
  refreshHint: {
    ...Typography.caption,
    textAlign: "center",
    paddingBottom: Spacing.md,
  },
  discoveryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  discoveryButtonText: {
    ...Typography.body,
    fontWeight: "600",
  },
  discoveryHint: {
    ...Typography.caption,
    textAlign: "center",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  discoveredSection: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  discoveredLabel: {
    ...Typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  discoveredDevice: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.sm,
  },
  deviceIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    ...Typography.body,
    fontWeight: "500",
  },
  deviceAddress: {
    ...Typography.caption,
    marginTop: 2,
  },
  manualAddButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  manualAddText: {
    ...Typography.body,
  },
  bridgeUrlInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
    gap: Spacing.sm,
  },
  bridgeUrlInput: {
    flex: 1,
    ...Typography.body,
    color: Colors.light.text,
    backgroundColor: Colors.light.backgroundSecondary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
  },
  bridgeUrlSaveButton: {
    backgroundColor: Colors.light.link,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
  },
  bridgeUrlSaveText: {
    ...Typography.body,
    color: "#FFFFFF",
    fontWeight: "600",
  },
});
