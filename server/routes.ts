import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import dgram from "node:dgram";
import { getRoonVolumeControl } from "./roon-volume-control";

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
        'User-Agent': 'Lyriq/1.0 UPnP/1.0',
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
      'User-Agent': 'Lyriq/1.0 UPnP/1.0',
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
  // Health check endpoint for proxy server availability
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      service: 'proxy-server',
      timestamp: new Date().toISOString()
    });
  });

  // Roon volume control endpoints
  app.get('/api/roon/status', async (_req: Request, res: Response) => {
    const roon = getRoonVolumeControl();
    if (!roon) {
      return res.json({
        success: true,
        enabled: false,
        connected: false,
        outputs: [],
        currentOutput: null,
        currentOutputName: null,
      });
    }
    const status = (roon as any).getConnectionStatus?.() || { connected: false, currentOutput: null, currentOutputName: null };
    const outputsMap: Map<string, any> = (roon as any).getOutputs?.() || new Map();
    const outputs = Array.from(outputsMap.values()).map((o: any) => ({
      output_id: o.output_id,
      zone_id: o.zone_id,
      display_name: o.display_name,
      volume_supported: !!o.volume,
    }));

    return res.json({
      success: true,
      enabled: true,
      connected: !!status.connected,
      outputs,
      currentOutput: status.currentOutput ?? null,
      currentOutputName: status.currentOutputName ?? null,
    });
  });

  app.post('/api/roon/output', async (req: Request, res: Response) => {
    const roon = getRoonVolumeControl();
    if (!roon) return res.status(503).json({ success: false, error: 'Roon volume control not initialized' });
    const { output_id } = (req.body as any) || {};
    if (!output_id) return res.status(400).json({ success: false, error: 'Missing output_id' });
    try {
      (roon as any).selectOutput?.(output_id);
      return res.json({ success: true, output_id });
    } catch (e) {
      return res.status(400).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/roon/volume', async (_req: Request, res: Response) => {
    const roon = getRoonVolumeControl();
    if (!roon) return res.status(404).json({ error: 'Roon volume control not initialized' });
    try {
      const volume = await roon.getVolume();
      return res.json({ success: true, volume });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/roon/volume', async (req: Request, res: Response) => {
    const roon = getRoonVolumeControl();
    if (!roon) return res.status(404).json({ error: 'Roon volume control not initialized' });
    const body = (req.body as any) || {};
    // Support multiple client shapes:
    // - { volume: 50 }
    // - { action: 'set', value: 50 }
    // - { value: 50 }
    // - { action: 'up', value: 2 } / { action: 'down', value: 2 }
    // - { action: 'up' } / { action: 'down' } (default step)
    const action = typeof body.action === 'string' ? body.action : undefined;
    const raw =
      body.volume !== undefined ? body.volume :
      body.value !== undefined ? body.value :
      (body.action === 'set' ? body.value : undefined);
    try {
      if (action === 'up' || action === 'down') {
        const stepRaw = body.value ?? body.step ?? 1;
        const step = typeof stepRaw === 'number' ? stepRaw : parseFloat(String(stepRaw));
        if (Number.isNaN(step) || step <= 0 || step > 100) {
          return res.status(400).json({ success: false, error: 'step must be a number (1-100)' });
        }
        const newVolume = action === 'up' ? await (roon as any).volumeUp(step) : await (roon as any).volumeDown(step);
        return res.json({ success: true, volume: newVolume });
      }

      const volume = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (Number.isNaN(volume)) return res.status(400).json({ success: false, error: 'volume must be a number (0-100)' });
      await roon.setVolume(volume);
      return res.json({ success: true, volume });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
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
      'qobuz', 'titles', 'globalsearch', 'playerpref', 'pref', 'squeezecloud'
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
      
      // Qobuz commands may take longer, use 30s timeout for them
      const isQobuzCommand = Array.isArray(command) && command.length > 0 && 
                             String(command[0]).toLowerCase() === 'qobuz';
      const timeoutMs = isQobuzCommand ? 30000 : 10000;
      
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
      console.error('[LMS Proxy] Target:', `http://${host}:${lmsPort}/jsonrpc.js`);
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
            'User-Agent': 'Lyriq/1.0',
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
  // UPnP Volume Control for dCS Varese DAC
  // ==========================================
  // Controls volume on UPnP/OpenHome devices via RenderingControl service
  
  app.post('/api/upnp/volume', async (req: Request, res: Response) => {
    const { action, ip, port = 80, volume, mute } = req.body;
    
    if (!ip || !action) {
      return res.status(400).json({ error: 'Missing ip or action' });
    }
    
    // Validate IP is a private address
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = String(ip).match(ipv4Regex);
    if (!ipMatch) {
      return res.status(403).json({ error: 'Only IPv4 addresses are allowed' });
    }
    
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
      (octets[0] === 192 && octets[1] === 168)
    );
    
    if (!isPrivate) {
      return res.status(403).json({ error: 'Only private network addresses are allowed' });
    }
    
    const devicePort = parseInt(String(port)) || 80;
    const baseUrl = `http://${ip}:${devicePort}`;
    
    // Common RenderingControl control URLs for UPnP devices
    const controlUrls = [
      `${baseUrl}/RenderingControl/ctrl`,
      `${baseUrl}/upnp/control/RenderingControl`,
      `${baseUrl}/MediaRenderer/RenderingControl/Control`,
      `${baseUrl}/dev/RenderingControl/ctrl`,
      `${baseUrl}/RenderingControl`,
    ];
    
    try {
      if (action === 'get') {
        // Get current volume
        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
    </u:GetVolume>
  </s:Body>
</s:Envelope>`;
        
        for (const controlUrl of controlUrls) {
          try {
            console.log(`[UPnP] Trying GetVolume at: ${controlUrl}`);
            const response = await fetch(controlUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPACTION': '"urn:schemas-upnp-org:service:RenderingControl:1#GetVolume"',
              },
              body: soapEnvelope,
              signal: AbortSignal.timeout(5000),
            });
            
            if (response.ok) {
              const text = await response.text();
              console.log(`[UPnP] GetVolume response:`, text.substring(0, 500));
              
              // Try standard UPnP format first (0-100 integer)
              let volumeMatch = text.match(/<CurrentVolume>(\d+)<\/CurrentVolume>/i);
              if (volumeMatch) {
                const currentVolume = parseInt(volumeMatch[1], 10);
                console.log(`[UPnP] Got volume (standard): ${currentVolume}`);
                return res.json({ success: true, volume: currentVolume, format: 'standard' });
              }
              
              // Try dCS/dB format (negative decimals like -34.5)
              volumeMatch = text.match(/<CurrentVolume>(-?\d+\.?\d*)<\/CurrentVolume>/i);
              if (volumeMatch) {
                const dbVolume = parseFloat(volumeMatch[1]);
                // Convert dB to 0-100 scale: dCS range is typically -80dB to 0dB
                // Map -80 to 0%, 0 to 100%
                const percentVolume = Math.round(((dbVolume + 80) / 80) * 100);
                const clampedVolume = Math.max(0, Math.min(100, percentVolume));
                console.log(`[UPnP] Got volume (dB): ${dbVolume}dB -> ${clampedVolume}%`);
                return res.json({ success: true, volume: clampedVolume, dbVolume, format: 'dB' });
              }
              
              // Try Volume tag (some devices use this)
              volumeMatch = text.match(/<Volume>(-?\d+\.?\d*)<\/Volume>/i);
              if (volumeMatch) {
                const vol = parseFloat(volumeMatch[1]);
                if (vol < 0) {
                  // dB format
                  const percentVolume = Math.round(((vol + 80) / 80) * 100);
                  const clampedVolume = Math.max(0, Math.min(100, percentVolume));
                  console.log(`[UPnP] Got volume (dB alt): ${vol}dB -> ${clampedVolume}%`);
                  return res.json({ success: true, volume: clampedVolume, dbVolume: vol, format: 'dB' });
                } else {
                  console.log(`[UPnP] Got volume (alt): ${vol}`);
                  return res.json({ success: true, volume: Math.round(vol), format: 'standard' });
                }
              }
              
              console.log(`[UPnP] Could not parse volume from response`);
            }
          } catch (e) {
            console.log(`[UPnP] Failed at ${controlUrl}:`, e);
            continue;
          }
        }
        
        return res.status(500).json({ error: 'Failed to get volume from device' });
        
      } else if (action === 'set') {
        // Set volume
        if (volume === undefined || volume < 0 || volume > 100) {
          return res.status(400).json({ error: 'Volume must be between 0 and 100' });
        }
        
        // Check if device uses dB format (from request body or default to percentage)
        const useDbFormat = req.body.useDbFormat === true;
        let volumeValue: string;
        
        if (useDbFormat) {
          // Convert 0-100 to dB scale (-80 to 0)
          const dbVolume = ((volume / 100) * 80) - 80;
          volumeValue = dbVolume.toFixed(1);
          console.log(`[UPnP] Setting volume: ${volume}% -> ${volumeValue}dB`);
        } else {
          volumeValue = String(Math.round(volume));
        }
        
        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredVolume>${volumeValue}</DesiredVolume>
    </u:SetVolume>
  </s:Body>
</s:Envelope>`;
        
        for (const controlUrl of controlUrls) {
          try {
            console.log(`[UPnP] Trying SetVolume(${volume}) at: ${controlUrl}`);
            const response = await fetch(controlUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPACTION': '"urn:schemas-upnp-org:service:RenderingControl:1#SetVolume"',
              },
              body: soapEnvelope,
              signal: AbortSignal.timeout(5000),
            });
            
            if (response.ok) {
              console.log(`[UPnP] Set volume to ${volume} successfully`);
              return res.json({ success: true, volume });
            }
          } catch (e) {
            console.log(`[UPnP] Failed at ${controlUrl}:`, e);
            continue;
          }
        }
        
        return res.status(500).json({ error: 'Failed to set volume on device' });
        
      } else if (action === 'mute') {
        // Set mute state
        const muteValue = mute ? '1' : '0';
        
        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetMute xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredMute>${muteValue}</DesiredMute>
    </u:SetMute>
  </s:Body>
</s:Envelope>`;
        
        for (const controlUrl of controlUrls) {
          try {
            console.log(`[UPnP] Trying SetMute(${mute}) at: ${controlUrl}`);
            const response = await fetch(controlUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPACTION': '"urn:schemas-upnp-org:service:RenderingControl:1#SetMute"',
              },
              body: soapEnvelope,
              signal: AbortSignal.timeout(5000),
            });
            
            if (response.ok) {
              console.log(`[UPnP] Set mute to ${mute} successfully`);
              return res.json({ success: true, muted: mute });
            }
          } catch (e) {
            console.log(`[UPnP] Failed at ${controlUrl}:`, e);
            continue;
          }
        }
        
        return res.status(500).json({ error: 'Failed to set mute on device' });
        
      } else {
        return res.status(400).json({ error: 'Invalid action. Use: get, set, or mute' });
      }
    } catch (error) {
      console.error('[UPnP] Error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'UPnP request failed' 
      });
    }
  });

  // Discover UPnP device description and find RenderingControl URL
  app.get('/api/upnp/discover', async (req: Request, res: Response) => {
    const { ip, port = 80 } = req.query;
    
    if (!ip) {
      return res.status(400).json({ error: 'Missing ip' });
    }
    
    const devicePort = parseInt(String(port)) || 80;
    const baseUrl = `http://${ip}:${devicePort}`;
    
    // Try common device description URLs
    const descriptionUrls = [
      `${baseUrl}/description.xml`,
      `${baseUrl}/upnp/desc.xml`,
      `${baseUrl}/DeviceDescription.xml`,
      `${baseUrl}/dev/desc.xml`,
      `${baseUrl}/`,
    ];
    
    try {
      for (const descUrl of descriptionUrls) {
        try {
          console.log(`[UPnP] Trying device description at: ${descUrl}`);
          const response = await fetch(descUrl, {
            signal: AbortSignal.timeout(5000),
          });
          
          if (response.ok) {
            const xml = await response.text();
            
            // Extract device info
            const friendlyNameMatch = xml.match(/<friendlyName>([^<]*)<\/friendlyName>/i);
            const manufacturerMatch = xml.match(/<manufacturer>([^<]*)<\/manufacturer>/i);
            const modelNameMatch = xml.match(/<modelName>([^<]*)<\/modelName>/i);
            
            // Find RenderingControl service URL
            let renderingControlUrl: string | null = null;
            const serviceRegex = /<service>([\s\S]*?)<\/service>/gi;
            let match;
            
            while ((match = serviceRegex.exec(xml)) !== null) {
              const serviceXml = match[1];
              if (serviceXml.includes('RenderingControl')) {
                const controlURLMatch = serviceXml.match(/<controlURL>([^<]+)<\/controlURL>/i);
                if (controlURLMatch) {
                  let controlURL = controlURLMatch[1];
                  if (controlURL.startsWith('/')) {
                    controlURL = baseUrl + controlURL;
                  } else if (!controlURL.startsWith('http')) {
                    controlURL = baseUrl + '/' + controlURL;
                  }
                  renderingControlUrl = controlURL;
                  break;
                }
              }
            }
            
            return res.json({
              success: true,
              device: {
                ip,
                port: devicePort,
                friendlyName: friendlyNameMatch?.[1] || 'Unknown Device',
                manufacturer: manufacturerMatch?.[1],
                modelName: modelNameMatch?.[1],
                renderingControlUrl,
              }
            });
          }
        } catch (e) {
          continue;
        }
      }
      
      return res.status(404).json({ error: 'Could not find device description' });
    } catch (error) {
      console.error('[UPnP] Discovery error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Discovery failed' 
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
            const timeoutMs = 2000;
            const found: Array<{ id: string; name: string; host: string; port: number; type: string; version?: string }> = [];
            
            const ipRanges = [
              { base: [192, 168, 0], maxHost: 30 },
              { base: [192, 168, 1], maxHost: 30 },
              { base: [10, 0, 0], maxHost: 30 },
              { base: [172, 16, 0], maxHost: 30 },
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
                          headers: { 'User-Agent': 'Lyriq/1.0 UPnP/1.0' },
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
      
      const allServers = [...lmsServers, ...minimServers, ...upnpDevices];
      console.log(`[Servers] Combined discovery complete, found ${allServers.length} server(s) (${lmsServers.length} LMS, ${minimServers.length} MinimServer, ${upnpDevices.length} UPnP)`);
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
          'User-Agent': 'Mozilla/5.0 (compatible; Lyriq/1.0)',
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
      const { ip, name, enabled, lmsHost, lmsPort } = req.body;
      
      if (!ip) {
        return res.status(400).json({ error: 'Chromecast IP is required' });
      }

      const serverPort = process.env.PORT || '3000';
      const localBase = `http://127.0.0.1:${serverPort}`;

      // Persist LMS config (optional)
      if (lmsHost) {
        try {
          await fetch(`${localBase}/api/lms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host: lmsHost, port: lmsPort || 9000 }),
            signal: AbortSignal.timeout(5000),
          });
        } catch (e) {
          console.warn('[Chromecast] Failed to persist LMS settings:', e instanceof Error ? e.message : String(e));
        }
      }

      const friendlyName = name || `Chromecast ${ip}`;

      // Persist Chromecast config (used by relay server for auto-casting)
      await fetch(`${localBase}/api/chromecast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, name: friendlyName, enabled: enabled !== false }),
        signal: AbortSignal.timeout(5000),
      });

      // Proactively launch the custom receiver so the TV updates immediately
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const chromecastService = require('./chromecast-service');
        chromecastService.configure(ip, friendlyName, enabled !== false);
        // Force a full reload of the receiver HTML (Chromecast can cache aggressively)
        await chromecastService.stop();
        await chromecastService.ensureLaunched();
      } catch (e) {
        console.warn('[Chromecast] Could not proactively launch receiver:', e instanceof Error ? e.message : String(e));
      }

      return res.json({
        success: true,
        message: 'Chromecast configured (no Dashcast). Receiver will show SoundStream UI while music plays.',
        chromecastIp: ip,
        chromecastName: friendlyName,
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

  // Chromecast status endpoint - gets current status from relay server
  app.get('/api/chromecast/status', async (req: Request, res: Response) => {
    try {
      // Try to get status from the relay server on 192.168.0.21:3000
      try {
        const relayResponse = await fetch('http://192.168.0.21:3000/api/status', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        });
        
        if (relayResponse.ok) {
          const status = await relayResponse.json();
          return res.json(status);
        }
      } catch (relayError) {
        console.log('[Chromecast] Relay server not available for status:', relayError instanceof Error ? relayError.message : String(relayError));
      }
      
      // Fallback response if relay server is not available
      return res.json({
        chromecastIp: '',
        chromecastName: '',
        chromecastEnabled: false,
        isCasting: false,
        serverIp: '',
      });
      
    } catch (error) {
      console.error('[Chromecast] Status error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to get status' 
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

  const httpServer = createServer(app);

  return httpServer;
}
