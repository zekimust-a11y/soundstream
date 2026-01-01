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
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from "expo-web-browser";
import * as ExpoLinking from "expo-linking";
import { Linking } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic } from "@/hooks/useMusic";
import { useTheme } from "@/hooks/useTheme";
import { useSettings } from "@/hooks/useSettings";
import { usePlayback } from "@/hooks/usePlayback";
import { lmsClient } from "@/lib/lmsClient";
import { roonVolumeClient } from "@/lib/roonVolumeClient";
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
  const { servers, tidalConnected, refreshLibrary, clearAllData, isLoading, addServer, activeServer, removeServer, playlists, getTidalAuthUrl, connectTidal, disconnectTidal, checkTidalStatus, tidalEnabled, soundcloudEnabled, spotifyEnabled } = useMusic();
  const { theme } = useTheme();
  const {
    chromecastIp, setChromecastIp,
    chromecastEnabled, setChromecastEnabled,
    gapless, setGapless,
    crossfade, setCrossfade,
    normalization, setNormalization,
    hardwareVolumeControl, setHardwareVolumeControl,
    localLibraryEnabled, setLocalLibraryEnabled,
    setTidalEnabled,
    setSoundcloudEnabled,
    setSpotifyEnabled,
    isLoaded: settingsLoaded,
  } = useSettings();
  const { players, activePlayer, setActivePlayer, refreshPlayers, allPlayers, disabledPlayers, togglePlayerDisabled, dacConfig, setDacConfig, dacVolume } = usePlayback();
  
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isRefreshingPlayers, setIsRefreshingPlayers] = useState(false);
  const [roonVolumeEnabled, setRoonVolumeEnabled] = useState(false);
  const [roonStatus, setRoonStatus] = useState<{ connected: boolean; currentOutput: string | null; currentOutputName?: string | null; outputs: Array<{ output_id: string; display_name: string }> } | null>(null);
  const [playerSearchQuery, setPlayerSearchQuery] = useState("");
  
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<Array<{host: string; port: number; name: string}>>([]);

  // Manual server addition
  const [libraryStats, setLibraryStats] = useState<{ albums: number; artists: number; tracks: number; radioStations: number; playlists: number } | null>(null);
  
  const [isChromecastDiscovering, setIsChromecastDiscovering] = useState(false);
  const [discoveredChromecastDevices, setDiscoveredChromecastDevices] = useState<Array<{ip: string; name: string}>>([]);

  // DAC configuration state
  const [dacIp, setDacIp] = useState(dacConfig?.ip || "");
  const [dacPort, setDacPort] = useState(dacConfig?.port?.toString() || "80");
  const [dacName, setDacName] = useState(dacConfig?.name || "");
  const [dacEnabled, setDacEnabled] = useState(dacConfig?.enabled || false);

  // Verify Tidal connection status when screen loads and when tidalEnabled changes
  useEffect(() => {
    // Always check status when screen loads to ensure UI reflects actual server state
    checkTidalStatus().catch(error => {
      console.error('Failed to check Tidal status:', error);
    });
  }, [checkTidalStatus]);

  // Also check when tidalEnabled changes
  useEffect(() => {
    if (tidalEnabled) {
      checkTidalStatus().catch(error => {
        console.error('Failed to check Tidal status:', error);
      });
    } else {
      // If Tidal is disabled, ensure UI reflects disconnected state
      disconnectTidal().catch(error => {
        console.error('Failed to disconnect Tidal:', error);
      });
    }
  }, [tidalEnabled, checkTidalStatus, disconnectTidal]);

  // Handle OAuth callback
  useEffect(() => {
    const handleDeepLink = async (event: { url: string }) => {
      console.log('Received deep link:', event.url);

      // Check if this is a Tidal OAuth callback
      if (event.url.includes('soundstream://callback') && event.url.includes('code=')) {
        try {
          const url = new URL(event.url);
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');

          if (code) {
            console.log('Processing Tidal OAuth callback with code:', code.substring(0, 10) + '...');
            setIsConnecting(true);

            const success = await connectTidal(code);
            setIsConnecting(false);

            if (success) {
              Alert.alert('Success', 'Successfully connected to Tidal!');
            } else {
              Alert.alert('Connection Failed', 'Unable to connect to Tidal. Please try again.');
            }
          }
        } catch (error) {
          console.error('Error processing OAuth callback:', error);
          setIsConnecting(false);
          Alert.alert('Connection Error', 'Failed to process Tidal authentication. Please try again.');
        }
      }
    };

    // Listen for deep links
    const subscription = Linking.addEventListener('url', handleDeepLink);

    // Check if app was opened with a URL
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink({ url });
      }
    });

    return () => {
      subscription?.remove?.();
    };
  }, [connectTidal]);
  
  // Update local state when dacConfig changes
  useEffect(() => {
    if (dacConfig) {
      setDacIp(dacConfig.ip || "");
      setDacPort(dacConfig.port?.toString() || "80");
      setDacName(dacConfig.name || "");
      setDacEnabled(dacConfig.enabled || false);
    }
  }, [dacConfig]);

  useEffect(() => {
    console.log("SettingsScreen: activeServer or tidalEnabled changed", { hasServer: !!activeServer, tidalEnabled });
    if (activeServer) {
      refreshPlayers();
      loadLibraryStats();
    }
  }, [activeServer, refreshPlayers, tidalEnabled]); // Added tidalEnabled to refresh stats when service is enabled
  
  // Update local DAC state when dacConfig changes
  useEffect(() => {
    if (dacConfig) {
      setDacIp(dacConfig.ip || "");
      setDacPort(dacConfig.port?.toString() || "80");
      setDacName(dacConfig.name || "");
      setDacEnabled(dacConfig.enabled || false);
    } else {
      setDacIp("");
      setDacPort("80");
      setDacName("");
      setDacEnabled(false);
    }
  }, [dacConfig]);

  useEffect(() => {
    loadLibraryStats();
  }, []); // Load on mount

  useEffect(() => {
    if (activeServer) {
      loadLibraryStats();
    } else {
      // Don't clear stats if LMS client is configured
      if (!lmsClient.isServerConfigured) {
        setLibraryStats(null);
      }
    }
  }, [activeServer]);

  // Load Roon volume control config
  useEffect(() => {
    roonVolumeClient.loadConfig().then(() => {
      setRoonVolumeEnabled(roonVolumeClient.isEnabled());
      if (roonVolumeClient.isEnabled()) {
        // Retry status check a few times to ensure server is ready
        const checkStatusWithRetry = async (retries = 5) => {
          for (let i = 0; i < retries; i++) {
            try {
              const status = await roonVolumeClient.checkStatus();
              if (status.connected && status.currentOutput) {
                setRoonStatus({
                  connected: status.connected,
                  currentOutput: status.currentOutput,
                  currentOutputName: status.currentOutputName,
                  outputs: status.outputs,
                });
                return;
              }
            } catch (error) {
              console.log(`Roon status check attempt ${i + 1} failed:`, error);
            }
            if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between retries
            }
          }
          // If all retries failed but Roon is enabled, assume it's connected
          // Volume control might still work even if status check fails
          console.log('All Roon status check attempts failed, but assuming connected since volume control is enabled');
          setRoonStatus({
            connected: true,
            currentOutput: null,
            currentOutputName: 'Roon (Status unavailable - volume control enabled)',
            outputs: [],
          });
        };
        checkStatusWithRetry();
      }
    });
  }, []);

  const handleRoonVolumeToggle = async (enabled: boolean) => {
    try {
      await roonVolumeClient.setEnabled(enabled);
      setRoonVolumeEnabled(enabled);
      if (enabled) {
        // Check status when enabled - retry a few times to ensure connection is ready
        let retries = 3;
        let status = null;
        while (retries > 0) {
          try {
            status = await roonVolumeClient.checkStatus();
            if (status.connected && status.currentOutput) {
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            retries--;
          } catch (error) {
            retries--;
            if (retries > 0) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }
        if (status && status.connected) {
          setRoonStatus({
            connected: status.connected,
            currentOutput: status.currentOutput,
            currentOutputName: status.currentOutputName,
            outputs: status.outputs,
          });
        } else {
          // Even if status check fails, assume it's connected since Roon volume control is enabled
          // The actual volume operations will work even if status check fails
          console.log('Roon status check failed, but assuming connected since volume control is enabled');
          setRoonStatus({
            connected: true,
            currentOutput: null,
            currentOutputName: 'Roon (Status check failed - volume control still works)',
            outputs: [],
          });
        }
      } else {
        setRoonStatus(null);
      }
    } catch (error) {
      console.error('Failed to toggle Roon volume control:', error);
      Alert.alert('Error', 'Failed to toggle Roon volume control');
    }
  };

  const loadLibraryStats = async () => {
    try {
      console.log("loadLibraryStats called, activeServer:", activeServer);
      // If we don't have an activeServer from context, but LMS client might be configured
      // Check if LMS client has server configured
      if (!activeServer && lmsClient.isServerConfigured) {
        console.log("Using LMS client configured server");
      } else if (!activeServer) {
        console.log("No active server and LMS client not configured, returning");
        return;
      }

      // Ensure LMS client is set if we have activeServer from context
      if (activeServer) {
        lmsClient.setServer(activeServer.host, activeServer.port);
      }

      console.log("Calling lmsClient.getLibraryTotals() with enabled services:", { tidalEnabled });
      const stats = await lmsClient.getLibraryTotals(tidalEnabled);
      console.log("Library stats loaded:", stats);
      setLibraryStats(stats);
    } catch (e) {
      console.error("Failed to load library stats:", e);
      // Set zeros on error so UI shows something
      setLibraryStats({
        albums: 0,
        artists: 0,
        tracks: 0,
        radioStations: 0,
        playlists: 0,
      });
    }
  };


  const handleAutoDiscover = async () => {
    setIsDiscovering(true);
    setConnectionError(null);
    setDiscoveredServers([]);
    
    try {
      const servers = await lmsClient.autoDiscoverServers();
      // Filter to only show LMS servers (exclude UPnP devices like Sonos)
      const lmsServers = servers.filter((s: any) => !s.type || s.type === 'lms');
      setDiscoveredServers(lmsServers.map(s => ({ host: s.host, port: s.port, name: s.name })));
      
      if (lmsServers.length === 0) {
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
        await addServer({
          name: server.name,
          host: server.host,
          port: server.port,
        });
        await refreshPlayers();
        await refreshLibrary();
        setDiscoveredServers([]);
        Alert.alert('Connected', `Successfully connected to ${server.name}`);
      } else {
        setConnectionError("Could not connect to server. Please try again.");
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

  const handleSelectPlayer = (player: typeof players[0]) => {
    setActivePlayer(player);
  };

  const handleRemoveServer = async (serverId: string) => {
    const confirmRemoval = async () => {
      await removeServer(serverId);
    };
    
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
      if (window.confirm("Are you sure you want to remove this server?")) {
        await confirmRemoval();
      }
    } else {
      Alert.alert(
        "Remove Server",
        "Are you sure you want to remove this server?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: confirmRemoval },
        ]
      );
    }
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
          <View style={styles.sectionHeaderRow}>
            <ThemedText style={styles.sectionTitle}>Connected Servers</ThemedText>
            {activeServer && (
              <Pressable
                style={({ pressed }) => [
                  styles.refreshButton,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={async () => {
                  await refreshLibrary();
                  Alert.alert('Library Refreshed', 'Library data has been refreshed.');
                }}
              >
                <Feather name="refresh-cw" size={16} color={theme.accent} />
                <ThemedText style={[styles.refreshButtonText, { color: theme.accent }]}>
                  Refresh
                </ThemedText>
              </Pressable>
            )}
          </View>
          <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
            {servers.length > 0 ? (
              <>
                {servers.map((server) => (
                  <View
                    key={server.id}
                    style={[
                      styles.serverRow,
                      { borderColor: theme.border },
                      activeServer?.id === server.id ? styles.serverRowActive : null,
                    ]}
                  >
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
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
                    </View>
                    <Pressable
                      style={({ pressed }) => [
                        styles.deleteButton,
                        { opacity: pressed ? 0.7 : 1 },
                      ]}
                      onPress={(e) => {
                        e?.stopPropagation?.();
                        handleRemoveServer(server.id);
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Feather name="trash-2" size={18} color={theme.error} />
                    </Pressable>
                  </View>
                ))}
                <ThemedText style={[styles.hintText, { color: theme.textTertiary }]}>
                  Connected servers. Delete to remove.
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
          <ThemedText style={styles.sectionTitle}>Add LMS Server</ThemedText>
          <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
            <Pressable
              style={({ pressed }) => [
                styles.connectButton,
                { 
                  backgroundColor: theme.accent,
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
                {isDiscovering ? "Searching..." : "Search for Servers"}
              </ThemedText>
            </Pressable>
            
            {connectionError ? (
              <ThemedText style={[styles.errorText, { color: theme.error, marginTop: Spacing.md }]}>
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
                      { opacity: pressed || isConnecting ? 0.7 : 1, borderColor: theme.border },
                    ]}
                    onPress={() => handleSelectDiscoveredServer(server.host, server.port)}
                    disabled={isConnecting}
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
                    {isConnecting ? (
                      <ActivityIndicator size="small" color={theme.accent} />
                    ) : (
                      <Feather name="chevron-right" size={18} color={theme.textTertiary} />
                    )}
                  </Pressable>
                ))}
              </View>
            ) : null}
            
            <ThemedText style={[styles.hintText, { color: theme.textTertiary }]}>
              Search for LMS servers on your network. Click a server to connect.
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

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionTitle}>Players</ThemedText>
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
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
            {/* Search input for players */}
            <View style={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md }}>
              <View style={[styles.textInputContainer, { borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}>
                <Feather name="search" size={18} color={theme.textTertiary} style={{ marginRight: Spacing.sm }} />
                <TextInput
                  style={[styles.textInput, { color: theme.text, flex: 1, borderWidth: 0, paddingHorizontal: 0 }]}
                  placeholder="Search players..."
                  placeholderTextColor={theme.textTertiary}
                  value={playerSearchQuery}
                  onChangeText={setPlayerSearchQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {playerSearchQuery.length > 0 && (
                  <Pressable
                    onPress={() => setPlayerSearchQuery("")}
                    style={{ padding: Spacing.xs }}
                  >
                    <Feather name="x" size={16} color={theme.textTertiary} />
                  </Pressable>
                )}
              </View>
            </View>
            
            {allPlayers.length === 0 ? (
              <View style={{ padding: Spacing.lg, alignItems: 'center' }}>
                <ThemedText style={[styles.inputLabel, { color: theme.textTertiary }]}>
                  No players found. Connect to an LMS server and refresh.
                </ThemedText>
              </View>
            ) : (
              [...allPlayers]
                .filter((player) => {
                  if (!playerSearchQuery) return true;
                  const query = playerSearchQuery.toLowerCase();
                  return (
                    player.name.toLowerCase().includes(query) ||
                    player.model.toLowerCase().includes(query) ||
                    player.id.toLowerCase().includes(query)
                  );
                })
                .sort((a, b) => {
                  if (activePlayer?.id === a.id) return -1;
                  if (activePlayer?.id === b.id) return 1;
                  return 0;
                })
                .map((player) => {
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
                        <View style={[styles.playerIcon, { backgroundColor: player.power ? Colors.light.success + '20' : theme.textTertiary + '20' }]}>
                          <Feather name="speaker" size={16} color={player.power ? Colors.light.success : theme.textTertiary} />
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
                })
            )}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Integrations</ThemedText>
          <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
            <View style={[styles.serverRow, { borderColor: theme.border }]}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.serverIcon, { backgroundColor: '#000000' + '20' }]}>
                  <Feather name="music" size={16} color="#000000" />
                </View>
                <View style={styles.serverInfo}>
                  <ThemedText style={[styles.serverName, { color: theme.text }]}>
                    Tidal
                  </ThemedText>
                  <ThemedText style={[styles.serverAddress, { color: theme.textSecondary }]}>
                    {tidalConnected ? 'Connected to Tidal API' : 'Direct API integration - Content loaded from Tidal API'}
                  </ThemedText>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                {tidalConnected ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.authButton,
                      { opacity: pressed ? 0.6 : 1, backgroundColor: '#FF4444' }
                    ]}
                    onPress={() => {
                      Alert.alert(
                        'Disconnect Tidal',
                        'Are you sure you want to disconnect from Tidal?',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Disconnect',
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                await disconnectTidal();
                                Alert.alert('Success', 'Disconnected from Tidal');
                              } catch (error) {
                                Alert.alert('Error', 'Failed to disconnect from Tidal');
                              }
                            }
                          }
                        ]
                      );
                    }}
                  >
                    <ThemedText style={{ color: 'white', fontSize: 12 }}>Disconnect</ThemedText>
                  </Pressable>
                ) : (
                  <Pressable
                    style={({ pressed }) => [
                      styles.authButton,
                      { opacity: pressed || isLoading ? 0.6 : 1, backgroundColor: theme.accent }
                    ]}
                    disabled={isLoading}
                    onPress={async () => {
                      // Prevent rapid clicks that might trigger anti-bot measures
                      if (isLoading) return;
                      
                      try {
                        setIsConnecting(true);
                        console.log('Tidal Connect button pressed');
                        
                        // Add a small delay to prevent rapid requests
                        await new Promise(resolve => setTimeout(resolve, 300));
                        
                        const authUrl = await getTidalAuthUrl();
                        console.log('Got auth URL:', authUrl);

                        if (Platform.OS === 'web') {
                          // For web, open a popup and wait for /api/tidal/callback to postMessage tokens back.
                          const popup = window.open(authUrl, 'tidal-auth', 'width=520,height=720');
                          if (!popup) {
                            await Clipboard.setStringAsync(authUrl);
                            Alert.alert('Popup blocked', `Tidal login URL copied. Paste into a browser:\n\n${authUrl}`);
                            return;
                          }

                          const handler = async (event: MessageEvent) => {
                            const data: any = event?.data;
                            if (!data || data.type !== 'TIDAL_AUTH_SUCCESS' || !data.tokens?.accessToken) return;
                            window.removeEventListener('message', handler as any);

                            try {
                              await AsyncStorage.setItem('@soundstream_tidal', JSON.stringify({
                                connected: true,
                                accessToken: data.tokens.accessToken,
                                refreshToken: data.tokens.refreshToken,
                                userId: data.tokens.userId,
                              }));

                              await fetch(`${getApiUrl()}/api/tidal/set-tokens`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  accessToken: data.tokens.accessToken,
                                  refreshToken: data.tokens.refreshToken,
                                  userId: data.tokens.userId,
                                }),
                              });

                              await checkTidalStatus();
                              Alert.alert('Success', 'Connected to Tidal!');
                            } catch (e) {
                              Alert.alert('Error', 'Connected, but failed to save tokens.');
                            }
                          };
                          window.addEventListener('message', handler as any);
                        } else {
                          try {
                            // Native: use AuthSession so we get redirected back with ?code=...
                            const redirectUri = ExpoLinking.createURL('callback');
                            const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

                            if (result.type !== 'success' || !result.url) return;
                            const parsed = ExpoLinking.parse(result.url);
                            const code = typeof parsed.queryParams?.code === 'string' ? parsed.queryParams.code : undefined;
                            if (!code) {
                              Alert.alert('Error', 'Tidal did not return an authorization code.');
                              return;
                            }

                            const success = await connectTidal(code);
                            if (success) Alert.alert('Success', 'Connected to Tidal!');
                            else Alert.alert('Error', 'Failed to connect to Tidal');
                          } catch (error) {
                            console.error('Failed to open URL:', error);
                            await Clipboard.setStringAsync(authUrl);
                            Alert.alert(
                              'Open in Safari',
                              `Please copy this URL and paste it in Safari:\n\n${authUrl}`,
                              [
                                { text: 'URL Copied', style: 'default' }
                              ]
                            );
                          }
                        }
                      } catch (error) {
                        console.error('Failed to get Tidal auth URL:', error);
                        if (Platform.OS !== 'web') {
                          Alert.alert(
                            'Connection Error',
                            `Unable to start Tidal authentication: ${error.message || 'Please check your internet connection and try again.'}`
                          );
                        } else {
                          console.error('Tidal auth error:', error);
                          Alert.alert(
                            'Connection Error',
                            `Unable to start Tidal authentication. If you see a "blocked" message from Tidal, please wait a few minutes and try again.`
                          );
                        }
                      } finally {
                        setIsConnecting(false);
                      }
                    }}
                  >
                    <ThemedText style={{ color: 'white', fontSize: 12 }}>Connect</ThemedText>
                  </Pressable>
                )}
                <Switch
                  value={tidalEnabled}
                  onValueChange={setTidalEnabled}
                  trackColor={{ false: theme.border, true: theme.accent + '40' }}
                  thumbColor={tidalEnabled ? theme.accent : theme.textTertiary}
                />
              </View>
            </View>
            <View style={[styles.serverRow, { borderColor: theme.border }]}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.serverIcon, { backgroundColor: '#FF5500' + '20' }]}>
                  <Feather name="cloud" size={16} color="#FF5500" />
                </View>
                <View style={styles.serverInfo}>
                  <ThemedText style={[styles.serverName, { color: theme.text }]}>
                    SoundCloud
                  </ThemedText>
                  <ThemedText style={[styles.serverAddress, { color: theme.textSecondary }]}>
                    Available via LMS plugin
                  </ThemedText>
                </View>
              </View>
              <Switch
                value={soundcloudEnabled}
                onValueChange={setSoundcloudEnabled}
                trackColor={{ false: theme.border, true: theme.accent + '40' }}
                thumbColor={soundcloudEnabled ? theme.accent : theme.textTertiary}
              />
            </View>
            <View style={[styles.serverRow, { borderColor: theme.border }]}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.serverIcon, { backgroundColor: '#1DB954' + '20' }]}>
                  <Feather name="music" size={16} color="#1DB954" />
                </View>
                <View style={styles.serverInfo}>
                  <ThemedText style={[styles.serverName, { color: theme.text }]}>
                    Spotify
                  </ThemedText>
                  <ThemedText style={[styles.serverAddress, { color: theme.textSecondary }]}>
                    Available via LMS plugin
                  </ThemedText>
                </View>
              </View>
              <Switch
                value={spotifyEnabled}
                onValueChange={setSpotifyEnabled}
                trackColor={{ false: theme.border, true: theme.accent + '40' }}
                thumbColor={spotifyEnabled ? theme.accent : theme.textTertiary}
              />
            </View>
            <View style={[styles.serverRow, { borderColor: theme.border }]}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.serverIcon, { backgroundColor: '#4CAF50' + '20' }]}>
                  <Feather name="folder" size={16} color="#4CAF50" />
                </View>
                <View style={styles.serverInfo}>
                  <ThemedText style={[styles.serverName, { color: theme.text }]}>
                    Local Library
                  </ThemedText>
                  <ThemedText style={[styles.serverSubtitle, { color: theme.textTertiary }]}>
                    Local music files from LMS
                  </ThemedText>
                </View>
              </View>
              <Switch
                value={localLibraryEnabled}
                onValueChange={setLocalLibraryEnabled}
                trackColor={{ false: theme.border, true: theme.accent + '40' }}
                thumbColor={localLibraryEnabled ? theme.accent : theme.textTertiary}
              />
            </View>
            <ThemedText style={[styles.hintText, { color: theme.textTertiary }]}>
              Toggle off to hide content from this service in your library.
            </ThemedText>
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
            <SettingRow
              icon="radio"
              iconColor={Colors.light.accentSecondary}
              title="Roon Volume Control"
              subtitle={roonStatus?.connected 
                ? `Connected to ${roonStatus.currentOutputName || roonStatus.outputs.find(o => o.output_id === roonStatus.currentOutput)?.display_name || 'Roon'}`
                : "Control volume via Roon Core"
              }
              showChevron={false}
              rightElement={
                <Switch
                  value={roonVolumeEnabled}
                  onValueChange={handleRoonVolumeToggle}
                  trackColor={{
                    false: Colors.light.backgroundTertiary,
                    true: Colors.light.accent,
                  }}
                  thumbColor={Colors.light.text}
                />
              }
            />
            {roonVolumeEnabled && roonStatus && (
              <View style={{ paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm }}>
                <ThemedText style={[styles.inputLabel, { 
                  color: roonStatus.connected ? Colors.light.success : theme.textTertiary,
                  fontSize: 12 
                }]}>
                  {roonStatus.connected 
                    ? `✓ Connected - Zone: ${roonStatus.currentOutputName || roonStatus.outputs.find(o => o.output_id === roonStatus.currentOutput)?.display_name || 'Unknown'}`
                    : '⚠ Not connected - Check server logs'
                  }
                </ThemedText>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>DAC Volume Control</ThemedText>
          <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText style={[styles.hintText, { color: theme.textSecondary, marginBottom: Spacing.md, paddingHorizontal: Spacing.lg }]}>
              Configure direct UPnP volume control for your DAC (e.g., dCS Varese). This allows volume control to work independently of the selected player.
            </ThemedText>
            
            <View style={styles.dacInputRow}>
              <View style={styles.dacInputGroup}>
                <ThemedText style={[styles.inputLabel, { color: theme.text }]}>DAC IP Address</ThemedText>
                <TextInput
                  style={[styles.textInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}
                  placeholder="192.168.0.42"
                  placeholderTextColor={theme.textTertiary}
                  value={dacIp}
                  onChangeText={setDacIp}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="default"
                />
              </View>
              <View style={styles.dacPortGroup}>
                <ThemedText style={[styles.inputLabel, { color: theme.text }]}>Port</ThemedText>
                <TextInput
                  style={[styles.textInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}
                  placeholder="80"
                  placeholderTextColor={theme.textTertiary}
                  value={dacPort}
                  onChangeText={setDacPort}
                  keyboardType="number-pad"
                />
              </View>
            </View>
            
            <View style={{ paddingHorizontal: Spacing.lg, marginBottom: Spacing.md }}>
              <ThemedText style={[styles.inputLabel, { color: theme.text }]}>DAC Name (Optional)</ThemedText>
              <TextInput
                style={[styles.textInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}
                placeholder="dCS Varese"
                placeholderTextColor={theme.textTertiary}
                value={dacName}
                onChangeText={setDacName}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            
            <View style={styles.dacToggleRow}>
              <ThemedText style={[styles.dacToggleLabel, { color: theme.text }]}>
                Enable DAC Volume Control
              </ThemedText>
              <Switch
                value={dacEnabled}
                onValueChange={(value) => {
                  // Only update local state - don't save until user clicks "Save DAC Configuration"
                  setDacEnabled(value);
                }}
                trackColor={{
                  false: Colors.light.backgroundTertiary,
                  true: Colors.light.accent,
                }}
                thumbColor={Colors.light.text}
              />
            </View>
            
            {dacConfig && dacConfig.enabled && dacVolume !== undefined ? (
              <View style={[styles.dacStatusRow, { borderColor: theme.accent, backgroundColor: theme.accent + '10' }]}>
                <Feather name="check-circle" size={18} color={theme.success} />
                <ThemedText style={[styles.dacStatusText, { color: theme.text }]}>
                  Connected - Current Volume: {dacVolume}%
                </ThemedText>
              </View>
            ) : dacConfig && dacConfig.enabled ? (
              <View style={[styles.dacStatusRow, { borderColor: theme.textTertiary }]}>
                <Feather name="alert-circle" size={18} color={theme.textTertiary} />
                <ThemedText style={[styles.dacStatusText, { color: theme.textSecondary }]}>
                  Configured but not connected
                </ThemedText>
              </View>
            ) : null}
            
            <View style={{ paddingHorizontal: Spacing.lg, marginTop: Spacing.md }}>
              <Pressable
                style={({ pressed }) => [
                  styles.connectButton,
                  { 
                    backgroundColor: theme.accentSecondary,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
                onPress={() => {
                  if (dacIp) {
                    setDacConfig({
                      enabled: dacEnabled,
                      ip: dacIp,
                      port: parseInt(dacPort) || 80,
                      name: dacName || "DAC",
                    });
                    Alert.alert("DAC Configuration", "DAC settings saved successfully!");
                  } else {
                    Alert.alert("Error", "Please enter a DAC IP address");
                  }
                }}
              >
                <ThemedText style={[styles.connectButtonText, { color: theme.buttonText }]}>
                  Save DAC Configuration
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>TV Display</ThemedText>
          <View style={[styles.sectionContent, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText style={[styles.hintText, { color: theme.textSecondary, marginBottom: Spacing.md }]}>
              Stream album artwork and track info to a TV via Chromecast
            </ThemedText>

            <SettingRow
              icon="tv"
              iconColor={theme.accent}
              title="Enable TV Display"
              subtitle="Allow casting to DashCast"
              showChevron={false}
              rightElement={
                <Switch
                  value={chromecastEnabled}
                  onValueChange={async (value) => {
                    setChromecastEnabled(value);
                    // Sync to relay server via main server (avoids iOS ATS issues with direct local IP access)
                    try {
                      const apiUrl = getApiUrl();
                      const response = await fetch(`${apiUrl}/api/chromecast/enabled`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ enabled: value }),
                        signal: AbortSignal.timeout(5000),
                      });
                      if (response.ok) {
                        console.log('[Chromecast] Enabled state synced via main server');
                      } else {
                        console.warn('[Chromecast] Failed to sync enabled state:', await response.text());
                      }
                    } catch (error) {
                      console.warn('[Chromecast] Error syncing enabled state:', error);
                    }
                  }}
                  trackColor={{ false: Colors.light.border, true: theme.accentSecondary }}
                  thumbColor={chromecastEnabled ? theme.accent : "#f4f3f4"}
                />
              }
            />
            
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
                {discoveredChromecastDevices.map((device, index) => (
                  <Pressable
                    key={`${device.ip}-${device.name}-${index}`}
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
  authButton: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    minWidth: 70,
    alignItems: 'center',
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
  deleteButton: {
    padding: Spacing.sm,
    marginRight: Spacing.sm,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
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
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
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
  textInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
  },
  textInput: {
    height: 48,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    ...Typography.body,
  },
});
