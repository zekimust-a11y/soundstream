import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SETTINGS_KEY = "@soundstream_settings";

interface Settings {
  gapless: boolean;
  crossfade: boolean;
  normalization: boolean;
  hardwareVolumeControl: boolean;
  chromecastIp: string;
  chromecastEnabled: boolean;
  qobuzEnabled: boolean;
  tidalEnabled: boolean;
  soundcloudEnabled: boolean;
  spotifyEnabled: boolean;
  localLibraryEnabled: boolean;
}

interface SettingsContextType extends Settings {
  setGapless: (value: boolean) => void;
  setCrossfade: (value: boolean) => void;
  setNormalization: (value: boolean) => void;
  setHardwareVolumeControl: (value: boolean) => void;
  setChromecastIp: (value: string) => void;
  setChromecastEnabled: (value: boolean) => void;
  setQobuzEnabled: (value: boolean) => void;
  setTidalEnabled: (value: boolean) => void;
  setSoundcloudEnabled: (value: boolean) => void;
  setSpotifyEnabled: (value: boolean) => void;
  setLocalLibraryEnabled: (value: boolean) => void;
  isLoaded: boolean;
}

const defaultSettings: Settings = {
  gapless: true,
  crossfade: false,
  normalization: false,
  hardwareVolumeControl: false,
  chromecastIp: "",
  chromecastEnabled: false,
  qobuzEnabled: true,
  tidalEnabled: true,
  soundcloudEnabled: true,
  spotifyEnabled: true,
  localLibraryEnabled: true,
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (isLoaded) {
      saveSettings();
    }
  }, [settings, isLoaded]);

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSettings({
          gapless: parsed.gapless ?? defaultSettings.gapless,
          crossfade: parsed.crossfade ?? defaultSettings.crossfade,
          normalization: parsed.normalization ?? defaultSettings.normalization,
          hardwareVolumeControl: parsed.hardwareVolumeControl ?? defaultSettings.hardwareVolumeControl,
          chromecastIp: parsed.chromecastIp ?? defaultSettings.chromecastIp,
          chromecastEnabled: parsed.chromecastEnabled ?? defaultSettings.chromecastEnabled,
          qobuzEnabled: parsed.qobuzEnabled ?? defaultSettings.qobuzEnabled,
          tidalEnabled: parsed.tidalEnabled ?? defaultSettings.tidalEnabled,
          soundcloudEnabled: parsed.soundcloudEnabled ?? defaultSettings.soundcloudEnabled,
          spotifyEnabled: parsed.spotifyEnabled ?? defaultSettings.spotifyEnabled,
          localLibraryEnabled: parsed.localLibraryEnabled ?? defaultSettings.localLibraryEnabled,
        });
      }
      setIsLoaded(true);
    } catch (e) {
      console.error("Failed to load settings:", e);
      setIsLoaded(true);
    }
  };

  const saveSettings = async () => {
    try {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  };

  const setGapless = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, gapless: value }));
  }, []);

  const setCrossfade = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, crossfade: value }));
  }, []);

  const setNormalization = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, normalization: value }));
  }, []);

  const setHardwareVolumeControl = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, hardwareVolumeControl: value }));
  }, []);

  const setChromecastIp = useCallback((value: string) => {
    setSettings(prev => ({ ...prev, chromecastIp: value }));
  }, []);

  const setChromecastEnabled = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, chromecastEnabled: value }));
  }, []);

  const setQobuzEnabled = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, qobuzEnabled: value }));
  }, []);

  const setTidalEnabled = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, tidalEnabled: value }));
  }, []);

  const setSoundcloudEnabled = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, soundcloudEnabled: value }));
  }, []);

  const setSpotifyEnabled = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, spotifyEnabled: value }));
  }, []);

  const setLocalLibraryEnabled = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, localLibraryEnabled: value }));
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        ...settings,
        setGapless,
        setCrossfade,
        setNormalization,
        setHardwareVolumeControl,
        setChromecastIp,
        setChromecastEnabled,
        setQobuzEnabled,
        setTidalEnabled,
        setSoundcloudEnabled,
        setSpotifyEnabled,
        setLocalLibraryEnabled,
        isLoaded,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
