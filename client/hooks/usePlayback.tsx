import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as upnpClient from "@/lib/upnpClient";
import { OpenHomeServices, setBridgeProxyUrl } from "@/lib/upnpClient";

// Fallback hardcoded URLs (used when bridge is not available)
// dCS Varese Core - has multiple network interfaces, try both IPs
const VARESE_IPS = ['192.168.0.42', '192.168.0.17'];
const VARESE_PORT = 16500;
const VARESE_AVTRANSPORT_PATH = '/Control/LibRygelRenderer/RygelAVTransport';
const VARESE_RENDERINGCONTROL_PATH = '/Control/LibRygelRenderer/RygelRenderingControl';
const VARESE_OPENHOME_VOLUME_PATH = '/Control/LibRygelRenderer/RygelVolume';

// Build URLs for a specific IP
const buildVareseUrls = (ip: string) => ({
  base: `http://${ip}:${VARESE_PORT}`,
  avTransport: `http://${ip}:${VARESE_PORT}${VARESE_AVTRANSPORT_PATH}`,
  renderingControl: `http://${ip}:${VARESE_PORT}${VARESE_RENDERINGCONTROL_PATH}`,
  openHomeVolume: `http://${ip}:${VARESE_PORT}${VARESE_OPENHOME_VOLUME_PATH}`,
});

// Default to first IP, will be updated dynamically
let activeVareseIp = VARESE_IPS[0];
let VARESE_AVTRANSPORT_URL = buildVareseUrls(activeVareseIp).avTransport;
let VARESE_RENDERINGCONTROL_URL = buildVareseUrls(activeVareseIp).renderingControl;
let VARESE_OPENHOME_VOLUME_URL = buildVareseUrls(activeVareseIp).openHomeVolume;

// Try to reach the Varese at any known IP
const findWorkingVareseIp = async (): Promise<string | null> => {
  for (const ip of VARESE_IPS) {
    try {
      const url = `http://${ip}:${VARESE_PORT}/`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(url, { 
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (response.ok || response.status === 404) {
        console.log(`Varese responding at ${ip}`);
        return ip;
      }
    } catch (e) {
      console.log(`Varese not responding at ${ip}`);
    }
  }
  return null;
};

// Update active Varese IP
const updateActiveVareseIp = (ip: string) => {
  activeVareseIp = ip;
  const urls = buildVareseUrls(ip);
  VARESE_AVTRANSPORT_URL = urls.avTransport;
  VARESE_RENDERINGCONTROL_URL = urls.renderingControl;
  VARESE_OPENHOME_VOLUME_URL = urls.openHomeVolume;
  console.log(`Switched to Varese at ${ip}`);
};

// SSDP Bridge configuration - runs on user's computer for proper device discovery
const BRIDGE_STORAGE_KEY = "@soundstream_bridge_url";
const DEFAULT_BRIDGE_URL = "http://localhost:3847";

interface BridgeRenderer {
  name: string;
  manufacturer?: string;
  model?: string;
  avTransportUrl?: string;
  location: string;
}

interface BridgeResponse {
  count: number;
  renderers: BridgeRenderer[];
}

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
  format?: string; // e.g., "FLAC", "WAV", "MP3"
  bitrate?: string; // e.g., "1411 kbps"
  sampleRate?: string; // e.g., "44.1 kHz"
  bitDepth?: string; // e.g., "16-bit"
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
  bridgeUrl: string;
  bridgeConnected: boolean;
  discoveredRenderers: BridgeRenderer[];
  setBridgeUrl: (url: string) => Promise<void>;
  refreshBridgeDevices: () => Promise<void>;
  syncTransportState: () => Promise<void>;
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
  
  // SSDP Bridge state
  const [bridgeUrl, setBridgeUrlState] = useState(DEFAULT_BRIDGE_URL);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [discoveredRenderers, setDiscoveredRenderers] = useState<BridgeRenderer[]>([]);
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTimeRef = useRef<number>(0);

  useEffect(() => {
    loadState();
    loadZones();
    loadBridgeUrl();
    fetchVareseVolume();
    discoverVareseServices();
  }, []);
  
  const loadBridgeUrl = async () => {
    try {
      const stored = await AsyncStorage.getItem(BRIDGE_STORAGE_KEY);
      if (stored) {
        setBridgeUrlState(stored);
        refreshBridgeDevices(stored);
      } else {
        refreshBridgeDevices(DEFAULT_BRIDGE_URL);
      }
    } catch (e) {
      console.error("Failed to load bridge URL:", e);
    }
  };
  
  const setBridgeUrl = async (url: string) => {
    setBridgeUrlState(url);
    await AsyncStorage.setItem(BRIDGE_STORAGE_KEY, url);
    await refreshBridgeDevices(url);
  };
  
  const refreshBridgeDevices = async (url?: string) => {
    const bridgeEndpoint = url || bridgeUrl;
    console.log(`[Bridge] Fetching renderers from ${bridgeEndpoint}/renderers`);
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(`${bridgeEndpoint}/renderers`, {
        signal: controller.signal
      });
      clearTimeout(timeout);
      
      if (response.ok) {
        const data: BridgeResponse = await response.json();
        console.log(`[Bridge] Found ${data.count} renderers:`, data.renderers);
        setBridgeConnected(true);
        setDiscoveredRenderers(data.renderers);
        
        // Enable proxy routing for UPnP requests through the bridge
        setBridgeProxyUrl(bridgeEndpoint);
        console.log(`[Bridge] Proxy routing enabled through ${bridgeEndpoint}`);
        
        // If we found a renderer with AVTransport URL, update the services
        const varese = data.renderers.find(r => 
          r.name?.toLowerCase().includes('varese') || 
          r.manufacturer?.toLowerCase().includes('dcs')
        );
        
        if (varese?.avTransportUrl) {
          console.log(`[Bridge] Found Varese AVTransport: ${varese.avTransportUrl}`);
          setVareseServices(prev => ({
            ...prev,
            avTransportControlURL: varese.avTransportUrl
          }));
        }
      } else {
        console.log('[Bridge] Not available or returned error');
        setBridgeConnected(false);
        setDiscoveredRenderers([]);
        setBridgeProxyUrl(null); // Disable proxy when bridge unavailable
      }
    } catch (e) {
      console.log('[Bridge] Not reachable (this is normal if not running):', e);
      setBridgeConnected(false);
      setDiscoveredRenderers([]);
      setBridgeProxyUrl(null); // Disable proxy when bridge unavailable
    }
  };

  const discoverVareseServices = async () => {
    console.log('=== CONFIGURING VARESE SERVICES ===');
    
    // The dCS Varese only responds to AVTransport commands (compatibility shim)
    // OpenHome services (Product, Playlist, Transport, Volume, Info) all return error 404
    // This is a device limitation, not a discovery issue
    // Use dCS Mosaic app for actual audio playback control
    
    const services: OpenHomeServices = {
      avTransportControlURL: VARESE_AVTRANSPORT_URL,
      renderingControlURL: VARESE_RENDERINGCONTROL_URL,
    };
    
    console.log('Configured Varese AVTransport services');
    setVareseServices(services);
  };
  
  // Run diagnostic to probe all OpenHome services
  const runOpenHomeDiagnostic = async () => {
    console.log('=== RUNNING OPENHOME DIAGNOSTIC ===');
    const uuid = '938555d3-b45d-cdb9-7a3b-00e04c68c799';
    const baseUrl = buildVareseUrls(activeVareseIp).base;
    await upnpClient.diagnoseOpenHomeServices(baseUrl, uuid);
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

  // Sync playback state with Varese's actual transport state
  const syncTransportState = async () => {
    try {
      const transportInfo = await upnpClient.getTransportInfo(VARESE_AVTRANSPORT_URL, 0);
      console.log('Varese transport state:', transportInfo.currentTransportState);
      
      const isActuallyPlaying = transportInfo.currentTransportState === 'PLAYING';
      const isActuallyStopped = transportInfo.currentTransportState === 'STOPPED' || 
                                transportInfo.currentTransportState === 'NO_MEDIA_PRESENT';
      
      // Only update if state differs to avoid unnecessary re-renders
      if (isActuallyPlaying && !isPlaying) {
        console.log('Syncing: Varese is playing, updating app state');
        setIsPlaying(true);
      } else if (isActuallyStopped && isPlaying && currentTrack) {
        // Only mark as stopped if we think we're playing but Varese says stopped
        // This could be end of track or user stopped via another app
        console.log('Syncing: Varese stopped, updating app state');
        setIsPlaying(false);
      }
      
      // Also sync position and duration if playing
      if (isActuallyPlaying) {
        const positionInfo = await upnpClient.getPositionInfo(VARESE_AVTRANSPORT_URL, 0);
        // Parse relTime string (HH:MM:SS) to seconds
        const relTimeParts = positionInfo.relTime?.split(':');
        if (relTimeParts && relTimeParts.length === 3) {
          const serverTime = parseInt(relTimeParts[0]) * 3600 + parseInt(relTimeParts[1]) * 60 + parseFloat(relTimeParts[2]);
          // Only update if difference is significant (> 3 seconds)
          if (Math.abs(serverTime - currentTime) > 3) {
            console.log(`Syncing position: ${serverTime}s (was ${currentTime}s)`);
            setCurrentTime(serverTime);
          }
        }
        
        // Sync track duration from Varese (more accurate than metadata)
        const trackDurationParts = positionInfo.trackDuration?.split(':');
        if (trackDurationParts && trackDurationParts.length === 3 && currentTrack) {
          const serverDurationSec = parseInt(trackDurationParts[0]) * 3600 + parseInt(trackDurationParts[1]) * 60 + parseFloat(trackDurationParts[2]);
          const serverDurationMs = serverDurationSec * 1000;
          // Update track duration if significantly different (> 5 seconds)
          if (serverDurationMs > 0 && Math.abs(serverDurationMs - currentTrack.duration) > 5000) {
            console.log(`Syncing duration: ${serverDurationSec}s (was ${currentTrack.duration / 1000}s)`);
            setCurrentTrack(prev => prev ? { ...prev, duration: serverDurationMs } : prev);
          }
        }
      }
    } catch (error) {
      // Silently ignore - Varese may not be reachable
    }
  };

  // No automatic polling - only sync on user action to avoid interfering with playback
  // Call syncTransportState() manually when needed (e.g., when Now Playing screen opens)

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
          const newTime = prev + 1;
          // Duration is in milliseconds, currentTime is in seconds
          const durationInSeconds = currentTrack.duration / 1000;
          
          // If we've exceeded the stored duration, extend it (metadata was wrong)
          // Add 30 seconds buffer each time we exceed
          if (durationInSeconds > 0 && newTime > durationInSeconds) {
            console.log(`Extending track duration: current ${newTime}s exceeds stored ${durationInSeconds}s`);
            setCurrentTrack(prev => prev ? { 
              ...prev, 
              duration: (newTime + 60) * 1000 // Extend by 60 seconds
            } : prev);
          }
          
          return newTime;
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
      console.log('Sending Stop command to Varese (Pause not supported)');
      await upnpClient.stop(VARESE_AVTRANSPORT_URL, 0);
      setIsPlaying(false);
    } catch (error) {
      console.error('Failed to stop on Varese:', error);
      setIsPlaying(false);
    }
  }, []);

  const togglePlayPause = useCallback(() => {
    const newState = !isPlaying;
    setIsPlaying(newState); // Optimistic update - don't revert on network error
    
    if (newState) {
      console.log('Sending Play command to Varese');
      upnpClient.play(VARESE_AVTRANSPORT_URL, 0, '1').catch((error) => {
        console.error('Play command error (may still be playing):', error);
        // Don't revert state - Varese may have received the command
      });
    } else {
      console.log('Sending Stop command to Varese');
      upnpClient.stop(VARESE_AVTRANSPORT_URL, 0).catch((error) => {
        console.error('Stop command error:', error);
      });
    }
  }, [isPlaying]);

  const next = useCallback(() => {
    console.log('=== NEXT TRACK ===');
    console.log('Queue length:', queue.length);
    console.log('Current track:', currentTrack?.title);
    
    if (queue.length === 0) {
      console.log('Queue is empty, cannot skip');
      return;
    }
    const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
    console.log('Current index in queue:', currentIndex);
    
    let nextIndex: number;
    
    if (shuffle) {
      nextIndex = Math.floor(Math.random() * queue.length);
      console.log('Shuffle mode, random index:', nextIndex);
    } else if (currentIndex === queue.length - 1) {
      if (repeat === "all") {
        nextIndex = 0;
      } else {
        setIsPlaying(false);
        upnpClient.stop(VARESE_AVTRANSPORT_URL, 0).catch(e => {
          console.error('Failed to stop playback:', e);
        });
        return;
      }
    } else {
      nextIndex = currentIndex + 1;
    }
    
    const nextTrack = queue[nextIndex];
    setCurrentTrack(nextTrack);
    setCurrentTime(0);
    
    // Send UPNP commands for the next track (fire-and-forget)
    if (nextTrack?.uri) {
      upnpClient.setAVTransportURI(VARESE_AVTRANSPORT_URL, 0, nextTrack.uri, nextTrack.metadata || '')
        .then(() => upnpClient.play(VARESE_AVTRANSPORT_URL, 0, '1'))
        .catch(error => {
          console.error('Failed to play next track on Varese:', error);
        });
    }
  }, [queue, currentTrack, shuffle, repeat]);

  const previous = useCallback(() => {
    if (currentTime > 3) {
      setCurrentTime(0);
      // Seek to beginning on the renderer (fire-and-forget)
      upnpClient.seek(VARESE_AVTRANSPORT_URL, 0, 'REL_TIME', '00:00:00').catch(e => {
        console.error('Failed to seek:', e);
      });
      return;
    }
    if (queue.length === 0) return;
    const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
    const prevIndex = currentIndex <= 0 ? queue.length - 1 : currentIndex - 1;
    const prevTrack = queue[prevIndex];
    setCurrentTrack(prevTrack);
    setCurrentTime(0);
    
    // Send UPNP commands for the previous track (fire-and-forget)
    if (prevTrack?.uri) {
      upnpClient.setAVTransportURI(VARESE_AVTRANSPORT_URL, 0, prevTrack.uri, prevTrack.metadata || '')
        .then(() => upnpClient.play(VARESE_AVTRANSPORT_URL, 0, '1'))
        .catch(error => {
          console.error('Failed to play previous track on Varese:', error);
        });
    }
  }, [queue, currentTrack, currentTime]);

  const seek = useCallback((time: number) => {
    setCurrentTime(time);
    // Convert seconds to HH:MM:SS format for UPNP
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = Math.floor(time % 60);
    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    // Fire-and-forget seek command
    upnpClient.seek(VARESE_AVTRANSPORT_URL, 0, 'REL_TIME', timeString).catch(error => {
      console.error('Failed to seek on Varese:', error);
    });
  }, []);

  const setVolume = useCallback((vol: number) => {
    const clampedVol = Math.max(0, Math.min(1, vol));
    setVolumeState(clampedVol); // UI updates immediately
    
    // Store latest value
    pendingVolumeRef.current = clampedVol;
    
    // Cancel pending request to avoid flooding
    if (volumeTimeoutRef.current) {
      clearTimeout(volumeTimeoutRef.current);
    }
    
    // Send after 50ms of no movement (prevents flooding while feeling instant)
    volumeTimeoutRef.current = setTimeout(() => {
      const finalVol = pendingVolumeRef.current;
      if (finalVol === null) return;
      
      const volumePercent = Math.round(finalVol * 100);
      pendingVolumeRef.current = null;
      
      upnpClient.setVolume(VARESE_RENDERINGCONTROL_URL, 0, 'Master', volumePercent)
        .catch(() => {}); // Silently ignore - UI already updated
    }, 50);
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
  
  // Debounce volume changes
  const volumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVolumeRef = useRef<number | null>(null);
  
  const playTrack = useCallback(async (track: Track, tracks?: Track[]) => {
    if (isPlayingRef.current) {
      console.log('Play already in progress, ignoring duplicate call');
      return;
    }
    
    const trackId = track.id || track.uri || null;
    if (lastPlayedTrackIdRef.current === trackId) {
      console.log('Same track requested again, ignoring');
      return;
    }
    
    isPlayingRef.current = true;
    lastPlayedTrackIdRef.current = trackId;
    
    setTimeout(() => {
      lastPlayedTrackIdRef.current = null;
    }, 1000);
    
    if (tracks) {
      setQueue(tracks);
    }
    setCurrentTrack(track);
    setCurrentTime(0);
    setIsPlaying(true);
    
    if (track.uri) {
      console.log('=== PLAYING TRACK ===');
      console.log('Track title:', track.title);
      console.log('Track URI:', track.uri);
      
      // Send with minimal metadata to reduce request size and improve reliability
      // The Varese may be choking on large DIDL-Lite metadata
      const minimalMetadata = track.title ? 
        `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/"><item><dc:title>${track.title}</dc:title></item></DIDL-Lite>` : '';
      
      upnpClient.setAVTransportURI(
        VARESE_AVTRANSPORT_URL, 
        0, 
        track.uri, 
        minimalMetadata
      ).then((setResult) => {
        if (!setResult.success) {
          console.error('SetAVTransportURI failed:', setResult.error);
          throw new Error(setResult.error || 'SetAVTransportURI failed');
        }
        console.log('SetAVTransportURI succeeded, sending Play command...');
        return upnpClient.play(VARESE_AVTRANSPORT_URL, 0, '1');
      }).then(() => {
        console.log('=== PLAY COMMAND SENT SUCCESSFULLY ===');
        // Sync with Varese after a delay to get correct duration
        setTimeout(() => {
          syncTransportState();
        }, 2000);
      }).catch((error) => {
        console.error('Playback error (may still be playing):', error);
        // Don't revert isPlaying - Varese may have received the command
      }).finally(() => {
        isPlayingRef.current = false;
      });
    } else {
      console.warn('Track has no URI, cannot play on renderer');
      setIsPlaying(false);
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
        bridgeUrl,
        bridgeConnected,
        discoveredRenderers,
        setBridgeUrl,
        refreshBridgeDevices: () => refreshBridgeDevices(),
        syncTransportState,
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
