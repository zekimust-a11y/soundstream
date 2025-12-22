import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import dgram from "node:dgram";
import { initializeRelayServer } from "./relay-server.js";
import { initializeRelayServer } from "./relay-server.js";
import { TidalApiClient } from "./tidal-api-client.js";
import { TidalApiClient } from "./tidal-api-client.js";
import { TidalApiClient } from "./tidal-api-client.js";
// import { TidalApiClient } from "./tidal-api-client.js";

// Global Roon control instance (to avoid issues with dynamic imports)
let globalRoonControl: any = null;

// Global Tidal API client instance
// Global Tidal API client instance
let globalTidalClient: TidalApiClient | null = null;

// Global Tidal API client instance
// let globalTidalClient: TidalApiClient | null = null;

// SSDP discovery for UPnP/OpenHome devices
interface DiscoveredDevice {
  usn: string;
  location: string;
  server?: string;
  st?: string;
  friendlyName?: string;
  manufacturer?: string;
  modelName?: string;
  services: {
    avTransport?: string;
    renderingControl?: string;
    playlist?: string;
    product?: string;
    transport?: string;
    contentDirectory?: string;
  };
}

async function performSsdpDiscovery(searchTarget: string = 'ssdp:all', timeoutMs: number = 5000): Promise<DiscoveredDevice[]> {
  return new Promise((resolve) => {
    const devices: Map<string, DiscoveredDevice> = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    
    const SSDP_ADDRESS = '239.255.255.250';
    const SSDP_PORT = 1900;
    
    const searchMessage = Buffer.from([
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      'MX: 3',
      `ST: ${searchTarget}`,
      '',
      ''
    ].join('\r\n'));

    socket.on('message', (msg, rinfo) => {
      const response = msg.toString();
      const lines = response.split('\r\n');
      
      const headers: Record<string, string> = {};
      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.substring(0, colonIdx).trim().toLowerCase();
          const value = line.substring(colonIdx + 1).trim();
          headers[key] = value;
        }
      }
      
      const location = headers['location'];
      const usn = headers['usn'] || `${rinfo.address}:${rinfo.port}`;
      const server = headers['server'];
      const st = headers['st'];
      
      if (location) {
        const deviceKey = location;
        if (!devices.has(deviceKey)) {
          devices.set(deviceKey, {
            usn,
            location,
            server,
            st,
            services: {}
          });
          console.log(`[SSDP] Discovered device at ${location}`);
        }
      }
    });

    socket.on('error', (err) => {
      console.error('[SSDP] Socket error:', err.message);
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.setMulticastTTL(4);
      
      // Send multiple M-SEARCH requests for better discovery
      socket.send(searchMessage, 0, searchMessage.length, SSDP_PORT, SSDP_ADDRESS);
      
      // Send again after a short delay
      setTimeout(() => {
        socket.send(searchMessage, 0, searchMessage.length, SSDP_PORT, SSDP_ADDRESS);
      }, 500);
    });

    // Wait for responses then close
    setTimeout(() => {
      socket.close();
      resolve(Array.from(devices.values()));
    }, timeoutMs);
  });
}

async function fetchDeviceDescription(locationUrl: string): Promise<DiscoveredDevice | null> {
  try {
    console.log(`[SSDP] Fetching device description from: ${locationUrl}`);
    
    const response = await fetch(locationUrl, {
      headers: {
        'User-Agent': 'SoundStream/1.0 UPnP/1.0',
      },
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) {
      console.log(`[SSDP] Device description fetch failed: ${response.status}`);
      return null;
    }
    
    const xml = await response.text();
    console.log(`[SSDP] Got device description, length: ${xml.length}`);
    
    // Parse the URL to get base URL
    const url = new URL(locationUrl);
    const baseUrl = `${url.protocol}//${url.host}`;
    
    // Extract device info
    const friendlyNameMatch = xml.match(/<friendlyName>([^<]*)<\/friendlyName>/i);
    const manufacturerMatch = xml.match(/<manufacturer>([^<]*)<\/manufacturer>/i);
    const modelNameMatch = xml.match(/<modelName>([^<]*)<\/modelName>/i);
    
    const device: DiscoveredDevice = {
      usn: '',
      location: locationUrl,
      friendlyName: friendlyNameMatch?.[1],
      manufacturer: manufacturerMatch?.[1],
      modelName: modelNameMatch?.[1],
      services: {}
    };
    
    // Find all services
    const serviceRegex = /<service>([\s\S]*?)<\/service>/gi;
    let match;
    
    while ((match = serviceRegex.exec(xml)) !== null) {
      const serviceXml = match[1];
      
      const serviceTypeMatch = serviceXml.match(/<serviceType>([^<]+)<\/serviceType>/i);
      const controlURLMatch = serviceXml.match(/<controlURL>([^<]+)<\/controlURL>/i);
      
      if (serviceTypeMatch && controlURLMatch) {
        const serviceType = serviceTypeMatch[1];
        let controlURL = controlURLMatch[1];
        
        // Make absolute
        if (controlURL.startsWith('/')) {
          controlURL = baseUrl + controlURL;
        } else if (!controlURL.startsWith('http')) {
          controlURL = baseUrl + '/' + controlURL;
        }
        
        console.log(`[SSDP] Found service: ${serviceType} -> ${controlURL}`);
        
        if (serviceType.includes('AVTransport')) {
          device.services.avTransport = controlURL;
        } else if (serviceType.includes('RenderingControl')) {
          device.services.renderingControl = controlURL;
        } else if (serviceType.includes('ContentDirectory')) {
          device.services.contentDirectory = controlURL;
        } else if (serviceType.includes('Playlist') && serviceType.includes('openhome')) {
          device.services.playlist = controlURL;
        } else if (serviceType.includes('Product') && serviceType.includes('openhome')) {
          device.services.product = controlURL;
        } else if (serviceType.includes('Transport') && serviceType.includes('openhome')) {
          device.services.transport = controlURL;
        }
      }
    }
    
    return device;
  } catch (error) {
    console.error(`[SSDP] Error fetching device description:`, error);
    return null;
  }
}

interface BrowseResult {
  artists: Array<{
    id: string;
    name: string;
    albumCount?: number;
  }>;
  albums: Array<{
    id: string;
    name: string;
    artist: string;
    artistId: string;
    year?: number;
    trackCount?: number;
    imageUrl?: string;
  }>;
  tracks: Array<{
    id: string;
    title: string;
    artist: string;
    album: string;
    duration: number;
    trackNumber?: number;
    albumArt?: string;
    streamUrl?: string;
  }>;
}

interface SOAPResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

async function makeSOAPRequest(controlUrl: string, soapEnvelope: string): Promise<SOAPResponse> {
  console.log(`[UPNP] Making SOAP request to: ${controlUrl}`);
  
  const response = await globalThis.fetch(controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
      'User-Agent': 'SoundStream/1.0 UPnP/1.0',
    },
    body: soapEnvelope,
  });
  
  console.log(`[UPNP] Response status: ${response.status} from ${controlUrl}`);
  return response;
}

async function browseUPNPServer(host: string, port: number): Promise<BrowseResult> {
  const baseUrl = `http://${host}:${port}`;
  
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <ObjectID>0</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>0</StartingIndex>
      <RequestedCount>0</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`;

  const result: BrowseResult = { artists: [], albums: [], tracks: [] };
  
  const controlUrls = [
    `${baseUrl}/dev/srv0/ctl/ContentDirectory`,
    `${baseUrl}/ctl/ContentDirectory`,
    `${baseUrl}/ContentDirectory/control`,
    `${baseUrl}/upnp/control/content_dir`,
    `${baseUrl}/MediaServer/ContentDirectory/Control`,
  ];
  
  for (const controlUrl of controlUrls) {
    try {
      const response = await makeSOAPRequest(controlUrl, soapEnvelope);

      if (response.ok) {
        const text = await response.text();
        console.log(`[UPNP] Got successful response, length: ${text.length}`);
        return await parseUPNPResponse(text, baseUrl);
      } else {
        const errorText = await response.text();
        console.log(`[UPNP] Error response body: ${errorText.substring(0, 200)}`);
      }
    } catch (error) {
      console.log(`[UPNP] Error with ${controlUrl}:`, error);
      continue;
    }
  }
  
  console.log('[UPNP] All control URLs failed, trying web interface fallback');
  return await browseViaWebInterface(baseUrl);
}

async function browseViaWebInterface(baseUrl: string): Promise<BrowseResult> {
  const result: BrowseResult = { artists: [], albums: [], tracks: [] };
  
  try {
    const response = await fetch(`${baseUrl}/`);
    if (!response.ok) {
      throw new Error(`Web interface returned ${response.status}`);
    }
    
    const descResponse = await fetch(`${baseUrl}/dev/desc.xml`);
    if (descResponse.ok) {
      console.log('Found MinimServer description');
    }

    return result;
  } catch (error) {
    console.error('Web interface error:', error);
    return result;
  }
}

async function parseUPNPResponse(xml: string, baseUrl: string): Promise<BrowseResult> {
  const result: BrowseResult = { artists: [], albums: [], tracks: [] };
  
  const resultMatch = xml.match(/<Result[^>]*>([\s\S]*?)<\/Result>/i);
  if (!resultMatch) return result;
  
  let didl = resultMatch[1];
  didl = didl.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  
  const containerMatches = didl.matchAll(/<container[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/container>/gi);
  for (const match of containerMatches) {
    const id = match[1];
    const content = match[2];
    const titleMatch = content.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i);
    const classMatch = content.match(/<upnp:class[^>]*>([^<]*)<\/upnp:class>/i);
    
    if (titleMatch) {
      const title = titleMatch[1];
      const upnpClass = classMatch ? classMatch[1] : '';
      
      if (upnpClass.includes('musicArtist') || upnpClass.includes('person')) {
        result.artists.push({ id, name: title });
      } else if (upnpClass.includes('musicAlbum') || upnpClass.includes('album')) {
        const artistMatch = content.match(/<upnp:artist[^>]*>([^<]*)<\/upnp:artist>/i) ||
                           content.match(/<dc:creator[^>]*>([^<]*)<\/dc:creator>/i);
        const artMatch = content.match(/<upnp:albumArtURI[^>]*>([^<]*)<\/upnp:albumArtURI>/i);
        
        result.albums.push({
          id,
          name: title,
          artist: artistMatch ? artistMatch[1] : 'Unknown Artist',
          artistId: '',
          imageUrl: artMatch ? artMatch[1] : undefined,
        });
      }
    }
  }
  
  const itemMatches = didl.matchAll(/<item[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/item>/gi);
  for (const match of itemMatches) {
    const id = match[1];
    const content = match[2];
    const titleMatch = content.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i);
    const artistMatch = content.match(/<upnp:artist[^>]*>([^<]*)<\/upnp:artist>/i) ||
                       content.match(/<dc:creator[^>]*>([^<]*)<\/dc:creator>/i);
    const albumMatch = content.match(/<upnp:album[^>]*>([^<]*)<\/upnp:album>/i);
    const durationMatch = content.match(/<res[^>]*duration="([^"]*)"[^>]*>/i);
    const resMatch = content.match(/<res[^>]*>([^<]*)<\/res>/i);
    const artMatch = content.match(/<upnp:albumArtURI[^>]*>([^<]*)<\/upnp:albumArtURI>/i);
    
    if (titleMatch) {
      let duration = 0;
      if (durationMatch) {
        const parts = durationMatch[1].split(':');
        if (parts.length === 3) {
          duration = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
        }
      }
      
      result.tracks.push({
        id,
        title: titleMatch[1],
        artist: artistMatch ? artistMatch[1] : 'Unknown Artist',
        album: albumMatch ? albumMatch[1] : 'Unknown Album',
        duration: Math.round(duration),
        streamUrl: resMatch ? resMatch[1] : undefined,
        albumArt: artMatch ? artMatch[1] : undefined,
      });
    }
  }
  
  return result;
}

async function browseContainer(host: string, port: number, containerId: string): Promise<BrowseResult> {
  const baseUrl = `http://${host}:${port}`;
  
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <ObjectID>${containerId}</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>0</StartingIndex>
      <RequestedCount>0</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`;

  const controlUrls = [
    `${baseUrl}/dev/srv0/ctl/ContentDirectory`,
    `${baseUrl}/ctl/ContentDirectory`,
    `${baseUrl}/ContentDirectory/control`,
    `${baseUrl}/upnp/control/content_dir`,
    `${baseUrl}/MediaServer/ContentDirectory/Control`,
  ];

  for (const controlUrl of controlUrls) {
    try {
      const response = await makeSOAPRequest(controlUrl, soapEnvelope);

      if (response.ok) {
        const text = await response.text();
        return await parseUPNPResponse(text, baseUrl);
      }
    } catch (error) {
      continue;
    }
  }
  
  return { artists: [], albums: [], tracks: [] };
}

async function discoverServerContent(host: string, port: number): Promise<BrowseResult> {
  const allResults: BrowseResult = { artists: [], albums: [], tracks: [] };
  
  const rootContent = await browseUPNPServer(host, port);
  
  if (rootContent.artists.length > 0 || rootContent.albums.length > 0 || rootContent.tracks.length > 0) {
    return rootContent;
  }
  
  const commonContainerIds = ['0', '1', '2', '3', '64', '65', 'Music', 'Artists', 'Albums'];
  
  for (const containerId of commonContainerIds) {
    try {
      const content = await browseContainer(host, port, containerId);
      
      allResults.artists.push(...content.artists);
      allResults.albums.push(...content.albums);
      allResults.tracks.push(...content.tracks);
      
      for (const album of content.albums) {
        const albumContent = await browseContainer(host, port, album.id);
        allResults.tracks.push(...albumContent.tracks.map(t => ({
          ...t,
          album: album.name,
          artist: album.artist,
        })));
      }
      
      if (allResults.tracks.length > 0) break;
    } catch (error) {
      continue;
    }
  }
  
  return allResults;
}

export async function registerRoutes(app: Express): Promise<Server> {
  console.log('🚀 registerRoutes initialized from server/routes.ts');
  // Health check endpoint for proxy server availability
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      service: 'proxy-server',
      timestamp: new Date().toISOString()
    });
  });
  // Android Mosaic ACTUS Relay (optional - for dCS Varese volume control)
  if (process.env.ENABLE_ANDROID_MOSAIC_RELAY === 'true') {
    try {
      const { initializeAndroidMosaicRelay, registerAndroidMosaicRoutes } = await import('./android-mosaic-relay');
      const relay = initializeAndroidMosaicRelay({
        enabled: true,
        adbPath: process.env.ADB_PATH,
        emulatorSerial: process.env.ANDROID_DEVICE_SERIAL || 'emulator-5554',
        packageName: process.env.MOSAIC_PACKAGE_NAME, // Optional - will auto-detect
        volumeUpButton: { x: 540, y: 1146 },
        volumeDownButton: { x: 540, y: 1581 },
      });
      await relay.initialize();
      registerAndroidMosaicRoutes(app);
      console.log('[Server] Android Mosaic ACTUS relay enabled');
    } catch (error) {
      console.warn('[Server] Android Mosaic relay failed to initialize:', error);
    }
  }

  // LMS JSON-RPC proxy endpoint for Now Playing display
  // SECURITY: Only allows read-only 'status' command to prevent unauthorized control
      // Image proxy endpoint to bypass CORS issues
      app.get('/api/image/proxy', async (req: Request, res: Response) => {
        const { url } = req.query;

        if (!url || typeof url !== 'string') {
          return res.status(400).json({ error: 'Missing or invalid url parameter' });
        }

        try {
          // Only allow URLs from private networks for security
          const urlObj = new URL(url);
          const hostname = urlObj.hostname;

          // Check if it's a private IP or localhost
          const isPrivateIP = (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.') ||
            (hostname.startsWith('172.') && (() => {
              const octets = hostname.split('.');
              const second = parseInt(octets[1] || '0', 10);
              return second >= 16 && second <= 31;
            })())
          );

          if (!isPrivateIP) {
            return res.status(403).json({ error: 'Access to public URLs is not allowed for security reasons' });
          }

          const response = await fetch(url, {
            signal: AbortSignal.timeout(10000), // 10 second timeout
          });

          if (!response.ok) {
            return res.status(response.status).json({ error: `Failed to fetch image: ${response.status}` });
          }

          // Get the content type from the response
          const contentType = response.headers.get('content-type') || 'image/jpeg';

          // Set CORS headers
          res.header('Access-Control-Allow-Origin', '*');
          res.header('Access-Control-Allow-Methods', 'GET');
          res.header('Access-Control-Allow-Headers', 'Content-Type');
          res.header('Content-Type', contentType);

          // Stream the image data
          response.body?.pipe(res);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Image proxy failed';
          console.error('[Image Proxy] Error:', errorMessage);
          res.status(500).json({ error: errorMessage });
        }
      });

  app.post('/api/lms/proxy', async (req: Request, res: Response) => {
    const { url, host, port, protocol, playerId, command } = req.body;
    
    if (!command) {
      return res.status(400).json({ error: 'Missing command' });
    }
    
    // Support both full URL format (for remote access) and host:port format (for local)
    let lmsUrl: string;
    let lmsHost: string;
    let lmsPort: number;
    let lmsProtocol: string;
    
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      // Full URL provided (for remote access)
      try {
        const parsedUrl = new URL(url);
        lmsProtocol = parsedUrl.protocol === 'https:' ? 'https' : 'http';
        lmsHost = parsedUrl.hostname;
        lmsPort = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (lmsProtocol === 'https' ? 443 : 9000);
        lmsUrl = `${lmsProtocol}://${parsedUrl.hostname}${parsedUrl.port ? `:${parsedUrl.port}` : ''}`;
        console.log(`[LMS Proxy] Remote connection: ${lmsUrl}`);
      } catch (error) {
        return res.status(400).json({ error: `Invalid LMS URL: ${url}` });
      }
    } else if (host) {
      // Legacy format: host and port (for local connections)
      lmsHost = String(host);
      lmsPort = parseInt(String(port)) || 9000;
      lmsProtocol = protocol || 'http';
      
      // Validate host is a valid IPv4 address for local connections
      const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const ipMatch = lmsHost.match(ipv4Regex);
      
      if (ipMatch) {
        // It's an IP address - validate it's private for security
        const octets = [
          parseInt(ipMatch[1], 10),
          parseInt(ipMatch[2], 10),
          parseInt(ipMatch[3], 10),
          parseInt(ipMatch[4], 10),
        ];
        
        if (octets.some(o => o < 0 || o > 255)) {
          return res.status(403).json({ error: 'Invalid IP address' });
        }
        
        // Check if IP is in private ranges (allow localhost and private IPs)
        const isPrivate = (
          (octets[0] === 10) ||
          (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
          (octets[0] === 192 && octets[1] === 168) ||
          (octets[0] === 127) || // localhost
          (lmsHost === 'localhost')
        );
        
        if (!isPrivate) {
          return res.status(403).json({ error: 'For IP addresses, only private network addresses are allowed. Use full URL format (https://hostname:port) for remote access.' });
        }
      } else if (lmsHost === 'localhost' || lmsHost === '127.0.0.1') {
        // Allow localhost
      } else {
        // Hostname provided - require full URL format for remote access
        return res.status(400).json({ error: 'For remote access, please provide full URL format (e.g., https://lms.example.com:9000)' });
      }
      
      lmsUrl = `${lmsProtocol}://${lmsHost}:${lmsPort}`;
    } else {
      return res.status(400).json({ error: 'Missing host or url' });
    }
    
    // Validate command format
    if (!Array.isArray(command) || command.length === 0) {
      return res.status(400).json({ error: 'Invalid command format' });
    }
    
    // Allow common LMS commands (expanded from read-only for full functionality)
    const allowedCommands = [
      'status', 'serverstatus', 'players', 'play', 'pause', 'stop', 'next', 'previous',
      'playlist', 'playlistcontrol', 'mixer', 'browse', 'albums', 'artists', 'tracks',
      'genres', 'years', 'playlists', 'favorites', 'info', 'rescan', 'search', 'power',
      'qobuz', 'tidal', 'spotify', 'soundcloud', 'titles', 'globalsearch', 'playerpref', 'pref', 'squeezecloud'
    ];
    const baseCommand = String(command[0]).toLowerCase();
    if (!allowedCommands.includes(baseCommand)) {
      return res.status(403).json({ error: `Command '${baseCommand}' is not allowed` });
    }
    
    if (lmsPort < 1 || lmsPort > 65535) {
      return res.status(400).json({ error: 'Invalid port' });
    }
    
    try {
      const jsonRpcUrl = `${lmsUrl}/jsonrpc.js`;
      console.log(`[LMS Proxy] Attempting to connect to: ${jsonRpcUrl}`);
      console.log(`[LMS Proxy] Command:`, JSON.stringify(command));
      
      // Qobuz and Tidal commands may take longer, use 30s timeout for them
      const isPluginCommand = Array.isArray(command) && command.length > 0 && 
                             ['qobuz', 'tidal', 'spotify', 'soundcloud'].includes(String(command[0]).toLowerCase());
      const timeoutMs = isPluginCommand ? 30000 : 10000;
      
      // Use AbortController for timeout (more compatible than AbortSignal.timeout)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      let response: Response;
      try {
        response = await fetch(jsonRpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: req.body.id || 1,
            method: 'slim.request',
            params: [playerId || '', command]
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId); // Clear timeout on success
      } catch (fetchError) {
        clearTimeout(timeoutId); // Clear timeout on error
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          throw new Error(`Request to LMS server timed out after ${timeoutMs}ms`);
        }
        throw fetchError;
      }
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        throw new Error(`LMS returned ${response.status}: ${response.statusText}. ${errorText.substring(0, 200)}`);
      }
      
      const data = await response.json();
      
      // Check if LMS returned an error in the response
      if (data.error) {
        console.error('[LMS Proxy] LMS error response:', data.error);
        throw new Error(`LMS error: ${JSON.stringify(data.error)}`);
      }
      
      res.json(data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'LMS request failed';
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error('[LMS Proxy] Error:', errorMessage);
      if (errorStack) {
        console.error('[LMS Proxy] Stack:', errorStack);
      }
      console.error('[LMS Proxy] Target:', `${lmsUrl}/jsonrpc.js`);
      console.error('[LMS Proxy] Command:', JSON.stringify(command));
      
      // Provide more helpful error messages
      let userMessage = errorMessage;
      if (errorMessage.includes('fetch failed') || errorMessage.includes('ECONNREFUSED')) {
        userMessage = `Cannot connect to LMS server at ${lmsUrl}. The server may be unreachable, or the LMS server may not be running.`;
      } else if (errorMessage.includes('timeout') || errorMessage.includes('AbortError')) {
        userMessage = `Request to LMS server timed out. The server at ${lmsUrl} may be slow or unreachable.`;
      } else if (errorMessage.includes('LMS error')) {
        // Pass through LMS-specific errors (like plugin not available)
        userMessage = errorMessage;
      }
      
      res.status(500).json({ 
        error: userMessage,
        details: errorMessage,
        target: `${lmsUrl}/jsonrpc.js`,
        command: command
      });
    }
  });

  // Image proxy endpoint - proxies LMS images to avoid CORS issues
  app.get('/api/image-proxy', async (req: Request, res: Response) => {
    const { url } = req.query;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing url parameter' });
    }
    
    try {
      // Decode the URL if it's encoded
      const imageUrl = decodeURIComponent(url);
      
      // Validate URL is from a private network (security)
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(imageUrl);
      } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
      }
      
      // Only allow HTTP/HTTPS
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ error: 'Only HTTP and HTTPS URLs are allowed' });
      }
      
      // Validate host is private network (same security as LMS proxy)
      const hostname = parsedUrl.hostname;
      const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const ipMatch = hostname.match(ipv4Regex);
      
      if (ipMatch) {
        const octets = [
          parseInt(ipMatch[1], 10),
          parseInt(ipMatch[2], 10),
          parseInt(ipMatch[3], 10),
          parseInt(ipMatch[4], 10),
        ];
        
        if (octets.some(o => o < 0 || o > 255)) {
          return res.status(403).json({ error: 'Invalid IP address' });
        }
        
        const isPrivate = (
          (octets[0] === 10) ||
          (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
          (octets[0] === 192 && octets[1] === 168) ||
          (octets[0] === 127) ||
          (hostname === 'localhost')
        );
        
        if (!isPrivate) {
          return res.status(403).json({ error: 'Only private network addresses are allowed' });
        }
      } else if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        // For hostnames, allow but log
        console.log(`[Image Proxy] Allowing hostname: ${hostname}`);
      }
      
      // Fetch the image
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      let response: Response;
      try {
        response = await fetch(imageUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'SoundStream/1.0',
          },
        });
        clearTimeout(timeoutId);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          return res.status(504).json({ error: 'Image request timed out' });
        }
        throw fetchError;
      }
      
      if (!response.ok) {
        return res.status(response.status).json({ 
          error: `Failed to fetch image: ${response.statusText}` 
        });
      }
      
      // Get content type from response or default to image
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
      
      // Stream the image
      const imageBuffer = await response.arrayBuffer();
      res.send(Buffer.from(imageBuffer));
    } catch (error) {
      console.error('[Image Proxy] Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to proxy image';
      res.status(500).json({ error: errorMessage });
    }
  });

  // SSDP discovery endpoint - discovers UPnP/OpenHome devices on the network
  app.get('/api/discover', async (req: Request, res: Response) => {
    try {
      console.log('[SSDP] Starting network discovery...');
      
      // Perform SSDP discovery
      const rawDevices = await performSsdpDiscovery('ssdp:all', 5000);
      console.log(`[SSDP] Found ${rawDevices.length} raw devices`);
      
      // Fetch device descriptions to get service URLs
      const devices: DiscoveredDevice[] = [];
      
      for (const device of rawDevices) {
        const detailedDevice = await fetchDeviceDescription(device.location);
        if (detailedDevice) {
          detailedDevice.usn = device.usn;
          detailedDevice.server = device.server;
          detailedDevice.st = device.st;
          devices.push(detailedDevice);
        }
      }
      
      console.log(`[SSDP] Returning ${devices.length} devices with descriptions`);
      
      res.json({ 
        success: true, 
        devices,
        count: devices.length
      });
    } catch (error) {
      console.error('[SSDP] Discovery error:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Discovery failed'
      });
    }
  });

  // Fetch device description from a specific URL
  app.get('/api/discover/device', async (req: Request, res: Response) => {
    const { location } = req.query;
    
    if (!location || typeof location !== 'string') {
      return res.status(400).json({ error: 'Location URL is required' });
    }
    
    try {
      const device = await fetchDeviceDescription(location);
      if (device) {
        res.json({ success: true, device });
      } else {
        res.status(404).json({ success: false, error: 'Failed to fetch device description' });
      }
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch device'
      });
    }
  });

  app.get('/api/server/test', async (req: Request, res: Response) => {
    const { host, port } = req.query;
    
    if (!host || !port) {
      return res.status(400).json({ error: 'Host and port are required' });
    }
    
    try {
      const response = await fetch(`http://${host}:${port}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      
      res.json({ 
        connected: true, 
        status: response.status,
        message: 'Server is reachable'
      });
    } catch (error) {
      res.json({ 
        connected: false, 
        message: error instanceof Error ? error.message : 'Connection failed'
      });
    }
  });

  app.get('/api/server/browse', async (req: Request, res: Response) => {
    const { host, port, type } = req.query;
    
    if (!host || !port) {
      return res.status(400).json({ error: 'Host and port are required' });
    }
    
    try {
      const content = await discoverServerContent(
        host as string, 
        parseInt(port as string, 10)
      );
      
      res.json(content);
    } catch (error) {
      console.error('Browse error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to browse server'
      });
    }
  });

  app.get('/api/server/browse/:containerId', async (req: Request, res: Response) => {
    const { host, port } = req.query;
    const { containerId } = req.params;
    
    if (!host || !port) {
      return res.status(400).json({ error: 'Host and port are required' });
    }
    
    try {
      const content = await browseContainer(
        host as string, 
        parseInt(port as string, 10),
        containerId
      );
      
      res.json(content);
    } catch (error) {
      console.error('Browse container error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to browse container'
      });
    }
  });

  // ==========================================
  // iOS Shortcuts / Siri Integration Endpoints
  // ==========================================
  // These endpoints can be called from iOS Shortcuts app to enable Siri voice control
  // All endpoints require: host (LMS IP), port (LMS port, default 9000), playerId (MAC address)

  // Helper function for LMS requests
  async function lmsRequest(host: string, port: number, playerId: string, command: string[]): Promise<Record<string, unknown>> {
    const response = await fetch(`http://${host}:${port}/jsonrpc.js`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        method: 'slim.request',
        params: [playerId, command]
      }),
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) {
      throw new Error(`LMS returned ${response.status}`);
    }
    
    const data = await response.json() as { result?: Record<string, unknown> };
    return data.result || {};
  }

  // Play/Pause toggle
  app.post('/api/shortcuts/play', async (req: Request, res: Response) => {
    const { host, port = 9000, playerId } = req.body;
    
    if (!host || !playerId) {
      return res.status(400).json({ error: 'Missing host or playerId' });
    }
    
    try {
      await lmsRequest(host, port, playerId, ['pause']);
      res.json({ success: true, action: 'play/pause toggled' });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to toggle play/pause' 
      });
    }
  });

  // Skip to next track
  app.post('/api/shortcuts/next', async (req: Request, res: Response) => {
    const { host, port = 9000, playerId } = req.body;
    
    if (!host || !playerId) {
      return res.status(400).json({ error: 'Missing host or playerId' });
    }
    
    try {
      await lmsRequest(host, port, playerId, ['playlist', 'index', '+1']);
      res.json({ success: true, action: 'skipped to next track' });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to skip track' 
      });
    }
  });

  // Skip to previous track
  app.post('/api/shortcuts/previous', async (req: Request, res: Response) => {
    const { host, port = 9000, playerId } = req.body;
    
    if (!host || !playerId) {
      return res.status(400).json({ error: 'Missing host or playerId' });
    }
    
    try {
      await lmsRequest(host, port, playerId, ['playlist', 'index', '-1']);
      res.json({ success: true, action: 'skipped to previous track' });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to skip track' 
      });
    }
  });

  // Set volume
  app.post('/api/shortcuts/volume', async (req: Request, res: Response) => {
    const { host, port = 9000, playerId, volume } = req.body;
    
    if (!host || !playerId || volume === undefined) {
      return res.status(400).json({ error: 'Missing host, playerId, or volume' });
    }
    
    const vol = Math.max(0, Math.min(100, parseInt(volume)));
    
    try {
      await lmsRequest(host, port, playerId, ['mixer', 'volume', String(vol)]);
      res.json({ success: true, action: `volume set to ${vol}` });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to set volume' 
      });
    }
  });

  // Play a specific playlist by name
  app.post('/api/shortcuts/playlist', async (req: Request, res: Response) => {
    const { host, port = 9000, playerId, name, shuffle = false } = req.body;
    
    if (!host || !playerId || !name) {
      return res.status(400).json({ error: 'Missing host, playerId, or playlist name' });
    }
    
    try {
      // First, get list of playlists to find matching one
      const playlistsResult = await lmsRequest(host, port, playerId, ['playlists', '0', '999']);
      const playlists = (playlistsResult.playlists_loop || []) as Array<{ id: string; playlist: string }>;
      
      // Find playlist by name (case-insensitive partial match)
      const searchName = String(name).toLowerCase();
      const match = playlists.find(p => 
        p.playlist.toLowerCase().includes(searchName)
      );
      
      if (!match) {
        return res.status(404).json({ 
          success: false, 
          error: `Playlist "${name}" not found`,
          available: playlists.map(p => p.playlist)
        });
      }
      
      // Set shuffle if requested
      if (shuffle) {
        await lmsRequest(host, port, playerId, ['playlist', 'shuffle', '1']);
      }
      
      // Play the playlist
      await lmsRequest(host, port, playerId, ['playlistcontrol', 'cmd:load', `playlist_id:${match.id}`]);
      
      res.json({ 
        success: true, 
        action: shuffle ? `playing "${match.playlist}" on shuffle` : `playing "${match.playlist}"`,
        playlist: match.playlist 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to play playlist' 
      });
    }
  });

  // Get list of available playlists
  app.get('/api/shortcuts/playlists', async (req: Request, res: Response) => {
    const { host, port = '9000', playerId } = req.query;
    
    if (!host || !playerId) {
      return res.status(400).json({ error: 'Missing host or playerId' });
    }
    
    try {
      const result = await lmsRequest(
        host as string, 
        parseInt(port as string), 
        playerId as string, 
        ['playlists', '0', '999']
      );
      
      const playlists = (result.playlists_loop || []) as Array<{ id: string; playlist: string }>;
      
      res.json({ 
        success: true, 
        playlists: playlists.map(p => ({ id: p.id, name: p.playlist }))
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to get playlists' 
      });
    }
  });

  // Get current playback status
  app.get('/api/shortcuts/status', async (req: Request, res: Response) => {
    const { host, port = '9000', playerId } = req.query;
    
    if (!host || !playerId) {
      return res.status(400).json({ error: 'Missing host or playerId' });
    }
    
    try {
      const result = await lmsRequest(
        host as string, 
        parseInt(port as string), 
        playerId as string, 
        ['status', '-', '1', 'tags:adKl']
      );
      
      const playlist = (result.playlist_loop || []) as Array<{ title?: string; artist?: string; album?: string }>;
      const currentTrack = playlist[0] || {};
      
      res.json({ 
        success: true, 
        playing: result.mode === 'play',
        mode: result.mode,
        volume: result['mixer volume'],
        track: currentTrack.title || 'Unknown',
        artist: currentTrack.artist || 'Unknown',
        album: currentTrack.album || 'Unknown',
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to get status' 
      });
    }
  });

  // Get list of available players
  app.get('/api/shortcuts/players', async (req: Request, res: Response) => {
    const { host, port = '9000' } = req.query;
    
    if (!host) {
      return res.status(400).json({ error: 'Missing host' });
    }
    
    try {
      const result = await lmsRequest(
        host as string, 
        parseInt(port as string), 
        '', 
        ['players', '0', '99']
      );
      
      const players = (result.players_loop || []) as Array<{ playerid: string; name: string; connected: number; power: number }>;
      
      res.json({ 
        success: true, 
        players: players.map(p => ({ 
          id: p.playerid, 
          name: p.name, 
          connected: p.connected === 1,
          power: p.power === 1
        }))
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to get players' 
      });
    }
  });

  // ==========================================
  // Roon Volume Control
  // ==========================================
  // Provides fast programmatic volume control for Roon via Roon API
  // Requires Roon Core to be running on the network
  
  // Initialize Roon volume control if enabled
  console.log('[Server] Checking Roon volume control:', {
    envVar: process.env.ENABLE_ROON_VOLUME_CONTROL,
    isTrue: process.env.ENABLE_ROON_VOLUME_CONTROL === 'true',
    type: typeof process.env.ENABLE_ROON_VOLUME_CONTROL
  });
  
  if (process.env.ENABLE_ROON_VOLUME_CONTROL === 'true') {
    console.log('[Server] Roon volume control is enabled, initializing...');
    try {
      const { initializeRoonVolumeControl, getRoonVolumeControl } = await import('./roon-volume-control');
      globalRoonControl = initializeRoonVolumeControl({
        enabled: true,
        coreIp: process.env.ROON_CORE_IP,
        corePort: process.env.ROON_CORE_PORT ? parseInt(process.env.ROON_CORE_PORT) : undefined,
        outputId: process.env.ROON_OUTPUT_ID,
        zoneId: process.env.ROON_ZONE_ID,
      });

      console.log('[Server] Global Roon control instance created');

      // Initialize the connection asynchronously
      console.log('[Server] Calling globalRoonControl.initialize()...');
      globalRoonControl.initialize().then(() => {
        console.log('[Server] Roon volume control initialized successfully');
      }).catch((error) => {
        console.error('[Server] Roon volume control failed to initialize:', error);
        console.error('[Server] Make sure Roon Core is running and accessible at', process.env.ROON_CORE_IP || '192.168.0.19');
      });

      console.log('[Server] Roon volume control enabled');
    } catch (error) {
      console.warn('[Server] Roon volume control failed to load:', error);
      console.warn('[Server] Install node-roon-api: npm install node-roon-api node-roon-api-transport node-roon-api-status');
    }
  }

  // Get Roon volume control status
app.get('/api/roon/status', async (req: Request, res: Response) => {
  console.log('[Routes] Status endpoint called, globalRoonControl:', !!globalRoonControl);
  try {
    const roonControl = globalRoonControl;
      
      if (!roonControl) {
        return res.status(503).json({
          success: false,
          error: 'Roon volume control not initialized',
          hint: 'Set ENABLE_ROON_VOLUME_CONTROL=true and ensure Roon Core is running'
        });
      }

      const status = roonControl.getConnectionStatus();

      // Return actual outputs and zones from the persistent connection
      const outputsArray = Array.from(roonControl.getOutputs().values());
      const zonesArray = Array.from(roonControl.getZones().values());

      console.log(`[Routes] Status: connected=${status.connected}, outputs=${outputsArray.length}, zones=${zonesArray.length}`);

      return res.json({
        success: true,
        ...status,
        outputs: outputsArray,
        zones: zonesArray,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Set Roon output
  app.post('/api/roon/output', async (req: Request, res: Response) => {
    try {
      const roonControl = globalRoonControl;
      
      if (!roonControl) {
        return res.status(503).json({
          success: false,
          error: 'Roon volume control not initialized'
        });
      }

      const { output_id } = req.body;
      if (!output_id) {
        return res.status(400).json({
          success: false,
          error: 'Missing output_id'
        });
      }

      const success = roonControl.setOutput(output_id);
      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'Output not found'
        });
      }

      return res.json({ success: true, output_id });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get current volume
  app.get('/api/roon/volume', async (req: Request, res: Response) => {
    try {
      console.log('[Routes] Volume endpoint called');
      const roonControl = globalRoonControl;
      console.log(`[Routes] Roon control instance: ${!!roonControl}`);

      if (!roonControl) {
        console.log('[Routes] Roon volume control not initialized');
        return res.status(503).json({
          success: false,
          error: 'Roon volume control not initialized'
        });
      }

      if (!roonControl.isReady()) {
        console.log('[Routes] Roon volume control not ready');
        return res.status(503).json({
          success: false,
          error: 'Roon volume control not ready',
          hint: 'Ensure Roon Core is running and extension is authorized'
        });
      }

      console.log('[Routes] Calling getVolume...');
      const volume = await roonControl.getVolume();
      console.log(`[Routes] Volume result: ${volume}`);
      return res.json({ success: true, volume });
    } catch (error) {
      console.error('[Routes] Error in volume endpoint:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get volume'
      });
    }
  });

  // Set volume
  app.post('/api/roon/volume', async (req: Request, res: Response) => {
    console.log('[Routes] === VOLUME POST ENDPOINT HIT ===');
    console.log('[Routes] Raw request body:', req.body);
    console.log('[Routes] Request method:', req.method);
    console.log('[Routes] Content-Type header:', req.headers['content-type']);
    console.log('[Routes] Content-Length header:', req.headers['content-length']);
    try {
      const roonControl = globalRoonControl;

      if (!roonControl) {
        console.log('[Routes] Roon control not initialized');
        return res.status(503).json({
          success: false,
          error: 'Roon volume control not initialized'
        });
      }

      // Refresh connection status and auto-select outputs if needed
      console.log('[Routes] Calling getConnectionStatus()');
      roonControl.getConnectionStatus();

      console.log('[Routes] Checking isReady()');
      if (!roonControl.isReady()) {
        console.log('[Routes] Roon control not ready');
        return res.status(503).json({
          success: false,
          error: 'Roon volume control not ready'
        });
      }

      console.log('[Routes] Roon control is ready, processing volume action');

      const { action, value } = req.body;
      console.log('[Routes] Extracted action:', action, 'value:', value);

      if (action === 'get') {
        const volume = await roonControl.getVolume();
        return res.json({ success: true, volume });
      } else if (action === 'set') {
        if (typeof value !== 'number' || value < 0 || value > 100) {
          return res.status(400).json({
            success: false,
            error: 'Volume must be a number between 0 and 100'
          });
        }

        await roonControl.setVolume(value);
        return res.json({ success: true, volume: value });
      } else if (action === 'up') {
        const step = typeof value === 'number' ? value : 2;
        const newVolume = await roonControl.volumeUp(step);
        return res.json({ success: true, volume: newVolume });
      } else if (action === 'down') {
        const step = typeof value === 'number' ? value : 2;
        const newVolume = await roonControl.volumeDown(step);
        return res.json({ success: true, volume: newVolume });
      } else {
        return res.status(400).json({
          success: false,
          error: 'Invalid action',
          hint: 'Use: get, set (with value 0-100), up (with optional step), down (with optional step)'
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to control volume'
      });
    }
  });


  // Combined server discovery endpoint (LMS + MinimServer + UPnP)
  app.get('/api/servers/discover', async (req: Request, res: Response) => {
    try {
      console.log('[Servers] Starting combined discovery...');
      
      const [lmsServers, minimServers, upnpDevices] = await Promise.all([
        // LMS discovery
        (async () => {
          try {
            const port = 9000;
            const timeoutMs = 500; // Very fast timeout to speed up discovery
            const found: Array<{ id: string; name: string; host: string; port: number; type: string; version?: string }> = [];

            // Only scan the most likely ranges with very limited hosts for speed
            const ipRanges = [
              { base: [192, 168, 0], maxHost: 10 }, // Focus on most common range
              { base: [192, 168, 1], maxHost: 5 },
            ];
            
            const promises: Promise<void>[] = [];
            
            for (const range of ipRanges) {
              for (let i = 1; i <= range.maxHost; i++) {
                const ip = `${range.base[0]}.${range.base[1]}.${range.base[2]}.${i}`;
                
                promises.push(
                  (async () => {
                    try {
                      const controller = new AbortController();
                      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                      
                      const response = await fetch(`http://${ip}:${port}/jsonrpc.js`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          id: 1,
                          method: 'slim.request',
                          params: ['', ['serverstatus', '0', '0']],
                        }),
                        signal: controller.signal,
                      });
                      
                      clearTimeout(timeoutId);
                      
                      if (response.ok) {
                        const data = await response.json();
                        if (data.result) {
                          found.push({
                            id: `lms-${ip}:${port}`,
                            name: 'Logitech Media Server',
                            host: ip,
                            port,
                            type: 'lms',
                            version: String(data.result.version || 'unknown'),
                          });
                        }
                      }
                    } catch {
                      // Ignore errors
                    }
                  })()
                );
              }
            }
            
            await Promise.all(promises);
            return found;
          } catch {
            return [];
          }
        })(),
        
        // MinimServer discovery via SSDP + direct port scan
        (async () => {
          try {
            console.log('[MinimServer] Starting discovery (SSDP + port scan)...');
            const minimServers: Array<{ id: string; name: string; host: string; port: number; type: string; manufacturer?: string }> = [];
            const foundHosts = new Set<string>();
            
            // First, try SSDP discovery
            try {
              const devices = await performSsdpDiscovery('urn:schemas-upnp-org:device:MediaServer:1', 5000);
              console.log(`[MinimServer] SSDP found ${devices.length} MediaServer device(s)`);
              
              for (const device of devices) {
                try {
                  const description = await fetchDeviceDescription(device.location);
                  if (description) {
                    // Check multiple ways to identify MinimServer
                    const friendlyName = description.friendlyName?.toLowerCase() || '';
                    const manufacturer = description.manufacturer?.toLowerCase() || '';
                    const modelName = description.modelName?.toLowerCase() || '';
                    const server = description.server?.toLowerCase() || '';
                    const url = new URL(device.location);
                    const port = parseInt(url.port) || 80;
                    const hostKey = `${url.hostname}:${port}`;
                    
                    // MinimServer identification - check multiple fields
                    // MinimServer typically:
                    // 1. Has "minim" in name/manufacturer/model
                    // 2. Uses port 9790 (default) or 9791
                    // 3. Provides ContentDirectory service
                    const hasMinimInName = 
                      friendlyName.includes('minim') ||
                      manufacturer.includes('minim') ||
                      modelName.includes('minim') ||
                      server.includes('minim');
                    
                    const hasMinimPort = port === 9790 || port === 9791;
                    const hasContentDirectory = !!description.services.contentDirectory;
                    
                    // Identify as MinimServer if:
                    // - Has "minim" in any name field, OR
                    // - Is on MinimServer default port (9790/9791) AND has ContentDirectory service
                    const isMinimServer = 
                      hasMinimInName ||
                      (hasMinimPort && hasContentDirectory);
                    
                    if (isMinimServer) {
                      minimServers.push({
                        id: `minimserver-${url.hostname}:${port}`,
                        name: description.friendlyName || 'MinimServer',
                        host: url.hostname,
                        port: port,
                        type: 'minimserver',
                        manufacturer: description.manufacturer,
                      });
                      foundHosts.add(hostKey);
                      console.log(`[MinimServer] Found via SSDP: ${description.friendlyName} at ${url.hostname}:${port}`);
                    }
                  }
                } catch (e) {
                  console.log(`[MinimServer] Error processing device ${device.location}:`, e);
                  continue;
                }
              }
            } catch (ssdpError) {
              console.error('[MinimServer] SSDP discovery error:', ssdpError);
            }
            
            // Also try direct port scan on MinimServer default ports (9790, 9791)
            const minimPorts = [9790, 9791];
            const ipRanges = [
              { base: [192, 168, 0], maxHost: 30 },
              { base: [192, 168, 1], maxHost: 30 },
              { base: [10, 0, 0], maxHost: 30 },
              { base: [172, 16, 0], maxHost: 30 },
            ];
            
            const portScanPromises: Promise<void>[] = [];
            
            for (const range of ipRanges) {
              for (let i = 1; i <= range.maxHost; i++) {
                const ip = `${range.base[0]}.${range.base[1]}.${range.base[2]}.${i}`;
                
                for (const minimPort of minimPorts) {
                  const hostKey = `${ip}:${minimPort}`;
                  if (foundHosts.has(hostKey)) continue; // Already found via SSDP
                  
                  portScanPromises.push(
                    (async () => {
                      try {
                        // Try to fetch device description from MinimServer default location
                        const descUrl = `http://${ip}:${minimPort}/description.xml`;
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 2000);
                        
                        const response = await fetch(descUrl, {
                          headers: { 'User-Agent': 'SoundStream/1.0 UPnP/1.0' },
                          signal: controller.signal,
                        });
                        
                        clearTimeout(timeoutId);
                        
                        if (response.ok) {
                          const xml = await response.text();
                          const friendlyNameMatch = xml.match(/<friendlyName>([^<]*)<\/friendlyName>/i);
                          const manufacturerMatch = xml.match(/<manufacturer>([^<]*)<\/manufacturer>/i);
                          
                          const friendlyName = friendlyNameMatch?.[1] || 'MinimServer';
                          const manufacturer = manufacturerMatch?.[1];
                          
                          // If we can fetch the description from port 9790/9791, it's likely MinimServer
                          minimServers.push({
                            id: `minimserver-${ip}:${minimPort}`,
                            name: friendlyName,
                            host: ip,
                            port: minimPort,
                            type: 'minimserver',
                            manufacturer: manufacturer,
                          });
                          console.log(`[MinimServer] Found via port scan: ${friendlyName} at ${ip}:${minimPort}`);
                        }
                      } catch {
                        // Ignore errors for individual IPs
                      }
                    })()
                  );
                }
              }
            }
            
            await Promise.all(portScanPromises);
            console.log(`[MinimServer] Discovery complete, found ${minimServers.length} server(s)`);
            return minimServers;
          } catch (error) {
            console.error('[MinimServer] Discovery error:', error);
            return [];
          }
        })(),
        
        // UPnP MediaServer discovery (non-MinimServer)
        (async () => {
          try {
            const devices = await performSsdpDiscovery('urn:schemas-upnp-org:device:MediaServer:1', 3000);
            const upnpServers: Array<{ id: string; name: string; host: string; port: number; type: string; manufacturer?: string }> = [];
            
            for (const device of devices.slice(0, 10)) {
              try {
                const description = await fetchDeviceDescription(device.location);
                if (description) {
                  const friendlyName = description.friendlyName?.toLowerCase() || '';
                  const manufacturer = description.manufacturer?.toLowerCase() || '';
                  const modelName = description.modelName?.toLowerCase() || '';
                  
                  const isMinimServer = 
                    friendlyName.includes('minim') ||
                    manufacturer.includes('minim') ||
                    modelName.includes('minim');
                  
                  if (!isMinimServer) {
                    const url = new URL(device.location);
                    upnpServers.push({
                      id: `upnp-${url.hostname}:${url.port || 80}`,
                      name: description.friendlyName || 'UPnP Media Server',
                      host: url.hostname,
                      port: parseInt(url.port) || 80,
                      type: 'upnp',
                      manufacturer: description.manufacturer,
                    });
                  }
                }
              } catch {
                continue;
              }
            }
            
            return upnpServers;
          } catch {
            return [];
          }
        })(),
      ]);
      
      // Only return LMS servers (removed MinimServer and UPnP support)
      const allServers = lmsServers;
      console.log(`[Servers] LMS discovery complete, found ${allServers.length} server(s)`);
      res.json(allServers);
    } catch (error) {
      console.error('[Servers] Discovery error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Discovery failed' 
      });
    }
  });

  // LMS server discovery endpoint (for web platform)
  app.get('/api/lms/discover', async (req: Request, res: Response) => {
    try {
      console.log('[LMS] Starting server-side discovery...');
      const port = 9000;
      const timeoutMs = 2000;
      const found: Array<{ id: string; name: string; host: string; port: number; version?: string }> = [];
      
      // Scan common local IP ranges: 192.168.0.x, 10.0.0.x, 172.16.0.x
      // For simplicity, scan the common subnet ranges
      const ipRanges = [
        { base: [192, 168, 0], maxHost: 255 },  // 192.168.0.1-255
        { base: [192, 168, 1], maxHost: 255 },  // 192.168.1.1-255
        { base: [10, 0, 0], maxHost: 255 },     // 10.0.0.1-255
        { base: [172, 16, 0], maxHost: 255 },  // 172.16.0.1-255
      ];
      
      const promises: Promise<void>[] = [];
      
      for (const range of ipRanges) {
        // Limit scanning to first 30 hosts per subnet for performance
        for (let i = 1; i <= Math.min(range.maxHost, 30); i++) {
          const ip = `${range.base[0]}.${range.base[1]}.${range.base[2]}.${i}`;
          
          promises.push(
            (async () => {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                
                const response = await fetch(`http://${ip}:${port}/jsonrpc.js`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    id: 1,
                    method: 'slim.request',
                    params: ['', ['serverstatus', '0', '0']],
                  }),
                  signal: controller.signal,
                });
                
                clearTimeout(timeoutId);
                
                if (response.ok) {
                  const data = await response.json();
                  if (data.result) {
                    found.push({
                      id: `lms-${ip}:${port}`,
                      name: 'Logitech Media Server',
                      host: ip,
                      port,
                      version: String(data.result.version || 'unknown'),
                    });
                    console.log(`[LMS] Found server at ${ip}:${port}`);
                  }
                }
              } catch {
                // Ignore errors for individual IPs
              }
            })()
          );
        }
      }
      
      await Promise.all(promises);
      console.log(`[LMS] Discovery complete, found ${found.length} server(s)`);
      res.json(found);
    } catch (error) {
      console.error('[LMS] Discovery error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Discovery failed' 
      });
    }
  });

  // Extract dominant color from an image URL
  app.get('/api/color/extract', async (req: Request, res: Response) => {
    const { url } = req.query;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid url parameter' });
    }

    try {
      // Fetch the image
      const imageResponse = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SoundStream/1.0)',
        },
      });

      if (!imageResponse.ok) {
        return res.status(404).json({ error: 'Image not found', color: '#1C1C1E' });
      }

      // Use canvas to extract dominant color
      const { createCanvas, loadImage } = require('canvas');
      const imageBuffer = await imageResponse.arrayBuffer();
      const image = await loadImage(Buffer.from(imageBuffer));
      
      // Sample a central region (20%-80% of the image) to avoid edges
      const sampleX = Math.floor(image.width * 0.2);
      const sampleY = Math.floor(image.height * 0.2);
      const sampleWidth = Math.floor(image.width * 0.6);
      const sampleHeight = Math.floor(image.height * 0.6);
      
      const canvas = createCanvas(sampleWidth, sampleHeight);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, sampleX, sampleY, sampleWidth, sampleHeight, 0, 0, sampleWidth, sampleHeight);
      
      const imageData = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
      const pixels = imageData.data;
      
      // Calculate average color, filtering out very dark/light pixels
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const pixelR = pixels[i];
        const pixelG = pixels[i + 1];
        const pixelB = pixels[i + 2];
        
        // Calculate brightness
        const brightness = (pixelR * 299 + pixelG * 587 + pixelB * 114) / 1000;
        
        // Filter out very dark (< 20) and very light (> 240) pixels
        if (brightness >= 20 && brightness <= 240) {
          r += pixelR;
          g += pixelG;
          b += pixelB;
          count++;
        }
      }
      
      if (count === 0) {
        // Fallback: use average of all pixels
        for (let i = 0; i < pixels.length; i += 4) {
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          count++;
        }
      }
      
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      
      // Ensure minimum brightness for readability
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      if (brightness < 80) {
        const factor = 80 / brightness;
        r = Math.min(255, Math.round(r * factor));
        g = Math.min(255, Math.round(g * factor));
        b = Math.min(255, Math.round(b * factor));
      }
      
      const color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      
      res.json({ color });
    } catch (error) {
      console.error('[Color Extract] Error:', error);
      res.status(500).json({ error: 'Failed to extract color', color: '#1C1C1E' });
    }
  });

  // LMS server connection proxy (for web platform to avoid CORS)
  app.post('/api/lms/connect', async (req: Request, res: Response) => {
    try {
      const { url, host, port, protocol } = req.body;
      
      // Support both full URL format (for remote access) and host:port format (for local)
      let lmsUrl: string;
      let lmsHost: string;
      let lmsPort: number;
      
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        // Full URL provided (for remote access)
        try {
          const parsedUrl = new URL(url);
          lmsHost = parsedUrl.hostname;
          lmsPort = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 9000);
          lmsUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.port ? `:${parsedUrl.port}` : ''}`;
        } catch (error) {
          return res.status(400).json({ error: `Invalid LMS URL: ${url}` });
        }
      } else if (host && port) {
        // Legacy format: host and port (for local connections)
        lmsHost = String(host);
        lmsPort = parseInt(String(port)) || 9000;
        const lmsProtocol = protocol || 'http';
        lmsUrl = `${lmsProtocol}://${lmsHost}:${lmsPort}`;
      } else {
        return res.status(400).json({ error: 'Either url or both host and port are required' });
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(`${lmsUrl}/jsonrpc.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          method: 'slim.request',
          params: ['', ['serverstatus', '0', '0']],
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        if (data.result) {
          res.json({
            id: `lms-${lmsHost}:${lmsPort}`,
            name: 'Logitech Media Server',
            host: lmsHost,
            port: lmsPort,
            version: String(data.result.version || 'unknown'),
          });
        } else {
          res.status(404).json({ error: 'Server responded but no result' });
        }
      } else {
        res.status(response.status).json({ error: `Server returned ${response.status}` });
      }
    } catch (error) {
      console.error('[LMS] Connection proxy error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Connection failed' 
      });
    }
  });

  // Chromecast casting endpoints
  app.post('/api/chromecast/cast', async (req: Request, res: Response) => {
    console.log('[Chromecast] Cast endpoint called');
    try {
      const { ip, lmsHost, lmsPort, playerId } = req.body;
      
      if (!ip) {
        return res.status(400).json({ error: 'Chromecast IP is required' });
      }
      
      // Get the server's local IP address
      const os = await import('os');
      const networkInterfaces = os.networkInterfaces();
      let serverIp = 'localhost';
      
      for (const interfaceName in networkInterfaces) {
        const interfaces = networkInterfaces[interfaceName];
        if (interfaces) {
          for (const iface of interfaces) {
            if (iface.family === 'IPv4' && !iface.internal) {
              serverIp = iface.address;
              break;
            }
          }
        }
        if (serverIp !== 'localhost') break;
      }
      
      // Construct the now-playing URL
      const serverPort = process.env.PORT || '3000';
      const nowPlayingUrl = `http://${serverIp}:${serverPort}/now-playing${lmsHost ? `?host=${lmsHost}&port=${lmsPort || 9000}${playerId ? `&player=${encodeURIComponent(playerId)}` : ''}` : ''}`;
      
      console.log(`[Chromecast] Casting to ${ip}: ${nowPlayingUrl}`);
      
      // Try to use the relay server on 192.168.0.21:3000 (the "all cast" server)
      // The relay server uses catt to cast HTML content to Chromecast
      try {
        // First, set the preferred player on the relay server so it uses the correct player
        if (playerId && lmsHost) {
          try {
            // Get player name from LMS to pass to relay server
            const playerNameResponse = await fetch(`http://${lmsHost}:${lmsPort || 9000}/jsonrpc.js`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: 1,
                method: 'slim.request',
                params: ['', ['players', '0', '100']]
              }),
              signal: AbortSignal.timeout(3000),
            });
            
            let playerName = playerId;
            if (playerNameResponse.ok) {
              const playerData = await playerNameResponse.json();
              const players = playerData.result?.players_loop || [];
              const player = players.find((p: any) => p.playerid === playerId);
              if (player) {
                playerName = player.name || playerId;
              }
            }
            
            // Set the preferred player on the relay server
            const playerResponse = await fetch('http://192.168.0.21:3000/api/player', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                playerId,
                playerName,
              }),
              signal: AbortSignal.timeout(5000),
            });
            
            if (playerResponse.ok) {
              console.log(`[Chromecast] Set preferred player on relay server: ${playerName} (${playerId})`);
            } else {
              console.warn('[Chromecast] Failed to set preferred player on relay server');
            }
          } catch (playerError) {
            console.warn('[Chromecast] Could not set preferred player:', playerError instanceof Error ? playerError.message : String(playerError));
            // Continue anyway - relay server will use its default player
          }
        }
        
        // First, update LMS server on relay if provided
        if (lmsHost && lmsPort) {
          try {
            const lmsResponse = await fetch('http://192.168.0.21:3000/api/lms', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                host: lmsHost,
                port: lmsPort,
              }),
              signal: AbortSignal.timeout(5000),
            });
            
            if (lmsResponse.ok) {
              console.log(`[Chromecast] Updated LMS server on relay to ${lmsHost}:${lmsPort}`);
            } else {
              console.warn('[Chromecast] Failed to update LMS server on relay');
            }
          } catch (lmsError) {
            console.warn('[Chromecast] Could not update LMS server on relay:', lmsError instanceof Error ? lmsError.message : String(lmsError));
            // Continue anyway - relay might already be configured
          }
        }
        
        // Configure the Chromecast on the relay server
        const configResponse = await fetch('http://192.168.0.21:3000/api/chromecast', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ip,
            name: `Chromecast ${ip}`,
          }),
          signal: AbortSignal.timeout(5000),
        });
        
        if (configResponse.ok) {
          console.log('[Chromecast] Configured on relay server');
          
          // The relay server automatically casts when music plays (it polls LMS)
          // It will now use the correct player that we just set
          return res.json({ 
            success: true, 
            message: 'Chromecast configured. Casting will start automatically when music plays.',
            url: nowPlayingUrl,
            relayServer: '192.168.0.21:3000',
            playerId,
          });
        }
      } catch (relayError) {
        console.log('[Chromecast] Relay server not available:', relayError instanceof Error ? relayError.message : String(relayError));
        return res.status(503).json({ 
          error: 'Relay server on 192.168.0.21:3000 is not available',
          url: nowPlayingUrl 
        });
      }
      
      // If relay server configuration failed, return error
      console.warn('[Chromecast] Relay server configuration failed');
      return res.status(503).json({ 
        error: 'Relay server on 192.168.0.21:3000 is not available or configuration failed',
        url: nowPlayingUrl 
      });
      
    } catch (error) {
      console.error('[Chromecast] Cast error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Cast failed' 
      });
    }
  });

  app.post('/api/chromecast/stop', async (req: Request, res: Response) => {
    try {
      const { ip } = req.body;
      
      if (!ip) {
        return res.status(400).json({ error: 'Chromecast IP is required' });
      }
      
      // Try to use the relay server on 192.168.0.21:3000
      try {
        // The relay server automatically stops casting when music pauses/stops
        // But we can also clear the Chromecast config to stop it
        const relayResponse = await fetch('http://192.168.0.21:3000/api/chromecast', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        });
        
        if (relayResponse.ok) {
          console.log('[Chromecast] Cast stopped via relay server');
          return res.json({ success: true, message: 'Cast stopped' });
        }
      } catch (relayError) {
        console.log('[Chromecast] Relay server not available for stop:', relayError instanceof Error ? relayError.message : String(relayError));
      }
      
      return res.json({ success: true, message: 'Stop command sent' });
      
    } catch (error) {
      console.error('[Chromecast] Stop error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Stop failed' 
      });
    }
  });

  // Chromecast enabled state endpoint - proxies to relay server
  app.post('/api/chromecast/enabled', async (req: Request, res: Response) => {
    console.log('[Chromecast] Enabled state endpoint called');
    try {
      const { enabled } = req.body;
      
      if (enabled === undefined) {
        return res.status(400).json({ error: 'enabled field is required' });
      }
      
      console.log(`[Chromecast] Setting enabled state to: ${enabled}`);
      
      // Proxy to the relay server on 192.168.0.21:3000
      try {
        const relayResponse = await fetch('http://192.168.0.21:3000/api/chromecast', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ enabled }),
          signal: AbortSignal.timeout(5000),
        });
        
        if (relayResponse.ok) {
          await relayResponse.json(); // consume response body
          console.log(`[Chromecast] Enabled state synced to relay server: ${enabled}`);
          return res.json({ 
            success: true, 
            message: `Chromecast ${enabled ? 'enabled' : 'disabled'}`,
            enabled,
            relayServer: '192.168.0.21:3000',
          });
        } else {
          const errorText = await relayResponse.text();
          console.warn('[Chromecast] Relay server returned error:', errorText);
          return res.status(relayResponse.status).json({ 
            error: `Relay server error: ${errorText}`,
            enabled 
          });
        }
      } catch (relayError) {
        console.error('[Chromecast] Failed to sync to relay server:', relayError instanceof Error ? relayError.message : String(relayError));
        return res.status(503).json({ 
          error: 'Relay server on 192.168.0.21:3000 is not available',
          enabled 
        });
      }
      
    } catch (error) {
      console.error('[Chromecast] Enabled state error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to set enabled state' 
      });
    }
  });

  // Chromecast device discovery using mDNS
  app.get('/api/chromecast/discover', async (req: Request, res: Response) => {
    try {
      let mdns: any;
      try {
        // @ts-ignore - mdns-js doesn't have type definitions
        mdns = await import('mdns-js');
      } catch (e) {
        console.warn('[Chromecast] mDNS library not available, falling back to manual discovery');
        // Fallback: return empty array or check for known server on 192.168.0.21
        // The user mentioned a server on 192.168.0.21 that uses "all cast"
        // We can try to discover devices via that server if it exists
        const fallbackDevices: Array<{ ip: string; name: string }> = [];
        
        // Try to check if there's a server on 192.168.0.21 that might have device info
        try {
          const response = await fetch('http://192.168.0.21:5000/api/chromecasts', {
            signal: AbortSignal.timeout(3000),
          });
          if (response.ok) {
            const data = await response.json();
            if (data.devices && Array.isArray(data.devices)) {
              return res.json(data.devices.map((d: { ip: string; name: string }) => ({
                ip: d.ip,
                name: d.name,
              })));
            }
          }
        } catch (e) {
          console.log('[Chromecast] Fallback server not available:', e instanceof Error ? e.message : String(e));
          // Server not available, continue with empty result
        }
        
        return res.json(fallbackDevices);
      }

      const timeout = parseInt(String(req.query.timeout)) || 5000;
      const devices: Array<{ ip: string; name: string }> = [];
      const seen = new Set<string>();

      return new Promise((resolve, reject) => {
        try {
          const browser = mdns.createBrowser(mdns.tcp('googlecast'));

          browser.on('ready', () => {
            console.log('[Chromecast] mDNS browser ready, starting discovery...');
            browser.discover();
          });

          browser.on('update', (data: any) => {
            if (data.addresses && data.addresses.length > 0) {
              const ip = data.addresses.find((addr: string) => addr.includes('.')) || data.addresses[0];
              const key = `${ip}:${data.port || 8009}`;

              if (!seen.has(key)) {
                seen.add(key);

                let name = data.fullname || data.host || 'Unknown Chromecast';
                if (name.includes('._googlecast')) {
                  name = name.split('._googlecast')[0];
                }
                name = name.replace(/-/g, ' ').replace(/\._tcp\.local$/, '');

                const txtRecord = data.txt || [];
                let friendlyName = name;

                txtRecord.forEach((entry: string) => {
                  if (typeof entry === 'string') {
                    if (entry.startsWith('fn=')) {
                      friendlyName = entry.substring(3);
                    }
                  }
                });

                devices.push({
                  ip,
                  name: friendlyName,
                });

                console.log(`[Chromecast] Discovered: ${friendlyName} at ${ip}`);
              }
            }
          });

          browser.on('error', (error: Error) => {
            console.error('[Chromecast] mDNS browser error:', error);
            // Don't reject here, let timeout handle it
          });

          setTimeout(() => {
            try {
              browser.stop();
            } catch (e) {
              // Ignore stop errors
            }

            console.log(`[Chromecast] Discovery complete, found ${devices.length} device(s)`);
            
            // Sort devices by name
            devices.sort((a, b) => a.name.localeCompare(b.name));
            
            res.json(devices);
            resolve(undefined);
          }, timeout);
        } catch (error) {
          console.error('[Chromecast] Discovery setup error:', error);
          res.status(500).json({ 
            error: error instanceof Error ? error.message : 'Discovery setup failed' 
          });
          reject(error);
        }
      });
    } catch (error) {
      console.error('[Chromecast] Discovery error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Discovery failed' 
      });
    }
  });

  // Initialize Tidal API client with stored tokens if available
  globalTidalClient = new TidalApiClient({
    clientId: 'pUlCxd80DuDSem4J', // Third-party client ID provided by user
  });

  // Try to load stored Tidal tokens and authenticate
  // Note: In a production app, tokens would be stored securely
  // For now, we'll initialize without tokens and require manual auth

  // Tidal API Routes
  app.get('/api/tidal/auth-url', (req: Request, res: Response) => {
    try {
      if (!globalTidalClient) {
        return res.status(503).json({ error: 'Tidal API client not initialized' });
      }

      // Dynamic redirect URI for web vs mobile
      const platform = req.query.platform || (req.headers.origin ? 'web' : 'mobile');
      const requestHost = req.headers.host || '192.168.0.21:3000';
      const protocol = req.protocol || 'http';
      
      let redirectUri;
      if (platform === 'web') {
        // ALWAYS use the redirect URI registered in Tidal Developer Portal for web
        redirectUri = `http://192.168.0.21:3000/api/tidal/callback`;
      } else {
        redirectUri = 'soundstream://callback';
      }

      console.log(`[Routes] Generating Tidal auth URL for platform: ${platform}, redirect: ${redirectUri}`);
      const authUrl = globalTidalClient.generateAuthUrl(redirectUri);
      
      // Store redirect URI for token exchange
      (global as any).tidalRedirectUri = redirectUri;

      res.json({ authUrl, redirectUri });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to generate auth URL'
      });
    }
  });

  app.post('/api/tidal/authenticate', async (req: Request, res: Response) => {
    try {
      const { code } = req.body;

      if (!globalTidalClient) {
        return res.status(503).json({ error: 'Tidal API client not initialized' });
      }

      if (!code) {
        return res.status(400).json({ error: 'Authorization code required' });
      }

      const redirectUri = (global as any).tidalRedirectUri || 'soundstream://callback';
      console.log(`[Routes] Exchanging code for Tidal tokens, redirect: ${redirectUri}`);
      
      const tokens = await globalTidalClient.exchangeCodeForTokens(code, redirectUri);
      // Set the tokens in the client for future use
      globalTidalClient.setTokens(tokens.accessToken, tokens.refreshToken, tokens.userId);
      
      // Clean up
      delete (global as any).tidalRedirectUri;
      
      res.json({ success: true, tokens });
    } catch (error) {
      console.error('[Routes] Tidal authenticate error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to authenticate with Tidal'
      });
    }
  });

  app.get('/api/tidal/callback', async (req: Request, res: Response) => {
    try {
      const { code, error } = req.query;

      if (error) {
        return res.send(`
          <html>
            <head><title>Tidal Auth Error</title></head>
            <body style="font-family: sans-serif; padding: 20px; text-align: center;">
              <h1>Authentication Error</h1>
              <p>${error}</p>
              <p>You can close this window now.</p>
            </body>
          </html>
        `);
      }

      if (!code || typeof code !== 'string') {
        return res.status(400).send('No code received');
      }

      if (!globalTidalClient) {
        return res.status(503).send('Tidal client not initialized');
      }

      const redirectUri = (global as any).tidalRedirectUri || 'http://192.168.0.21:3000/api/tidal/callback';
      console.log(`[Routes] Handling Tidal callback, exchanging code, redirect: ${redirectUri}`);

      const tokens = await globalTidalClient.exchangeCodeForTokens(code, redirectUri);
      globalTidalClient.setTokens(tokens.accessToken, tokens.refreshToken, tokens.userId);

      // Clean up
      delete (global as any).tidalRedirectUri;

      res.send(`
        <html>
          <head>
            <title>Tidal Auth Success</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
          </head>
          <body style="font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #121212; color: white;">
            <div style="text-align: center; padding: 40px; border-radius: 20px; background: #1e1e1e; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
              <div style="font-size: 64px; margin-bottom: 20px;">✅</div>
              <h1 style="margin: 0 0 10px 0;">Authentication Successful!</h1>
              <p style="color: #aaa; margin-bottom: 30px;">Your Tidal account is now connected.</p>
              <button onclick="window.close()" style="background: #2196F3; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 16px;">
                Close This Window
              </button>
              <p style="margin-top: 20px; font-size: 14px; color: #666;">You can now return to the SoundStream app.</p>
            </div>
            <script>
              // Try to notify the opener if possible
              if (window.opener) {
                window.opener.postMessage({ type: 'TIDAL_AUTH_SUCCESS' }, '*');
              }
              // Auto-close after 5 seconds if not closed manually
              setTimeout(() => {
                try { window.close(); } catch(e) {}
              }, 5000);
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('[Routes] Tidal callback error:', error);
      res.status(500).send(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  app.post('/api/tidal/set-tokens', (req: Request, res: Response) => {
    try {
      const { accessToken, refreshToken, userId } = req.body;

      if (!globalTidalClient) {
        return res.status(503).json({ error: 'Tidal API client not initialized' });
      }

      if (!accessToken || !refreshToken) {
        return res.status(400).json({ error: 'Access token and refresh token required' });
      }

      globalTidalClient.setTokens(accessToken, refreshToken, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to set Tidal tokens'
      });
    }
  });

  app.get('/api/tidal/status', (req: Request, res: Response) => {
    try {
      if (!globalTidalClient) {
        return res.status(503).json({ error: 'Tidal API client not initialized' });
      }

      const authenticated = globalTidalClient.isAuthenticated();
      const tokens = authenticated ? globalTidalClient.getTokens() : null;

      res.json({
        authenticated,
        hasTokens: !!tokens?.accessToken,
        userId: tokens?.userId,
        clientId: globalTidalClient.getClientId()
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get Tidal status'
      });
    }
  });

  app.get('/api/tidal/cycle-client-id', (req: Request, res: Response) => {
    try {
      if (!globalTidalClient) {
        return res.status(503).json({ error: 'Tidal API client not initialized' });
      }

      const newClientId = globalTidalClient.cycleClientId();
      res.json({ success: true, clientId: newClientId });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to cycle Tidal client ID'
      });
    }
  });

  app.post('/api/tidal/cycle-client-id', (req: Request, res: Response) => {
    try {
      if (!globalTidalClient) {
        return res.status(503).json({ error: 'Tidal API client not initialized' });
      }

      const newClientId = globalTidalClient.cycleClientId();
      res.json({ success: true, clientId: newClientId });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to cycle Tidal client ID'
      });
    }
  });

  app.get('/api/tidal/albums', async (req: Request, res: Response) => {
    try {
      if (!globalTidalClient) {
        return res.status(503).json({ error: 'Tidal API client not initialized' });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await globalTidalClient.getMyAlbums(limit, offset);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get Tidal albums'
      });
    }
  });

  app.get('/api/tidal/playlists', async (req: Request, res: Response) => {
    try {
      if (!globalTidalClient) {
        return res.status(503).json({ error: 'Tidal API client not initialized' });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await globalTidalClient.getMyPlaylists(limit, offset);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get Tidal playlists'
      });
    }
  });

  app.get('/api/tidal/artists', async (req: Request, res: Response) => {
    try {
      if (!globalTidalClient) {
        return res.status(503).json({ error: 'Tidal API client not initialized' });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await globalTidalClient.getMyArtists(limit, offset);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get Tidal artists'
      });
    }
  });

  app.get('/api/tidal/albums/:albumId/tracks', async (req: Request, res: Response) => {
    try {
      if (!globalTidalClient) {
        return res.status(503).json({ error: 'Tidal API client not initialized' });
      }

      const { albumId } = req.params;
      const tracks = await globalTidalClient.getAlbumTracks(albumId);
      res.json({ tracks });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get album tracks'
      });
    }
  });

  app.get('/api/tidal/playlists/:playlistId/tracks', async (req: Request, res: Response) => {
    try {
      if (!globalTidalClient) {
        return res.status(503).json({ error: 'Tidal API client not initialized' });
      }

      const { playlistId } = req.params;
      const tracks = await globalTidalClient.getPlaylistTracks(playlistId);
      res.json({ tracks });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get playlist tracks'
      });
    }
  });

  app.get('/api/tidal/search', async (req: Request, res: Response) => {
    try {
      if (!globalTidalClient) {
        return res.status(503).json({ error: 'Tidal API client not initialized' });
      }

      const { q: query, type = 'albums', limit = 20 } = req.query;

      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Search query required' });
      }

      let results;
      switch (type) {
        case 'albums':
          results = await globalTidalClient.searchAlbums(query, Number(limit));
          break;
        case 'artists':
          results = await globalTidalClient.searchArtists(query, Number(limit));
          break;
        case 'tracks':
          results = await globalTidalClient.searchTracks(query, Number(limit));
          break;
        default:
          return res.status(400).json({ error: 'Invalid search type' });
      }

      res.json({ results });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Search failed'
      });
    }
  });
  const httpServer = createServer(app);

  return httpServer;
}
