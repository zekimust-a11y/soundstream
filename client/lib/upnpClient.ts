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
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': soapAction,
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
