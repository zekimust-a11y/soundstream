#!/usr/bin/env node
const dgram = require('dgram');
const http = require('http');

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || '3847');

const devices = new Map();

function extractUUID(usn) {
  const match = usn.match(/uuid:([^:]+)/);
  return match ? match[1] : usn;
}

function fetchDeviceDescription(location) {
  return new Promise((resolve, reject) => {
    const url = new URL(location);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: 'GET',
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = parseDeviceDescription(data, location);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.end();
  });
}

function parseDeviceDescription(xml, baseUrl) {
  const result = {
    friendlyName: extractXmlValue(xml, 'friendlyName'),
    manufacturer: extractXmlValue(xml, 'manufacturer'),
    modelName: extractXmlValue(xml, 'modelName'),
    modelDescription: extractXmlValue(xml, 'modelDescription'),
    services: [],
    avTransportUrl: null,
    contentDirectoryUrl: null
  };

  const base = new URL(baseUrl);
  const serviceRegex = /<service>([\s\S]*?)<\/service>/gi;
  let match;

  while ((match = serviceRegex.exec(xml)) !== null) {
    const serviceXml = match[1];
    const serviceType = extractXmlValue(serviceXml, 'serviceType');
    const controlURL = extractXmlValue(serviceXml, 'controlURL');

    if (serviceType && controlURL) {
      let fullUrl = controlURL;
      if (!controlURL.startsWith('http')) {
        fullUrl = `${base.protocol}//${base.host}${controlURL.startsWith('/') ? '' : '/'}${controlURL}`;
      }

      result.services.push({ serviceType, controlURL: fullUrl });

      if (serviceType.includes('AVTransport')) {
        result.avTransportUrl = fullUrl;
      }
      if (serviceType.includes('ContentDirectory')) {
        result.contentDirectoryUrl = fullUrl;
      }
    }
  }

  return result;
}

function extractXmlValue(xml, tag) {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function parseHeaders(msg) {
  const lines = msg.toString().split('\r\n');
  const headers = {};
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).toLowerCase().trim();
      const value = line.substring(colonIndex + 1).trim();
      headers[key] = value;
    }
  }
  return headers;
}

async function handleSsdpMessage(msg, rinfo) {
  const headers = parseHeaders(msg);
  const location = headers['location'];
  const usn = headers['usn'] || 'unknown';
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
        console.log(`[SSDP] Failed to update device ${uuid}:`, e.message);
      }
    }
    return;
  }

  console.log(`[SSDP] Found device: ${uuid}`);
  console.log(`       Location: ${location}`);

  try {
    const details = await fetchDeviceDescription(location);

    const device = {
      usn,
      location,
      server: headers['server'],
      st,
      lastSeen: Date.now(),
      services: [],
      ...details
    };

    devices.set(uuid, device);

    console.log(`[SSDP] Device: ${device.friendlyName || 'Unknown'}`);
    if (device.avTransportUrl) {
      console.log(`       AVTransport: ${device.avTransportUrl}`);
    }
    if (device.contentDirectoryUrl) {
      console.log(`       ContentDirectory: ${device.contentDirectoryUrl}`);
    }
  } catch (e) {
    console.log(`[SSDP] Failed to fetch device details: ${e.message}`);
  }
}

function startSsdpListener() {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('message', handleSsdpMessage);

  socket.on('error', (err) => {
    console.error('[SSDP] Socket error:', err);
    socket.close();
  });

  socket.bind(SSDP_PORT, () => {
    socket.addMembership(SSDP_ADDRESS);
    console.log(`[SSDP] Listening on ${SSDP_ADDRESS}:${SSDP_PORT}`);
  });

  return socket;
}

function sendMSearch(socket) {
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

    socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS);
  }
  console.log('[SSDP] Sent M-SEARCH requests');
}

async function proxyUpnpRequest(targetUrl, soapAction, body) {
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
        resolve({ status: response.statusCode || 500, body: data });
      });
    });

    req.on('error', (e) => {
      console.error(`[Proxy] Request error:`, e.message);
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

    const url = new URL(req.url, `http://localhost:${BRIDGE_PORT}`);

    if (url.pathname === '/proxy' && req.method === 'POST') {
      const targetUrl = req.headers['x-target-url'];
      const soapAction = req.headers['x-soap-action'];
      
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
        } catch (e) {
          console.error('[Proxy] Error:', e.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Proxy error' }));
        }
      });
      return;
    }

    if (url.pathname === '/devices') {
      const deviceList = Array.from(devices.values());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ devices: deviceList, count: deviceList.length }));
    } else if (url.pathname === '/renderers') {
      const renderers = Array.from(devices.values()).filter(d =>
        d.avTransportUrl || d.st?.includes('MediaRenderer')
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ renderers, count: renderers.length }));
    } else if (url.pathname === '/servers') {
      const servers = Array.from(devices.values()).filter(d =>
        d.contentDirectoryUrl || d.st?.includes('MediaServer')
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ servers, count: servers.length }));
    } else if (url.pathname === '/discover') {
      sendMSearch(ssdpSocket);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Discovery initiated', currentDevices: devices.size }));
    } else if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', devices: devices.size }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(BRIDGE_PORT, '0.0.0.0', () => {
    console.log(`[Bridge] HTTP server listening on http://0.0.0.0:${BRIDGE_PORT}`);
    console.log(`[Bridge] Endpoints: /devices, /renderers, /servers, /discover, /health, /proxy`);
    console.log(`[Bridge] Proxy enabled for UPnP control requests`);
  });

  return server;
}

console.log('=== SoundStream SSDP Bridge ===');
console.log('Discovering UPnP devices on your network...\n');

const ssdpSocket = startSsdpListener();
startHttpServer();

setTimeout(() => sendMSearch(ssdpSocket), 1000);
setInterval(() => sendMSearch(ssdpSocket), 30000);

setInterval(() => {
  const now = Date.now();
  for (const [uuid, device] of devices) {
    if (now - device.lastSeen > 120000) {
      console.log(`[SSDP] Removing stale device: ${device.friendlyName || uuid}`);
      devices.delete(uuid);
    }
  }
}, 60000);

console.log('\nPress Ctrl+C to stop.\n');
