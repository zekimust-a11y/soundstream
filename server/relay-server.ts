import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import dgram from "dgram";

// Configuration
let LMS_HOST = process.env.LMS_HOST || '192.168.0.19';
let LMS_PORT = process.env.LMS_PORT || '9000';
const PAUSE_TIMEOUT = parseInt(process.env.PAUSE_TIMEOUT || '5000', 10);
const ENABLE_KEYBOARD = process.env.ENABLE_KEYBOARD !== 'false';

// Global state
let isCasting = false;
let pauseTimer: NodeJS.Timeout | null = null;
let currentPlayerId = '';
let lastMode = '';
let serverIp = '';

// Chromecast configuration
let chromecastIp = process.env.CHROMECAST_IP || '';
let chromecastName = '';
let chromecastEnabled = true;

// DAC configuration
const DAC_IP = process.env.DAC_IP || '192.168.0.42';
const DAC_PORT = process.env.DAC_PORT || 80;

// Mosaic volume control
const MOSAIC_VOLUME_SCRIPT = path.join(process.cwd(), 'local-server', 'mosaic-volume.swift');
const MOSAIC_VOLUME_BINARY = path.join(process.cwd(), 'local-server', 'mosaic-volume');
let mosaicVolumeAvailable = false;

// Check if mosaic-volume binary exists
if (fs.existsSync(MOSAIC_VOLUME_BINARY)) {
  mosaicVolumeAvailable = true;
  console.log('[Relay] Mosaic volume control enabled (compiled binary)');
} else if (fs.existsSync(MOSAIC_VOLUME_SCRIPT)) {
  mosaicVolumeAvailable = true;
  console.log('[Relay] Mosaic volume control enabled (Swift script)');
}

// Check if catt is available for Chromecast casting
let cattAvailable = false;
exec('which catt', (error) => {
  if (!error) {
    cattAvailable = true;
    console.log('[Relay] Chromecast support enabled (using catt)');
  } else {
    console.log('[Relay] Chromecast support disabled (install catt: pip3 install catt)');
  }
});

// LMS communication function
async function lmsRequest(playerId: string, command: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      id: 1,
      method: 'slim.request',
      params: [playerId || '', command]
    });

    const options = {
      hostname: LMS_HOST,
      port: parseInt(LMS_PORT),
      path: '/jsonrpc.js',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.result);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(postData);
    req.end();
  });
}

// Get available players
async function getPlayers(): Promise<any[]> {
  try {
    const result = await lmsRequest('', ['players', '0', '100']);
    return result.players_loop || [];
  } catch (e) {
    return [];
  }
}

// Get player status
async function getPlayerStatus(playerId: string): Promise<any> {
  try {
    return await lmsRequest(playerId, ['status', '-', '1', 'tags:aAlcdegiIKloNrstuwy']);
  } catch (e) {
    return null;
  }
}

// Chromecast functions
async function startCasting(): Promise<void> {
  if (isCasting) return;
  if (!cattAvailable) {
    console.log('[Relay] Chromecast not available (install catt: pip3 install catt)');
    return;
  }
  if (!chromecastIp) {
    console.log('[Relay] Chromecast not configured');
    return;
  }

  isCasting = true;

  const nowPlayingUrl = `http://${serverIp}:3000/now-playing?host=${LMS_HOST}&port=${LMS_PORT}&player=${encodeURIComponent(currentPlayerId)}`;

  console.log(`[Relay] Starting cast to: ${nowPlayingUrl}`);

  const cattCmd = `catt -d "${chromecastIp}" cast_site "${nowPlayingUrl}"`;

  exec(cattCmd, (error, stdout, stderr) => {
    if (error) {
      console.error('[Relay] Error starting cast:', error.message);
      isCasting = false;
      return;
    }
    console.log('[Relay] Cast started successfully');
  });
}

function stopCasting(): void {
  if (!isCasting) return;
  if (!cattAvailable || !chromecastIp) return;

  console.log('[Relay] Stopping cast...');

  exec(`catt -d "${chromecastIp}" stop`, (error) => {
    if (error) {
      console.error('[Relay] Error stopping cast:', error.message);
    }
  });

  isCasting = false;
}

// LMS status polling
async function pollLmsStatus(): Promise<void> {
  try {
    if (!currentPlayerId) {
      const players = await getPlayers();
      if (players.length > 0) {
        currentPlayerId = players[0].playerid;
        console.log('[Relay] Auto-selected player:', players[0].name);
      } else {
        return;
      }
    }

    const status = await getPlayerStatus(currentPlayerId);
    if (!status) return;

    const mode = status.mode;
    const hasTrack = status.playlist_loop && status.playlist_loop.length > 0;

    if (mode === 'play' && hasTrack) {
      if (pauseTimer) {
        clearTimeout(pauseTimer);
        pauseTimer = null;
      }

      if (!isCasting && chromecastIp && chromecastEnabled) {
        console.log('[Relay] Play detected, starting cast...');
        await startCasting();
      } else if (!chromecastEnabled) {
        console.log('[Relay] Casting disabled, skipping cast');
      }
    } else if (mode === 'pause' || mode === 'stop') {
      if (isCasting && !pauseTimer) {
        console.log(`[Relay] Pause/stop detected, will stop cast in ${PAUSE_TIMEOUT/1000} seconds...`);
        pauseTimer = setTimeout(() => {
          console.log('[Relay] Pause timeout reached, stopping cast');
          stopCasting();
          pauseTimer = null;
        }, PAUSE_TIMEOUT);
      }
    }

    lastMode = mode;
  } catch (e) {
    console.error('[Relay] Poll error:', e.message);
  }
}

// Get local IP
function getLocalIp(): string {
  try {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return 'localhost';
}

// UPnP volume control
function sendUpnpCommand(ip: string, port: number, action: string, body: string): Promise<{ status: number, data: string }> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: ip,
      port: port,
      path: '/RenderingControl/ctrl',
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'Content-Length': Buffer.byteLength(body),
        'SOAPAction': `"urn:schemas-upnp-org:service:RenderingControl:1#${action}"`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, data }));
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('UPnP request timeout'));
    });
    req.write(body);
    req.end();
  });
}

// Mosaic volume control
function executeMosaicVolume(args: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const command = fs.existsSync(MOSAIC_VOLUME_BINARY)
      ? `"${MOSAIC_VOLUME_BINARY}" ${args}`
      : `swift "${MOSAIC_VOLUME_SCRIPT}" ${args}`;

    exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        try {
          const result = JSON.parse(stdout || stderr);
          reject(new Error(result.error || error.message));
        } catch {
          reject(new Error(error.message));
        }
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        reject(new Error(`Invalid JSON response: ${stdout}`));
      }
    });
  });
}

// Initialize relay server
export function initializeRelayServer(app: express.Application): void {
  serverIp = getLocalIp();
  console.log(`[Relay] Server IP: ${serverIp}`);

  // Serve display pages
  app.use('/now-playing', express.static(path.join(process.cwd(), 'server', 'templates')));

  // LMS proxy endpoint
  app.post('/api/lms/proxy', async (req, res) => {
    const { host, port, playerId, command } = req.body;
    const lmsHost = host || LMS_HOST;
    const lmsPort = port || LMS_PORT;

    try {
      const response = await fetch(`http://${lmsHost}:${lmsPort}/jsonrpc.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          method: 'slim.request',
          params: [playerId || '', command]
        })
      });
      const data = await response.json();
      res.json(data.result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Status endpoint
  app.get('/api/status', async (req, res) => {
    res.json({
      lmsHost: LMS_HOST,
      lmsPort: LMS_PORT,
      chromecastIp: chromecastIp,
      chromecastName: chromecastName,
      isCasting,
      currentPlayerId,
      lastMode,
      serverIp
    });
  });

  // LMS configuration
  app.post('/api/lms', async (req, res) => {
    const { host, port } = req.body;

    if (host !== undefined) {
      if (!host || typeof host !== 'string') {
        return res.status(400).json({ error: 'Valid host/IP address is required' });
      }
      LMS_HOST = host;
      console.log(`[Relay] LMS Host updated to: ${LMS_HOST}`);
    }

    if (port !== undefined) {
      const portNum = parseInt(port);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        return res.status(400).json({ error: 'Valid port number (1-65535) is required' });
      }
      LMS_PORT = String(portNum);
      console.log(`[Relay] LMS Port updated to: ${LMS_PORT}`);
    }

    currentPlayerId = '';
    res.json({
      success: true,
      message: `LMS server updated to ${LMS_HOST}:${LMS_PORT}`,
      lmsHost: LMS_HOST,
      lmsPort: LMS_PORT
    });
  });

  // Players endpoint
  app.get('/api/players', async (req, res) => {
    try {
      const players = await getPlayers();
      res.json({ players });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Chromecast configuration
  app.post('/api/chromecast', async (req, res) => {
    const { ip, name, enabled } = req.body;

    if (ip !== undefined) {
      if (!ip) {
        return res.status(400).json({ error: 'IP address is required' });
      }

      const oldIp = chromecastIp;
      chromecastIp = ip;
      chromecastName = name || '';

      if (isCasting) {
        stopCasting();
      }

      if (chromecastIp) {
        console.log(`[Relay] Chromecast configured: ${chromecastName} (${chromecastIp})`);
      }
    }

    if (enabled !== undefined) {
      chromecastEnabled = enabled;
      console.log(`[Relay] Chromecast enabled set to: ${chromecastEnabled}`);

      if (!chromecastEnabled && isCasting) {
        stopCasting();
      }
    }

    res.json({
      success: true,
      message: chromecastIp ? `Configured ${chromecastName || chromecastIp}` : 'Chromecast disabled',
      chromecastIp,
      chromecastName,
      chromecastEnabled
    });
  });

  app.delete('/api/chromecast', (req, res) => {
    chromecastIp = '';
    chromecastName = '';

    if (isCasting) {
      stopCasting();
    }

    res.json({ success: true, message: 'Chromecast disabled' });
  });

  // UPnP volume control
  app.post('/api/upnp/volume', async (req, res) => {
    const { action, ip, port, volume, mute } = req.body;
    const targetIp = ip || DAC_IP;
    const targetPort = port || DAC_PORT;

    try {
      if (action === 'get') {
        const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
    </u:GetVolume>
  </s:Body>
</s:Envelope>`;

        console.log(`[Relay] UPnP GetVolume from ${targetIp}:${targetPort}`);
        const result = await sendUpnpCommand(targetIp, targetPort, 'GetVolume', soapBody);
        console.log('[Relay] UPnP raw response:', result.data);

        const volumeValue = parseVolumeFromResponse(result.data);

        if (volumeValue !== null) {
          res.json({ volume: volumeValue, raw: result.data });
        } else {
          res.json({ volume: 50, raw: result.data, warning: 'Could not parse volume' });
        }

      } else if (action === 'set') {
        const volumeValue = percentToDb(volume);

        const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredVolume>${volumeValue}</DesiredVolume>
    </u:SetVolume>
  </s:Body>
</s:Envelope>`;

        console.log(`[Relay] UPnP SetVolume to ${targetIp}:${targetPort}: ${volume}% (${volumeValue}dB)`);
        const result = await sendUpnpCommand(targetIp, targetPort, 'SetVolume', soapBody);
        console.log('[Relay] UPnP SetVolume response:', result.status);

        res.json({ success: result.status === 200, volumePercent: volume, volumeDb: volumeValue });

      } else if (action === 'mute') {
        const muteValue = mute ? '1' : '0';
        const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetMute xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredMute>${muteValue}</DesiredMute>
    </u:SetMute>
  </s:Body>
</s:Envelope>`;

        console.log(`[Relay] UPnP SetMute to ${targetIp}:${targetPort}: ${mute}`);
        const result = await sendUpnpCommand(targetIp, targetPort, 'SetMute', soapBody);

        res.json({ success: result.status === 200 });

      } else {
        res.status(400).json({ error: 'Invalid action. Use: get, set, or mute' });
      }

    } catch (error) {
      console.error('[Relay] UPnP error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Mosaic volume control
  app.get('/api/mosaic/volume', async (req, res) => {
    if (!mosaicVolumeAvailable) {
      return res.status(503).json({
        success: false,
        error: 'Mosaic volume control not available',
        hint: 'Ensure mosaic-volume.swift exists'
      });
    }

    try {
      const result = await executeMosaicVolume('--get');
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/mosaic/volume', async (req, res) => {
    if (!mosaicVolumeAvailable) {
      return res.status(503).json({
        success: false,
        error: 'Mosaic volume control not available'
      });
    }

    const { action, value } = req.body;

    try {
      let args;
      switch (action) {
        case 'get':
          args = '--get';
          break;
        case 'set':
          if (value === undefined) {
            return res.status(400).json({ success: false, error: 'Volume value required for set action' });
          }
          args = `--set ${value}`;
          break;
        case 'up':
          args = value !== undefined ? `--up ${value}` : '--up';
          break;
        case 'down':
          args = value !== undefined ? `--down ${value}` : '--down';
          break;
        case 'mute':
          args = '--mute';
          break;
        default:
          return res.status(400).json({
            success: false,
            error: 'Invalid action. Use: get, set, up, down, or mute'
          });
      }

      const result = await executeMosaicVolume(args);
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/mosaic/sliders', async (req, res) => {
    if (!mosaicVolumeAvailable) {
      return res.status(503).json({
        success: false,
        error: 'Mosaic volume control not available'
      });
    }

    try {
      const result = await executeMosaicVolume('--list');
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Start LMS polling
  console.log('[Relay] Starting LMS status polling...');
  setInterval(pollLmsStatus, 2000);
  pollLmsStatus();
}

// Helper functions that were defined inline
function parseVolumeFromResponse(xml: string): number | null {
  const match = xml.match(/<CurrentVolume>([^<]+)<\/CurrentVolume>/i);
  if (match) {
    const value = match[1].trim();
    const dbMatch = value.match(/^-?\d+(\.\d+)?$/);
    if (dbMatch) {
      const num = parseFloat(value);
      if (num <= 0 && num >= -80) {
        const percent = Math.round(((num + 80) / 80) * 100);
        console.log(`[Relay] Volume: ${value}dB = ${percent}%`);
        return percent;
      }
      return Math.round(Math.max(0, Math.min(100, num)));
    }
  }
  return null;
}

function percentToDb(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const db = ((clamped / 100) * 80) - 80;
  return db.toFixed(1);
}
