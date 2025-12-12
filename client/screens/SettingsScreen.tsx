import React, { useState, useEffect, useMemo } from "react";
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
  Linking,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";

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
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient } from "@/lib/lmsClient";
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
  const { servers, qobuzConnected, refreshLibrary, clearAllData, isLoading, addServer, activeServer, removeServer } = useMusic();
  const { theme } = useTheme();
  const { players, activePlayer, setActivePlayer, refreshPlayers } = usePlayback();
  
  const [isConnecting, setIsConnecting] = useState(false);
  const [lmsHost, setLmsHost] = useState("");
  const [lmsPort, setLmsPort] = useState("9000");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isRefreshingPlayers, setIsRefreshingPlayers] = useState(false);

  const [gapless, setGapless] = useState(true);
  const [crossfade, setCrossfade] = useState(false);
  const [normalization, setNormalization] = useState(false);
  const [hardwareVolumeControl, setHardwareVolumeControl] = useState(false);
  const [streamingQuality, setStreamingQuality] = useState<"cd" | "hires" | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<Array<{host: string; port: number; name: string}>>([]);
  const [urlCopied, setUrlCopied] = useState(false);
  
  const [localServerIp, setLocalServerIp] = useState("");
  const [localServerPort, setLocalServerPort] = useState("3000");
  const [isDiscoveringChromecasts, setIsDiscoveringChromecasts] = useState(false);
  const [discoveredChromecasts, setDiscoveredChromecasts] = useState<Array<{name: string; model: string; ip: string; port: number}>>([]);
  const [selectedChromecast, setSelectedChromecast] = useState<{name: string; ip: string} | null>(null);

  const nowPlayingUrl = useMemo(() => {
    if (!activeServer || !activePlayer) return null;
    // Generate a local network URL using the LMS server's IP address
    // This URL format is for when SoundStream is running on the local network
    // Port 5000 is the default SoundStream server port
    const baseUrl = `http://${activeServer.host}:5000`;
    return `${baseUrl}/now-playing?host=${activeServer.host}&port=${activeServer.port}&player=${encodeURIComponent(activePlayer.id)}`;
  }, [activeServer, activePlayer]);

  useEffect(() => {
    loadSettings();
    if (activeServer) {
      refreshPlayers();
    }
  }, []);

  useEffect(() => {
    // Only save after initial load is complete and when values actually change
    if (settingsLoaded && !isInitialLoad) {
      saveSettings();
    }
    // Mark initial load as complete after first render with loaded settings
    if (settingsLoaded && isInitialLoad) {
      setIsInitialLoad(false);
    }
  }, [gapless, crossfade, normalization, hardwareVolumeControl, streamingQuality, localServerIp, localServerPort, selectedChromecast, settingsLoaded, isInitialLoad]);

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const settings = JSON.parse(stored);
        setGapless(settings.gapless ?? true);
        setCrossfade(settings.crossfade ?? false);
        setNormalization(settings.normalization ?? false);
        setHardwareVolumeControl(settings.hardwareVolumeControl ?? false);
        setStreamingQuality(settings.streamingQuality ?? "cd");
        setLocalServerIp(settings.localServerIp ?? "");
        setLocalServerPort(settings.localServerPort ?? "3000");
        setSelectedChromecast(settings.selectedChromecast ?? null);
      } else {
        // No stored settings, use defaults
        setStreamingQuality("cd");
      }
      setSettingsLoaded(true);
    } catch (e) {
      console.error("Failed to load settings:", e);
      setStreamingQuality("cd"); // Set default on error
      setSettingsLoaded(true);
    }
  };

  const saveSettings = async () => {
    // Don't save if streaming quality hasn't been set yet
    if (streamingQuality === null) return;
    
    try {
      await AsyncStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ 
          gapless, 
          crossfade, 
          normalization, 
          hardwareVolumeControl, 
          streamingQuality,
          localServerIp,
          localServerPort,
          selectedChromecast,
        })
      );
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  };

  const handleDiscoverChromecasts = async () => {
    if (!localServerIp.trim()) {
      Alert.alert('Local Server Required', 'Please enter the IP address of the computer running the local display server.');
      return;
    }

    setIsDiscoveringChromecasts(true);
    setDiscoveredChromecasts([]);

    try {
      const port = localServerPort || '3000';
      const response = await fetch(`http://${localServerIp.trim()}:${port}/api/chromecasts?timeout=5000`);
      
      if (!response.ok) {
        throw new Error('Failed to connect to local server');
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      setDiscoveredChromecasts(data.devices || []);
      
      if (data.devices?.length === 0) {
        Alert.alert('No Devices Found', 'No Chromecast devices were found on your network. Make sure your Chromecast is powered on and connected to the same network.');
      }
    } catch (error) {
      console.error('Chromecast discovery error:', error);
      Alert.alert(
        'Discovery Failed', 
        `Could not discover Chromecast devices. Make sure the local server is running at ${localServerIp}:${localServerPort}\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setIsDiscoveringChromecasts(false);
    }
  };

  const handleSelectChromecast = async (device: {name: string; ip: string}) => {
    setSelectedChromecast(device);
    
    const serverUrl = `http://${localServerIp}:${localServerPort}`;
    
    try {
      const response = await fetch(`${serverUrl}/api/chromecast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ip: device.ip, name: device.name }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        Alert.alert('Chromecast Configured', `${device.name} is now set up for auto-casting. When music plays, the Now Playing screen will automatically appear on your TV.`);
      } else {
        Alert.alert('Chromecast Saved', `${device.name} has been saved. ${result.message}`);
      }
    } catch (error) {
      Alert.alert('Chromecast Selected', `${device.name} has been selected locally, but could not configure the server. Make sure your local server is running.`);
    }
  };

  const handleConnectLms = async () => {
    if (!lmsHost.trim()) {
      setConnectionError("Please enter a server address");
      return;
    }
    
    setIsConnecting(true);
    setConnectionError(null);
    
    try {
      const port = parseInt(lmsPort) || 9000;
      const server = await lmsClient.discoverServer(lmsHost.trim(), port);
      
      if (server) {
        addServer({
          name: server.name,
          host: server.host,
          port: server.port,
          type: 'lms',
        });
        lmsClient.setServer(server.host, server.port);
        await refreshPlayers();
        setLmsHost("");
        Alert.alert('Connected', `Successfully connected to ${server.name}`);
      } else {
        setConnectionError("Could not connect to LMS server. Make sure it is running.");
      }
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Connection failed");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleAutoDiscover = async () => {
    setIsDiscovering(true);
    setConnectionError(null);
    setDiscoveredServers([]);
    
    try {
      const servers = await lmsClient.autoDiscoverServers();
      setDiscoveredServers(servers.map(s => ({ host: s.host, port: s.port, name: s.name })));
      
      if (servers.length === 0) {
        setConnectionError("No LMS servers found. Make sure your server is running on this network.");
      }
    } catch (error) {
      setConnectionError("Auto-discovery failed: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleSelectDiscoveredServer = async (host: string, port: number) => {
    setIsConnecting(true);
    setConnectionError(null);
    
    try {
      const server = await lmsClient.discoverServer(host, port);
      
      if (server) {
        addServer({
          name: server.name,
          host: server.host,
          port: server.port,
          type: 'lms',
        });
        lmsClient.setServer(server.host, server.port);
        await refreshPlayers();
        setDiscoveredServers([]);
        Alert.alert('Connected', `Successfully connected to ${server.name}`);
      }
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Connection failed");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleRefreshPlayers = async () => {
    setIsRefreshingPlayers(true);
    await refreshPlayers();
    setIsRefreshingPlayers(false);
  };

  const handleSelectPlayer = async (player: typeof players[0]) => {
    setActivePlayer(player);
    
    // Also sync player selection to local Chromecast display server if configured
    if (localServerIp) {
      try {
        const serverUrl = `http://${localServerIp.trim()}:${localServerPort}`;
        const response = await fetch(`${serverUrl}/api/player`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId: player.id,
            playerName: player.name
          })
        });
        if (response.ok) {
          console.log('Player synced to local server:', player.name);
        }
      } catch (e) {
        console.log('Could not sync player to local server:', e);
      }
    }
  };

  const handleRemoveServer = (serverId: string) => {
    Alert.alert(
      "Remove Server",
      "Are you sure you want to remove this server?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => removeServer(serverId) },
      ]
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
          <ThemedText style={styles.sectionTitle}>LMS Connection</ThemedText>
          <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.hostInput, { color: theme.text, borderColor: theme.border }]}
                placeholder="LMS Server IP (e.g., 192.168.0.100)"
                placeholderTextColor={theme.textTertiary}
                value={lmsHost}
                onChangeText={setLmsHost}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="default"
              />
              <TextInput
                style={[styles.portInput, { color: theme.text, borderColor: theme.border }]}
                placeholder="Port"
                placeholderTextColor={theme.textTertiary}
                value={lmsPort}
                onChangeText={setLmsPort}
                keyboardType="number-pad"
              />
            </View>
            
            <View style={styles.buttonRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.connectButton,
                  { flex: 1 },
                  { 
                    backgroundColor: theme.accent,
                    opacity: pressed || isConnecting ? 0.7 : 1,
                  },
                ]}
                onPress={handleConnectLms}
                disabled={isConnecting}
              >
                {isConnecting ? (
                  <ActivityIndicator size="small" color={theme.buttonText} />
                ) : (
                  <Feather name="wifi" size={18} color={theme.buttonText} />
                )}
                <ThemedText style={[styles.connectButtonText, { color: theme.buttonText }]}>
                  {isConnecting ? "Connecting..." : "Connect"}
                </ThemedText>
              </Pressable>
              
              <Pressable
                style={({ pressed }) => [
                  styles.connectButton,
                  { flex: 1, marginLeft: Spacing.sm },
                  { 
                    backgroundColor: theme.accentSecondary,
                    opacity: pressed || isDiscovering ? 0.7 : 1,
                  },
                ]}
                onPress={handleAutoDiscover}
                disabled={isDiscovering}
              >
                {isDiscovering ? (
                  <ActivityIndicator size="small" color={theme.buttonText} />
                ) : (
                  <Feather name="search" size={18} color={theme.buttonText} />
                )}
                <ThemedText style={[styles.connectButtonText, { color: theme.buttonText }]}>
                  {isDiscovering ? "Searching..." : "Search"}
                </ThemedText>
              </Pressable>
            </View>
            
            {connectionError ? (
              <ThemedText style={[styles.errorText, { color: theme.error }]}>
                {connectionError}
              </ThemedText>
            ) : null}
            
            {discoveredServers.length > 0 ? (
              <View style={styles.discoveredSection}>
                <ThemedText style={[styles.discoveredTitle, { color: theme.text }]}>
                  Found {discoveredServers.length} Server{discoveredServers.length !== 1 ? 's' : ''}
                </ThemedText>
                {discoveredServers.map((server) => (
                  <Pressable
                    key={`${server.host}:${server.port}`}
                    style={({ pressed }) => [
                      styles.discoveredServer,
                      { opacity: pressed ? 0.7 : 1, borderColor: theme.border },
                    ]}
                    onPress={() => handleSelectDiscoveredServer(server.host, server.port)}
                  >
                    <Feather name="server" size={16} color={theme.accent} />
                    <View style={styles.discoveredServerInfo}>
                      <ThemedText style={[styles.discoveredServerName, { color: theme.text }]}>
                        {server.name}
                      </ThemedText>
                      <ThemedText style={[styles.discoveredServerAddress, { color: theme.textSecondary }]}>
                        {server.host}:{server.port}
                      </ThemedText>
                    </View>
                    <Feather name="chevron-right" size={18} color={theme.textTertiary} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            
            <ThemedText style={[styles.hintText, { color: theme.textTertiary }]}>
              Enter the IP address of your Logitech Media Server. Default port is 9000. Or use Search to auto-discover.
            </ThemedText>
          </View>
        </View>

        {servers.length > 0 ? (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Connected Servers</ThemedText>
            <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
              {servers.map((server) => (
                <Pressable
                  key={server.id}
                  style={({ pressed }) => [
                    styles.serverRow,
                    { opacity: pressed ? 0.7 : 1, borderColor: theme.border },
                    activeServer?.id === server.id ? styles.serverRowActive : null,
                  ]}
                  onLongPress={() => handleRemoveServer(server.id)}
                >
                  <View style={[styles.serverIcon, { backgroundColor: theme.accent + '20' }]}>
                    <Feather name="server" size={16} color={theme.accent} />
                  </View>
                  <View style={styles.serverInfo}>
                    <ThemedText style={[styles.serverName, { color: theme.text }]}>
                      {server.name}
                    </ThemedText>
                    <ThemedText style={[styles.serverAddress, { color: theme.textSecondary }]}>
                      {server.host}:{server.port}
                    </ThemedText>
                  </View>
                  {activeServer?.id === server.id ? (
                    <View style={styles.activeBadge}>
                      <Feather name="check" size={14} color={theme.success} />
                    </View>
                  ) : null}
                </Pressable>
              ))}
              <ThemedText style={[styles.hintText, { color: theme.textTertiary }]}>
                Long press a server to remove it.
              </ThemedText>
            </View>
          </View>
        ) : null}

        {players.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Players</ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.refreshPlayersButton,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={handleRefreshPlayers}
                disabled={isRefreshingPlayers}
              >
                {isRefreshingPlayers ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : (
                  <Feather name="refresh-cw" size={16} color={theme.accent} />
                )}
              </Pressable>
            </View>
            <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
              {players.map((player) => (
                <Pressable
                  key={player.id}
                  style={({ pressed }) => [
                    styles.playerRow,
                    { opacity: pressed ? 0.7 : 1, borderColor: theme.border },
                    activePlayer?.id === player.id ? styles.playerRowActive : null,
                  ]}
                  onPress={() => handleSelectPlayer(player)}
                >
                  <View style={[styles.playerIcon, { backgroundColor: player.power ? theme.success + '20' : theme.textTertiary + '20' }]}>
                    <Feather name="speaker" size={16} color={player.power ? theme.success : theme.textTertiary} />
                  </View>
                  <View style={styles.playerInfo}>
                    <ThemedText style={[styles.playerName, { color: theme.text }]}>
                      {player.name}
                    </ThemedText>
                    <ThemedText style={[styles.playerModel, { color: theme.textSecondary }]}>
                      {player.model} {player.power ? '• On' : '• Off'}
                    </ThemedText>
                  </View>
                  {activePlayer?.id === player.id ? (
                    <Feather name="check-circle" size={20} color={theme.accent} />
                  ) : (
                    <View style={styles.radioEmpty} />
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

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
            <ThemedText style={[styles.libraryStatus, { color: theme.textSecondary }]}>
              {activeServer ? `Connected to ${activeServer.name}` : "No server connected"}
            </ThemedText>
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
                Connect to an LMS server to load music
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

        {nowPlayingUrl ? (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>TV Display</ThemedText>
            <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
              <View style={styles.tvDisplayContent}>
                <View style={styles.tvDisplayHeader}>
                  <View style={[styles.iconContainer, { backgroundColor: '#9C27B0' + '20' }]}>
                    <Feather name="tv" size={18} color="#9C27B0" />
                  </View>
                  <View style={styles.settingContent}>
                    <ThemedText style={styles.settingTitle}>Now Playing Display</ThemedText>
                    <ThemedText style={styles.settingSubtitle}>
                      Cast this page to your TV to show album artwork and track info
                    </ThemedText>
                  </View>
                </View>
                <View style={styles.urlContainer}>
                  <ThemedText 
                    style={[styles.urlText, { color: theme.textSecondary }]} 
                    numberOfLines={2}
                  >
                    {nowPlayingUrl}
                  </ThemedText>
                </View>
                <View style={styles.tvDisplayButtons}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.tvDisplayButton,
                      { 
                        backgroundColor: theme.accent,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                    onPress={async () => {
                      await Clipboard.setStringAsync(nowPlayingUrl);
                      setUrlCopied(true);
                      setTimeout(() => setUrlCopied(false), 2000);
                    }}
                  >
                    <Feather name={urlCopied ? "check" : "copy"} size={16} color={theme.buttonText} />
                    <ThemedText style={[styles.tvDisplayButtonText, { color: theme.buttonText }]}>
                      {urlCopied ? "Copied!" : "Copy URL"}
                    </ThemedText>
                  </Pressable>
                  {Platform.OS === 'web' ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.tvDisplayButton,
                        styles.tvDisplayButtonSecondary,
                        { 
                          borderColor: theme.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                      onPress={() => {
                        window.open(nowPlayingUrl, '_blank');
                      }}
                    >
                      <Feather name="external-link" size={16} color={theme.text} />
                      <ThemedText style={[styles.tvDisplayButtonText, { color: theme.text }]}>
                        Open
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
                <ThemedText style={[styles.tvDisplayHint, { color: theme.textTertiary }]}>
                  This URL requires SoundStream to be running on your local network at port 5000. Open the URL on a device connected to the same network as your LMS server.
                </ThemedText>
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Display Server</ThemedText>
          <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.tvDisplayContent}>
              <View style={styles.tvDisplayHeader}>
                <View style={[styles.iconContainer, { backgroundColor: '#4CAF50' + '20' }]}>
                  <Feather name="cast" size={18} color="#4CAF50" />
                </View>
                <View style={styles.settingContent}>
                  <ThemedText style={styles.settingTitle}>Chromecast Auto-Cast</ThemedText>
                  <ThemedText style={styles.settingSubtitle}>
                    Automatically display Now Playing on your TV when music plays
                  </ThemedText>
                </View>
              </View>
              
              <ThemedText style={[styles.inputLabel, { color: theme.textSecondary, marginTop: Spacing.lg }]}>
                Local Server Address
              </ThemedText>
              <View style={styles.inputRow}>
                <TextInput
                  style={[styles.hostInput, { color: theme.text, borderColor: theme.border }]}
                  placeholder="Server IP (e.g., 192.168.0.50)"
                  placeholderTextColor={theme.textTertiary}
                  value={localServerIp}
                  onChangeText={setLocalServerIp}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="default"
                />
                <TextInput
                  style={[styles.portInput, { color: theme.text, borderColor: theme.border }]}
                  placeholder="Port"
                  placeholderTextColor={theme.textTertiary}
                  value={localServerPort}
                  onChangeText={setLocalServerPort}
                  keyboardType="number-pad"
                />
              </View>
              
              <Pressable
                style={({ pressed }) => [
                  styles.connectButton,
                  { 
                    backgroundColor: '#4CAF50',
                    opacity: pressed || isDiscoveringChromecasts ? 0.7 : 1,
                    marginTop: Spacing.md,
                  },
                ]}
                onPress={handleDiscoverChromecasts}
                disabled={isDiscoveringChromecasts}
              >
                {isDiscoveringChromecasts ? (
                  <ActivityIndicator size="small" color={theme.buttonText} />
                ) : (
                  <Feather name="search" size={18} color={theme.buttonText} />
                )}
                <ThemedText style={[styles.connectButtonText, { color: theme.buttonText }]}>
                  {isDiscoveringChromecasts ? "Scanning..." : "Find Chromecast Devices"}
                </ThemedText>
              </Pressable>

              {selectedChromecast ? (
                <View style={[styles.selectedDevice, { backgroundColor: '#4CAF50' + '15', marginTop: Spacing.md }]}>
                  <Feather name="check-circle" size={18} color="#4CAF50" />
                  <View style={{ marginLeft: Spacing.sm, flex: 1 }}>
                    <ThemedText style={styles.selectedDeviceName}>{selectedChromecast.name}</ThemedText>
                    <ThemedText style={[styles.selectedDeviceIp, { color: theme.textSecondary }]}>
                      {selectedChromecast.ip}
                    </ThemedText>
                  </View>
                  <Pressable
                    onPress={() => setSelectedChromecast(null)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Feather name="x" size={18} color={theme.textSecondary} />
                  </Pressable>
                </View>
              ) : null}

              {discoveredChromecasts.length > 0 ? (
                <View style={{ marginTop: Spacing.md }}>
                  <ThemedText style={[styles.inputLabel, { color: theme.textSecondary }]}>
                    Found Devices
                  </ThemedText>
                  {discoveredChromecasts.map((device, index) => (
                    <Pressable
                      key={`${device.ip}-${index}`}
                      style={({ pressed }) => [
                        styles.deviceRow,
                        { 
                          backgroundColor: pressed ? theme.backgroundTertiary : theme.backgroundDefault,
                          borderColor: theme.border,
                        },
                      ]}
                      onPress={() => handleSelectChromecast({ name: device.name, ip: device.ip })}
                    >
                      <View style={[styles.iconContainer, { backgroundColor: '#4CAF50' + '20' }]}>
                        <Feather name="tv" size={16} color="#4CAF50" />
                      </View>
                      <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                        <ThemedText style={styles.deviceName}>{device.name}</ThemedText>
                        <ThemedText style={[styles.deviceModel, { color: theme.textSecondary }]}>
                          {device.model ? `${device.model} - ` : ''}{device.ip}
                        </ThemedText>
                      </View>
                      <Feather name="plus-circle" size={20} color="#4CAF50" />
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <ThemedText style={[styles.tvDisplayHint, { color: theme.textTertiary, marginTop: Spacing.md }]}>
                Requires the local display server running on a computer on your network. The server will scan for Chromecast devices.
              </ThemedText>
            </View>
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
            <SettingRow
              icon="terminal"
              iconColor="#FF9800"
              title="Debug Console"
              subtitle="View logs and test connections"
              onPress={() => navigation.navigate("Debug")}
            />
          </View>
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
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.headline,
    color: Colors.light.textSecondary,
    marginBottom: Spacing.md,
    marginLeft: Spacing.xs,
  },
  sectionContent: {
    backgroundColor: Colors.light.backgroundDefault,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  inputRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    gap: Spacing.md,
  },
  hostInput: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    ...Typography.body,
  },
  portInput: {
    width: 80,
    height: 48,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    textAlign: "center",
    ...Typography.body,
  },
  buttonRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  connectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    gap: Spacing.sm,
  },
  connectButtonText: {
    ...Typography.body,
    fontWeight: "600",
  },
  errorText: {
    ...Typography.caption,
    textAlign: "center",
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  hintText: {
    ...Typography.caption,
    textAlign: "center",
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  discoveredSection: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  discoveredTitle: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  discoveredServer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.xs,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    gap: Spacing.md,
  },
  discoveredServerInfo: {
    flex: 1,
  },
  discoveredServerName: {
    ...Typography.body,
    fontWeight: "500",
  },
  discoveredServerAddress: {
    ...Typography.caption,
    marginTop: 2,
  },
  serverRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  serverRowActive: {
    backgroundColor: Colors.light.accent + '10',
  },
  serverIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  serverInfo: {
    flex: 1,
  },
  serverName: {
    ...Typography.body,
    fontWeight: "500",
  },
  serverAddress: {
    ...Typography.caption,
    marginTop: 2,
  },
  activeBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.light.success + '20',
    justifyContent: "center",
    alignItems: "center",
  },
  refreshPlayersButton: {
    padding: Spacing.sm,
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  playerRowActive: {
    backgroundColor: Colors.light.accent + '10',
  },
  playerIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    ...Typography.body,
    fontWeight: "500",
  },
  playerModel: {
    ...Typography.caption,
    marginTop: 2,
  },
  radioEmpty: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.light.border,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
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
    backgroundColor: Colors.light.success + "20",
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.sm,
  },
  libraryStatus: {
    ...Typography.body,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  libraryStats: {
    flexDirection: "row",
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  libraryStat: {
    flex: 1,
    alignItems: "center",
  },
  libraryStatNumber: {
    ...Typography.title,
    fontWeight: "700",
  },
  libraryStatLabel: {
    ...Typography.caption,
    marginTop: Spacing.xs,
  },
  libraryStatDivider: {
    width: 1,
    height: "100%",
    marginHorizontal: Spacing.lg,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    gap: Spacing.sm,
  },
  refreshButtonText: {
    ...Typography.body,
    fontWeight: "600",
  },
  refreshHint: {
    ...Typography.caption,
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  qualityOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  qualityOptionActive: {
    backgroundColor: Colors.light.accent + "08",
  },
  qualityInfo: {
    flex: 1,
  },
  qualityTitle: {
    ...Typography.body,
    color: Colors.light.text,
  },
  qualityTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  qualitySubtitle: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  hiResBadge: {
    backgroundColor: Colors.light.accent,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
    marginLeft: Spacing.sm,
  },
  hiResBadgeText: {
    ...Typography.label,
    color: Colors.light.buttonText,
    fontWeight: "600",
  },
  tvDisplayContent: {
    padding: Spacing.lg,
  },
  tvDisplayHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.md,
  },
  urlContainer: {
    backgroundColor: Colors.light.backgroundTertiary,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
  },
  urlText: {
    ...Typography.caption,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  tvDisplayButtons: {
    flexDirection: "row",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  tvDisplayButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    gap: Spacing.sm,
  },
  tvDisplayButtonSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  tvDisplayButtonText: {
    ...Typography.body,
    fontWeight: "600",
  },
  tvDisplayHint: {
    ...Typography.caption,
    textAlign: "center",
  },
  inputLabel: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
  },
  selectedDevice: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  selectedDeviceName: {
    ...Typography.body,
    fontWeight: "500",
  },
  selectedDeviceIp: {
    ...Typography.caption,
    marginTop: 2,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.xs,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  deviceName: {
    ...Typography.body,
    fontWeight: "500",
  },
  deviceModel: {
    ...Typography.caption,
    marginTop: 2,
  },
  dacHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  dacInputRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  dacInputGroup: {
    flex: 2,
  },
  dacPortGroup: {
    flex: 1,
  },
  dacToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  dacToggleLabel: {
    ...Typography.body,
    flex: 1,
  },
  dacStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  dacStatusText: {
    ...Typography.caption,
    fontWeight: "500",
  },
  textInput: {
    height: 48,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    ...Typography.body,
  },
});
