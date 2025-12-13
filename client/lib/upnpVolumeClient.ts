import { Platform } from 'react-native';
import { debugLog } from './debugLog';

interface UpnpDevice {
  ip: string;
  port: number;
  name?: string;
}

function getApiUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN || 'localhost:3000';
  const protocol = Platform.OS === 'web' ? window.location.protocol : 'http:';
  return `${protocol}//${domain}`;
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
    // Always use proxy endpoint for mobile (iOS/Android) to avoid network restrictions
    // Web can use proxy or direct, but proxy is more reliable
    if (Platform.OS !== 'web') {
      // Mobile: always use proxy
      return this.tryRequestViaProxy(action, soapBody);
    }
    
    // Web: try direct first, fall back to proxy
    const url = `http://${this.device!.ip}:${this.device!.port}${path}`;
    debugLog.request(`UPnP ${action} (direct)`, url);
    
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
      
      // If direct request fails, try proxy as fallback
      if (!response.ok) {
        debugLog.info('UPnP direct request failed', `HTTP ${response.status}, trying proxy`);
        return this.tryRequestViaProxy(action, soapBody);
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeout);
      // If direct request throws, try proxy as fallback
      debugLog.info('UPnP direct request error', error instanceof Error ? error.message : String(error));
      return this.tryRequestViaProxy(action, soapBody);
    }
  }

  private async tryRequestViaProxy(action: string, soapBody: string): Promise<Response> {
    const apiUrl = getApiUrl();
    const device = this.device!;
    
    debugLog.request(`UPnP ${action} (via proxy)`, `${apiUrl}/api/upnp/volume`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    try {
      const requestBody: any = {
        action: action === 'GetVolume' ? 'get' : action === 'SetVolume' ? 'set' : 'mute',
        ip: device.ip,
        port: device.port,
      };
      
      // For setVolume, include volume and useDbFormat for dCS DACs
      if (action === 'SetVolume') {
        const volume = this.parseVolumeFromRequest(soapBody);
        if (volume !== null) {
          requestBody.volume = volume;
          requestBody.useDbFormat = true; // dCS DACs use dB format
        }
      }
      
      const response = await fetch(`${apiUrl}/api/upnp/volume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  private parseVolumeFromRequest(soapBody: string): number | null {
    const match = soapBody.match(/<DesiredVolume>([^<]+)<\/DesiredVolume>/i);
    if (match) {
      const dbValue = parseFloat(match[1]);
      if (!isNaN(dbValue)) {
        // Convert dB back to percentage
        const percent = Math.round(((dbValue + 80) / 80) * 100);
        return Math.max(0, Math.min(100, percent));
      }
    }
    return null;
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

        // If using proxy, response is JSON
        if (response.headers.get('content-type')?.includes('application/json')) {
          const data = await response.json();
          if (data.success) {
            this.workingPath = path;
            this.currentVolume = clampedVolume;
            debugLog.response('UPnP SetVolume', `${clampedVolume}% OK (via proxy)`);
            return;
          }
        } else {
          // Direct request - assume success if response is OK
          this.workingPath = path;
          this.currentVolume = clampedVolume;
          debugLog.response('UPnP SetVolume', `${clampedVolume}% OK (path: ${path})`);
          return;
        }
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

  /**
   * Query UPnP device capabilities to get supported audio formats
   * Uses ContentDirectory service GetProtocolInfo
   */
  async getSupportedFormats(): Promise<string[]> {
    if (!this.device) {
      throw new Error('UPnP device not configured');
    }

    // Try to get device description first to find ContentDirectory service
    try {
      const deviceUrl = `http://${this.device.ip}:${this.device.port}/description.xml`;
      const descResponse = await fetch(deviceUrl, { signal: AbortSignal.timeout(5000) });
      const descXml = await descResponse.text();
      
      // Parse device description to find ContentDirectory service URL
      const serviceMatch = descXml.match(/<serviceType>urn:schemas-upnp-org:service:ContentDirectory:1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/i);
      if (serviceMatch) {
        const controlUrl = serviceMatch[1];
        
        const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetProtocolInfo xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
    </u:GetProtocolInfo>
  </s:Body>
</s:Envelope>`;

        const url = `http://${this.device.ip}:${this.device.port}${controlUrl}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset="utf-8"',
            'SOAPAction': '"urn:schemas-upnp-org:service:ContentDirectory:1#GetProtocolInfo"',
          },
          body: soapBody,
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const xml = await response.text();
          // Parse SourceProtocolInfo or SinkProtocolInfo
          const protocolMatch = xml.match(/<SinkProtocolInfo>([^<]+)<\/SinkProtocolInfo>/i) || 
                               xml.match(/<SourceProtocolInfo>([^<]+)<\/SourceProtocolInfo>/i);
          if (protocolMatch) {
            const protocols = protocolMatch[1].split(',').map(p => p.trim());
            debugLog.info('UPnP supported formats', protocols.join(', '));
            return protocols;
          }
        }
      }
    } catch (error) {
      debugLog.info('Could not query UPnP capabilities', error instanceof Error ? error.message : String(error));
    }

    // Fallback: return common formats that most DACs support
    // dCS Varese typically supports: FLAC, WAV, AIFF, PCM, MP3, AAC
    return [
      'http-get:*:audio/flac:*',
      'http-get:*:audio/x-flac:*',
      'http-get:*:audio/L16:*',
      'http-get:*:audio/L24:*',
      'http-get:*:audio/wav:*',
      'http-get:*:audio/x-wav:*',
      'http-get:*:audio/aiff:*',
      'http-get:*:audio/x-aiff:*',
      'http-get:*:audio/mpeg:*',
      'http-get:*:audio/mp4:*',
    ];
  }

  /**
   * Check if a format is supported by the DAC
   */
  async isFormatSupported(format: string, sampleRate?: string, bitDepth?: string): Promise<boolean> {
    try {
      const supportedFormats = await this.getSupportedFormats();
      
      const f = format.toUpperCase();
      let formatPattern = '';
      
      if (f.includes('FLAC')) {
        formatPattern = 'audio/flac';
      } else if (f.includes('WAV')) {
        formatPattern = 'audio/wav';
      } else if (f.includes('AIFF') || f.includes('AIF')) {
        formatPattern = 'audio/aiff';
      } else if (f.includes('MP3')) {
        formatPattern = 'audio/mpeg';
      } else if (f.includes('AAC') || f.includes('M4A')) {
        formatPattern = 'audio/mp4';
      } else if (f.includes('DSD') || f.includes('DSF')) {
        formatPattern = 'audio/dsd';
      } else if (f.includes('PCM')) {
        formatPattern = 'audio/L16';
      }
      
      if (!formatPattern) {
        // Unknown format - assume not supported to be safe
        return false;
      }
      
      // Check if any supported format matches
      const isSupported = supportedFormats.some(supported => 
        supported.toLowerCase().includes(formatPattern.toLowerCase())
      );
      
      // If format is supported, also check sample rate limits
      if (isSupported && sampleRate) {
        const rateStr = sampleRate.replace(/[^0-9.]/g, '');
        const rate = parseFloat(rateStr);
        const rateHz = sampleRate.toLowerCase().includes('khz') ? rate * 1000 : rate;
        
        // dCS Varese typically supports up to 192kHz, some models up to 384kHz
        // Check if any supported format mentions higher rates
        const maxRate = supportedFormats.some(s => s.includes('384')) ? 384000 :
                       supportedFormats.some(s => s.includes('192')) ? 192000 : 192000;
        
        if (rateHz > maxRate) {
          return false;
        }
      }
      
      return isSupported;
    } catch (error) {
      debugLog.error('Error checking format support', error instanceof Error ? error.message : String(error));
      // On error, assume format is supported (don't force transcoding)
      return true;
    }
  }
}

export const upnpVolumeClient = new UpnpVolumeClient();
export default upnpVolumeClient;
