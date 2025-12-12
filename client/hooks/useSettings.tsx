import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SETTINGS_KEY = "@soundstream_settings";

interface Settings {
  gapless: boolean;
  crossfade: boolean;
  normalization: boolean;
  hardwareVolumeControl: boolean;
  streamingQuality: "cd" | "hires";
  chromecastIp: string;
}

interface SettingsContextType extends Settings {
  setGapless: (value: boolean) => void;
  setCrossfade: (value: boolean) => void;
  setNormalization: (value: boolean) => void;
  setHardwareVolumeControl: (value: boolean) => void;
  setStreamingQuality: (value: "cd" | "hires") => void;
  setChromecastIp: (value: string) => void;
  isLoaded: boolean;
}

const defaultSettings: Settings = {
  gapless: true,
  crossfade: false,
  normalization: false,
  hardwareVolumeControl: false,
  streamingQuality: "hires",
  chromecastIp: "",
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
          streamingQuality: parsed.streamingQuality ?? defaultSettings.streamingQuality,
          chromecastIp: parsed.chromecastIp ?? defaultSettings.chromecastIp,
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

  const setStreamingQuality = useCallback((value: "cd" | "hires") => {
    setSettings(prev => ({ ...prev, streamingQuality: value }));
  }, []);

  const setChromecastIp = useCallback((value: string) => {
    setSettings(prev => ({ ...prev, chromecastIp: value }));
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        ...settings,
        setGapless,
        setCrossfade,
        setNormalization,
        setHardwareVolumeControl,
        setStreamingQuality,
        setChromecastIp,
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
