import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as upnpClient from "@/lib/upnpClient";
import { OpenHomeServices } from "@/lib/upnpClient";

// Common device description URL paths to try
const VARESE_BASE_HOST = 'http://192.168.0.35:49152';
const DEVICE_DESCRIPTION_PATHS = [
  '/device.xml',
  '/description.xml',
  '/desc.xml',
  '/root.xml',
  '/DeviceDescription.xml',
  '/',
  '/upnp/desc.xml',
  '/rootDesc.xml',
];

// Hardcoded URLs based on discovered URL pattern from AVTransport
const VARESE_BASE = 'http://192.168.0.35:49152';
const VARESE_UUID_BASE = `${VARESE_BASE}/uuid-938555d3-b45d-cdb9-7a3b-00e04c68c799`;
const VARESE_AVTRANSPORT_URL = `${VARESE_UUID_BASE}/ctl-urn-schemas-upnp-org-service-AVTransport-1`;
const VARESE_RENDERINGCONTROL_URL = `${VARESE_UUID_BASE}/ctl-urn-schemas-upnp-org-service-RenderingControl-1`;

// OpenHome URLs - guessed based on the same pattern as AVTransport
// OpenHome uses av.openhome.org namespace, converted to URL path format
const VARESE_OH_PLAYLIST_URL = `${VARESE_UUID_BASE}/ctl-urn-av-openhome-org-service-Playlist-1`;
const VARESE_OH_PRODUCT_URL = `${VARESE_UUID_BASE}/ctl-urn-av-openhome-org-service-Product-1`;
const VARESE_OH_TRANSPORT_URL = `${VARESE_UUID_BASE}/ctl-urn-av-openhome-org-service-Transport-1`;

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
  metadata?: string; // DIDL-Lite XML for AVTransport
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
  runOpenHomeDiagnostic: () => Promise<void>;
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
  const [vareseServices, setVareseServices] = useState<OpenHomeServices>({});
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTimeRef = useRef<number>(0);

  useEffect(() => {
    loadState();
    loadZones();
    fetchVareseVolume();
    discoverVareseServices();
  }, []);

  const discoverVareseServices = async () => {
    console.log('=== DISCOVERING VARESE SERVICES (silent mode) ===');
    
    // Since device description returns 403 and OpenHome probes fail,
    // we just use the hardcoded AVTransport URL which we know works
    // OpenHome services require further investigation via the diagnostic tool
    
    const services: OpenHomeServices = {
      avTransportControlURL: VARESE_AVTRANSPORT_URL,
      renderingControlURL: VARESE_RENDERINGCONTROL_URL,
    };
    
    console.log('Using hardcoded Varese services:', services);
    setVareseServices(services);
  };
  
  // Run diagnostic to probe all OpenHome services
  const runOpenHomeDiagnostic = async () => {
    console.log('=== RUNNING OPENHOME DIAGNOSTIC ===');
    const uuid = '938555d3-b45d-cdb9-7a3b-00e04c68c799';
    await upnpClient.diagnoseOpenHomeServices(VARESE_BASE, uuid);
  };

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
        console.log('Sending Pause command to Varese');
        await upnpClient.pause(VARESE_AVTRANSPORT_URL, 0);
        setIsPlaying(false);
      } else {
        console.log('Sending Play command to Varese');
        await upnpClient.play(VARESE_AVTRANSPORT_URL, 0, '1');
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('Failed to toggle playback on Varese:', error);
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
        await upnpClient.setAVTransportURI(VARESE_AVTRANSPORT_URL, 0, nextTrack.uri, nextTrack.metadata || '');
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
        await upnpClient.setAVTransportURI(VARESE_AVTRANSPORT_URL, 0, prevTrack.uri, prevTrack.metadata || '');
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

  // Track if we're currently sending a play command to prevent race conditions
  const isPlayingRef = useRef(false);
  const lastPlayedTrackIdRef = useRef<string | null>(null);
  
  const playTrack = useCallback(async (track: Track, tracks?: Track[]) => {
    // Prevent concurrent play attempts and duplicate calls for same track
    if (isPlayingRef.current) {
      console.log('Play already in progress, ignoring duplicate call');
      return;
    }
    
    // Debounce rapid calls for the same track (within 500ms)
    const trackId = track.id || track.uri || null;
    if (lastPlayedTrackIdRef.current === trackId) {
      console.log('Same track requested again, ignoring');
      return;
    }
    
    isPlayingRef.current = true;
    lastPlayedTrackIdRef.current = trackId;
    
    // Reset after 5 seconds to allow replaying same track
    setTimeout(() => {
      lastPlayedTrackIdRef.current = null;
    }, 5000);
    
    try {
      if (tracks) {
        setQueue(tracks);
      }
      setCurrentTrack(track);
      setCurrentTime(0);
      
      // Try OpenHome Playlist first (preferred for dCS devices), then fall back to AVTransport
      if (track.uri) {
        console.log('=== PLAYING TRACK ===');
        console.log('Track title:', track.title);
        console.log('Track URI:', track.uri);
        
        let openHomeSuccess = false;
        
        // Try OpenHome Playlist approach first
        try {
          console.log('Trying OpenHome Playlist approach...');
          
          // Step 1: Try to get sources to find Playlist source index
          console.log('Getting Product sources...');
          const sourceXml = await upnpClient.productSourceXml(VARESE_OH_PRODUCT_URL);
          console.log('SourceXml retrieved, length:', sourceXml.length);
          
          // Find Playlist source index - look for a source with type "Playlist" or "NetAux"
          const sourceMatches = sourceXml.matchAll(/<Source>[\s\S]*?<Index>(\d+)<\/Index>[\s\S]*?<Type>([^<]+)<\/Type>[\s\S]*?<\/Source>/gi);
          let playlistSourceIndex = 0; // Default to 0
          
          for (const match of sourceMatches) {
            const index = parseInt(match[1]);
            const type = match[2];
            console.log(`Found source ${index}: ${type}`);
            if (type.toLowerCase().includes('playlist') || type.toLowerCase().includes('netaux')) {
              playlistSourceIndex = index;
              console.log('Using source index:', playlistSourceIndex);
              break;
            }
          }
          
          // Step 2: Set source to Playlist
          await upnpClient.productSetSource(VARESE_OH_PRODUCT_URL, playlistSourceIndex);
          await new Promise(resolve => setTimeout(resolve, 200));
          
          // Step 3: Clear playlist and insert track
          await upnpClient.playlistDeleteAll(VARESE_OH_PLAYLIST_URL);
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Step 4: Insert track into playlist
          await upnpClient.playlistInsert(
            VARESE_OH_PLAYLIST_URL, 
            0, // afterId - insert at beginning
            track.uri, 
            track.metadata || ''
          );
          await new Promise(resolve => setTimeout(resolve, 200));
          
          // Step 5: Play the playlist
          await upnpClient.playlistPlay(VARESE_OH_PLAYLIST_URL);
          
          console.log('OpenHome Playlist play successful!');
          openHomeSuccess = true;
          setIsPlaying(true);
          
        } catch (ohError) {
          console.log('OpenHome Playlist approach failed:', ohError);
          console.log('Falling back to AVTransport...');
        }
        
        // Fall back to AVTransport if OpenHome failed
        if (!openHomeSuccess) {
          try {
            // Step 1: Set the transport URI with metadata
            const setResult = await upnpClient.setAVTransportURI(
              VARESE_AVTRANSPORT_URL, 
              0, 
              track.uri, 
              track.metadata || ''
            );
            
            if (!setResult.success) {
              console.error('SetAVTransportURI failed:', setResult.error);
              setIsPlaying(false);
              return;
            }
            
            console.log('SetAVTransportURI succeeded');
            
            // Step 2: Wait for the Varese to process the URI
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Step 3: Send Play command
            await upnpClient.play(VARESE_AVTRANSPORT_URL, 0, '1');
            console.log('AVTransport Play command sent');
            
            setIsPlaying(true);
            console.log('=== PLAY COMMAND SENT (AVTransport) ===');
            
          } catch (error) {
            console.error('AVTransport playback failed:', error);
            setIsPlaying(false);
          }
        }
        
        console.log('=== PLAY SEQUENCE COMPLETE ===');
        
      } else {
        console.warn('Track has no URI, cannot play on renderer');
        setIsPlaying(false);
      }
    } catch (error) {
      console.error('Failed to control Varese:', error);
      setIsPlaying(false);
    } finally {
      isPlayingRef.current = false;
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
        runOpenHomeDiagnostic,
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
