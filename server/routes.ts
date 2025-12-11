import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";

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

  const httpServer = createServer(app);

  return httpServer;
}
