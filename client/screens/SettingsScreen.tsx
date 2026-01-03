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
import { getApiUrl } from "@/lib/query-client";
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
  const { servers, tidalConnected, refreshLibrary, clearAllData, isLoading, addServer, activeServer, removeServer, playlists, getTidalAuthUrl, connectTidal, disconnectTidal, checkTidalStatus, tidalEnabled, soundcloudEnabled } = useMusic();
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

  type SourceKey = "local" | "tidal" | "soundcloud";
  type LibraryCounts = { albums: number | null; artists: number | null; tracks: number | null; playlists: number | null };
  type LibraryCountsBySource = Record<SourceKey, LibraryCounts>;

  const [libraryCountsBySource, setLibraryCountsBySource] = useState<LibraryCountsBySource | null>(null);
  const [libraryRadioCount, setLibraryRadioCount] = useState<number | null>(null);
  const [tidalTotalsNote, setTidalTotalsNote] = useState<string | null>(null);
  const [tidalTotalsCache, setTidalTotalsCache] = useState<LibraryCounts | null>(null);
  const TIDAL_TOTALS_CACHE_KEY = "@soundstream_tidal_totals_cache_v1";
  
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
    }
    // IMPORTANT:
    // Disabling the "Tidal API" toggle should NOT revoke/clear tokens. Only the explicit
    // "Disconnect" button should call disconnectTidal() (which deletes server tokens).
  }, [tidalEnabled, checkTidalStatus]);

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

  // Load last-known Tidal totals so Settings can show meaningful numbers immediately after server restarts.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const raw = await AsyncStorage.getItem(TIDAL_TOTALS_CACHE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const pick = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);
        const next: LibraryCounts = {
          albums: pick(parsed?.albums),
          artists: pick(parsed?.artists),
          tracks: pick(parsed?.tracks),
          playlists: pick(parsed?.playlists),
        };
        if (cancelled) return;
        // Only set if we have at least one value.
        if ([next.albums, next.artists, next.tracks, next.playlists].some((v) => v !== null)) {
          setTidalTotalsCache(next);
        }
      } catch {
        // ignore cache parse errors
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchTidalTotals = async (): Promise<{
    counts: LibraryCounts;
    note: string | null;
    computing: boolean;
    partial: boolean;
    rateLimited: boolean;
  } | null> => {
    if (!tidalEnabled) return null;
    const apiUrl = getApiUrl();
    const cleanApiUrl = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
    const toNumOrNull = (v: any) => {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      return Number.isFinite(n) ? n : null;
    };

    try {
      const resp = await fetch(`${cleanApiUrl}/api/tidal/totals`, {
        signal: (AbortSignal as any).timeout ? (AbortSignal as any).timeout(30000) : undefined,
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      const computing = !!data?.computing;
      const partial = !!data?.partial;
      const rateLimited = !!data?.rateLimited;

      let note: string | null = null;
      if (computing) {
        note = "Calculating Tidal totals in the background… this can take a bit the first time (and after server restarts).";
      } else if (data?.missingScope) {
        note = `Tidal totals are unavailable with the current TIDAL app credentials (scope ${String(
          data.missingScope
        )} triggers OAuth error 1002). Library browsing still works.`;
      } else if (partial) {
        note = "Tidal totals are partial (rate-limited). They’ll improve over time as the background counter retries.";
      } else if (rateLimited) {
        note = "Tidal totals are temporarily rate-limited. Try again in a minute.";
      }

      const counts: LibraryCounts = {
        albums: toNumOrNull(data.albums),
        artists: toNumOrNull(data.artists),
        tracks: toNumOrNull(data.tracks),
        playlists: toNumOrNull(data.playlists),
      };

      // Persist best-known values so Settings can show them immediately even if the server restarts and recomputes.
      if ([counts.albums, counts.artists, counts.tracks, counts.playlists].some((v) => v !== null)) {
        setTidalTotalsCache((prev) => ({
          albums: counts.albums ?? prev?.albums ?? null,
          artists: counts.artists ?? prev?.artists ?? null,
          tracks: counts.tracks ?? prev?.tracks ?? null,
          playlists: counts.playlists ?? prev?.playlists ?? null,
        }));
        AsyncStorage.setItem(
          TIDAL_TOTALS_CACHE_KEY,
          JSON.stringify({
            albums: counts.albums ?? tidalTotalsCache?.albums ?? null,
            artists: counts.artists ?? tidalTotalsCache?.artists ?? null,
            tracks: counts.tracks ?? tidalTotalsCache?.tracks ?? null,
            playlists: counts.playlists ?? tidalTotalsCache?.playlists ?? null,
            cachedAt: Date.now(),
          })
        ).catch(() => {});
      }

      return { counts, note, computing, partial, rateLimited };
    } catch (e) {
      console.warn("Failed to fetch Tidal totals:", e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  // Poll Tidal totals while they're still computing so the Settings table updates from "—" to real numbers.
  useEffect(() => {
    if (!activeServer) return;
    if (!tidalEnabled) return;

    let cancelled = false;
    const tick = async () => {
      const r = await fetchTidalTotals();
      if (cancelled || !r) return;

      setTidalTotalsNote(r.note);

      // Use cached values as a fallback while computing/partial so we don't show all dashes after restarts.
      const allowCache = r.computing || r.partial || r.rateLimited;
      const merged: LibraryCounts = {
        albums: r.counts.albums ?? (allowCache ? tidalTotalsCache?.albums ?? null : null),
        artists: r.counts.artists ?? (allowCache ? tidalTotalsCache?.artists ?? null : null),
        tracks: r.counts.tracks ?? (allowCache ? tidalTotalsCache?.tracks ?? null : null),
        playlists: r.counts.playlists ?? (allowCache ? tidalTotalsCache?.playlists ?? null : null),
      };

      setLibraryCountsBySource((prev) => {
        if (!prev) return prev;
        return { ...prev, tidal: merged };
      });
    };

    tick();
    const id = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServer, tidalEnabled]);

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
      // For per-source totals we need an explicit active LMS server (host/port) for /api/lms/proxy.
      if (!activeServer) {
        console.log("No active server, returning");
        return;
      }

      // Ensure LMS client is set if we have activeServer from context
      lmsClient.setServer(activeServer.host, activeServer.port);

      // --- Local (LMS) counts ---
      let localAlbums: number | null = 0;
      let localArtists: number | null = 0;
      let localTracks: number | null = 0;
      try {
        // IMPORTANT:
        // `serverstatus` totals often still include LMS plugin libraries (e.g. LMS Tidal) even with `library_id:0`.
        // These list queries respect `library_id:0` and provide correct local-only totals in `count`.
        const apiUrl = getApiUrl();
        const cleanApiUrl = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;

        const proxy = async (command: string[]) => {
          const resp = await fetch(`${cleanApiUrl}/api/lms/proxy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              host: activeServer?.host,
              port: activeServer?.port,
              playerId: "",
              command,
              id: 1,
            }),
            signal: (AbortSignal as any).timeout ? (AbortSignal as any).timeout(8000) : undefined,
          });
          if (!resp.ok) return null;
          const json = await resp.json().catch(() => null);
          return json?.result ?? null;
        };

        const [albumsRes, artistsRes, tracksRes] = await Promise.all([
          proxy(["albums", "0", "0", "library_id:0"]),
          proxy(["artists", "0", "0", "library_id:0"]),
          proxy(["titles", "0", "0", "library_id:0"]),
        ]);

        const n = (v: any) => {
          const x = Number(v ?? 0);
          return Number.isFinite(x) ? x : 0;
        };

        localAlbums = n(albumsRes?.count ?? albumsRes?.total);
        localArtists = n(artistsRes?.count ?? artistsRes?.total);
        localTracks = n(tracksRes?.count ?? tracksRes?.total);
      } catch (e) {
        console.warn("Failed to get LMS local totals:", e instanceof Error ? e.message : String(e));
      }

      // LMS playlists count (local playlists only; plugin playlists filtered out elsewhere)
      let localPlaylists = 0;
      try {
        // Use client-side filtering (excludes plugin playlists like LMS Tidal/SoundCloud/etc.)
        lmsClient.setServer(activeServer.host, activeServer.port);
        const playlists = await lmsClient.getPlaylists(false, false, false);
        localPlaylists = playlists.length;
      } catch (e) {
        console.warn("Failed to count LMS playlists:", e instanceof Error ? e.message : String(e));
      }

      // LMS radio count
      let radioCount = 0;
      try {
        const radios = await lmsClient.getFavoriteRadios();
        radioCount = radios.length;
      } catch (e) {
        console.warn("Failed to count radio stations:", e instanceof Error ? e.message : String(e));
      }

      // --- Tidal counts (Direct API ONLY) ---
      let tidalCounts: LibraryCounts = { albums: null, artists: null, tracks: null, playlists: null };
      if (tidalEnabled) {
        const r = await fetchTidalTotals();
        if (r) {
          setTidalTotalsNote(r.note);
          const allowCache = r.computing || r.partial || r.rateLimited;
          tidalCounts = {
            albums: r.counts.albums ?? (allowCache ? tidalTotalsCache?.albums ?? null : null),
            artists: r.counts.artists ?? (allowCache ? tidalTotalsCache?.artists ?? null : null),
            tracks: r.counts.tracks ?? (allowCache ? tidalTotalsCache?.tracks ?? null : null),
            playlists: r.counts.playlists ?? (allowCache ? tidalTotalsCache?.playlists ?? null : null),
          };
        }
      }

      // --- SoundCloud counts (via LMS plugin) ---
      // SoundCloud integration is playlist-centric in our UI; we show playlist count and leave other columns as N/A.
      let soundcloudCounts: LibraryCounts = { albums: null, artists: null, tracks: null, playlists: null };
      if (soundcloudEnabled) {
        try {
          const playlists = await lmsClient.getPlaylists(true, false, false);
          const scCount = playlists.filter((p) => (p.name || "").toLowerCase().startsWith("soundcloud:")).length;
          soundcloudCounts = { albums: null, artists: null, tracks: null, playlists: scCount };
        } catch (e) {
          console.warn("Failed to count SoundCloud playlists:", e instanceof Error ? e.message : String(e));
        }
      }

      const countsBySource: LibraryCountsBySource = {
        local: localLibraryEnabled
          ? { albums: localAlbums, artists: localArtists, tracks: localTracks, playlists: localPlaylists }
          : { albums: null, artists: null, tracks: null, playlists: null },
        tidal: tidalEnabled ? tidalCounts : { albums: null, artists: null, tracks: null, playlists: null },
        soundcloud: soundcloudEnabled ? soundcloudCounts : { albums: null, artists: null, tracks: null, playlists: null },
      };

      setLibraryCountsBySource(countsBySource);
      setLibraryRadioCount(localLibraryEnabled ? radioCount : null);
    } catch (e) {
      console.error("Failed to load library stats:", e);
      setLibraryCountsBySource(null);
      setLibraryRadioCount(null);
      setTidalTotalsNote(null);
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
            {activeServer && (
              <>
                <View style={styles.libraryStatsTable}>
                  <View style={[styles.statsRow, { borderColor: theme.border }]}>
                    <ThemedText style={[styles.statsHeaderCell, { color: theme.textTertiary }]}>Source</ThemedText>
                    <ThemedText style={[styles.statsHeaderCell, { color: theme.textTertiary }]}>Albums</ThemedText>
                    <ThemedText style={[styles.statsHeaderCell, { color: theme.textTertiary }]}>Artists</ThemedText>
                    <ThemedText style={[styles.statsHeaderCell, { color: theme.textTertiary }]}>Tracks</ThemedText>
                    <ThemedText style={[styles.statsHeaderCell, { color: theme.textTertiary }]}>Playlists</ThemedText>
                  </View>

                  {(() => {
                    const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Number(v).toLocaleString());
                    const sum = (vals: Array<number | null | undefined>): number | null => {
                      const present = vals.filter((v) => typeof v === "number" && Number.isFinite(v)) as number[];
                      if (present.length === 0) return null;
                      // If any enabled source is unknown for this column, show "—" rather than a misleading partial sum.
                      if (present.length !== vals.filter((v) => v !== undefined).length) return null;
                      return present.reduce((a, b) => a + b, 0);
                    };
                    const rows: Array<{ key: "local" | "tidal" | "soundcloud"; label: string; show: boolean }> = [
                      { key: "local", label: "Local (LMS)", show: !!localLibraryEnabled },
                    { key: "tidal", label: "Tidal (API)", show: !!tidalEnabled },
                      { key: "soundcloud", label: "SoundCloud", show: !!soundcloudEnabled },
                    ];

                    const visible = rows.filter((r) => r.show);
                    const local = libraryCountsBySource?.local;
                    const tidal = libraryCountsBySource?.tidal;
                    const sc = libraryCountsBySource?.soundcloud;
                    const totalAlbums = sum([
                      localLibraryEnabled ? local?.albums : undefined,
                      tidalEnabled ? tidal?.albums : undefined,
                      soundcloudEnabled ? sc?.albums : undefined,
                    ]);
                    const totalTracks = sum([
                      localLibraryEnabled ? local?.tracks : undefined,
                      tidalEnabled ? tidal?.tracks : undefined,
                      soundcloudEnabled ? sc?.tracks : undefined,
                    ]);
                    const totalPlaylists = sum([
                      localLibraryEnabled ? local?.playlists : undefined,
                      tidalEnabled ? tidal?.playlists : undefined,
                      soundcloudEnabled ? sc?.playlists : undefined,
                    ]);
                    // Artists overlap heavily across sources; avoid inflated sums by using max when both are known.
                    const artistVals = [
                      localLibraryEnabled ? local?.artists : undefined,
                      tidalEnabled ? tidal?.artists : undefined,
                      soundcloudEnabled ? sc?.artists : undefined,
                    ].filter((v) => typeof v === "number" && Number.isFinite(v)) as number[];
                    const totalArtists = artistVals.length > 0 ? Math.max(...artistVals) : null;

                    return (
                      <>
                        <View style={[styles.statsRow, { borderColor: theme.border }]}>
                          <ThemedText style={[styles.statsCell, { color: theme.text }]}>{`Total`}</ThemedText>
                          <ThemedText style={[styles.statsCell, { color: theme.accent }]}>{fmt(totalAlbums)}</ThemedText>
                          <ThemedText style={[styles.statsCell, { color: theme.accent }]}>{fmt(totalArtists)}</ThemedText>
                          <ThemedText style={[styles.statsCell, { color: theme.accent }]}>{fmt(totalTracks)}</ThemedText>
                          <ThemedText style={[styles.statsCell, { color: theme.accent }]}>{fmt(totalPlaylists)}</ThemedText>
                        </View>
                        {visible.map((r) => {
                          const data = libraryCountsBySource?.[r.key];
                          return (
                            <View key={r.key} style={[styles.statsRow, { borderColor: theme.border }]}>
                              <ThemedText style={[styles.statsCell, { color: theme.text }]}>{r.label}</ThemedText>
                              <ThemedText style={[styles.statsCell, { color: theme.accent }]}>{fmt(data?.albums)}</ThemedText>
                              <ThemedText style={[styles.statsCell, { color: theme.accent }]}>{fmt(data?.artists)}</ThemedText>
                              <ThemedText style={[styles.statsCell, { color: theme.accent }]}>{fmt(data?.tracks)}</ThemedText>
                              <ThemedText style={[styles.statsCell, { color: theme.accent }]}>{fmt(data?.playlists)}</ThemedText>
                            </View>
                          );
                        })}
                      </>
                    );
                  })()}
                </View>
                {tidalTotalsNote ? (
                  <ThemedText style={[styles.hintText, { color: theme.textTertiary, marginTop: Spacing.sm }]}>
                    {tidalTotalsNote}
                  </ThemedText>
                ) : null}

                <View style={[styles.radioRow, { borderColor: theme.border }]}>
                  <ThemedText style={[styles.radioLabel, { color: theme.textTertiary }]}>Radio (LMS)</ThemedText>
                  <ThemedText style={[styles.radioValue, { color: theme.accent }]}>
                    {libraryRadioCount === null ? "—" : libraryRadioCount.toLocaleString()}
                  </ThemedText>
                </View>
              </>
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
                    Tidal API (Browse)
                  </ThemedText>
                  <ThemedText style={[styles.serverAddress, { color: theme.textSecondary }]}>
                    {tidalConnected
                      ? "API connected (browse updates in-app)"
                      : "API not connected (browse won’t refresh). LMS Tidal plugin can still show counts/playback."}
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
                    <ThemedText style={{ color: 'white', fontSize: 12 }}>Disconnect API</ThemedText>
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

                        if (Platform.OS === 'web') {
                          // IMPORTANT:
                          // Many browsers block window.open() if it's called after an await.
                          // So we open a blank popup synchronously, then navigate it once the auth URL is fetched.
                          const popup = window.open('about:blank', 'tidal-auth', 'width=520,height=720');
                          if (!popup) {
                            console.warn('[Tidal] Popup blocked');
                            const authUrl = await getTidalAuthUrl();
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

                          // Now fetch the auth URL and navigate the already-opened popup.
                          const authUrl = await getTidalAuthUrl();
                          console.log('Got auth URL:', authUrl);
                          popup.location.href = authUrl;
                        } else {
                          try {
                            const authUrl = await getTidalAuthUrl();
                            console.log('Got auth URL:', authUrl);

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
                    <ThemedText style={{ color: 'white', fontSize: 12 }}>Connect API</ThemedText>
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
  libraryStatsTable: {
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
    marginHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  statsHeaderCell: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  statsCell: {
    flex: 1,
    fontSize: 14,
    textAlign: "center",
  },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  radioLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  radioValue: {
    fontSize: 12,
    fontWeight: "700",
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
