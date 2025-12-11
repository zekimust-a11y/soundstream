import * as dgram from 'node:dgram';
import * as http from 'node:http';
import { XMLParser } from 'fast-xml-parser';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || '3847');

interface DiscoveredDevice {
  usn: string;
  location: string;
  server?: string;
  st: string;
  friendlyName?: string;
  manufacturer?: string;
  modelName?: string;
  services: ServiceInfo[];
  avTransportUrl?: string;
  contentDirectoryUrl?: string;
  lastSeen: number;
}

interface ServiceInfo {
  serviceType: string;
  serviceId: string;
  controlURL: string;
  eventSubURL?: string;
  SCPDURL?: string;
}

const devices: Map<string, DiscoveredDevice> = new Map();

function extractUUID(usn: string): string {
  const match = usn.match(/uuid:([^:]+)/i);
  return match ? match[1] : usn;
}
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

async function fetchDeviceDescription(location: string): Promise<Partial<DiscoveredDevice>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
    
    http.get(location, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const parsed = parser.parse(data);
          const root = parsed?.root || parsed?.['root'];
          const device = root?.device;
          
          if (!device) {
            resolve({});
            return;
          }

          const result: Partial<DiscoveredDevice> = {
            friendlyName: device.friendlyName,
            manufacturer: device.manufacturer,
            modelName: device.modelName,
            services: []
          };

          const baseUrl = new URL(location);
          const baseUrlStr = `${baseUrl.protocol}//${baseUrl.host}`;

          const serviceList = device.serviceList?.service;
          const services = Array.isArray(serviceList) ? serviceList : serviceList ? [serviceList] : [];
          
          for (const svc of services) {
            const controlURL = svc.controlURL?.startsWith('/') 
              ? `${baseUrlStr}${svc.controlURL}` 
              : svc.controlURL?.startsWith('http') 
                ? svc.controlURL 
                : `${baseUrlStr}/${svc.controlURL}`;
            
            const serviceInfo: ServiceInfo = {
              serviceType: svc.serviceType,
              serviceId: svc.serviceId,
              controlURL,
              eventSubURL: svc.eventSubURL,
              SCPDURL: svc.SCPDURL
            };
            
            result.services!.push(serviceInfo);
            
            if (svc.serviceType?.includes('AVTransport')) {
              result.avTransportUrl = controlURL;
            }
            if (svc.serviceType?.includes('ContentDirectory')) {
              result.contentDirectoryUrl = controlURL;
            }
          }

          const embeddedDevices = device.deviceList?.device;
          const embeddedList = Array.isArray(embeddedDevices) ? embeddedDevices : embeddedDevices ? [embeddedDevices] : [];
          
          for (const embedded of embeddedList) {
            const embeddedServices = embedded.serviceList?.service;
            const embSvcList = Array.isArray(embeddedServices) ? embeddedServices : embeddedServices ? [embeddedServices] : [];
            
            for (const svc of embSvcList) {
              const controlURL = svc.controlURL?.startsWith('/') 
                ? `${baseUrlStr}${svc.controlURL}` 
                : svc.controlURL?.startsWith('http') 
                  ? svc.controlURL 
                  : `${baseUrlStr}/${svc.controlURL}`;
              
              const serviceInfo: ServiceInfo = {
                serviceType: svc.serviceType,
                serviceId: svc.serviceId,
                controlURL,
                eventSubURL: svc.eventSubURL,
                SCPDURL: svc.SCPDURL
              };
              
              result.services!.push(serviceInfo);
              
              if (svc.serviceType?.includes('AVTransport')) {
                result.avTransportUrl = controlURL;
              }
              if (svc.serviceType?.includes('ContentDirectory')) {
                result.contentDirectoryUrl = controlURL;
              }
            }
          }

          resolve(result);
        } catch (e) {
          console.error('Parse error:', e);
          resolve({});
        }
      });
    }).on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}

function startSsdpListener() {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('message', async (msg, rinfo) => {
    const message = msg.toString();
    
    if (!message.includes('HTTP/1.1 200 OK') && !message.includes('NOTIFY')) {
      return;
    }

    const headers: Record<string, string> = {};
    const lines = message.split('\r\n');
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).toLowerCase().trim();
        const value = line.substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    const location = headers['location'];
    const usn = headers['usn'] || `${rinfo.address}:${rinfo.port}`;
    const st = headers['st'] || headers['nt'] || 'unknown';
    
    if (!location) return;

    const uuid = extractUUID(usn);
    const existingDevice = devices.get(uuid);
    
    if (existingDevice) {
      existingDevice.lastSeen = Date.now();
      
      if (!existingDevice.avTransportUrl || !existingDevice.contentDirectoryUrl) {
        console.log(`[SSDP] Re-fetching device ${uuid} to update services`);
        try {
          const details = await fetchDeviceDescription(location);
          if (details.avTransportUrl && !existingDevice.avTransportUrl) {
            existingDevice.avTransportUrl = details.avTransportUrl;
            console.log(`[SSDP] Updated AVTransport: ${details.avTransportUrl}`);
          }
          if (details.contentDirectoryUrl && !existingDevice.contentDirectoryUrl) {
            existingDevice.contentDirectoryUrl = details.contentDirectoryUrl;
            console.log(`[SSDP] Updated ContentDirectory: ${details.contentDirectoryUrl}`);
          }
          if (details.services && details.services.length > existingDevice.services.length) {
            existingDevice.services = details.services;
          }
        } catch (e) {
          console.log(`[SSDP] Failed to update device ${uuid}:`, e);
        }
      }
      return;
    }

    console.log(`[SSDP] Found device: ${uuid}`);
    console.log(`       Location: ${location}`);
    console.log(`       ST: ${st}`);

    try {
      const details = await fetchDeviceDescription(location);
      
      const device: DiscoveredDevice = {
        usn,
        location,
        server: headers['server'],
        st,
        lastSeen: Date.now(),
        services: [],
        ...details
      };
      
      devices.set(uuid, device);
      
      console.log(`[SSDP] Device details: ${device.friendlyName || 'Unknown'}`);
      if (device.avTransportUrl) {
        console.log(`       AVTransport: ${device.avTransportUrl}`);
      }
      if (device.contentDirectoryUrl) {
        console.log(`       ContentDirectory: ${device.contentDirectoryUrl}`);
      }
    } catch (e) {
      console.error(`[SSDP] Failed to fetch device description:`, e);
    }
  });

  socket.on('error', (err) => {
    console.error('[SSDP] Socket error:', err);
  });

  socket.bind(SSDP_PORT, () => {
    socket.addMembership(SSDP_ADDRESS);
    console.log(`[SSDP] Listening for multicast on ${SSDP_ADDRESS}:${SSDP_PORT}`);
  });

  return socket;
}

function sendSsdpSearch(socket: dgram.Socket) {
  const searchTargets = [
    'ssdp:all',
    'urn:schemas-upnp-org:device:MediaRenderer:1',
    'urn:schemas-upnp-org:device:MediaServer:1',
    'urn:schemas-upnp-org:service:AVTransport:1',
    'urn:schemas-upnp-org:service:ContentDirectory:1'
  ];

  for (const st of searchTargets) {
    const message = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\n` +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 3\r\n' +
      `ST: ${st}\r\n` +
      '\r\n'
    );
    
    socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS, (err) => {
      if (err) console.error('[SSDP] Search error:', err);
    });
  }
  
  console.log('[SSDP] Sent discovery requests');
}

async function proxyUpnpRequest(targetUrl: string, soapAction: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': soapAction,
        'Content-Length': Buffer.byteLength(body),
        'Connection': 'close',
        'User-Agent': 'SoundStream/1.0 UPnP/1.1'
      }
    };

    console.log(`[Proxy] Forwarding to ${targetUrl}`);
    console.log(`[Proxy] SOAPAction: ${soapAction}`);

    const req = http.request(options, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        console.log(`[Proxy] Response status: ${response.statusCode}`);
        console.log(`[Proxy] Response preview: ${data.substring(0, 200)}`);
        resolve({ status: response.statusCode || 500, body: data });
      });
    });

    req.on('error', (e) => {
      console.error(`[Proxy] Request error:`, e);
      reject(e);
    });

    req.setTimeout(10000, () => {
      console.error(`[Proxy] Request timeout`);
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.write(body);
    req.end();
  });
}

function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Target-URL, X-SOAP-Action');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${BRIDGE_PORT}`);
    
    if (url.pathname === '/proxy' && req.method === 'POST') {
      const targetUrl = req.headers['x-target-url'] as string;
      const soapAction = req.headers['x-soap-action'] as string;
      
      if (!targetUrl || !soapAction) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing X-Target-URL or X-SOAP-Action header' }));
        return;
      }
      
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const result = await proxyUpnpRequest(targetUrl, soapAction, body);
          res.writeHead(result.status, { 'Content-Type': 'text/xml' });
          res.end(result.body);
        } catch (e: any) {
          console.error('[Proxy] Error:', e);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Proxy error' }));
        }
      });
      return;
    }
    
    if (url.pathname === '/devices' || url.pathname === '/') {
      const deviceList = Array.from(devices.values());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        count: deviceList.length,
        devices: deviceList
      }, null, 2));
      return;
    }

    if (url.pathname === '/renderers') {
      const renderers = Array.from(devices.values()).filter(d => 
        d.avTransportUrl || d.st?.includes('MediaRenderer')
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        count: renderers.length,
        renderers: renderers.map(r => ({
          name: r.friendlyName || 'Unknown Renderer',
          manufacturer: r.manufacturer,
          model: r.modelName,
          avTransportUrl: r.avTransportUrl,
          location: r.location
        }))
      }, null, 2));
      return;
    }

    if (url.pathname === '/servers') {
      const servers = Array.from(devices.values()).filter(d => 
        d.contentDirectoryUrl || d.st?.includes('MediaServer')
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        count: servers.length,
        servers: servers.map(s => ({
          name: s.friendlyName || 'Unknown Server',
          manufacturer: s.manufacturer,
          model: s.modelName,
          contentDirectoryUrl: s.contentDirectoryUrl,
          location: s.location
        }))
      }, null, 2));
      return;
    }

    if (url.pathname === '/discover') {
      if (ssdpSocket) {
        sendSsdpSearch(ssdpSocket);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'discovery_started' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(BRIDGE_PORT, '0.0.0.0', () => {
    console.log(`[Bridge] HTTP API running on http://localhost:${BRIDGE_PORT}`);
    console.log('');
    console.log('Available endpoints:');
    console.log(`  GET  /devices    - All discovered UPnP devices`);
    console.log(`  GET  /renderers  - Media renderers (DACs, streamers)`);
    console.log(`  GET  /servers    - Media servers (MinimServer, etc.)`);
    console.log(`  GET  /discover   - Trigger new SSDP search`);
    console.log(`  POST /proxy      - Proxy UPnP requests to local devices`);
    console.log('');
  });
}

let ssdpSocket: dgram.Socket | null = null;

console.log('');
console.log('='.repeat(60));
console.log('  SoundStream SSDP Bridge');
console.log('  Discovers UPnP devices on your network');
console.log('='.repeat(60));
console.log('');

ssdpSocket = startSsdpListener();
startHttpServer();

setTimeout(() => {
  if (ssdpSocket) {
    sendSsdpSearch(ssdpSocket);
  }
}, 1000);

setInterval(() => {
  if (ssdpSocket) {
    sendSsdpSearch(ssdpSocket);
  }
}, 30000);

setInterval(() => {
  const now = Date.now();
  const timeout = 5 * 60 * 1000;
  for (const [usn, device] of devices) {
    if (now - device.lastSeen > timeout) {
      console.log(`[SSDP] Device expired: ${device.friendlyName || usn}`);
      devices.delete(usn);
    }
  }
}, 60000);

process.on('SIGINT', () => {
  console.log('\n[Bridge] Shutting down...');
  if (ssdpSocket) {
    ssdpSocket.close();
  }
  process.exit(0);
});
