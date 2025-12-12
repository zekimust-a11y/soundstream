import { debugLog } from './debugLog';

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

    try {
      const url = `http://${this.device.ip}:${this.device.port}/RenderingControl/ctrl`;
      debugLog.request('UPnP GetVolume', url);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'SOAPAction': '"urn:schemas-upnp-org:service:RenderingControl:1#GetVolume"',
        },
        body: soapBody,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const xml = await response.text();
      debugLog.response('UPnP GetVolume raw', xml.substring(0, 200));
      
      const volumeValue = this.parseVolumeFromResponse(xml);
      
      if (volumeValue !== null) {
        this.currentVolume = volumeValue;
        debugLog.response('UPnP GetVolume', `${volumeValue}%`);
        return volumeValue;
      }
      
      debugLog.error('UPnP GetVolume', 'Could not parse volume from response');
      return this.currentVolume;
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

    try {
      const url = `http://${this.device.ip}:${this.device.port}/RenderingControl/ctrl`;
      debugLog.request('UPnP SetVolume', `${url} -> ${clampedVolume}% (${dbValue}dB)`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'SOAPAction': '"urn:schemas-upnp-org:service:RenderingControl:1#SetVolume"',
        },
        body: soapBody,
      });

      if (!response.ok) {
        const text = await response.text();
        debugLog.error('UPnP SetVolume response', text.substring(0, 200));
        throw new Error(`HTTP ${response.status}`);
      }

      this.currentVolume = clampedVolume;
      debugLog.response('UPnP SetVolume', `${clampedVolume}% OK`);
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

    try {
      const url = `http://${this.device.ip}:${this.device.port}/RenderingControl/ctrl`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'SOAPAction': '"urn:schemas-upnp-org:service:RenderingControl:1#SetMute"',
        },
        body: soapBody,
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

    try {
      const url = `http://${this.device.ip}:${this.device.port}/RenderingControl/ctrl`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'SOAPAction': '"urn:schemas-upnp-org:service:RenderingControl:1#SetMute"',
        },
        body: soapBody,
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
