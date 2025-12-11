import { DiscoveredDevice, ServiceInfo } from '../hooks/useSsdpDiscovery';

export interface BrowseResult {
  containers: Container[];
  items: Item[];
  totalMatches: number;
  numberReturned: number;
}

export interface Container {
  id: string;
  parentId: string;
  title: string;
  childCount?: number;
  albumArtURI?: string;
  creator?: string;
}

export interface Item {
  id: string;
  parentId: string;
  title: string;
  album?: string;
  artist?: string;
  albumArtURI?: string;
  duration?: string;
  trackNumber?: number;
  res?: ResourceInfo[];
}

export interface ResourceInfo {
  uri: string;
  protocolInfo?: string;
  size?: number;
  duration?: string;
  bitrate?: number;
  sampleFrequency?: number;
  bitsPerSample?: number;
  nrAudioChannels?: number;
}

const createSoapEnvelope = (action: string, serviceType: string, body: string): string => {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${serviceType}">
${body}
    </u:${action}>
  </s:Body>
</s:Envelope>`;
};

const decodeXmlEntities = (text: string): string => {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
};

const parseDIDLLite = (didlXml: string): { containers: Container[]; items: Item[] } => {
  const containers: Container[] = [];
  const items: Item[] = [];
  
  const decoded = decodeXmlEntities(didlXml);
  
  const containerMatches = decoded.matchAll(/<container[^>]*>([\s\S]*?)<\/container>/gi);
  for (const match of containerMatches) {
    const containerXml = match[0];
    const content = match[1];
    
    const idMatch = containerXml.match(/id="([^"]+)"/);
    const parentIdMatch = containerXml.match(/parentID="([^"]+)"/);
    const childCountMatch = containerXml.match(/childCount="([^"]+)"/);
    const titleMatch = content.match(/<dc:title>([^<]+)<\/dc:title>/);
    const albumArtMatch = content.match(/<upnp:albumArtURI>([^<]+)<\/upnp:albumArtURI>/);
    const creatorMatch = content.match(/<dc:creator>([^<]+)<\/dc:creator>/);
    
    if (idMatch && titleMatch) {
      containers.push({
        id: idMatch[1],
        parentId: parentIdMatch?.[1] || '0',
        title: titleMatch[1],
        childCount: childCountMatch ? parseInt(childCountMatch[1]) : undefined,
        albumArtURI: albumArtMatch?.[1],
        creator: creatorMatch?.[1],
      });
    }
  }
  
  const itemMatches = decoded.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);
  for (const match of itemMatches) {
    const itemXml = match[0];
    const content = match[1];
    
    const idMatch = itemXml.match(/id="([^"]+)"/);
    const parentIdMatch = itemXml.match(/parentID="([^"]+)"/);
    const titleMatch = content.match(/<dc:title>([^<]+)<\/dc:title>/);
    const albumMatch = content.match(/<upnp:album>([^<]+)<\/upnp:album>/);
    const artistMatch = content.match(/<upnp:artist>([^<]+)<\/upnp:artist>/) || 
                       content.match(/<dc:creator>([^<]+)<\/dc:creator>/);
    const albumArtMatch = content.match(/<upnp:albumArtURI>([^<]+)<\/upnp:albumArtURI>/);
    const trackNumberMatch = content.match(/<upnp:originalTrackNumber>([^<]+)<\/upnp:originalTrackNumber>/);
    
    const resources: ResourceInfo[] = [];
    const resMatches = content.matchAll(/<res([^>]*)>([^<]+)<\/res>/gi);
    for (const resMatch of resMatches) {
      const resAttrs = resMatch[1];
      const resUri = resMatch[2];
      
      const protocolInfo = resAttrs.match(/protocolInfo="([^"]+)"/)?.[1];
      const duration = resAttrs.match(/duration="([^"]+)"/)?.[1];
      const size = resAttrs.match(/size="([^"]+)"/)?.[1];
      const bitrate = resAttrs.match(/bitrate="([^"]+)"/)?.[1];
      const sampleFrequency = resAttrs.match(/sampleFrequency="([^"]+)"/)?.[1];
      const bitsPerSample = resAttrs.match(/bitsPerSample="([^"]+)"/)?.[1];
      const nrAudioChannels = resAttrs.match(/nrAudioChannels="([^"]+)"/)?.[1];
      
      resources.push({
        uri: resUri,
        protocolInfo,
        duration,
        size: size ? parseInt(size) : undefined,
        bitrate: bitrate ? parseInt(bitrate) : undefined,
        sampleFrequency: sampleFrequency ? parseInt(sampleFrequency) : undefined,
        bitsPerSample: bitsPerSample ? parseInt(bitsPerSample) : undefined,
        nrAudioChannels: nrAudioChannels ? parseInt(nrAudioChannels) : undefined,
      });
    }
    
    if (idMatch && titleMatch) {
      items.push({
        id: idMatch[1],
        parentId: parentIdMatch?.[1] || '0',
        title: titleMatch[1],
        album: albumMatch?.[1],
        artist: artistMatch?.[1],
        albumArtURI: albumArtMatch?.[1],
        trackNumber: trackNumberMatch ? parseInt(trackNumberMatch[1]) : undefined,
        res: resources,
      });
    }
  }
  
  return { containers, items };
};

export const browseContentDirectory = async (
  controlURL: string,
  objectId: string = '0',
  browseFlag: 'BrowseDirectChildren' | 'BrowseMetadata' = 'BrowseDirectChildren',
  startingIndex: number = 0,
  requestedCount: number = 0
): Promise<BrowseResult> => {
  const serviceType = 'urn:schemas-upnp-org:service:ContentDirectory:1';
  const action = 'Browse';
  
  const body = `      <ObjectID>${objectId}</ObjectID>
      <BrowseFlag>${browseFlag}</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>${startingIndex}</StartingIndex>
      <RequestedCount>${requestedCount}</RequestedCount>
      <SortCriteria></SortCriteria>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('UPNP Browse request to:', controlURL);
  console.log('UPNP Browse ObjectID:', objectId);
  
  try {
    const response = await fetch(controlURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml;charset="utf-8"',
        'SOAPAction': soapAction,
        'User-Agent': 'iOS/18.0 UPnP/1.0 SoundStream/1.0',
        'Connection': 'Keep-Alive',
      },
      body: soapEnvelope,
    });
    
    console.log('UPNP Browse response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('UPNP Browse error:', errorText);
      throw new Error(`UPNP Browse failed: ${response.status} ${response.statusText}`);
    }
    
    const responseXml = await response.text();
    console.log('UPNP Browse response preview:', responseXml.substring(0, 500));
    
    const resultMatch = responseXml.match(/<Result>([^]*?)<\/Result>/);
    const totalMatchesMatch = responseXml.match(/<TotalMatches>(\d+)<\/TotalMatches>/);
    const numberReturnedMatch = responseXml.match(/<NumberReturned>(\d+)<\/NumberReturned>/);
    
    if (!resultMatch) {
      console.log('No Result element found in response');
      return { containers: [], items: [], totalMatches: 0, numberReturned: 0 };
    }
    
    const didlLite = resultMatch[1];
    const { containers, items } = parseDIDLLite(didlLite);
    
    console.log('Parsed UPNP response:', containers.length, 'containers,', items.length, 'items');
    
    return {
      containers,
      items,
      totalMatches: totalMatchesMatch ? parseInt(totalMatchesMatch[1]) : containers.length + items.length,
      numberReturned: numberReturnedMatch ? parseInt(numberReturnedMatch[1]) : containers.length + items.length,
    };
  } catch (error) {
    console.error('UPNP Browse request failed:', error);
    throw error;
  }
};

export const searchContentDirectory = async (
  controlURL: string,
  containerId: string = '0',
  searchCriteria: string,
  startingIndex: number = 0,
  requestedCount: number = 0
): Promise<BrowseResult> => {
  const serviceType = 'urn:schemas-upnp-org:service:ContentDirectory:1';
  const action = 'Search';
  
  const body = `      <ContainerID>${containerId}</ContainerID>
      <SearchCriteria>${searchCriteria}</SearchCriteria>
      <Filter>*</Filter>
      <StartingIndex>${startingIndex}</StartingIndex>
      <RequestedCount>${requestedCount}</RequestedCount>
      <SortCriteria></SortCriteria>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  try {
    const response = await fetch(controlURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': soapAction,
      },
      body: soapEnvelope,
    });
    
    if (!response.ok) {
      throw new Error(`UPNP Search failed: ${response.status}`);
    }
    
    const responseXml = await response.text();
    const resultMatch = responseXml.match(/<Result>([^]*?)<\/Result>/);
    const totalMatchesMatch = responseXml.match(/<TotalMatches>(\d+)<\/TotalMatches>/);
    const numberReturnedMatch = responseXml.match(/<NumberReturned>(\d+)<\/NumberReturned>/);
    
    if (!resultMatch) {
      return { containers: [], items: [], totalMatches: 0, numberReturned: 0 };
    }
    
    const { containers, items } = parseDIDLLite(resultMatch[1]);
    
    return {
      containers,
      items,
      totalMatches: totalMatchesMatch ? parseInt(totalMatchesMatch[1]) : 0,
      numberReturned: numberReturnedMatch ? parseInt(numberReturnedMatch[1]) : 0,
    };
  } catch (error) {
    console.error('UPNP Search failed:', error);
    throw error;
  }
};

export const setAVTransportURI = async (
  controlURL: string,
  instanceId: number = 0,
  currentURI: string,
  currentURIMetaData: string = ''
): Promise<void> => {
  const serviceType = 'urn:schemas-upnp-org:service:AVTransport:1';
  const action = 'SetAVTransportURI';
  
  const escapedURI = currentURI.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedMetaData = currentURIMetaData.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  const body = `      <InstanceID>${instanceId}</InstanceID>
      <CurrentURI>${escapedURI}</CurrentURI>
      <CurrentURIMetaData>${escapedMetaData}</CurrentURIMetaData>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  const response = await fetch(controlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SetAVTransportURI failed: ${response.status} - ${errorText}`);
  }
};

export const play = async (controlURL: string, instanceId: number = 0, speed: string = '1'): Promise<void> => {
  const serviceType = 'urn:schemas-upnp-org:service:AVTransport:1';
  const action = 'Play';
  
  const body = `      <InstanceID>${instanceId}</InstanceID>
      <Speed>${speed}</Speed>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  const response = await fetch(controlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    throw new Error(`Play failed: ${response.status}`);
  }
};

export const pause = async (controlURL: string, instanceId: number = 0): Promise<void> => {
  const serviceType = 'urn:schemas-upnp-org:service:AVTransport:1';
  const action = 'Pause';
  
  const body = `      <InstanceID>${instanceId}</InstanceID>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  const response = await fetch(controlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    throw new Error(`Pause failed: ${response.status}`);
  }
};

export const stop = async (controlURL: string, instanceId: number = 0): Promise<void> => {
  const serviceType = 'urn:schemas-upnp-org:service:AVTransport:1';
  const action = 'Stop';
  
  const body = `      <InstanceID>${instanceId}</InstanceID>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  const response = await fetch(controlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    throw new Error(`Stop failed: ${response.status}`);
  }
};

export const getTransportInfo = async (controlURL: string, instanceId: number = 0): Promise<{
  currentTransportState: string;
  currentTransportStatus: string;
  currentSpeed: string;
}> => {
  const serviceType = 'urn:schemas-upnp-org:service:AVTransport:1';
  const action = 'GetTransportInfo';
  
  const body = `      <InstanceID>${instanceId}</InstanceID>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  const response = await fetch(controlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    throw new Error(`GetTransportInfo failed: ${response.status}`);
  }
  
  const xml = await response.text();
  
  return {
    currentTransportState: xml.match(/<CurrentTransportState>([^<]+)<\/CurrentTransportState>/)?.[1] || 'UNKNOWN',
    currentTransportStatus: xml.match(/<CurrentTransportStatus>([^<]+)<\/CurrentTransportStatus>/)?.[1] || 'UNKNOWN',
    currentSpeed: xml.match(/<CurrentSpeed>([^<]+)<\/CurrentSpeed>/)?.[1] || '1',
  };
};

export const getPositionInfo = async (controlURL: string, instanceId: number = 0): Promise<{
  track: number;
  trackDuration: string;
  trackMetaData: string;
  trackURI: string;
  relTime: string;
  absTime: string;
}> => {
  const serviceType = 'urn:schemas-upnp-org:service:AVTransport:1';
  const action = 'GetPositionInfo';
  
  const body = `      <InstanceID>${instanceId}</InstanceID>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  const response = await fetch(controlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    throw new Error(`GetPositionInfo failed: ${response.status}`);
  }
  
  const xml = await response.text();
  
  return {
    track: parseInt(xml.match(/<Track>(\d+)<\/Track>/)?.[1] || '0'),
    trackDuration: xml.match(/<TrackDuration>([^<]+)<\/TrackDuration>/)?.[1] || '0:00:00',
    trackMetaData: xml.match(/<TrackMetaData>([^<]*)<\/TrackMetaData>/)?.[1] || '',
    trackURI: xml.match(/<TrackURI>([^<]*)<\/TrackURI>/)?.[1] || '',
    relTime: xml.match(/<RelTime>([^<]+)<\/RelTime>/)?.[1] || '0:00:00',
    absTime: xml.match(/<AbsTime>([^<]+)<\/AbsTime>/)?.[1] || '0:00:00',
  };
};

export const seek = async (
  controlURL: string,
  instanceId: number = 0,
  unit: 'REL_TIME' | 'ABS_TIME' | 'TRACK_NR' = 'REL_TIME',
  target: string
): Promise<void> => {
  const serviceType = 'urn:schemas-upnp-org:service:AVTransport:1';
  const action = 'Seek';
  
  const body = `      <InstanceID>${instanceId}</InstanceID>
      <Unit>${unit}</Unit>
      <Target>${target}</Target>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  const response = await fetch(controlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    throw new Error(`Seek failed: ${response.status}`);
  }
};

// OpenHome Product service for input source switching
// dCS Varese uses OpenHome protocol for source management

export interface OpenHomeSource {
  name: string;
  type: string;
  visible: boolean;
  systemName: string;
}

export const getOpenHomeSources = async (productControlURL: string): Promise<OpenHomeSource[]> => {
  const serviceType = 'urn:av-openhome-org:service:Product:1';
  const action = 'SourceXml';
  
  const body = '';
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('Getting OpenHome sources from:', productControlURL);
  
  const response = await fetch(productControlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    console.log('SourceXml failed, trying SourceArray...');
    // Try SourceArray as alternative
    const arrayEnvelope = createSoapEnvelope('SourceArray', serviceType, '');
    const arrayResponse = await fetch(productControlURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': `"${serviceType}#SourceArray"`,
      },
      body: arrayEnvelope,
    });
    
    if (!arrayResponse.ok) {
      throw new Error(`Failed to get sources: ${arrayResponse.status}`);
    }
    
    const xml = await arrayResponse.text();
    console.log('SourceArray response:', xml.substring(0, 500));
    
    // Parse JSON array from response
    const arrayMatch = xml.match(/<Value>([^<]*)<\/Value>/);
    if (arrayMatch) {
      try {
        return JSON.parse(decodeXmlEntities(arrayMatch[1]));
      } catch (e) {
        console.error('Failed to parse source array:', e);
        return [];
      }
    }
    return [];
  }
  
  const xml = await response.text();
  console.log('SourceXml response:', xml.substring(0, 500));
  
  // Parse XML sources
  const sources: OpenHomeSource[] = [];
  const sourceMatches = xml.matchAll(/<Source[^>]*>([\s\S]*?)<\/Source>/gi);
  for (const match of sourceMatches) {
    const sourceXml = match[1];
    const name = sourceXml.match(/<Name>([^<]*)<\/Name>/)?.[1] || '';
    const type = sourceXml.match(/<Type>([^<]*)<\/Type>/)?.[1] || '';
    const visible = sourceXml.match(/<Visible>([^<]*)<\/Visible>/)?.[1] === 'true';
    const systemName = sourceXml.match(/<SystemName>([^<]*)<\/SystemName>/)?.[1] || name;
    
    sources.push({ name, type, visible, systemName });
  }
  
  return sources;
};

export const setOpenHomeSourceIndex = async (productControlURL: string, sourceIndex: number): Promise<void> => {
  const serviceType = 'urn:av-openhome-org:service:Product:1';
  const action = 'SetSourceIndex';
  
  const body = `      <Value>${sourceIndex}</Value>`;
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('Setting OpenHome source index to:', sourceIndex);
  
  const response = await fetch(productControlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('SetSourceIndex failed:', errorText);
    throw new Error(`SetSourceIndex failed: ${response.status}`);
  }
  
  console.log('Source index set successfully');
};

export const switchToNetworkSource = async (productControlURL: string): Promise<void> => {
  try {
    const sources = await getOpenHomeSources(productControlURL);
    console.log('Available sources:', sources.map(s => `${s.name} (${s.type})`).join(', '));
    
    // Find the network/UPnP/Playlist source - these are typical names for network streaming
    const networkSourceIndex = sources.findIndex(s => 
      s.type.toLowerCase() === 'upnpav' ||
      s.type.toLowerCase() === 'playlist' ||
      s.type.toLowerCase() === 'netaux' ||
      s.name.toLowerCase().includes('network') ||
      s.name.toLowerCase().includes('upnp') ||
      s.name.toLowerCase().includes('stream')
    );
    
    if (networkSourceIndex === -1) {
      console.log('No network source found, available types:', sources.map(s => s.type));
      return; // Don't fail, just log
    }
    
    console.log(`Switching to source: ${sources[networkSourceIndex].name} (index ${networkSourceIndex})`);
    await setOpenHomeSourceIndex(productControlURL, networkSourceIndex);
    
    // Brief delay for input to switch
    await new Promise(resolve => setTimeout(resolve, 300));
  } catch (error) {
    console.log('OpenHome source switching not available:', error);
    // Don't throw - source switching may not be supported
  }
};

// OpenHome Playlist service for track playback
// dCS Varese uses this instead of standard AVTransport for playing tracks

export const playlistInsert = async (
  playlistControlURL: string, 
  afterId: number, 
  uri: string, 
  metadata: string = ''
): Promise<number> => {
  const serviceType = 'urn:av-openhome-org:service:Playlist:1';
  const action = 'Insert';
  
  // Escape XML special characters in URI and metadata
  const escapedUri = uri.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedMetadata = metadata.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  const body = `      <AfterId>${afterId}</AfterId>
      <Uri>${escapedUri}</Uri>
      <Metadata>${escapedMetadata}</Metadata>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('Inserting track into OpenHome Playlist:', uri);
  
  const response = await fetch(playlistControlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Playlist Insert failed:', errorText);
    throw new Error(`Playlist Insert failed: ${response.status}`);
  }
  
  const xml = await response.text();
  console.log('Insert response:', xml.substring(0, 300));
  
  // Extract NewId from response
  const newIdMatch = xml.match(/<NewId>(\d+)<\/NewId>/i);
  const newId = newIdMatch ? parseInt(newIdMatch[1], 10) : 0;
  console.log('New track ID:', newId);
  
  return newId;
};

export const playlistSeekId = async (playlistControlURL: string, id: number): Promise<void> => {
  const serviceType = 'urn:av-openhome-org:service:Playlist:1';
  const action = 'SeekId';
  
  const body = `      <Value>${id}</Value>`;
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('Seeking to track ID:', id);
  
  const response = await fetch(playlistControlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Playlist SeekId failed:', errorText);
    throw new Error(`Playlist SeekId failed: ${response.status}`);
  }
  
  console.log('SeekId successful');
};

export const playlistPlay = async (playlistControlURL: string): Promise<void> => {
  const serviceType = 'urn:av-openhome-org:service:Playlist:1';
  const action = 'Play';
  
  const body = '';
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('Sending OpenHome Playlist Play command');
  
  const response = await fetch(playlistControlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Playlist Play failed:', errorText);
    throw new Error(`Playlist Play failed: ${response.status}`);
  }
  
  console.log('Playlist Play successful');
};

export const playlistPause = async (playlistControlURL: string): Promise<void> => {
  const serviceType = 'urn:av-openhome-org:service:Playlist:1';
  const action = 'Pause';
  
  const body = '';
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('Sending OpenHome Playlist Pause command');
  
  const response = await fetch(playlistControlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Playlist Pause failed:', errorText);
    throw new Error(`Playlist Pause failed: ${response.status}`);
  }
  
  console.log('Playlist Pause successful');
};

export const playlistDeleteAll = async (playlistControlURL: string): Promise<void> => {
  const serviceType = 'urn:av-openhome-org:service:Playlist:1';
  const action = 'DeleteAll';
  
  const body = '';
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('Clearing OpenHome Playlist');
  
  const response = await fetch(playlistControlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    // Don't throw - DeleteAll might fail if playlist is already empty
    console.log('Playlist DeleteAll returned:', response.status);
  } else {
    console.log('Playlist cleared');
  }
};

// RenderingControl service functions for volume control

export const setVolume = async (
  controlURL: string,
  instanceId: number = 0,
  channel: 'Master' | 'LF' | 'RF' = 'Master',
  desiredVolume: number
): Promise<void> => {
  const serviceType = 'urn:schemas-upnp-org:service:RenderingControl:1';
  const action = 'SetVolume';
  
  // Clamp volume between 0 and 100
  const volume = Math.max(0, Math.min(100, Math.round(desiredVolume)));
  
  const body = `      <InstanceID>${instanceId}</InstanceID>
      <Channel>${channel}</Channel>
      <DesiredVolume>${volume}</DesiredVolume>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  const response = await fetch(controlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SetVolume failed: ${response.status} - ${errorText}`);
  }
};

export const getVolume = async (
  controlURL: string,
  instanceId: number = 0,
  channel: 'Master' | 'LF' | 'RF' = 'Master'
): Promise<number> => {
  const serviceType = 'urn:schemas-upnp-org:service:RenderingControl:1';
  const action = 'GetVolume';
  
  const body = `      <InstanceID>${instanceId}</InstanceID>
      <Channel>${channel}</Channel>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  const response = await fetch(controlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    throw new Error(`GetVolume failed: ${response.status}`);
  }
  
  const xml = await response.text();
  const volumeMatch = xml.match(/<CurrentVolume>(\d+)<\/CurrentVolume>/);
  return volumeMatch ? parseInt(volumeMatch[1]) : 0;
};

export const setMute = async (
  controlURL: string,
  instanceId: number = 0,
  channel: 'Master' | 'LF' | 'RF' = 'Master',
  desiredMute: boolean
): Promise<void> => {
  const serviceType = 'urn:schemas-upnp-org:service:RenderingControl:1';
  const action = 'SetMute';
  
  const body = `      <InstanceID>${instanceId}</InstanceID>
      <Channel>${channel}</Channel>
      <DesiredMute>${desiredMute ? '1' : '0'}</DesiredMute>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  const response = await fetch(controlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    throw new Error(`SetMute failed: ${response.status}`);
  }
};

export const getMute = async (
  controlURL: string,
  instanceId: number = 0,
  channel: 'Master' | 'LF' | 'RF' = 'Master'
): Promise<boolean> => {
  const serviceType = 'urn:schemas-upnp-org:service:RenderingControl:1';
  const action = 'GetMute';
  
  const body = `      <InstanceID>${instanceId}</InstanceID>
      <Channel>${channel}</Channel>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  const response = await fetch(controlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  if (!response.ok) {
    throw new Error(`GetMute failed: ${response.status}`);
  }
  
  const xml = await response.text();
  const muteMatch = xml.match(/<CurrentMute>(\d+)<\/CurrentMute>/);
  return muteMatch ? muteMatch[1] === '1' : false;
};
