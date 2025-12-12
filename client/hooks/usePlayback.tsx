import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { lmsClient, LmsPlayer, LmsPlayerStatus } from "@/lib/lmsClient";
import { debugLog } from "@/lib/debugLog";

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
}

const PlaybackContext = createContext<PlaybackContextType | undefined>(undefined);

const STORAGE_KEY = "@soundstream_playback";
const ZONES_KEY = "@soundstream_zones";
const LMS_PLAYER_KEY = "@soundstream_lms_active_player";

const DEFAULT_ZONES: Zone[] = [
  { id: "local", name: "This Device", type: "local", isActive: false, volume: 0.8 },
];

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("off");
  const [zones, setZones] = useState<Zone[]>(DEFAULT_ZONES);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  
  const [players, setPlayers] = useState<LmsPlayer[]>([]);
  const [activePlayer, setActivePlayerState] = useState<LmsPlayer | null>(null);
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTimeRef = useRef<number>(0);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const volumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVolumeRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    loadState();
    loadZones();
    loadActivePlayer();
  }, []);

  useEffect(() => {
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }

    if (activePlayer) {
      syncPlayerStatus();
      statusPollRef.current = setInterval(() => {
        syncPlayerStatus();
      }, 3000);
    }

    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
      }
    };
  }, [activePlayer?.id]);

  const loadActivePlayer = async () => {
    try {
      const stored = await AsyncStorage.getItem(LMS_PLAYER_KEY);
      if (stored) {
        const playerData: LmsPlayer = JSON.parse(stored);
        setActivePlayerState(playerData);
        setActiveZoneId(playerData.id);
      }
    } catch (e) {
      console.error("Failed to load active player:", e);
    }
  };

  const refreshPlayers = useCallback(async () => {
    try {
      const fetchedPlayers = await lmsClient.getPlayers();
      setPlayers(fetchedPlayers);
      
      const lmsZones: Zone[] = fetchedPlayers.map(p => ({
        id: p.id,
        name: p.name,
        type: 'lms' as const,
        isActive: p.id === activePlayer?.id,
        volume: p.volume / 100,
      }));
      
      setZones([...DEFAULT_ZONES, ...lmsZones]);
      
      if (!activePlayer && fetchedPlayers.length > 0) {
        setActivePlayer(fetchedPlayers[0]);
      }
    } catch (error) {
      debugLog.error('Failed to refresh players', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer]);

  const setActivePlayer = useCallback((player: LmsPlayer) => {
    setActivePlayerState(player);
    setActiveZoneId(player.id);
    AsyncStorage.setItem(LMS_PLAYER_KEY, JSON.stringify(player));
  }, []);

  const syncPlayerStatus = useCallback(async () => {
    if (!activePlayer) return;

    try {
      const status = await lmsClient.getPlayerStatus(activePlayer.id);
      
      setIsPlaying(status.mode === 'play');
      setVolumeState(status.volume / 100);
      setCurrentTime(status.time);
      
      const shuffleMode = status.shuffle > 0;
      const repeatMode = status.repeat === 0 ? 'off' : status.repeat === 1 ? 'one' : 'all';
      setShuffle(shuffleMode);
      setRepeat(repeatMode);
      
      if (status.currentTrack) {
        const track: Track = {
          id: status.currentTrack.id,
          title: status.currentTrack.title,
          artist: status.currentTrack.artist,
          album: status.currentTrack.album,
          albumArt: status.currentTrack.artwork_url ? lmsClient.getArtworkUrl(status.currentTrack) : undefined,
          duration: status.currentTrack.duration,
          source: 'local',
          format: status.currentTrack.format,
          bitrate: status.currentTrack.bitrate,
          sampleRate: status.currentTrack.sampleRate,
          bitDepth: status.currentTrack.bitDepth,
          lmsTrackId: status.currentTrack.id,
        };
        setCurrentTrack(track);
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
  }, [activePlayer]);

  useEffect(() => {
    saveState();
  }, [currentTrack, queue, volume, shuffle, repeat]);

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
        if (state.currentTrack) {
          setCurrentTrack(state.currentTrack);
          setCurrentTime(state.currentTime || 0);
          lastSavedTimeRef.current = state.currentTime || 0;
        }
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
          currentTrack,
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
    
    if (track) {
      setCurrentTrack(track);
      setCurrentTime(0);
    }
    
    try {
      await lmsClient.play(activePlayer.id);
      setIsPlaying(true);
    } catch (error) {
      debugLog.error('Play failed', error instanceof Error ? error.message : String(error));
    }
  }, [activePlayer]);

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
    if (!activePlayer) return;
    
    const clampedVol = Math.max(0, Math.min(1, vol));
    setVolumeState(clampedVol);
    
    pendingVolumeRef.current = clampedVol;
    
    if (volumeTimeoutRef.current) {
      clearTimeout(volumeTimeoutRef.current);
    }
    
    volumeTimeoutRef.current = setTimeout(async () => {
      const finalVol = pendingVolumeRef.current;
      if (finalVol === null || !activePlayer) return;
      
      const volumePercent = Math.round(finalVol * 100);
      pendingVolumeRef.current = null;
      
      try {
        await lmsClient.setVolume(activePlayer.id, volumePercent);
      } catch (error) {
        debugLog.error('Set volume failed', error instanceof Error ? error.message : String(error));
      }
    }, 50);
  }, [activePlayer]);

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
    
    if (isPlayingRef.current) {
      debugLog.info('Play already in progress', 'Ignoring duplicate call');
      return;
    }
    
    isPlayingRef.current = true;
    
    try {
      if (track.lmsTrackId) {
        // Ensure player is powered on
        await lmsClient.setPower(activePlayer.id, true);
        // Load track into playlist
        await lmsClient.playTrack(activePlayer.id, track.lmsTrackId);
        // Actually start playback
        await lmsClient.play(activePlayer.id);
      }
      
      setCurrentTrack(track);
      setCurrentTime(0);
      setIsPlaying(true);
      
      if (tracks) {
        setQueue(tracks);
      }
      
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
    
    try {
      await lmsClient.setPower(activePlayer.id, true);
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
    
    const player = players.find(p => p.id === zoneId);
    if (player) {
      setActivePlayer(player);
    }
  }, [players, setActivePlayer]);

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
