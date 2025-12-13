import React, { useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  ActivityIndicator,
  Alert,
  TextInput,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SETTINGS_KEY = "@soundstream_settings";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic } from "@/hooks/useMusic";
import { useTheme } from "@/hooks/useTheme";
import { useSettings } from "@/hooks/useSettings";
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
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation<NavigationProp>();
  const { servers, qobuzConnected, refreshLibrary, clearAllData, isLoading, addServer, activeServer, removeServer, playlists, updateServerConnectionStatus, setActiveServer } = useMusic();
  const { theme } = useTheme();
  const { 
    chromecastIp, setChromecastIp,
    gapless, setGapless,
    crossfade, setCrossfade,
    normalization, setNormalization,
    hardwareVolumeControl, setHardwareVolumeControl,
    isLoaded: settingsLoaded,
  } = useSettings();
  const { players, activePlayer, setActivePlayer, refreshPlayers, allPlayers, disabledPlayers, togglePlayerDisabled } = usePlayback();
  
  const [isConnecting, setIsConnecting] = useState(false);
  const [lmsHost, setLmsHost] = useState("");
  const [lmsPort, setLmsPort] = useState("9000");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isRefreshingPlayers, setIsRefreshingPlayers] = useState(false);
  
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<Array<{host: string; port: number; name: string}>>([]);
  const [libraryStats, setLibraryStats] = useState<{ albums: number; artists: number; tracks: number; radioStations: number; playlists: number } | null>(null);
  
  const [isChromecastDiscovering, setIsChromecastDiscovering] = useState(false);
  const [discoveredChromecastDevices, setDiscoveredChromecastDevices] = useState<Array<{ip: string; name: string}>>([]);
  const [isConfiguringLMS, setIsConfiguringLMS] = useState(false);

  useEffect(() => {
    if (activeServer) {
      refreshPlayers();
      loadLibraryStats();
    }
    // Check server connection status when screen loads
    if (servers.length > 0) {
      updateServerConnectionStatus();
    }
  }, []);

  useEffect(() => {
    if (activeServer) {
      loadLibraryStats();
    } else {
      setLibraryStats(null);
    }
  }, [activeServer]);

  const loadLibraryStats = async () => {
    try {
      const stats = await lmsClient.getLibraryTotals();
      setLibraryStats(stats);
    } catch (e) {
      console.error("Failed to load library stats:", e);
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
        await refreshLibrary();
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
        await refreshLibrary();
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

  const handleConfigureLMS = async () => {
    if (!activePlayer) {
      Alert.alert('No Player Selected', 'Please select a player first to configure LMS settings.');
      return;
    }

    if (!activeServer) {
      Alert.alert('No Server Connected', 'Please connect to an LMS server first.');
      return;
    }

    setIsConfiguringLMS(true);
    try {
      lmsClient.setServer(activeServer.host, activeServer.port);
      await lmsClient.configureForStablePlayback(activePlayer.id);
      Alert.alert(
        'Configuration Complete',
        'LMS server and player settings have been optimized to prevent audio dropouts.\n\nSettings applied:\n• Buffer size: 8192 frames\n• Streaming buffer: 100%\n• Network buffers: 128KB\n• Rebuffer threshold: 0%\n• Crossfade/Replay Gain: Disabled\n• Gapless playback: Enabled\n\nNote: Some settings may need to be configured manually in the LMS web interface if not available via API.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      Alert.alert(
        'Configuration Error',
        `Some settings were configured, but some preferences may need to be set manually in the LMS web interface.\n\nError: ${error instanceof Error ? error.message : String(error)}\n\nSee AUDIO_DROPOUT_TROUBLESHOOTING.md for manual configuration steps.`
      );
    } finally {
      setIsConfiguringLMS(false);
    }
  };

  const handleSelectPlayer = (player: typeof players[0]) => {
    setActivePlayer(player);
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

  const handleDiscoverChromecast = async () => {
    setIsChromecastDiscovering(true);
    setConnectionError(null);
    setDiscoveredChromecastDevices([]);
    
    try {
      const apiUrl = getApiUrl();
      console.log('[Chromecast] Discovering devices via:', `${apiUrl}/api/chromecast/discover`);
      
      const response = await fetch(`${apiUrl}/api/chromecast/discover`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Chromecast] Discovery failed:', response.status, errorText);
        setConnectionError(`Discovery failed: ${response.status} ${response.statusText}`);
        return;
      }
      
      const data = await response.json();
      console.log('[Chromecast] Discovery response:', data);
      
      // Handle both array response and object with devices property
      const devices = Array.isArray(data) ? data : (data.devices || []);
      
      if (devices.length === 0) {
        setConnectionError("No Chromecast devices found. Make sure your device is powered on and connected to WiFi.");
      } else {
        setDiscoveredChromecastDevices(devices);
        setConnectionError(null);
      }
    } catch (error) {
      console.error('[Chromecast] Discovery error:', error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setConnectionError(`Discovery failed: ${errorMessage}`);
    } finally {
      setIsChromecastDiscovering(false);
    }
  };

  const handleSelectChromecast = async (ip: string) => {
    setChromecastIp(ip);
    setDiscoveredChromecastDevices([]);
    
    // Automatically start casting when a device is selected
    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/chromecast/cast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ip,
          lmsHost: activeServer?.host,
          lmsPort: activeServer?.port || 9000,
          playerId: activePlayer?.id,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('[Chromecast] Cast started:', data);
      } else {
        const errorText = await response.text();
        console.error('[Chromecast] Failed to start cast:', errorText);
        setConnectionError(`Failed to start casting: ${errorText}`);
      }
    } catch (error) {
      console.error('[Chromecast] Error starting cast:', error);
      setConnectionError(`Failed to start casting: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const getApiUrl = () => {
    const domain = process.env.EXPO_PUBLIC_DOMAIN || 'localhost:3000';
    const protocol = Platform.OS === 'web' ? window.location.protocol : 'http:';
    return `${protocol}//${domain}`;
  };

  const isWeb = Platform.OS === 'web';

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { 
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: tabBarHeight + Spacing["5xl"],
          },
        ]}
      >
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Connected Servers</ThemedText>
          <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
            {servers.length > 0 ? (
              <>
                {servers.map((server) => (
                  <Pressable
                    key={server.id}
                    style={({ pressed }) => [
                      styles.serverRow,
                      { opacity: pressed ? 0.7 : 1, borderColor: theme.border },
                      activeServer?.id === server.id ? styles.serverRowActive : null,
                    ]}
                    onPress={() => {
                      if (server.connected) {
                        setActiveServer(server);
                      }
                    }}
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
                    {!server.connected ? (
                      <View style={[styles.connectionBadge, { backgroundColor: theme.error + '20' }]}>
                        <Feather name="x-circle" size={14} color={theme.error} />
                        <ThemedText style={[styles.connectionText, { color: theme.error }]}>
                          Offline
                        </ThemedText>
                      </View>
                    ) : null}
                  </Pressable>
                ))}
                <ThemedText style={[styles.hintText, { color: theme.textTertiary }]}>
                  Tap a server to select it. Long press to remove.
                </ThemedText>
              </>
            ) : (
              <ThemedText style={[styles.hintText, { color: theme.textTertiary }]}>
                No servers connected. Add one below.
              </ThemedText>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>New LMS Connection</ThemedText>
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
              
              <Pressable
                style={({ pressed }) => [
                  styles.connectButton,
                  { flex: 1, marginLeft: Spacing.sm },
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

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Library</ThemedText>
          <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText style={[styles.libraryStatus, { color: theme.textSecondary }]}>
              {activeServer ? `Connected to ${activeServer.name}` : "No server connected"}
            </ThemedText>
            {activeServer && (
              <View style={styles.libraryStats}>
                <View style={styles.statItem}>
                  <ThemedText style={[styles.statLabel, { color: theme.textTertiary }]}>Albums</ThemedText>
                  <ThemedText style={[styles.statValue, { color: theme.accent }]}>
                    {libraryStats?.albums?.toLocaleString() || '—'}
                  </ThemedText>
                </View>
                <View style={styles.statItem}>
                  <ThemedText style={[styles.statLabel, { color: theme.textTertiary }]}>Artists</ThemedText>
                  <ThemedText style={[styles.statValue, { color: theme.accent }]}>
                    {libraryStats?.artists?.toLocaleString() || '—'}
                  </ThemedText>
                </View>
                <View style={styles.statItem}>
                  <ThemedText style={[styles.statLabel, { color: theme.textTertiary }]}>Tracks</ThemedText>
                  <ThemedText style={[styles.statValue, { color: theme.accent }]}>
                    {libraryStats?.tracks?.toLocaleString() || '—'}
                  </ThemedText>
                </View>
                <View style={styles.statItem}>
                  <ThemedText style={[styles.statLabel, { color: theme.textTertiary }]}>Playlists</ThemedText>
                  <ThemedText style={[styles.statValue, { color: theme.accent }]}>
                    {libraryStats?.playlists?.toLocaleString() || '—'}
                  </ThemedText>
                </View>
                <View style={styles.statItem}>
                  <ThemedText style={[styles.statLabel, { color: theme.textTertiary }]}>Radio</ThemedText>
                  <ThemedText style={[styles.statValue, { color: theme.accent }]}>
                    {libraryStats?.radioStations?.toLocaleString() || '—'}
                  </ThemedText>
                </View>
              </View>
            )}
            <Pressable
              style={({ pressed }) => [
                styles.refreshButton,
                { 
                  backgroundColor: theme.accent,
                  opacity: pressed || isLoading ? 0.7 : 1,
                },
              ]}
              onPress={async () => {
                await refreshLibrary();
                // Reload library stats to get updated radio station count
                await loadLibraryStats();
              }}
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

        {allPlayers.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Players</ThemedText>
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                {activePlayer && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.refreshPlayersButton,
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                    onPress={handleConfigureLMS}
                    disabled={isConfiguringLMS}
                  >
                    {isConfiguringLMS ? (
                      <ActivityIndicator size="small" color={theme.accent} />
                    ) : (
                      <Feather name="settings" size={16} color={theme.accent} />
                    )}
                  </Pressable>
                )}
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
            </View>
            <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
              {[...allPlayers].sort((a, b) => {
                if (activePlayer?.id === a.id) return -1;
                if (activePlayer?.id === b.id) return 1;
                return 0;
              }).map((player) => {
                const isDisabled = disabledPlayers.has(player.id);
                return (
                  <View
                    key={player.id}
                    style={[
                      styles.playerRow,
                      { borderColor: theme.border, opacity: isDisabled ? 0.5 : 1 },
                      activePlayer?.id === player.id ? styles.playerRowActive : null,
                    ]}
                  >
                    <Pressable
                      style={({ pressed }) => [
                        { flex: 1, flexDirection: 'row', alignItems: 'center', opacity: pressed ? 0.7 : 1 },
                      ]}
                      onPress={() => !isDisabled && handleSelectPlayer(player)}
                      disabled={isDisabled}
                    >
                      <View style={[styles.playerIcon, { backgroundColor: player.power ? theme.success + '20' : theme.textTertiary + '20' }]}>
                        <Feather name="speaker" size={16} color={player.power ? theme.success : theme.textTertiary} />
                      </View>
                      <View style={styles.playerInfo}>
                        <ThemedText style={[styles.playerName, { color: theme.text }]}>
                          {player.name}
                        </ThemedText>
                        <ThemedText style={[styles.playerModel, { color: theme.textSecondary }]}>
                          {player.model} {player.power ? '• On' : '• Off'} {isDisabled ? '• Hidden' : ''}
                        </ThemedText>
                      </View>
                      {activePlayer?.id === player.id ? (
                        <Feather name="check-circle" size={20} color={theme.accent} />
                      ) : (
                        <View style={styles.radioEmpty} />
                      )}
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.eyeButton,
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                      onPress={() => togglePlayerDisabled(player.id)}
                    >
                      <Feather 
                        name={isDisabled ? "eye-off" : "eye"} 
                        size={18} 
                        color={isDisabled ? theme.textTertiary : theme.textSecondary} 
                      />
                    </Pressable>
                  </View>
                );
              })}
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
            {Platform.OS === 'ios' && (
              <SettingRow
                icon="volume-2"
                iconColor={Colors.light.accentSecondary}
                title="Hardware Volume Control"
                subtitle="Use iPhone volume buttons to control playback"
                showChevron={false}
                rightElement={
                  <Switch
                    value={hardwareVolumeControl}
                    onValueChange={setHardwareVolumeControl}
                    trackColor={{
                      false: Colors.light.backgroundTertiary,
                      true: Colors.light.accent,
                    }}
                    thumbColor={Colors.light.text}
                  />
                }
              />
            )}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>TV Display</ThemedText>
          <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText style={[styles.hintText, { color: theme.textSecondary, marginBottom: Spacing.md }]}>
              Stream album artwork and track info to a TV via Chromecast
            </ThemedText>
            
            <View style={styles.buttonRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.connectButton,
                  { flex: 1 },
                  { 
                    backgroundColor: theme.accentSecondary,
                    opacity: pressed || isChromecastDiscovering ? 0.7 : 1,
                  },
                ]}
                onPress={handleDiscoverChromecast}
                disabled={isChromecastDiscovering}
              >
                {isChromecastDiscovering ? (
                  <ActivityIndicator size="small" color={theme.buttonText} />
                ) : (
                  <Feather name="search" size={18} color={theme.buttonText} />
                )}
                <ThemedText style={[styles.connectButtonText, { color: theme.buttonText }]}>
                  {isChromecastDiscovering ? "Searching..." : "Search Devices"}
                </ThemedText>
              </Pressable>
            </View>
            
            {connectionError && (chromecastIp === '' || isChromecastDiscovering) ? (
              <ThemedText style={[styles.errorText, { color: theme.error }]}>
                {connectionError}
              </ThemedText>
            ) : null}
            
            {discoveredChromecastDevices.length > 0 ? (
              <View style={styles.discoveredSection}>
                <ThemedText style={[styles.discoveredTitle, { color: theme.text }]}>
                  Found {discoveredChromecastDevices.length} Device{discoveredChromecastDevices.length !== 1 ? 's' : ''}
                </ThemedText>
                {discoveredChromecastDevices.map((device) => (
                  <Pressable
                    key={device.ip}
                    style={({ pressed }) => [
                      styles.discoveredServer,
                      { opacity: pressed ? 0.7 : 1, borderColor: theme.border },
                    ]}
                    onPress={() => handleSelectChromecast(device.ip)}
                  >
                    <Feather name="tv" size={16} color={theme.accent} />
                    <View style={styles.discoveredServerInfo}>
                      <ThemedText style={[styles.discoveredServerName, { color: theme.text }]}>
                        {device.name}
                      </ThemedText>
                      <ThemedText style={[styles.discoveredServerAddress, { color: theme.textSecondary }]}>
                        {device.ip}
                      </ThemedText>
                    </View>
                    <Feather name="chevron-right" size={18} color={theme.textTertiary} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {chromecastIp ? (
              <View style={[styles.selectedDevice, { borderColor: theme.accent, backgroundColor: theme.accent + '10' }]}>
                <Feather name="check-circle" size={18} color={theme.success} />
                <View style={styles.selectedDeviceInfo}>
                  <ThemedText style={[styles.selectedDeviceLabel, { color: theme.text }]}>
                    Connected
                  </ThemedText>
                  <ThemedText style={[styles.selectedDeviceIp, { color: theme.textSecondary }]}>
                    {chromecastIp}
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => setChromecastIp('')}
                  style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
                >
                  <Feather name="x" size={18} color={theme.error} />
                </Pressable>
              </View>
            ) : null}

            <ThemedText style={[styles.hintText, { color: theme.textTertiary }]}>
              {chromecastIp ? 'Tap X to disconnect from this device' : 'Search to find and select a Chromecast device'}
            </ThemedText>
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
  eyeButton: {
    padding: Spacing.sm,
    marginLeft: Spacing.sm,
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
  connectionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    marginLeft: Spacing.sm,
  },
  connectionText: {
    fontSize: 11,
    fontWeight: "600",
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
    justifyContent: "space-around",
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.light.backgroundTertiary,
  },
  statItem: {
    alignItems: "center",
  },
  statLabel: {
    fontSize: 12,
    color: Colors.light.textTertiary,
    marginBottom: Spacing.xs,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "600",
    color: Colors.light.accent,
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
  selectedDevice: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    gap: Spacing.md,
  },
  selectedDeviceInfo: {
    flex: 1,
  },
  selectedDeviceLabel: {
    ...Typography.body,
    fontWeight: "500",
  },
  selectedDeviceIp: {
    ...Typography.caption,
    marginTop: 2,
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
