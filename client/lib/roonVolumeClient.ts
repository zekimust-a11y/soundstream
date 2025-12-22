/**
 * Roon Volume Control Client
 * 
 * Provides client-side interface for controlling Roon volume via the server API.
 * This client communicates with the server's Roon volume control service.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debugLog } from './debugLog';

const ROON_CONFIG_KEY = '@soundstream_roon_config';
const ROON_OUTPUT_KEY = '@soundstream_roon_output';

interface RoonConfig {
  enabled: boolean;
  outputId?: string;
}

interface RoonOutput {
  output_id: string;
  zone_id: string;
  display_name: string;
  volume_supported: boolean;
}

function getApiUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN || 'localhost:3000';
  const protocol = Platform.OS === 'web' ? window.location.protocol : 'http:';
  return `${protocol}//${domain}`;
}

class RoonVolumeClient {
  private config: RoonConfig | null = null;
  private currentOutputId: string | null = null;
  private currentVolume: number = 50;
  private isReady: boolean = false;

  /**
   * Load configuration from storage
   */
  async loadConfig(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(ROON_CONFIG_KEY);
      if (stored) {
        this.config = JSON.parse(stored);
        debugLog.info('Roon config loaded', JSON.stringify(this.config));
      }

      const storedOutput = await AsyncStorage.getItem(ROON_OUTPUT_KEY);
      if (storedOutput) {
        this.currentOutputId = storedOutput;
        debugLog.info('Roon output loaded', this.currentOutputId);
      }
    } catch (e) {
      debugLog.error('Failed to load Roon config', e instanceof Error ? e.message : String(e));
      this.config = null;
    }
  }

  /**
   * Save configuration to storage
   */
  private async saveConfig(): Promise<void> {
    if (this.config) {
      try {
        await AsyncStorage.setItem(ROON_CONFIG_KEY, JSON.stringify(this.config));
      } catch (e) {
        debugLog.error('Failed to save Roon config', e instanceof Error ? e.message : String(e));
      }
    }
  }

  /**
   * Enable/disable Roon volume control
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (!this.config) {
      this.config = { enabled };
    } else {
      this.config.enabled = enabled;
    }
    await this.saveConfig();
    debugLog.info('Roon volume control', enabled ? 'enabled' : 'disabled');
  }

  /**
   * Check if Roon volume control is enabled
   */
  isEnabled(): boolean {
    return this.config?.enabled === true;
  }

  /**
   * Check if Roon volume control is configured and ready
   */
  isConfigured(): boolean {
    const configured = this.isEnabled() && this.isReady;
    if (this.isEnabled() && !this.isReady) {
      // If enabled but not ready, try to check status again
      this.checkStatus().catch(() => {
        // Silently fail - will be checked again on next volume change
      });
    }
    return configured;
  }

  /**
   * Get connection status and available outputs
   */
  async checkStatus(): Promise<{ connected: boolean; outputs: RoonOutput[]; currentOutput: string | null; currentOutputName?: string | null }> {
    const apiUrl = getApiUrl();
    
    try {
      const response = await fetch(`${apiUrl}/api/roon/status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success) {
        this.isReady = data.connected && data.currentOutput !== null;
        this.currentOutputId = data.currentOutput;
        
        // If we have a saved output ID but it's not selected, try to select it
        if (this.currentOutputId && data.outputs.length > 0) {
          const savedOutput = await AsyncStorage.getItem(ROON_OUTPUT_KEY);
          if (savedOutput && savedOutput !== this.currentOutputId) {
            // Try to set the saved output
            await this.setOutput(savedOutput);
          }
        }
        
        return {
          connected: data.connected,
          outputs: data.outputs || [],
          currentOutput: data.currentOutput,
          currentOutputName: data.currentOutputName || null,
        };
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      this.isReady = false;
      debugLog.error('Roon status check failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Set the output to control
   */
  async setOutput(outputId: string): Promise<void> {
    const apiUrl = getApiUrl();
    
    try {
      const response = await fetch(`${apiUrl}/api/roon/output`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ output_id: outputId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success) {
        this.currentOutputId = outputId;
        await AsyncStorage.setItem(ROON_OUTPUT_KEY, outputId);
        debugLog.info('Roon output set', outputId);
      } else {
        throw new Error(data.error || 'Failed to set output');
      }
    } catch (error) {
      debugLog.error('Failed to set Roon output', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Get current volume (0-100)
   */
  async getVolume(): Promise<number> {
    if (!this.isEnabled()) {
      throw new Error('Roon volume control not enabled');
    }

    const apiUrl = getApiUrl();
    
    try {
      const response = await fetch(`${apiUrl}/api/roon/volume?action=get`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && typeof data.volume === 'number') {
        this.currentVolume = data.volume;
        debugLog.response('Roon GetVolume', `${data.volume}%`);
        return data.volume;
      } else {
        throw new Error(data.error || 'Invalid response');
      }
    } catch (error) {
      debugLog.error('Roon GetVolume failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Set volume (0-100)
   */
  async setVolume(volume: number): Promise<void> {
    if (!this.isEnabled()) {
      throw new Error('Roon volume control not enabled');
    }

    const clampedVolume = Math.max(0, Math.min(100, Math.round(volume)));
    const apiUrl = getApiUrl();
    
    try {
      debugLog.request('Roon SetVolume', `${clampedVolume}%`);
      
      const response = await fetch(`${apiUrl}/api/roon/volume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'set',
          value: clampedVolume,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success) {
        this.currentVolume = clampedVolume;
        debugLog.response('Roon SetVolume', `${clampedVolume}% OK`);
      } else {
        throw new Error(data.error || 'Failed to set volume');
      }
    } catch (error) {
      debugLog.error('Roon SetVolume failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Volume up by step
   */
  async volumeUp(step: number = 2): Promise<number> {
    const newVolume = Math.min(100, this.currentVolume + step);
    await this.setVolume(newVolume);
    return newVolume;
  }

  /**
   * Volume down by step
   */
  async volumeDown(step: number = 2): Promise<number> {
    const newVolume = Math.max(0, this.currentVolume - step);
    await this.setVolume(newVolume);
    return newVolume;
  }

  /**
   * Clear configuration
   */
  clearConfig(): void {
    this.config = null;
    this.currentOutputId = null;
    this.isReady = false;
    this.currentVolume = 50;
    AsyncStorage.removeItem(ROON_CONFIG_KEY).catch(() => {});
    AsyncStorage.removeItem(ROON_OUTPUT_KEY).catch(() => {});
    debugLog.info('Roon config cleared');
  }

  /**
   * Get current output ID
   */
  getCurrentOutputId(): string | null {
    return this.currentOutputId;
  }

  /**
   * Get current volume (cached)
   */
  getCurrentVolume(): number {
    return this.currentVolume;
  }
}

export const roonVolumeClient = new RoonVolumeClient();
export default roonVolumeClient;

