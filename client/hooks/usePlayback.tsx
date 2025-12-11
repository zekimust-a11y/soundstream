import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as upnpClient from "@/lib/upnpClient";

const VARESE_AVTRANSPORT_URL = 'http://192.168.0.35:49152/uuid-938555d3-b45d-cdb9-7a3b-00e04c68c799/ctl-urn-schemas-upnp-org-service-AVTransport-1';
const VARESE_RENDERINGCONTROL_URL = 'http://192.168.0.35:49152/uuid-938555d3-b45d-cdb9-7a3b-00e04c68c799/ctl-urn-schemas-upnp-org-service-RenderingControl-1';
const VARESE_PRODUCT_URL = 'http://192.168.0.35:49152/uuid-938555d3-b45d-cdb9-7a3b-00e04c68c799/ctl-urn-av-openhome-org-service-Product-1';
const VARESE_PLAYLIST_URL = 'http://192.168.0.35:49152/uuid-938555d3-b45d-cdb9-7a3b-00e04c68c799/ctl-urn-av-openhome-org-service-Playlist-1';

export interface Zone {
  id: string;
  name: string;
  type: "upnp" | "airplay" | "local";
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
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  setActiveZone: (zoneId: string) => void;
  setZoneVolume: (zoneId: string, volume: number) => void;
  toggleZone: (zoneId: string) => void;
  activeZone: Zone | null;
}

const PlaybackContext = createContext<PlaybackContextType | undefined>(undefined);

const STORAGE_KEY = "@soundstream_playback";
const ZONES_KEY = "@soundstream_zones";

const DEFAULT_ZONES: Zone[] = [
  { id: "local", name: "This Device", type: "local", isActive: true, volume: 0.8 },
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
  const [activeZoneId, setActiveZoneId] = useState<string | null>("local");
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTimeRef = useRef<number>(0);

  useEffect(() => {
    loadState();
    loadZones();
    fetchVareseVolume();
  }, []);

  const fetchVareseVolume = async () => {
    try {
      const volumePercent = await upnpClient.getVolume(VARESE_RENDERINGCONTROL_URL, 0, 'Master');
      console.log('Varese current volume:', volumePercent);
      setVolumeState(volumePercent / 100); // Convert 0-100 to 0-1
    } catch (error) {
      console.log('Could not fetch Varese volume (may not be available):', error);
    }
  };

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

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying && currentTrack) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= currentTrack.duration) {
            next();
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentTrack]);

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
        setActiveZoneId(data.activeZoneId || "local");
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
    if (track) {
      setCurrentTrack(track);
      setCurrentTime(0);
    }
    try {
      console.log('Sending Play command to Varese');
      await upnpClient.play(VARESE_AVTRANSPORT_URL, 0, '1');
      setIsPlaying(true);
    } catch (error) {
      console.error('Failed to resume playback on Varese:', error);
    }
  }, []);

  const pause = useCallback(async () => {
    try {
      console.log('Sending Pause command to Varese');
      await upnpClient.pause(VARESE_AVTRANSPORT_URL, 0);
      setIsPlaying(false);
    } catch (error) {
      console.error('Failed to pause on Varese:', error);
      setIsPlaying(false);
    }
  }, []);

  const togglePlayPause = useCallback(async () => {
    try {
      if (isPlaying) {
        console.log('Sending OpenHome Pause command to Varese');
        await upnpClient.playlistPause(VARESE_PLAYLIST_URL);
        setIsPlaying(false);
      } else {
        console.log('Sending OpenHome Play command to Varese');
        await upnpClient.playlistPlay(VARESE_PLAYLIST_URL);
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('Failed to toggle playback on Varese:', error);
      // Try AVTransport fallback
      try {
        if (isPlaying) {
          await upnpClient.pause(VARESE_AVTRANSPORT_URL, 0);
          setIsPlaying(false);
        } else {
          await upnpClient.play(VARESE_AVTRANSPORT_URL, 0, '1');
          setIsPlaying(true);
        }
      } catch (fallbackError) {
        console.error('AVTransport fallback also failed:', fallbackError);
      }
    }
  }, [isPlaying]);

  const next = useCallback(async () => {
    if (queue.length === 0) return;
    const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
    let nextIndex: number;
    
    if (shuffle) {
      nextIndex = Math.floor(Math.random() * queue.length);
    } else if (currentIndex === queue.length - 1) {
      if (repeat === "all") {
        nextIndex = 0;
      } else {
        try {
          await upnpClient.stop(VARESE_AVTRANSPORT_URL, 0);
        } catch (e) {
          console.error('Failed to stop playback:', e);
        }
        setIsPlaying(false);
        return;
      }
    } else {
      nextIndex = currentIndex + 1;
    }
    
    const nextTrack = queue[nextIndex];
    setCurrentTrack(nextTrack);
    setCurrentTime(0);
    
    // Send UPNP commands for the next track
    if (nextTrack?.uri) {
      try {
        await upnpClient.setAVTransportURI(VARESE_AVTRANSPORT_URL, 0, nextTrack.uri, '');
        await upnpClient.play(VARESE_AVTRANSPORT_URL, 0, '1');
      } catch (error) {
        console.error('Failed to play next track on Varese:', error);
      }
    }
  }, [queue, currentTrack, shuffle, repeat]);

  const previous = useCallback(async () => {
    if (currentTime > 3) {
      setCurrentTime(0);
      // Seek to beginning on the renderer
      try {
        await upnpClient.seek(VARESE_AVTRANSPORT_URL, 0, 'REL_TIME', '00:00:00');
      } catch (e) {
        console.error('Failed to seek:', e);
      }
      return;
    }
    if (queue.length === 0) return;
    const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
    const prevIndex = currentIndex <= 0 ? queue.length - 1 : currentIndex - 1;
    const prevTrack = queue[prevIndex];
    setCurrentTrack(prevTrack);
    setCurrentTime(0);
    
    // Send UPNP commands for the previous track
    if (prevTrack?.uri) {
      try {
        await upnpClient.setAVTransportURI(VARESE_AVTRANSPORT_URL, 0, prevTrack.uri, '');
        await upnpClient.play(VARESE_AVTRANSPORT_URL, 0, '1');
      } catch (error) {
        console.error('Failed to play previous track on Varese:', error);
      }
    }
  }, [queue, currentTrack, currentTime]);

  const seek = useCallback(async (time: number) => {
    setCurrentTime(time);
    // Convert seconds to HH:MM:SS format for UPNP
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = Math.floor(time % 60);
    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    try {
      await upnpClient.seek(VARESE_AVTRANSPORT_URL, 0, 'REL_TIME', timeString);
    } catch (error) {
      console.error('Failed to seek on Varese:', error);
    }
  }, []);

  const setVolume = useCallback(async (vol: number) => {
    const clampedVol = Math.max(0, Math.min(1, vol));
    setVolumeState(clampedVol);
    
    // Send volume to Varese (convert 0-1 range to 0-100)
    const volumePercent = Math.round(clampedVol * 100);
    try {
      console.log('Setting Varese volume to:', volumePercent);
      await upnpClient.setVolume(VARESE_RENDERINGCONTROL_URL, 0, 'Master', volumePercent);
    } catch (error) {
      console.error('Failed to set volume on Varese:', error);
    }
  }, []);

  const addToQueue = useCallback((track: Track) => {
    setQueue((prev) => [...prev, track]);
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    setQueue((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setCurrentTrack(null);
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    setQueue((prev) => {
      const newQueue = [...prev];
      const [removed] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, removed);
      return newQueue;
    });
  }, []);

  const playTrack = useCallback(async (track: Track, tracks?: Track[]) => {
    if (tracks) {
      setQueue(tracks);
    }
    setCurrentTrack(track);
    setCurrentTime(0);
    
    // Send OpenHome commands to the dCS Varese
    if (track.uri) {
      try {
        // First, switch to the Playlist source using OpenHome Product service
        console.log('Switching Varese to Playlist source...');
        await upnpClient.switchToNetworkSource(VARESE_PRODUCT_URL);
        
        // Clear the playlist and insert the new track
        console.log('Clearing Varese playlist...');
        await upnpClient.playlistDeleteAll(VARESE_PLAYLIST_URL);
        
        // Insert the track into the playlist
        console.log('Inserting track into Varese playlist:', track.uri);
        const trackId = await upnpClient.playlistInsert(VARESE_PLAYLIST_URL, 0, track.uri, '');
        
        // Seek to the track (this also starts playback in OpenHome)
        console.log('Seeking to track ID:', trackId);
        await upnpClient.playlistSeekId(VARESE_PLAYLIST_URL, trackId);
        
        // Send Play command to ensure playback starts
        console.log('Sending Play command...');
        await upnpClient.playlistPlay(VARESE_PLAYLIST_URL);
        
        console.log('Playback started on Varese via OpenHome Playlist');
        setIsPlaying(true);
      } catch (error) {
        console.error('Failed to control Varese:', error);
        // Fall back to trying AVTransport
        try {
          console.log('Trying AVTransport fallback...');
          await upnpClient.setAVTransportURI(VARESE_AVTRANSPORT_URL, 0, track.uri, '');
          await upnpClient.play(VARESE_AVTRANSPORT_URL, 0, '1');
          setIsPlaying(true);
        } catch (fallbackError) {
          console.error('AVTransport fallback also failed:', fallbackError);
          setIsPlaying(false);
        }
      }
    } else {
      console.warn('Track has no URI, cannot play on renderer');
      setIsPlaying(false);
    }
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((prev) => !prev);
  }, []);

  const toggleRepeat = useCallback(() => {
    setRepeat((prev) => {
      if (prev === "off") return "all";
      if (prev === "all") return "one";
      return "off";
    });
  }, []);

  const setActiveZone = useCallback((zoneId: string) => {
    setActiveZoneId(zoneId);
  }, []);

  const setZoneVolume = useCallback((zoneId: string, newVolume: number) => {
    setZones((prev) =>
      prev.map((z) =>
        z.id === zoneId ? { ...z, volume: Math.max(0, Math.min(1, newVolume)) } : z
      )
    );
  }, []);

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
        toggleShuffle,
        toggleRepeat,
        setActiveZone,
        setZoneVolume,
        toggleZone,
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
