import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';

export interface DiscoveredDevice {
  id: string;
  name: string;
  type: 'mediaServer' | 'mediaRenderer' | 'unknown';
  location: string;
  host: string;
  port: number;
  services: ServiceInfo[];
  rawHeaders: Record<string, string>;
}

export interface ServiceInfo {
  serviceType: string;
  serviceId: string;
  controlURL: string;
  eventSubURL: string;
  SCPDURL: string;
}

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;

const SEARCH_TARGETS = [
  'ssdp:all',
  'urn:schemas-upnp-org:device:MediaServer:1',
  'urn:schemas-upnp-org:device:MediaRenderer:1',
  'urn:schemas-upnp-org:service:ContentDirectory:1',
  'urn:schemas-upnp-org:service:AVTransport:1',
];

const parseDeviceDescription = async (location: string): Promise<Partial<DiscoveredDevice> | null> => {
  try {
    console.log('Fetching device description from:', location);
    const response = await fetch(location, {
      method: 'GET',
      headers: {
        'Accept': 'text/xml, application/xml',
      },
    });
    
    if (!response.ok) {
      console.log('Device description fetch failed:', response.status);
      return null;
    }
    
    const xml = await response.text();
    console.log('Device description XML preview:', xml.substring(0, 500));
    
    const friendlyNameMatch = xml.match(/<friendlyName>([^<]+)<\/friendlyName>/);
    const deviceTypeMatch = xml.match(/<deviceType>([^<]+)<\/deviceType>/);
    
    const services: ServiceInfo[] = [];
    const serviceMatches = xml.matchAll(/<service>[\s\S]*?<\/service>/g);
    
    for (const match of serviceMatches) {
      const serviceXml = match[0];
      const serviceType = serviceXml.match(/<serviceType>([^<]+)<\/serviceType>/)?.[1] || '';
      const serviceId = serviceXml.match(/<serviceId>([^<]+)<\/serviceId>/)?.[1] || '';
      const controlURL = serviceXml.match(/<controlURL>([^<]+)<\/controlURL>/)?.[1] || '';
      const eventSubURL = serviceXml.match(/<eventSubURL>([^<]+)<\/eventSubURL>/)?.[1] || '';
      const SCPDURL = serviceXml.match(/<SCPDURL>([^<]+)<\/SCPDURL>/)?.[1] || '';
      
      if (serviceType) {
        services.push({ serviceType, serviceId, controlURL, eventSubURL, SCPDURL });
      }
    }
    
    let type: 'mediaServer' | 'mediaRenderer' | 'unknown' = 'unknown';
    const deviceType = deviceTypeMatch?.[1] || '';
    if (deviceType.includes('MediaServer')) {
      type = 'mediaServer';
    } else if (deviceType.includes('MediaRenderer')) {
      type = 'mediaRenderer';
    }
    
    return {
      name: friendlyNameMatch?.[1] || 'Unknown Device',
      type,
      services,
    };
  } catch (error) {
    console.error('Failed to parse device description:', error);
    return null;
  }
};

const DISCOVERY_TIMEOUT = 10000;

export function useSsdpDiscovery() {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const socketRef = useRef<any>(null);
  const discoveredLocationsRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  
  const parseLocation = (location: string): { host: string; port: number } | null => {
    try {
      const url = new URL(location);
      return {
        host: url.hostname,
        port: parseInt(url.port) || 80,
      };
    } catch {
      return null;
    }
  };
  
  const handleSsdpResponse = useCallback(async (data: Buffer, rinfo: { address: string; port: number }) => {
    try {
      const message = data.toString();
      console.log('SSDP Response from:', rinfo.address, ':', rinfo.port);
      console.log('SSDP Message preview:', message.substring(0, 300));
      
      const headers: Record<string, string> = {};
      const lines = message.split('\r\n');
      
      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim().toUpperCase();
          const value = line.substring(colonIndex + 1).trim();
          headers[key] = value;
        }
      }
      
      const location = headers['LOCATION'];
      if (!location || discoveredLocationsRef.current.has(location)) {
        return;
      }
      
      discoveredLocationsRef.current.add(location);
      console.log('New device discovered at:', location);
      
      const parsed = parseLocation(location);
      if (!parsed) return;
      
      const deviceInfo = await parseDeviceDescription(location);
      if (!deviceInfo) return;
      
      const device: DiscoveredDevice = {
        id: location,
        name: deviceInfo.name || 'Unknown Device',
        type: deviceInfo.type || 'unknown',
        location,
        host: parsed.host,
        port: parsed.port,
        services: deviceInfo.services || [],
        rawHeaders: headers,
      };
      
      console.log('Discovered device:', device.name, 'Type:', device.type, 'Services:', device.services.length);
      
      setDevices(prev => {
        const exists = prev.some(d => d.id === device.id);
        if (exists) return prev;
        return [...prev, device];
      });
    } catch (err) {
      console.error('Error handling SSDP response:', err);
    }
  }, []);
  
  const startDiscovery = useCallback(async () => {
    if (Platform.OS === 'web') {
      setError('SSDP discovery is not available on web. Please use Expo Go or a development build on your mobile device.');
      return;
    }
    
    setIsDiscovering(true);
    setError(null);
    discoveredLocationsRef.current.clear();
    setDevices([]);
    
    try {
      const dgram = require('react-native-udp');
      const Buffer = require('buffer').Buffer;
      
      const socket = dgram.createSocket({ type: 'udp4' });
      socketRef.current = socket;
      
      socket.on('error', (err: Error) => {
        console.error('SSDP socket error:', err);
        setError(`Discovery error: ${err.message}`);
        setIsDiscovering(false);
      });
      
      socket.on('message', (msg: Buffer, rinfo: { address: string; port: number }) => {
        handleSsdpResponse(msg, rinfo);
      });
      
      socket.bind(0, () => {
        console.log('SSDP socket bound, starting discovery...');
        
        for (const target of SEARCH_TARGETS) {
          const searchMessage = Buffer.from(
            'M-SEARCH * HTTP/1.1\r\n' +
            `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\n` +
            'MAN: "ssdp:discover"\r\n' +
            'MX: 3\r\n' +
            `ST: ${target}\r\n` +
            '\r\n'
          );
          
          socket.send(
            searchMessage,
            0,
            searchMessage.length,
            SSDP_PORT,
            SSDP_ADDRESS,
            (err: Error | null) => {
              if (err) {
                console.error('Failed to send SSDP search:', err);
              } else {
                console.log('Sent SSDP M-SEARCH for:', target);
              }
            }
          );
        }
      });
      
      setTimeRemaining(Math.ceil(DISCOVERY_TIMEOUT / 1000));
      countdownRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      timerRef.current = setTimeout(() => {
        console.log('Discovery period ended');
        setIsDiscovering(false);
        if (countdownRef.current) clearInterval(countdownRef.current);
        setTimeRemaining(0);
      }, DISCOVERY_TIMEOUT);
      
    } catch (err) {
      console.error('Failed to start SSDP discovery:', err);
      setError(`Failed to start discovery: ${err instanceof Error ? err.message : String(err)}`);
      setIsDiscovering(false);
    }
  }, [handleSsdpResponse]);
  
  const stopDiscovery = useCallback(() => {
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch (e) {
        console.log('Error closing socket:', e);
      }
      socketRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setIsDiscovering(false);
    setTimeRemaining(0);
  }, []);
  
  useEffect(() => {
    return () => {
      stopDiscovery();
    };
  }, [stopDiscovery]);
  
  const getMediaServers = useCallback(() => {
    return devices.filter(d => d.type === 'mediaServer');
  }, [devices]);
  
  const getMediaRenderers = useCallback(() => {
    return devices.filter(d => d.type === 'mediaRenderer');
  }, [devices]);
  
  const getContentDirectoryUrl = useCallback((device: DiscoveredDevice): string | null => {
    const cdService = device.services.find(s => 
      s.serviceType.includes('ContentDirectory')
    );
    
    if (!cdService) return null;
    
    let controlURL = cdService.controlURL;
    if (controlURL.startsWith('/')) {
      controlURL = `http://${device.host}:${device.port}${controlURL}`;
    } else if (!controlURL.startsWith('http')) {
      controlURL = `http://${device.host}:${device.port}/${controlURL}`;
    }
    
    return controlURL;
  }, []);
  
  const getAVTransportUrl = useCallback((device: DiscoveredDevice): string | null => {
    const avService = device.services.find(s => 
      s.serviceType.includes('AVTransport')
    );
    
    if (!avService) return null;
    
    let controlURL = avService.controlURL;
    if (controlURL.startsWith('/')) {
      controlURL = `http://${device.host}:${device.port}${controlURL}`;
    } else if (!controlURL.startsWith('http')) {
      controlURL = `http://${device.host}:${device.port}/${controlURL}`;
    }
    
    return controlURL;
  }, []);
  
  return {
    devices,
    isDiscovering,
    error,
    timeRemaining,
    startDiscovery,
    stopDiscovery,
    getMediaServers,
    getMediaRenderers,
    getContentDirectoryUrl,
    getAVTransportUrl,
  };
}
