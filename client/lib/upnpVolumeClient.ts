import { debugLog } from './debugLog';

interface UpnpDevice {
  ip: string;
  port: number;
  name?: string;
}

// Common UPnP control paths to try
const CONTROL_PATHS = [
  '/RenderingControl/control',
  '/upnp/control/RenderingControl',
  '/ctl/RenderingControl',
  '/RenderingControl/ctrl',
  '/MediaRenderer/RenderingControl/Control',
];

class UpnpVolumeClient {
  private device: UpnpDevice | null = null;
  private currentVolume: number = 50;
  private workingPath: string | null = null;

  setDevice(ip: string, port: number = 16500, name?: string): void {
    this.device = { ip, port, name };
    this.workingPath = null; // Reset working path when device changes
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

  private parseVolumeFromResponse(xml: string): number | null {
    const match = xml.match(/<CurrentVolume>([^<]+)<\/CurrentVolume>/i);
    if (match) {
      const value = match[1].trim();
      const num = parseFloat(value);
      if (!isNaN(num)) {
        if (num <= 0 && num >= -80) {
          const percent = Math.round(((num + 80) / 80) * 100);
          debugLog.info('Volume parsed', `${value}dB = ${percent}%`);
          return percent;
        }
        return Math.round(Math.max(0, Math.min(100, num)));
      }
    }
    return null;
  }

  private percentToDb(percent: number): string {
    const clamped = Math.max(0, Math.min(100, percent));
    const db = ((clamped / 100) * 80) - 80;
    return db.toFixed(1);
  }

  private async tryRequest(path: string, soapBody: string, action: string): Promise<Response> {
    const url = `http://${this.device!.ip}:${this.device!.port}${path}`;
    debugLog.request(`UPnP ${action}`, url);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'SOAPAction': `"urn:schemas-upnp-org:service:RenderingControl:1#${action}"`,
        },
        body: soapBody,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  async getVolume(): Promise<number> {
    if (!this.device) {
      throw new Error('UPnP device not configured');
    }

    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
    </u:GetVolume>
  </s:Body>
</s:Envelope>`;

    // If we have a working path, try it first
    const pathsToTry = this.workingPath 
      ? [this.workingPath, ...CONTROL_PATHS.filter(p => p !== this.workingPath)]
      : CONTROL_PATHS;

    for (const path of pathsToTry) {
      try {
        const response = await this.tryRequest(path, soapBody, 'GetVolume');

        if (!response.ok) {
          debugLog.info('UPnP path failed', `${path} -> HTTP ${response.status}`);
          continue;
        }

        const xml = await response.text();
        debugLog.response('UPnP GetVolume raw', xml.substring(0, 200));
        
        const volumeValue = this.parseVolumeFromResponse(xml);
        
        if (volumeValue !== null) {
          this.workingPath = path; // Remember working path
          this.currentVolume = volumeValue;
          debugLog.response('UPnP GetVolume', `${volumeValue}% (path: ${path})`);
          return volumeValue;
        }
      } catch (error) {
        debugLog.info('UPnP path error', `${path} -> ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }
    
    debugLog.error('UPnP GetVolume', 'All paths failed');
    throw new Error('Could not connect to DAC - all UPnP paths failed');
  }

  async setVolume(volume: number): Promise<void> {
    if (!this.device) {
      throw new Error('UPnP device not configured');
    }

    const clampedVolume = Math.max(0, Math.min(100, Math.round(volume)));
    const dbValue = this.percentToDb(clampedVolume);

    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredVolume>${dbValue}</DesiredVolume>
    </u:SetVolume>
  </s:Body>
</s:Envelope>`;

    // If we have a working path, use it; otherwise try all paths
    const pathsToTry = this.workingPath 
      ? [this.workingPath]
      : CONTROL_PATHS;

    for (const path of pathsToTry) {
      try {
        debugLog.request('UPnP SetVolume', `${path} -> ${clampedVolume}% (${dbValue}dB)`);
        const response = await this.tryRequest(path, soapBody, 'SetVolume');

        if (!response.ok) {
          const text = await response.text();
          debugLog.error('UPnP SetVolume response', text.substring(0, 200));
          continue;
        }

        this.workingPath = path;
        this.currentVolume = clampedVolume;
        debugLog.response('UPnP SetVolume', `${clampedVolume}% OK (path: ${path})`);
        return;
      } catch (error) {
        debugLog.info('UPnP SetVolume path error', `${path} -> ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }

    throw new Error('Could not set volume - all UPnP paths failed');
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

    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetMute xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredMute>1</DesiredMute>
    </u:SetMute>
  </s:Body>
</s:Envelope>`;

    const path = this.workingPath || CONTROL_PATHS[0];
    try {
      await this.tryRequest(path, soapBody, 'SetMute');
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

    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetMute xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredMute>0</DesiredMute>
    </u:SetMute>
  </s:Body>
</s:Envelope>`;

    const path = this.workingPath || CONTROL_PATHS[0];
    try {
      await this.tryRequest(path, soapBody, 'SetMute');
      debugLog.request('UPnP Mute', 'OFF');
    } catch (error) {
      debugLog.error('UPnP Unmute failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  getWorkingPath(): string | null {
    return this.workingPath;
  }
}

export const upnpVolumeClient = new UpnpVolumeClient();
export default upnpVolumeClient;
