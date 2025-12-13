import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { lmsClient, LmsPlayer, LmsPlayerStatus } from "@/lib/lmsClient";
import { upnpVolumeClient } from "@/lib/upnpVolumeClient";
import { debugLog } from "@/lib/debugLog";
import { useSettings } from "@/hooks/useSettings";
import { useMusic } from "@/hooks/useMusic";

export interface Zone {
  id: string;
  name: string;
  type: "lms" | "local";
  isActive: boolean;
  volume: number;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArt?: string;
  duration: number;
  source: "local" | "qobuz";
  uri?: string;
  metadata?: string;
  format?: string;
  bitrate?: string;
  sampleRate?: string;
  bitDepth?: string;
  lmsTrackId?: string;
  isRadio?: boolean;
  radioStationName?: string;
  radioStationImage?: string;
}

interface PlaybackState {
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  zones: Zone[];
  activeZoneId: string | null;
}

interface PlaybackContextType extends PlaybackState {
  play: (track?: Track) => void;
  pause: () => void;
  togglePlayPause: () => void;
  next: () => void;
  previous: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  playTrack: (track: Track, tracks?: Track[]) => void;
  playPlaylist: (playlistId: string) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  setActiveZone: (zoneId: string) => void;
  setZoneVolume: (zoneId: string, volume: number) => void;
  toggleZone: (zoneId: string) => void;
  activeZone: Zone | null;
  players: LmsPlayer[];
  activePlayer: LmsPlayer | null;
  setActivePlayer: (player: LmsPlayer) => void;
  refreshPlayers: () => Promise<void>;
  syncPlayerStatus: () => Promise<void>;
  disabledPlayers: Set<string>;
  togglePlayerDisabled: (playerId: string) => void;
  allPlayers: LmsPlayer[];
  dacConfig: DacConfig | null;
  setDacConfig: (config: DacConfig | null) => void;
  dacVolume: number;
}

const PlaybackContext = createContext<PlaybackContextType | undefined>(undefined);

const STORAGE_KEY = "@soundstream_playback";
const ZONES_KEY = "@soundstream_zones";
const LMS_PLAYER_KEY = "@soundstream_lms_active_player";
const DAC_CONFIG_KEY = "@soundstream_dac_config";
const DISABLED_PLAYERS_KEY = "@soundstream_disabled_players";

export interface DacConfig {
  enabled: boolean;
  ip: string;
  port: number;
  name: string;
}

const DEFAULT_ZONES: Zone[] = [
  { id: "local", name: "This Device", type: "local", isActive: false, volume: 0.8 },
];

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const { hardwareVolumeControl, chromecastIp } = useSettings();
  const { addToRecentlyPlayed, activeServer } = useMusic();
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [shuffle, setShuffle] = useState(false);
  const [disabledPlayers, setDisabledPlayers] = useState<Set<string>>(new Set());
  const [allPlayers, setAllPlayers] = useState<LmsPlayer[]>([]);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("off");
  const [zones, setZones] = useState<Zone[]>(DEFAULT_ZONES);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  
  const [players, setPlayers] = useState<LmsPlayer[]>([]);
  const [activePlayer, setActivePlayerState] = useState<LmsPlayer | null>(null);
  const [dacConfig, setDacConfigState] = useState<DacConfig | null>(null);
  const [dacVolume, setDacVolume] = useState(50);
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTimeRef = useRef<number>(0);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const volumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVolumeRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const lastSystemVolumeRef = useRef<number | null>(null);
  const volumeManagerRef = useRef<any>(null);
  const previousTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    loadState();
    loadZones();
    loadActivePlayer();
    loadDacConfig();
    loadDisabledPlayers();
  }, []);

  // Update zones when disabledPlayers changes
  useEffect(() => {
    if (allPlayers.length > 0) {
      const enabledPlayers = allPlayers.filter(p => !disabledPlayers.has(p.id));
      const lmsZones: Zone[] = enabledPlayers.map(p => ({
        id: p.id,
        name: p.name,
        type: 'lms' as const,
        // Use activeZoneId if set, otherwise fall back to activePlayer?.id
        isActive: p.id === (activeZoneId || activePlayer?.id),
        volume: p.volume / 100,
      }));
      
      // Also update DEFAULT_ZONES to reflect activeZoneId
      const updatedDefaultZones = DEFAULT_ZONES.map(z => ({
        ...z,
        isActive: z.id === (activeZoneId || activePlayer?.id),
      }));
      
      setZones([...updatedDefaultZones, ...lmsZones]);
    }
  }, [disabledPlayers, allPlayers, activePlayer, activeZoneId]);

  // This useEffect will be moved after syncPlayerStatus is defined

  const loadActivePlayer = async () => {
    try {
      const stored = await AsyncStorage.getItem(LMS_PLAYER_KEY);
      if (stored) {
        const playerData: LmsPlayer = JSON.parse(stored);
        debugLog.info('Loaded active player from storage', `${playerData.name} (${playerData.id})`);
        setActivePlayerState(playerData);
        setActiveZoneId(playerData.id);
      } else {
        debugLog.info('No stored active player', 'Will auto-select when players are refreshed');
      }
    } catch (e) {
      console.error("Failed to load active player:", e);
    }
  };

  const loadDisabledPlayers = async () => {
    try {
      const stored = await AsyncStorage.getItem(DISABLED_PLAYERS_KEY);
      if (stored) {
        const disabledIds = JSON.parse(stored) as string[];
        setDisabledPlayers(new Set(disabledIds));
      }
    } catch (e) {
      console.error("Failed to load disabled players:", e);
    }
  };

  const saveDisabledPlayers = async (disabled: Set<string>) => {
    try {
      await AsyncStorage.setItem(DISABLED_PLAYERS_KEY, JSON.stringify(Array.from(disabled)));
    } catch (e) {
      console.error("Failed to save disabled players:", e);
    }
  };

  const refreshPlayers = useCallback(async () => {
    try {
      const fetchedPlayers = await lmsClient.getPlayers();
      // Store all players (for SettingsScreen to show disabled state)
      setAllPlayers(fetchedPlayers);
      // Filter out disabled players for use in the app
      const enabledPlayers = fetchedPlayers.filter(p => !disabledPlayers.has(p.id));
      setPlayers(enabledPlayers);
      
      const lmsZones: Zone[] = enabledPlayers.map(p => ({
        id: p.id,
        name: p.name,
        type: 'lms' as const,
        isActive: p.id === activePlayer?.id,
        volume: p.volume / 100,
      }));
      
      setZones([...DEFAULT_ZONES, ...lmsZones]);
      
      // Only auto-select first player if no player was ever stored
      // Check storage to see if user had a previous selection
      if (!activePlayer && enabledPlayers.length > 0) {
        const storedPlayer = await AsyncStorage.getItem(LMS_PLAYER_KEY);
        if (!storedPlayer) {
          // Only auto-select if user never chose a player before
          setActivePlayer(enabledPlayers[0]);
        } else {
          // Restore stored player if it's in the current list and not disabled
          const stored = JSON.parse(storedPlayer);
          const matchingPlayer = enabledPlayers.find(p => p.id === stored.id);
          if (matchingPlayer) {
            setActivePlayerState(matchingPlayer);
            setActiveZoneId(matchingPlayer.id);
          }
          // If stored player not found or disabled, keep stored preference and don't auto-select
        }
      }
    } catch (error) {
      debugLog.error('Failed to refresh players', error instanceof Error ? error.message : String(error));
      // Don't clear activePlayer on error - keep the stored preference
    }
  }, [activePlayer, disabledPlayers]);

  const togglePlayerDisabled = useCallback(async (playerId: string) => {
    const newSet = new Set(disabledPlayers);
    if (newSet.has(playerId)) {
      newSet.delete(playerId);
    } else {
      newSet.add(playerId);
      // If this player was active, clear it
      if (activePlayer?.id === playerId) {
        setActivePlayerState(null);
        setActiveZoneId(null);
        AsyncStorage.removeItem(LMS_PLAYER_KEY);
      }
    }
    setDisabledPlayers(newSet);
    await saveDisabledPlayers(newSet);
    // Refresh players to update the filtered list
    await refreshPlayers();
  }, [activePlayer, disabledPlayers, refreshPlayers]);

  const loadDacConfig = async () => {
    try {
      const stored = await AsyncStorage.getItem(DAC_CONFIG_KEY);
      if (stored) {
        const config: DacConfig = JSON.parse(stored);
        setDacConfigState(config);
        if (config.enabled && config.ip) {
          upnpVolumeClient.setDevice(config.ip, config.port, config.name);
          try {
            const vol = await upnpVolumeClient.getVolume();
            setDacVolume(vol);
          } catch (e) {
            debugLog.error('Failed to get DAC volume', e instanceof Error ? e.message : String(e));
          }
        }
      }
    } catch (e) {
      console.error("Failed to load DAC config:", e);
    }
  };

  const setDacConfig = useCallback(async (config: DacConfig | null) => {
    setDacConfigState(config);
    if (config) {
      await AsyncStorage.setItem(DAC_CONFIG_KEY, JSON.stringify(config));
      if (config.enabled && config.ip) {
        upnpVolumeClient.setDevice(config.ip, config.port, config.name);
        try {
          const vol = await upnpVolumeClient.getVolume();
          setDacVolume(vol);
        } catch (e) {
          debugLog.error('Failed to get DAC volume', e instanceof Error ? e.message : String(e));
        }
      } else {
        upnpVolumeClient.clearDevice();
      }
    } else {
      await AsyncStorage.removeItem(DAC_CONFIG_KEY);
      upnpVolumeClient.clearDevice();
    }
  }, []);

  const setActivePlayer = useCallback((player: LmsPlayer) => {
    // Don't allow setting a disabled player as active
    if (disabledPlayers.has(player.id)) {
      debugLog.error('Player disabled', 'Cannot set a disabled player as active');
      return;
    }
    setActivePlayerState(player);
    setActiveZoneId(player.id);
    AsyncStorage.setItem(LMS_PLAYER_KEY, JSON.stringify(player));
  }, [disabledPlayers]);

  const syncPlayerStatus = useCallback(async () => {
    if (!activePlayer) {
      debugLog.info('Sync skipped', 'No active player');
      return;
    }

    try {
      debugLog.info('Syncing player status', `Player: ${activePlayer.name} (${activePlayer.id})`);
      const status = await lmsClient.getPlayerStatus(activePlayer.id);
      
      setIsPlaying(status.mode === 'play');
      const newVolume = status.volume / 100;
      setVolumeState(newVolume);
      // Update the active zone's volume to keep them in sync
      if (activeZoneId) {
        setZones((prev) =>
          prev.map((z) =>
            z.id === activeZoneId ? { ...z, volume: newVolume } : z
          )
        );
      }
      setCurrentTime(status.time);
      
      const shuffleMode = status.shuffle > 0;
      const repeatMode = status.repeat === 0 ? 'off' : status.repeat === 1 ? 'one' : 'all';
      setShuffle(shuffleMode);
      setRepeat(repeatMode);
      
      if (status.currentTrack) {
        // Check if this is a radio station by matching URL with favorite radios
        let isRadio = false;
        let radioStationName: string | undefined;
        let radioStationImage: string | undefined;
        
        if (status.currentTrack?.url) {
          try {
            const radios = await lmsClient.getFavoriteRadios();
            const matchingStation = radios.find(r => r.url === status.currentTrack?.url);
            if (matchingStation) {
              isRadio = true;
              radioStationName = matchingStation.name;
              if (matchingStation.image) {
                // Construct full URL for radio station image
                const baseUrl = lmsClient.getBaseUrl();
                radioStationImage = matchingStation.image.startsWith('http') 
                  ? matchingStation.image 
                  : `${baseUrl}${matchingStation.image.startsWith('/') ? '' : '/'}${matchingStation.image}`;
              }
            }
          } catch (error) {
            // If we can't fetch radios, continue without radio info
            debugLog.error('Failed to check radio station', error instanceof Error ? error.message : String(error));
          }
        }
        
        const track: Track = {
          id: status.currentTrack.id,
          title: isRadio ? radioStationName || status.currentTrack.title : status.currentTrack.title,
          artist: isRadio ? 'Radio Station' : status.currentTrack.artist,
          album: isRadio ? '' : status.currentTrack.album,
          albumArt: isRadio 
            ? (radioStationImage || (status.currentTrack.artwork_url ? lmsClient.getArtworkUrl(status.currentTrack) : undefined))
            : (status.currentTrack.artwork_url ? lmsClient.getArtworkUrl(status.currentTrack) : undefined),
          duration: status.currentTrack.duration,
          source: 'local',
          format: status.currentTrack.format,
          bitrate: status.currentTrack.bitrate,
          sampleRate: status.currentTrack.sampleRate,
          bitDepth: status.currentTrack.bitDepth,
          lmsTrackId: status.currentTrack.id,
          isRadio,
          radioStationName,
          radioStationImage,
        };
        
        // Only update if track actually changed to avoid unnecessary re-renders
        // This also helps prevent stale data from being displayed
        setCurrentTrack((prev) => {
          if (prev?.id === track.id && prev?.title === track.title) {
            // Track hasn't changed, but update other properties that might have changed
            return track;
          }
          debugLog.info('Track updated from server', `${track.title} by ${track.artist} (ID: ${track.id})`);
          return track;
        });
      } else {
        // No track playing, clear current track
        setCurrentTrack(null);
      }
      
      if (status.playlist.length > 0) {
        const queueTracks: Track[] = status.playlist.map(t => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          albumArt: t.artwork_url ? lmsClient.getArtworkUrl(t) : undefined,
          duration: t.duration,
          source: 'local' as const,
          format: t.format,
          bitrate: t.bitrate,
          sampleRate: t.sampleRate,
          bitDepth: t.bitDepth,
          lmsTrackId: t.id,
        }));
        setQueue(queueTracks);
      }
    } catch (error) {
      debugLog.error('Failed to sync player status', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer, activeZoneId]);

  // Poll player status when active player changes
  useEffect(() => {
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }

    if (activePlayer) {
      // Always sync immediately when player changes to get current track from server
      // Use a small delay to ensure LMS client is ready
      const immediateSync = setTimeout(() => {
        debugLog.info('Immediate sync on player change', `Player: ${activePlayer.name} (${activePlayer.id})`);
        syncPlayerStatus();
      }, 100);
      
      // Then poll every 2 seconds for more responsive updates
      statusPollRef.current = setInterval(() => {
        syncPlayerStatus();
      }, 2000);
      
      return () => {
        clearTimeout(immediateSync);
        if (statusPollRef.current) {
          clearInterval(statusPollRef.current);
        }
      };
    } else {
      // Clear current track when no active player
      setCurrentTrack(null);
    }

    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
      }
    };
  }, [activePlayer?.id, syncPlayerStatus]);

  // Force sync when window regains focus to ensure all browser instances show the same track
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    
    const handleFocus = () => {
      if (activePlayer) {
        debugLog.info('Window focused, forcing sync', `Player: ${activePlayer.name} (${activePlayer.id})`);
        syncPlayerStatus();
      }
    };
    
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
      return () => {
        window.removeEventListener('focus', handleFocus);
      };
    }
  }, [activePlayer, syncPlayerStatus]);

  useEffect(() => {
    saveState();
  }, [currentTrack, queue, volume, shuffle, repeat]);

  // Add tracks to history when they start playing
  useEffect(() => {
    if (currentTrack && currentTrack.id !== previousTrackIdRef.current) {
      // Only add to history if this is a new track (different ID)
      previousTrackIdRef.current = currentTrack.id;
      // Only add non-radio tracks to history (or include radio if desired)
      if (!currentTrack.isRadio) {
        addToRecentlyPlayed(currentTrack);
      }
    }
  }, [currentTrack, addToRecentlyPlayed]);

  // Automatically start casting to Chromecast when music starts playing
  const lastCastTrackRef = useRef<string | null>(null);
  useEffect(() => {
    // Debug logging for casting conditions
    if (!chromecastIp) {
      debugLog.info('Chromecast casting skipped', 'No Chromecast IP configured');
      return;
    }
    if (!isPlaying) {
      debugLog.info('Chromecast casting skipped', 'Not playing');
      // Reset cast tracking when playback stops
      lastCastTrackRef.current = null;
      return;
    }
    if (!currentTrack) {
      debugLog.info('Chromecast casting skipped', 'No current track');
      return;
    }
    if (!activePlayer) {
      debugLog.info('Chromecast casting skipped', 'No active player');
      return;
    }
    if (!activeServer) {
      debugLog.info('Chromecast casting skipped', 'No active server');
      return;
    }
    
    // Only cast if this is a new track (avoid recasting on every status update)
    if (currentTrack.id !== lastCastTrackRef.current) {
      lastCastTrackRef.current = currentTrack.id;
      
      // Start casting when playback begins
      const startCast = async () => {
        try {
          const domain = process.env.EXPO_PUBLIC_DOMAIN || 'localhost:3000';
          const protocol = Platform.OS === 'web' ? window.location.protocol : 'http:';
          const apiUrl = `${protocol}//${domain}`;
          
          debugLog.info('Starting Chromecast cast', `IP: ${chromecastIp}, Player: ${activePlayer.name}, Track: ${currentTrack.title}`);
          
          const response = await fetch(`${apiUrl}/api/chromecast/cast`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ip: chromecastIp,
              lmsHost: activeServer.host,
              lmsPort: activeServer.port || 9000,
              playerId: activePlayer.id,
            }),
            signal: AbortSignal.timeout(10000),
          });
          
          if (response.ok) {
            const data = await response.json();
            debugLog.info('Chromecast cast started', data.message || 'Success');
          } else {
            const errorText = await response.text();
            debugLog.error('Chromecast cast failed', `HTTP ${response.status}: ${errorText.substring(0, 200)}`);
          }
        } catch (error) {
          debugLog.error('Chromecast cast error', error instanceof Error ? error.message : String(error));
        }
      };
      
      // Debounce casting to avoid multiple calls
      const castTimeout = setTimeout(startCast, 1000);
      return () => clearTimeout(castTimeout);
    }
  }, [chromecastIp, isPlaying, currentTrack?.id, activePlayer, activeServer]);

  useEffect(() => {
    if (Math.abs(currentTime - lastSavedTimeRef.current) >= 10) {
      lastSavedTimeRef.current = currentTime;
      saveCurrentTime();
    }
  }, [currentTime]);

  useEffect(() => {
    saveZones();
  }, [zones, activeZoneId]);

  const loadState = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const state = JSON.parse(stored);
        setQueue(state.queue || []);
        setVolumeState(state.volume ?? 0.8);
        setShuffle(state.shuffle ?? false);
        setRepeat(state.repeat ?? "off");
        // Don't load currentTrack from storage - always sync from server to ensure accuracy
        // This prevents app and web from showing different tracks
        setCurrentTime(state.currentTime || 0);
        lastSavedTimeRef.current = state.currentTime || 0;
      }
    } catch (e) {
      console.error("Failed to load playback state:", e);
    }
  };

  const loadZones = async () => {
    try {
      const stored = await AsyncStorage.getItem(ZONES_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        setZones(data.zones || DEFAULT_ZONES);
        setActiveZoneId(data.activeZoneId || null);
      }
    } catch (e) {
      console.error("Failed to load zones:", e);
    }
  };

  const saveState = async () => {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ 
          queue, 
          volume, 
          shuffle, 
          repeat,
          // Don't save currentTrack - always sync from server to ensure accuracy across platforms
          currentTime: lastSavedTimeRef.current,
        })
      );
    } catch (e) {
      console.error("Failed to save playback state:", e);
    }
  };

  const saveCurrentTime = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const state = JSON.parse(stored);
        state.currentTime = currentTime;
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch (e) {
      console.error("Failed to save current time:", e);
    }
  };

  const saveZones = async () => {
    try {
      await AsyncStorage.setItem(
        ZONES_KEY,
        JSON.stringify({ zones, activeZoneId })
      );
    } catch (e) {
      console.error("Failed to save zones:", e);
    }
  };

  const play = useCallback(async (track?: Track) => {
    if (!activePlayer) {
      debugLog.error('No active player', 'Cannot play without a player');
      return;
    }
    
    // Don't set currentTrack locally - let syncPlayerStatus get it from server
    if (track) {
      setCurrentTime(0);
    }
    
    try {
      await lmsClient.play(activePlayer.id);
      setIsPlaying(true);
      // Sync immediately to get actual current track from server
      setTimeout(() => {
        syncPlayerStatus();
      }, 300);
    } catch (error) {
      debugLog.error('Play failed', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer, syncPlayerStatus]);

  const pause = useCallback(async () => {
    if (!activePlayer) return;
    
    try {
      await lmsClient.pause(activePlayer.id);
      setIsPlaying(false);
    } catch (error) {
      debugLog.error('Pause failed', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer]);

  const togglePlayPause = useCallback(async () => {
    if (!activePlayer) return;
    
    try {
      await lmsClient.togglePlayPause(activePlayer.id);
      setIsPlaying(prev => !prev);
    } catch (error) {
      debugLog.error('Toggle play/pause failed', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer]);

  const next = useCallback(async () => {
    if (!activePlayer) return;
    
    try {
      await lmsClient.next(activePlayer.id);
      await syncPlayerStatus();
    } catch (error) {
      debugLog.error('Next failed', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer, syncPlayerStatus]);

  const previous = useCallback(async () => {
    if (!activePlayer) return;
    
    try {
      await lmsClient.previous(activePlayer.id);
      await syncPlayerStatus();
    } catch (error) {
      debugLog.error('Previous failed', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer, syncPlayerStatus]);

  const seek = useCallback(async (time: number) => {
    if (!activePlayer) return;
    
    setCurrentTime(time);
    
    try {
      await lmsClient.seek(activePlayer.id, time);
    } catch (error) {
      debugLog.error('Seek failed', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer]);

  const setVolume = useCallback((vol: number) => {
    const clampedVol = Math.max(0, Math.min(1, vol));
    const volumePercent = Math.round(clampedVol * 100);
    
    // Update the active zone's volume to keep them in sync
    if (activeZoneId) {
      setZones((prev) =>
        prev.map((z) =>
          z.id === activeZoneId ? { ...z, volume: clampedVol } : z
        )
      );
    }
    
    // If DAC volume control is enabled, control the DAC instead of LMS player
    if (dacConfig?.enabled && upnpVolumeClient.isConfigured()) {
      setDacVolume(volumePercent);
      
      pendingVolumeRef.current = volumePercent;
      
      if (volumeTimeoutRef.current) {
        clearTimeout(volumeTimeoutRef.current);
      }
      
      volumeTimeoutRef.current = setTimeout(async () => {
        const finalVol = pendingVolumeRef.current;
        if (finalVol === null) return;
        
        pendingVolumeRef.current = null;
        
        try {
          await upnpVolumeClient.setVolume(finalVol);
          debugLog.info('DAC volume set', `${finalVol}%`);
        } catch (error) {
          debugLog.error('Set DAC volume failed', error instanceof Error ? error.message : String(error));
        }
      }, 50);
      return;
    }
    
    // Fall back to LMS player volume control
    if (!activePlayer) return;
    
    setVolumeState(clampedVol);
    
    pendingVolumeRef.current = clampedVol;
    
    if (volumeTimeoutRef.current) {
      clearTimeout(volumeTimeoutRef.current);
    }
    
    volumeTimeoutRef.current = setTimeout(async () => {
      const finalVol = pendingVolumeRef.current;
      if (finalVol === null || !activePlayer) return;
      
      const lmsVolumePercent = Math.round(finalVol * 100);
      pendingVolumeRef.current = null;
      
      try {
        await lmsClient.setVolume(activePlayer.id, lmsVolumePercent);
      } catch (error) {
        debugLog.error('Set volume failed', error instanceof Error ? error.message : String(error));
      }
    }, 50);
  }, [activePlayer, activeZoneId, dacConfig]);

  // Setup hardware volume button listener (must be after setVolume is defined)
  useEffect(() => {
    debugLog.info('Hardware volume control effect', `Setting: ${hardwareVolumeControl}, Platform: ${Platform.OS}`);
    
    // Hardware volume control only works on iOS native, not web or Expo Go
    // Skip if not on iOS, if web platform, or if setting is disabled
    if (!hardwareVolumeControl) {
      debugLog.info('Hardware volume control disabled', 'Setting is off');
      if (volumeManagerRef.current) {
        try {
          const VolumeManager = volumeManagerRef.current;
          if (VolumeManager && typeof VolumeManager.enable === 'function') {
            VolumeManager.enable(false);
          }
          volumeManagerRef.current = null;
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      return;
    }

    if (Platform.OS !== 'ios') {
      debugLog.info('Hardware volume control skipped', `Only works on iOS native, current platform: ${Platform.OS}`);
      return;
    }

    // Check if we're in Expo Go (no native modules)
    // In Expo Go, Constants.executionEnvironment is 'storeClient'
    // In development builds, it's 'standalone' or 'bare'
    const isExpoGo = Constants.executionEnvironment === 'storeClient';
    
    if (isExpoGo) {
      debugLog.info('Hardware volume control skipped', 'Not available in Expo Go - requires development build');
      return; // Skip entirely in Expo Go - don't even try to require
    }

    // Try to load volume manager - only works in development builds with native modules
    let VolumeManager: any = null;
    let volumeListener: any = null;
    let isMounted = true;
    
    try {
      // Check if we're on web (require might not work)
      if (typeof require === 'undefined') {
        debugLog.info('Hardware volume control skipped', 'require() not available');
        return;
      }

      try {
        debugLog.info('Attempting to load volume manager', 'Loading react-native-volume-manager...');
        const volumeManagerModule = require('react-native-volume-manager');
        VolumeManager = volumeManagerModule?.default || volumeManagerModule;
        
        if (!VolumeManager) {
          debugLog.info('Volume manager module loaded but is null', 'Library may not be linked - requires development build with native modules');
          return;
        }
        
        debugLog.info('Volume manager loaded successfully', 'Ready to enable');
      } catch (requireError) {
        // Library not available or not linked - this is expected if not properly set up
        const errorMsg = requireError instanceof Error ? requireError.message : String(requireError);
        debugLog.info('Volume manager not available', 'Requires development build with native modules linked');
        debugLog.info('Error details', errorMsg.substring(0, 100)); // Log first 100 chars only
        return; // Silently skip - don't crash the app
      }

      if (typeof VolumeManager.enable !== 'function') {
        debugLog.error('Volume manager missing enable()', 'Module structure may be incorrect');
        return;
      }

      // Enable volume button listener
      try {
        debugLog.info('Enabling volume manager', 'Calling VolumeManager.enable(true)...');
        VolumeManager.enable(true);

        if (typeof VolumeManager.addVolumeListener === 'function') {
          debugLog.info('Adding volume listener', 'Setting up hardware button listener...');
          volumeListener = VolumeManager.addVolumeListener((result: { value: number }) => {
            if (!isMounted) return;
            
            try {
              debugLog.info('Volume button pressed', `Value: ${result?.value}`);
              if (result?.value !== undefined && result?.value !== null) {
                const newVolume = Math.max(0, Math.min(1, result.value));
                // Only update if volume actually changed (to avoid loops)
                if (lastSystemVolumeRef.current === null || Math.abs(lastSystemVolumeRef.current - newVolume) > 0.02) {
                  lastSystemVolumeRef.current = newVolume;
                  debugLog.info('Updating volume from hardware button', `${Math.round(newVolume * 100)}%`);
                  setVolume(newVolume);
                }
              }
            } catch (listenerError) {
              debugLog.error('Volume listener error', listenerError instanceof Error ? listenerError.message : String(listenerError));
            }
          });

          volumeManagerRef.current = VolumeManager;
          debugLog.info('Hardware volume control enabled', 'Volume buttons will control app volume');
        } else {
          debugLog.error('Volume manager missing addVolumeListener()', 'API may have changed');
        }
      } catch (enableError) {
        debugLog.error('Failed to enable volume manager', enableError instanceof Error ? enableError.message : String(enableError));
        debugLog.error('Enable error details', enableError instanceof Error ? enableError.stack : String(enableError));
      }
    } catch (error) {
      // Catch any unexpected errors to prevent crashes
      debugLog.error('Volume manager setup error', error instanceof Error ? error.message : String(error));
      debugLog.error('Setup error details', error instanceof Error ? error.stack : String(error));
    }

    return () => {
      isMounted = false;
      if (volumeListener && VolumeManager) {
        try {
          if (typeof VolumeManager.removeVolumeListener === 'function') {
            VolumeManager.removeVolumeListener(volumeListener);
          }
          if (typeof VolumeManager.enable === 'function') {
            VolumeManager.enable(false);
          }
          volumeManagerRef.current = null;
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, [hardwareVolumeControl, setVolume]);

  const addToQueue = useCallback(async (track: Track) => {
    if (!activePlayer || !track.lmsTrackId) {
      setQueue((prev) => [...prev, track]);
      return;
    }
    
    try {
      await lmsClient.addTrackToPlaylist(activePlayer.id, track.lmsTrackId);
      await syncPlayerStatus();
    } catch (error) {
      debugLog.error('Add to queue failed', error instanceof Error ? error.message : String(error));
      setQueue((prev) => [...prev, track]);
    }
  }, [activePlayer, syncPlayerStatus]);

  const removeFromQueue = useCallback(async (index: number) => {
    if (!activePlayer) {
      setQueue((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    
    try {
      await lmsClient.removeFromPlaylist(activePlayer.id, index);
      await syncPlayerStatus();
    } catch (error) {
      debugLog.error('Remove from queue failed', error instanceof Error ? error.message : String(error));
      setQueue((prev) => prev.filter((_, i) => i !== index));
    }
  }, [activePlayer, syncPlayerStatus]);

  const clearQueue = useCallback(async () => {
    if (!activePlayer) {
      setQueue([]);
      setCurrentTrack(null);
      setIsPlaying(false);
      setCurrentTime(0);
      return;
    }
    
    try {
      await lmsClient.clearPlaylist(activePlayer.id);
      setQueue([]);
      setCurrentTrack(null);
      setIsPlaying(false);
      setCurrentTime(0);
    } catch (error) {
      debugLog.error('Clear queue failed', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer]);

  const reorderQueue = useCallback(async (fromIndex: number, toIndex: number) => {
    if (!activePlayer) {
      setQueue((prev) => {
        const newQueue = [...prev];
        const [removed] = newQueue.splice(fromIndex, 1);
        newQueue.splice(toIndex, 0, removed);
        return newQueue;
      });
      return;
    }
    
    try {
      await lmsClient.moveInPlaylist(activePlayer.id, fromIndex, toIndex);
      await syncPlayerStatus();
    } catch (error) {
      debugLog.error('Reorder queue failed', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer, syncPlayerStatus]);

  const playTrack = useCallback(async (track: Track, tracks?: Track[]) => {
    if (!activePlayer) {
      debugLog.error('No active player', 'Cannot play without a player');
      return;
    }
    if (disabledPlayers.has(activePlayer.id)) {
      debugLog.error('Player disabled', 'Cannot play to a disabled player');
      return;
    }
    
    if (isPlayingRef.current) {
      debugLog.info('Play already in progress', 'Ignoring duplicate call');
      return;
    }
    
    isPlayingRef.current = true;
    
    try {
      if (track.lmsTrackId) {
        // Ensure player is powered on
        await lmsClient.setPower(activePlayer.id, true);
        // Load track into playlist - pass format info and player model to allow smart transcoding decisions
        await lmsClient.playTrack(activePlayer.id, track.lmsTrackId, track.source === 'qobuz', track.format, track.sampleRate, track.bitDepth, activePlayer.model);
        // Actually start playback
        await lmsClient.play(activePlayer.id);
      }
      
      // Don't set currentTrack locally - let syncPlayerStatus get it from server
      // This ensures mobile and web always show the same track (what's actually playing)
      setCurrentTime(0);
      setIsPlaying(true);
      
      if (tracks) {
        setQueue(tracks);
      }
      
      // Sync immediately to get actual current track from server
      setTimeout(() => {
        syncPlayerStatus();
      }, 500);
    } catch (error) {
      debugLog.error('Play track failed', error instanceof Error ? error.message : String(error));
    } finally {
      isPlayingRef.current = false;
    }
  }, [activePlayer, syncPlayerStatus]);

  const playPlaylist = useCallback(async (playlistId: string) => {
    if (!activePlayer) {
      debugLog.error('No active player', 'Cannot play playlist without a player');
      return;
    }
    if (disabledPlayers.has(activePlayer.id)) {
      debugLog.error('Player disabled', 'Cannot play to a disabled player');
      return;
    }
    
    try {
      await lmsClient.setPower(activePlayer.id, true);
      // Let LMS handle format/transcoding automatically based on player capabilities
      await lmsClient.playPlaylist(activePlayer.id, playlistId);
      await lmsClient.play(activePlayer.id);
      setIsPlaying(true);
      
      setTimeout(() => {
        syncPlayerStatus();
      }, 500);
    } catch (error) {
      debugLog.error('Play playlist failed', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer, syncPlayerStatus]);

  const toggleShuffle = useCallback(async () => {
    if (!activePlayer) {
      setShuffle((prev) => !prev);
      return;
    }
    
    const newMode = shuffle ? 0 : 1;
    try {
      await lmsClient.setShuffle(activePlayer.id, newMode as 0 | 1 | 2);
      setShuffle(!shuffle);
    } catch (error) {
      debugLog.error('Toggle shuffle failed', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer, shuffle]);

  const toggleRepeat = useCallback(async () => {
    if (!activePlayer) {
      setRepeat((prev) => {
        if (prev === "off") return "all";
        if (prev === "all") return "one";
        return "off";
      });
      return;
    }
    
    let newMode: 0 | 1 | 2;
    let newRepeat: "off" | "all" | "one";
    
    if (repeat === "off") {
      newMode = 2;
      newRepeat = "all";
    } else if (repeat === "all") {
      newMode = 1;
      newRepeat = "one";
    } else {
      newMode = 0;
      newRepeat = "off";
    }
    
    try {
      await lmsClient.setRepeat(activePlayer.id, newMode);
      setRepeat(newRepeat);
    } catch (error) {
      debugLog.error('Toggle repeat failed', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer, repeat]);

  const setActiveZone = useCallback((zoneId: string) => {
    setActiveZoneId(zoneId);
    
    // Update zones immediately to reflect the new active zone
    setZones((prev) =>
      prev.map((z) => ({
        ...z,
        isActive: z.id === zoneId,
      }))
    );
    
    const player = players.find(p => p.id === zoneId);
    if (player) {
      setActivePlayer(player);
      // Immediately sync status from the newly selected player
      // The useEffect will also trigger, but this ensures immediate update
      setTimeout(() => {
        syncPlayerStatus();
      }, 150);
    }
  }, [players, setActivePlayer, syncPlayerStatus]);

  const setZoneVolume = useCallback((zoneId: string, newVolume: number) => {
    setZones((prev) =>
      prev.map((z) =>
        z.id === zoneId ? { ...z, volume: Math.max(0, Math.min(1, newVolume)) } : z
      )
    );
    
    if (zoneId === activePlayer?.id) {
      setVolume(newVolume);
    }
  }, [activePlayer, setVolume]);

  const toggleZone = useCallback((zoneId: string) => {
    setZones((prev) =>
      prev.map((z) =>
        z.id === zoneId ? { ...z, isActive: !z.isActive } : z
      )
    );
  }, []);

  const activeZone = zones.find((z) => z.id === activeZoneId) || null;

  return (
    <PlaybackContext.Provider
      value={{
        currentTrack,
        queue,
        isPlaying,
        currentTime,
        volume,
        shuffle,
        repeat,
        zones,
        activeZoneId,
        activeZone,
        play,
        pause,
        togglePlayPause,
        next,
        previous,
        seek,
        setVolume,
        addToQueue,
        removeFromQueue,
        clearQueue,
        reorderQueue,
        playTrack,
        playPlaylist,
        toggleShuffle,
        toggleRepeat,
        setActiveZone,
        setZoneVolume,
        toggleZone,
        players,
        activePlayer,
        setActivePlayer,
        refreshPlayers,
        syncPlayerStatus,
        dacConfig,
        setDacConfig,
        dacVolume,
        disabledPlayers,
        togglePlayerDisabled,
        allPlayers,
      }}
    >
      {children}
    </PlaybackContext.Provider>
  );
}

export function usePlayback() {
  const context = useContext(PlaybackContext);
  if (!context) {
    throw new Error("usePlayback must be used within a PlaybackProvider");
  }
  return context;
}
