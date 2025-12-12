import { debugLog } from './debugLog';
import { getApiUrl } from './query-client';

interface UpnpDevice {
  ip: string;
  port: number;
  name?: string;
}

class UpnpVolumeClient {
  private device: UpnpDevice | null = null;
  private currentVolume: number = 50;

  setDevice(ip: string, port: number = 80, name?: string): void {
    this.device = { ip, port, name };
    debugLog.info('UPnP device set', `${ip}:${port} (${name || 'Unknown'})`);
  }

  clearDevice(): void {
    this.device = null;
    debugLog.info('UPnP device cleared');
  }

  isConfigured(): boolean {
    return this.device !== null;
  }

  getDevice(): UpnpDevice | null {
    return this.device;
  }

  async getVolume(): Promise<number> {
    if (!this.device) {
      throw new Error('UPnP device not configured');
    }

    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/upnp/volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get',
          ip: this.device.ip,
          port: this.device.port,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      this.currentVolume = data.volume;
      debugLog.response('UPnP GetVolume', `${data.volume}%`);
      return data.volume;
    } catch (error) {
      debugLog.error('UPnP GetVolume failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async setVolume(volume: number): Promise<void> {
    if (!this.device) {
      throw new Error('UPnP device not configured');
    }

    const clampedVolume = Math.max(0, Math.min(100, Math.round(volume)));
    
    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/upnp/volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set',
          ip: this.device.ip,
          port: this.device.port,
          volume: clampedVolume,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      this.currentVolume = clampedVolume;
      debugLog.request('UPnP SetVolume', `${clampedVolume}%`);
    } catch (error) {
      debugLog.error('UPnP SetVolume failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async volumeUp(step: number = 2): Promise<number> {
    const newVolume = Math.min(100, this.currentVolume + step);
    await this.setVolume(newVolume);
    return newVolume;
  }

  async volumeDown(step: number = 2): Promise<number> {
    const newVolume = Math.max(0, this.currentVolume - step);
    await this.setVolume(newVolume);
    return newVolume;
  }

  async mute(): Promise<void> {
    if (!this.device) {
      throw new Error('UPnP device not configured');
    }

    try {
      const apiUrl = getApiUrl();
      await fetch(`${apiUrl}/api/upnp/volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mute',
          ip: this.device.ip,
          port: this.device.port,
          mute: true,
        }),
      });
      debugLog.request('UPnP Mute', 'ON');
    } catch (error) {
      debugLog.error('UPnP Mute failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async unmute(): Promise<void> {
    if (!this.device) {
      throw new Error('UPnP device not configured');
    }

    try {
      const apiUrl = getApiUrl();
      await fetch(`${apiUrl}/api/upnp/volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mute',
          ip: this.device.ip,
          port: this.device.port,
          mute: false,
        }),
      });
      debugLog.request('UPnP Mute', 'OFF');
    } catch (error) {
      debugLog.error('UPnP Unmute failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

export const upnpVolumeClient = new UpnpVolumeClient();
export default upnpVolumeClient;
