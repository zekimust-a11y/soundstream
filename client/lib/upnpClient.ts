import { DiscoveredDevice, ServiceInfo } from '../hooks/useSsdpDiscovery';
import { debugLog } from './debugLog';

// Bridge proxy URL for routing requests through Mac when Expo Go can't reach local devices
let bridgeProxyUrl: string | null = null;

export const setBridgeProxyUrl = (url: string | null) => {
  bridgeProxyUrl = url;
  console.log('[UPnP] Bridge proxy URL set to:', url);
};

export const getBridgeProxyUrl = () => bridgeProxyUrl;

// Try direct request first, fall back to bridge proxy if direct fails
// This gives best performance in development builds while still working in Expo Go
const proxySoapRequest = async (
  targetUrl: string,
  soapAction: string,
  body: string,
  timeoutMs: number = 3000
): Promise<{ ok: boolean; status: number; text: string }> => {
  // Extract action name from SOAP action string for logging
  const actionMatch = soapAction.match(/#(\w+)"?$/);
  const actionName = actionMatch ? actionMatch[1] : 'Unknown';
  const isLocalTarget = targetUrl.includes('192.168.') || targetUrl.includes('10.') || targetUrl.includes('172.');
  
  // Try direct request first (works in development builds with proper ATS settings)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    debugLog.request(`${actionName}`, `direct -> ${targetUrl.substring(0, 60)}...`);
    
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': soapAction,
      },
      body: body,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const text = await response.text();
    
    if (response.ok) {
      debugLog.response(`${actionName} OK (direct)`, `${response.status} in ${timeoutMs}ms`);
    } else {
      debugLog.error(`${actionName} failed (direct)`, `${response.status}`);
    }
    
    return { ok: response.ok, status: response.status, text };
  } catch (directError) {
    // Direct request failed - try bridge proxy if available
    if (bridgeProxyUrl && isLocalTarget) {
      debugLog.info(`${actionName} direct failed, trying bridge...`);
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
        const response = await fetch(`${bridgeProxyUrl}/proxy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset="utf-8"',
            'X-Target-URL': targetUrl,
            'X-SOAP-Action': soapAction,
          },
          body: body,
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        const text = await response.text();
        
        if (response.ok) {
          debugLog.response(`${actionName} OK (bridge)`, `${response.status}`);
        } else {
          debugLog.error(`${actionName} failed (bridge)`, `${response.status}`);
        }
        
        return { ok: response.ok, status: response.status, text };
      } catch (bridgeError) {
        const errorMessage = bridgeError instanceof Error ? bridgeError.message : String(bridgeError);
        debugLog.error(`${actionName} bridge error`, errorMessage);
        throw bridgeError;
      }
    }
    
    // No bridge available, propagate original error
    const errorMessage = directError instanceof Error ? directError.message : String(directError);
    debugLog.error(`${actionName} error`, errorMessage);
    throw directError;
  }
};

// Fetch with timeout helper - React Native fetch doesn't have native timeout
const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number = 15000): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Network request timed out');
    }
    throw error;
  }
};

// Interface for parsed OpenHome services from device description
export interface OpenHomeServices {
  playlistControlURL?: string;
  transportControlURL?: string;
  productControlURL?: string;
  avTransportControlURL?: string;
  renderingControlURL?: string;
}

// Fetch and parse device description to discover OpenHome service URLs
export const fetchDeviceServices = async (deviceDescriptionURL: string): Promise<OpenHomeServices> => {
  console.log('Fetching device description from:', deviceDescriptionURL);
  
  try {
    const response = await fetch(deviceDescriptionURL);
    if (!response.ok) {
      throw new Error(`Failed to fetch device description: ${response.status}`);
    }
    
    const xml = await response.text();
    console.log('Device description XML length:', xml.length);
    console.log('Device description preview:', xml.substring(0, 1000));
    
    const services: OpenHomeServices = {};
    
    // Extract base URL from device description URL
    const urlParts = new URL(deviceDescriptionURL);
    const baseURL = `${urlParts.protocol}//${urlParts.host}`;
    
    // Find all service entries - look for serviceType and controlURL pairs
    const serviceRegex = /<service>([\s\S]*?)<\/service>/gi;
    let match;
    
    while ((match = serviceRegex.exec(xml)) !== null) {
      const serviceXml = match[1];
      
      const serviceTypeMatch = serviceXml.match(/<serviceType>([^<]+)<\/serviceType>/);
      const controlURLMatch = serviceXml.match(/<controlURL>([^<]+)<\/controlURL>/);
      
      if (serviceTypeMatch && controlURLMatch) {
        const serviceType = serviceTypeMatch[1];
        let controlURL = controlURLMatch[1];
        
        // Make controlURL absolute if relative
        if (controlURL.startsWith('/')) {
          controlURL = baseURL + controlURL;
        } else if (!controlURL.startsWith('http')) {
          controlURL = baseURL + '/' + controlURL;
        }
        
        console.log(`Found service: ${serviceType} -> ${controlURL}`);
        
        if (serviceType.includes('Playlist')) {
          services.playlistControlURL = controlURL;
        } else if (serviceType.includes('Transport') && serviceType.includes('openhome')) {
          services.transportControlURL = controlURL;
        } else if (serviceType.includes('Product')) {
          services.productControlURL = controlURL;
        } else if (serviceType.includes('AVTransport')) {
          services.avTransportControlURL = controlURL;
        }
      }
    }
    
    console.log('Discovered OpenHome services:', services);
    return services;
    
  } catch (error) {
    console.error('Error fetching device services:', error);
    return {};
  }
};

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
  didlFragment?: string; // Raw DIDL-Lite XML for this item (needed for AVTransport)
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
    
    // Wrap the item in DIDL-Lite for AVTransport metadata
    const didlFragment = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">${itemXml}</DIDL-Lite>`;
    
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
        didlFragment,
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
): Promise<{ success: boolean; error?: string }> => {
  const serviceType = 'urn:schemas-upnp-org:service:AVTransport:1';
  const action = 'SetAVTransportURI';
  
  const escapeForXml = (str: string): string => {
    return str
      .replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };
  
  const escapedURI = escapeForXml(currentURI);
  const escapedMetaData = escapeForXml(currentURIMetaData);
  
  const body = `      <InstanceID>${instanceId}</InstanceID>
      <CurrentURI>${escapedURI}</CurrentURI>
      <CurrentURIMetaData>${escapedMetaData}</CurrentURIMetaData>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('SetAVTransportURI SOAP request to:', controlURL);
  console.log('SetAVTransportURI SOAP body preview:', soapEnvelope.substring(0, 800));
  
  const maxRetries = 3;
  let lastError = '';
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`SetAVTransportURI attempt ${attempt}/${maxRetries}`);
      
      // Use proxy-aware request
      const result = await proxySoapRequest(controlURL, soapAction, soapEnvelope, 3000);
      
      console.log('SetAVTransportURI response status:', result.status);
      console.log('SetAVTransportURI response:', result.text.substring(0, 500));
      
      if (!result.ok) {
        console.error('SetAVTransportURI HTTP error:', result.status, result.text);
        return { success: false, error: `HTTP ${result.status}: ${result.text.substring(0, 200)}` };
      }
      
      if (result.text.includes('Fault') || result.text.includes('UPnPError')) {
        const errorCodeMatch = result.text.match(/<errorCode>(\d+)<\/errorCode>/);
        const errorDescMatch = result.text.match(/<errorDescription>([^<]+)<\/errorDescription>/);
        const errorMsg = `UPnP Error ${errorCodeMatch?.[1] || 'unknown'}: ${errorDescMatch?.[1] || 'Unknown error'}`;
        console.error('SetAVTransportURI SOAP Fault:', errorMsg);
        return { success: false, error: errorMsg };
      }
      
      console.log('SetAVTransportURI succeeded on attempt', attempt);
      return { success: true };
    } catch (error) {
      lastError = String(error);
      console.error(`SetAVTransportURI attempt ${attempt} failed:`, error);
      
      if (attempt < maxRetries) {
        console.log('Retrying in 500ms...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
  
  console.error('SetAVTransportURI failed after all retries');
  return { success: false, error: lastError };
};

export const play = async (controlURL: string, instanceId: number = 0, speed: string = '1'): Promise<void> => {
  const serviceType = 'urn:schemas-upnp-org:service:AVTransport:1';
  const action = 'Play';
  
  const body = `      <InstanceID>${instanceId}</InstanceID>
      <Speed>${speed}</Speed>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('Play SOAP request to:', controlURL);
  
  const result = await proxySoapRequest(controlURL, soapAction, soapEnvelope, 2000);
  
  console.log('Play response status:', result.status);
  
  if (!result.ok) {
    throw new Error(`Play failed: ${result.status} - ${result.text}`);
  }
};

export const pause = async (controlURL: string, instanceId: number = 0): Promise<void> => {
  const serviceType = 'urn:schemas-upnp-org:service:AVTransport:1';
  const action = 'Pause';
  
  const body = `      <InstanceID>${instanceId}</InstanceID>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  const result = await proxySoapRequest(controlURL, soapAction, soapEnvelope, 2000);
  
  if (!result.ok) {
    throw new Error(`Pause failed: ${result.status}`);
  }
};

export const stop = async (controlURL: string, instanceId: number = 0): Promise<void> => {
  const serviceType = 'urn:schemas-upnp-org:service:AVTransport:1';
  const action = 'Stop';
  
  const body = `      <InstanceID>${instanceId}</InstanceID>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('Stop SOAP request to:', controlURL);
  
  const result = await proxySoapRequest(controlURL, soapAction, soapEnvelope, 2000);
  
  if (!result.ok) {
    throw new Error(`Stop failed: ${result.status}`);
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

// Fetch device description and discover available services
export const getDeviceServices = async (deviceDescriptionURL: string): Promise<{
  services: Array<{
    serviceType: string;
    serviceId: string;
    controlURL: string;
    eventSubURL: string;
    SCPDURL: string;
  }>;
}> => {
  console.log('Fetching device description from:', deviceDescriptionURL);
  
  const response = await fetch(deviceDescriptionURL);
  if (!response.ok) {
    throw new Error(`Failed to fetch device description: ${response.status}`);
  }
  
  const xml = await response.text();
  console.log('Device description (first 2000 chars):', xml.substring(0, 2000));
  
  // Parse services from the device description
  const services: Array<{
    serviceType: string;
    serviceId: string;
    controlURL: string;
    eventSubURL: string;
    SCPDURL: string;
  }> = [];
  
  const serviceMatches = xml.matchAll(/<service>([\s\S]*?)<\/service>/gi);
  for (const match of serviceMatches) {
    const serviceXml = match[1];
    const serviceType = serviceXml.match(/<serviceType>([^<]*)<\/serviceType>/)?.[1] || '';
    const serviceId = serviceXml.match(/<serviceId>([^<]*)<\/serviceId>/)?.[1] || '';
    const controlURL = serviceXml.match(/<controlURL>([^<]*)<\/controlURL>/)?.[1] || '';
    const eventSubURL = serviceXml.match(/<eventSubURL>([^<]*)<\/eventSubURL>/)?.[1] || '';
    const SCPDURL = serviceXml.match(/<SCPDURL>([^<]*)<\/SCPDURL>/)?.[1] || '';
    
    services.push({ serviceType, serviceId, controlURL, eventSubURL, SCPDURL });
  }
  
  console.log('Discovered services:', services.map(s => s.serviceType).join(', '));
  
  return { services };
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
    console.log('Playlist DeleteAll returned:', response.status);
  } else {
    console.log('Playlist cleared');
  }
};

// OpenHome Product service - required to select source before Playlist commands work
export const productSetSource = async (productControlURL: string, sourceIndex: number): Promise<void> => {
  const serviceType = 'urn:av-openhome-org:service:Product:1';
  const action = 'SetSourceIndex';
  
  const body = `      <Value>${sourceIndex}</Value>`;
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('Setting Product source index to:', sourceIndex);
  console.log('Product control URL:', productControlURL);
  
  const response = await fetch(productControlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  const responseText = await response.text();
  console.log('SetSourceIndex response status:', response.status);
  console.log('SetSourceIndex response:', responseText);
  
  if (!response.ok) {
    throw new Error(`SetSourceIndex failed: ${response.status} - ${responseText}`);
  }
  
  console.log('Product source set successfully');
};

// Probe an OpenHome service with a simple action to see if it responds
export const probeOpenHomeService = async (
  controlURL: string, 
  serviceType: string, 
  action: string
): Promise<{ success: boolean; response: string }> => {
  const body = '';
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log(`Probing ${serviceType} action ${action} at ${controlURL}`);
  
  try {
    const response = await fetch(controlURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': soapAction,
      },
      body: soapEnvelope,
    });
    
    const responseText = await response.text();
    console.log(`Probe ${action} status: ${response.status}`);
    console.log(`Probe ${action} response:`, responseText.substring(0, 300));
    
    return { success: response.ok, response: responseText };
  } catch (error) {
    console.log(`Probe ${action} failed:`, error);
    return { success: false, response: String(error) };
  }
};

// Diagnose which OpenHome services are available on a device
export const diagnoseOpenHomeServices = async (baseUrl: string, uuid: string): Promise<void> => {
  console.log('=== DIAGNOSING OPENHOME SERVICES ===');
  
  const servicesToProbe = [
    { service: 'Product', version: 1, actions: ['Manufacturer', 'Model', 'Source', 'SourceIndex'] },
    { service: 'Product', version: 2, actions: ['Manufacturer', 'Model'] },
    { service: 'Transport', version: 1, actions: ['TransportState', 'ModeInfo'] },
    { service: 'Playlist', version: 1, actions: ['TransportState', 'Id', 'IdArray'] },
    { service: 'Volume', version: 1, actions: ['Volume', 'Mute'] },
    { service: 'Volume', version: 2, actions: ['Volume', 'Mute'] },
    { service: 'Info', version: 1, actions: ['Track', 'Metatext'] },
  ];
  
  for (const { service, version, actions } of servicesToProbe) {
    const controlUrl = `${baseUrl}/uuid-${uuid}/ctl-urn-av-openhome-org-service-${service}-${version}`;
    const serviceType = `urn:av-openhome-org:service:${service}:${version}`;
    
    console.log(`\n--- Testing ${service}:${version} ---`);
    
    for (const action of actions) {
      const result = await probeOpenHomeService(controlUrl, serviceType, action);
      if (result.success) {
        console.log(`SUCCESS: ${service}:${version}.${action} works!`);
      } else if (result.response.includes('errorCode>404<')) {
        console.log(`FAIL: ${service}:${version}.${action} - Invalid action`);
      } else if (result.response.includes('errorCode>')) {
        const errorCode = result.response.match(/errorCode>(\d+)</)?.[1];
        console.log(`FAIL: ${service}:${version}.${action} - Error code ${errorCode}`);
      } else {
        console.log(`UNKNOWN: ${service}:${version}.${action} - ${result.response.substring(0, 100)}`);
      }
    }
  }
  
  console.log('\n=== DIAGNOSIS COMPLETE ===');
};

export const productSourceXml = async (productControlURL: string): Promise<string> => {
  const serviceType = 'urn:av-openhome-org:service:Product:1';
  const action = 'SourceXml';
  
  const body = '';
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('Getting Product SourceXml from:', productControlURL);
  
  const response = await fetch(productControlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  const responseText = await response.text();
  console.log('SourceXml response status:', response.status);
  
  if (!response.ok) {
    throw new Error(`SourceXml failed: ${response.status} - ${responseText}`);
  }
  
  // Extract the Value element containing the source XML
  const valueMatch = responseText.match(/<Value>([^<]*)<\/Value>/);
  if (valueMatch) {
    const decoded = decodeXmlEntities(valueMatch[1]);
    console.log('SourceXml decoded:', decoded.substring(0, 500));
    return decoded;
  }
  
  return responseText;
};

// OpenHome Transport service - used by dCS for actual playback control
export const transportPlay = async (transportControlURL: string): Promise<void> => {
  const serviceType = 'urn:av-openhome-org:service:Transport:1';
  const action = 'Play';
  
  const body = '';
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  console.log('Sending OpenHome Transport Play command to:', transportControlURL);
  
  const response = await fetch(transportControlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': soapAction,
    },
    body: soapEnvelope,
  });
  
  const responseText = await response.text();
  console.log('Transport Play response status:', response.status);
  console.log('Transport Play response:', responseText);
  
  if (!response.ok) {
    throw new Error(`Transport Play failed: ${response.status} - ${responseText}`);
  }
  
  console.log('Transport Play successful');
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
  
  const volume = Math.max(0, Math.min(100, Math.round(desiredVolume)));
  
  const body = `      <InstanceID>${instanceId}</InstanceID>
      <Channel>${channel}</Channel>
      <DesiredVolume>${volume}</DesiredVolume>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  try {
    const result = await proxySoapRequest(controlURL, soapAction, soapEnvelope, 2000);
    
    if (!result.ok || result.text.includes('Fault') || result.text.includes('UPnPError')) {
      // Silently fail - UI already updated, don't disrupt user experience
      return;
    }
  } catch (error) {
    // Silently fail - volume slider already shows intended value
    return;
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
  
  const result = await proxySoapRequest(controlURL, soapAction, soapEnvelope, 3000);
  
  if (!result.ok) {
    throw new Error(`GetVolume failed: ${result.status}`);
  }
  
  const volumeMatch = result.text.match(/<CurrentVolume>(\d+)<\/CurrentVolume>/);
  return volumeMatch ? parseInt(volumeMatch[1]) : 0;
};

// OpenHome Volume service functions (used by dCS devices)
export const setOpenHomeVolume = async (
  controlURL: string,
  desiredVolume: number
): Promise<void> => {
  const serviceType = 'urn:av-openhome-org:service:Volume:1';
  const action = 'SetVolume';
  
  const volume = Math.max(0, Math.min(100, Math.round(desiredVolume)));
  
  const body = `      <Value>${volume}</Value>`;
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  try {
    const result = await proxySoapRequest(controlURL, soapAction, soapEnvelope, 2000);
    // Silently succeed or fail - UI already updated
  } catch (error) {
    // Silently fail - volume slider already shows intended value
  }
};

export const getOpenHomeVolume = async (
  controlURL: string
): Promise<number> => {
  const serviceType = 'urn:av-openhome-org:service:Volume:1';
  const action = 'Volume';
  
  const body = '';
  
  const soapEnvelope = createSoapEnvelope(action, serviceType, body);
  const soapAction = `"${serviceType}#${action}"`;
  
  const result = await proxySoapRequest(controlURL, soapAction, soapEnvelope, 3000);
  
  if (!result.ok) {
    throw new Error(`OpenHome GetVolume failed: ${result.status}`);
  }
  
  const volumeMatch = result.text.match(/<Value>(\d+)<\/Value>/);
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
  
  const result = await proxySoapRequest(controlURL, soapAction, soapEnvelope, 2000);
  
  if (!result.ok) {
    throw new Error(`SetMute failed: ${result.status}`);
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
  
  const result = await proxySoapRequest(controlURL, soapAction, soapEnvelope, 10000);
  
  if (!result.ok) {
    throw new Error(`GetMute failed: ${result.status}`);
  }
  
  const muteMatch = result.text.match(/<CurrentMute>([01])<\/CurrentMute>/);
  return muteMatch?.[1] === '1';
};

// Comprehensive device discovery diagnostic - mirrors JRiver's approach
// This probes the Varese to find its actual UPnP service URLs
export interface DeviceDiscoveryResult {
  success: boolean;
  deviceDescriptionUrl?: string;
  friendlyName?: string;
  manufacturer?: string;
  modelName?: string;
  services: {
    name: string;
    type: string;
    controlURL: string;
  }[];
  avTransportUrl?: string;
  renderingControlUrl?: string;
  connectionManagerUrl?: string;
  testResult?: {
    action: string;
    success: boolean;
    response?: string;
    error?: string;
  };
  error?: string;
}

export const discoverDeviceServices = async (
  baseHost: string,
  descriptionPaths: string[] = [
    '/description.xml',
    '/DeviceDescription.xml',
    '/rootDesc.xml',
    '/upnp/description.xml',
    '/device.xml',
    '/dmr/description.xml',
    '/MediaRenderer/desc.xml',
    '/desc.xml',
  ]
): Promise<DeviceDiscoveryResult> => {
  console.log('=== JRIVER-STYLE DEVICE DISCOVERY ===');
  console.log('Base host:', baseHost);
  
  const result: DeviceDiscoveryResult = {
    success: false,
    services: [],
  };
  
  // Try each description path
  for (const path of descriptionPaths) {
    const url = `${baseHost}${path}`;
    console.log(`Trying: ${url}`);
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/xml, application/xml',
          'User-Agent': 'SoundStream/1.0 UPnP/1.0',
        },
      });
      
      if (!response.ok) {
        console.log(`  ${response.status} ${response.statusText}`);
        continue;
      }
      
      const xml = await response.text();
      console.log(`  SUCCESS - Got ${xml.length} bytes`);
      
      result.deviceDescriptionUrl = url;
      result.success = true;
      
      // Parse device info
      const friendlyNameMatch = xml.match(/<friendlyName>([^<]+)<\/friendlyName>/);
      const manufacturerMatch = xml.match(/<manufacturer>([^<]+)<\/manufacturer>/);
      const modelNameMatch = xml.match(/<modelName>([^<]+)<\/modelName>/);
      
      result.friendlyName = friendlyNameMatch?.[1];
      result.manufacturer = manufacturerMatch?.[1];
      result.modelName = modelNameMatch?.[1];
      
      console.log(`  Device: ${result.friendlyName} (${result.manufacturer} ${result.modelName})`);
      
      // Parse all services
      const serviceRegex = /<service>([\s\S]*?)<\/service>/gi;
      let match;
      
      while ((match = serviceRegex.exec(xml)) !== null) {
        const serviceXml = match[1];
        
        const serviceTypeMatch = serviceXml.match(/<serviceType>([^<]+)<\/serviceType>/);
        const serviceIdMatch = serviceXml.match(/<serviceId>([^<]+)<\/serviceId>/);
        const controlURLMatch = serviceXml.match(/<controlURL>([^<]+)<\/controlURL>/);
        
        if (serviceTypeMatch && controlURLMatch) {
          const serviceType = serviceTypeMatch[1];
          let controlURL = controlURLMatch[1];
          
          // Make URL absolute
          if (controlURL.startsWith('/')) {
            controlURL = baseHost + controlURL;
          } else if (!controlURL.startsWith('http')) {
            controlURL = baseHost + '/' + controlURL;
          }
          
          const serviceName = serviceIdMatch?.[1]?.split(':').pop() || serviceType.split(':').slice(-2)[0];
          
          result.services.push({
            name: serviceName,
            type: serviceType,
            controlURL: controlURL,
          });
          
          console.log(`  Service: ${serviceName}`);
          console.log(`    Type: ${serviceType}`);
          console.log(`    Control: ${controlURL}`);
          
          // Identify key services
          if (serviceType.includes('AVTransport')) {
            result.avTransportUrl = controlURL;
          } else if (serviceType.includes('RenderingControl')) {
            result.renderingControlUrl = controlURL;
          } else if (serviceType.includes('ConnectionManager')) {
            result.connectionManagerUrl = controlURL;
          }
        }
      }
      
      // If we found AVTransport, test it
      if (result.avTransportUrl) {
        console.log('\n=== TESTING AVTRANSPORT ===');
        console.log('URL:', result.avTransportUrl);
        
        try {
          const testSoap = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetTransportInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
    </u:GetTransportInfo>
  </s:Body>
</s:Envelope>`;
          
          const testResponse = await fetch(result.avTransportUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/xml; charset="utf-8"',
              'SOAPAction': '"urn:schemas-upnp-org:service:AVTransport:1#GetTransportInfo"',
            },
            body: testSoap,
          });
          
          const testXml = await testResponse.text();
          console.log('GetTransportInfo response:', testResponse.status);
          console.log('Response preview:', testXml.substring(0, 500));
          
          result.testResult = {
            action: 'GetTransportInfo',
            success: testResponse.ok,
            response: testXml.substring(0, 1000),
          };
          
          if (testResponse.ok) {
            // Parse transport state
            const stateMatch = testXml.match(/<CurrentTransportState>([^<]+)<\/CurrentTransportState>/);
            if (stateMatch) {
              console.log('Transport State:', stateMatch[1]);
            }
          }
        } catch (testError: any) {
          console.log('AVTransport test failed:', testError.message);
          result.testResult = {
            action: 'GetTransportInfo',
            success: false,
            error: testError.message,
          };
        }
      }
      
      // Found device description, stop searching
      break;
      
    } catch (error: any) {
      console.log(`  Error: ${error.message}`);
    }
  }
  
  if (!result.success) {
    result.error = 'Could not find device description at any known path';
    console.log('=== DISCOVERY FAILED ===');
    console.log('The Varese device description is not accessible from this network context.');
    console.log('This is expected when running from Replit - the app cannot reach your local network.');
    console.log('To properly discover the Varese, you need to:');
    console.log('1. Run the app on your iPhone via Expo Go (scan QR code)');
    console.log('2. Ensure your iPhone is on the same WiFi as the Varese');
    console.log('3. Or build a development build for native SSDP discovery');
  }
  
  console.log('=== DISCOVERY COMPLETE ===');
  return result;
};

// High-level function to play a track via OpenHome Playlist
// This is the preferred method for dCS devices when OpenHome services are discovered via SSDP
export const playViaOpenHomePlaylist = async (
  track: { uri?: string; metadata?: string; title?: string },
  productControlURL: string,
  playlistControlURL: string,
  transportControlURL?: string
): Promise<void> => {
  console.log('=== PLAYING VIA OPENHOME PLAYLIST ===');
  console.log('Track:', track.title);
  console.log('Product URL:', productControlURL);
  console.log('Playlist URL:', playlistControlURL);
  
  if (!track.uri) {
    throw new Error('Track has no URI');
  }
  
  try {
    // Step 1: Get sources and find the Playlist source
    const sourceXml = await productSourceXml(productControlURL);
    console.log('Retrieved source list');
    
    // Find Playlist source index
    const sourceMatches = sourceXml.matchAll(/<Source>[\s\S]*?<Index>(\d+)<\/Index>[\s\S]*?<Type>([^<]+)<\/Type>[\s\S]*?<\/Source>/gi);
    let playlistSourceIndex = 0;
    
    for (const match of sourceMatches) {
      const index = parseInt(match[1]);
      const type = match[2];
      console.log(`Source ${index}: ${type}`);
      if (type.toLowerCase().includes('playlist') || type.toLowerCase().includes('netaux')) {
        playlistSourceIndex = index;
        console.log('Using source index:', playlistSourceIndex);
        break;
      }
    }
    
    // Step 2: Set source to Playlist
    await productSetSource(productControlURL, playlistSourceIndex);
    await new Promise(resolve => setTimeout(resolve, 200));
    console.log('Set source to Playlist');
    
    // Step 3: Clear playlist
    await playlistDeleteAll(playlistControlURL);
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log('Cleared playlist');
    
    // Step 4: Insert track
    await playlistInsert(
      playlistControlURL,
      0, // afterId - insert at beginning
      track.uri,
      track.metadata || ''
    );
    await new Promise(resolve => setTimeout(resolve, 200));
    console.log('Inserted track into playlist');
    
    // Step 5: Play
    await playlistPlay(playlistControlURL);
    console.log('=== OPENHOME PLAYLIST PLAY COMPLETE ===');
    
  } catch (error) {
    console.error('OpenHome Playlist play failed:', error);
    throw error;
  }
};
