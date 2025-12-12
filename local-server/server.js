const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs');
const readline = require('readline');

const app = express();
const PORT = process.env.PORT || 5000;

const LMS_HOST = process.env.LMS_HOST || '192.168.0.19';
const LMS_PORT = process.env.LMS_PORT || '9000';
const CHROMECAST_IP = process.env.CHROMECAST_IP || '';
const PAUSE_TIMEOUT = parseInt(process.env.PAUSE_TIMEOUT || '5000', 10);
const ENABLE_KEYBOARD = process.env.ENABLE_KEYBOARD !== 'false';

let Client, Application, DefaultMediaReceiver;
let castClient = null;
let dashCastSession = null;
let isCasting = false;
let pauseTimer = null;
let currentPlayerId = '';
let lastMode = '';
let serverIp = '';

const DASHCAST_APP_ID = 'CC1AD845';

try {
  const castv2 = require('castv2-client');
  Client = castv2.Client;
  Application = castv2.Application;
  DefaultMediaReceiver = castv2.DefaultMediaReceiver;
  console.log('Chromecast support enabled');
} catch (e) {
  console.log('Chromecast support disabled (install castv2-client to enable)');
}

function createDashCastClass() {
  if (!Application) return null;
  
  class DashCastApp extends Application {
    static APP_ID = DASHCAST_APP_ID;
    
    constructor(client, session) {
      super(client, session);
      this.dashcast = this.createController('urn:x-cast:com.madmod.dashcast');
    }

    load(url, options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      
      const message = { 
        type: 'LOAD',
        url: url,
        force: options.force !== undefined ? options.force : false,
        reload: options.reload || 0,
        reloadTime: options.reloadTime || 0
      };
      
      this.dashcast.send(message, (err, response) => {
        if (callback) callback(err, response);
      });
    }
  }
  
  return DashCastApp;
}

let DashCast = createDashCastClass();

async function lmsRequest(playerId, command) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      id: 1,
      method: 'slim.request',
      params: [playerId, command]
    });

    const options = {
      hostname: LMS_HOST,
      port: LMS_PORT,
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

async function getPlayers() {
  try {
    const result = await lmsRequest('', ['players', '0', '100']);
    return result.players_loop || [];
  } catch (e) {
    return [];
  }
}

async function getPlayerStatus(playerId) {
  try {
    return await lmsRequest(playerId, ['status', '-', '1', 'tags:aAlcdegiIKloNrstuwy']);
  } catch (e) {
    return null;
  }
}

function connectToChromecast() {
  if (!Client || !CHROMECAST_IP) {
    console.log('Chromecast not configured (set CHROMECAST_IP environment variable)');
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    if (castClient) {
      castClient.close();
      castClient = null;
      dashCastSession = null;
    }

    castClient = new Client();

    castClient.connect(CHROMECAST_IP, () => {
      console.log('Connected to Chromecast at', CHROMECAST_IP);
      resolve(true);
    });

    castClient.on('error', (err) => {
      console.error('Chromecast error:', err.message);
      castClient = null;
      dashCastSession = null;
      isCasting = false;
      resolve(false);
    });

    castClient.on('close', () => {
      console.log('Chromecast connection closed');
      castClient = null;
      dashCastSession = null;
      isCasting = false;
    });
  });
}

async function startCasting() {
  if (isCasting) return;
  if (!DashCast) {
    console.log('DashCast not available (castv2-client not loaded)');
    return;
  }
  if (!castClient) {
    const connected = await connectToChromecast();
    if (!connected) return;
  }

  const nowPlayingUrl = `http://${serverIp}:${PORT}/now-playing?host=${LMS_HOST}&port=${LMS_PORT}&player=${encodeURIComponent(currentPlayerId)}`;
  
  console.log('Starting cast to:', nowPlayingUrl);

  castClient.launch(DashCast, (err, dashCast) => {
    if (err) {
      console.error('Error launching DashCast:', err);
      return;
    }

    dashCastSession = dashCast;
    
    dashCast.load(nowPlayingUrl, { force: true }, (err) => {
      if (err) {
        console.error('Error loading URL:', err);
        return;
      }
      console.log('Cast started successfully - DashCast loaded');
      isCasting = true;
    });
  });
}

function stopCasting() {
  if (!isCasting) return;

  console.log('Stopping cast...');
  
  if (castClient) {
    castClient.close();
    castClient = null;
    dashCastSession = null;
  }
  
  isCasting = false;
}

async function pollLmsStatus() {
  try {
    if (!currentPlayerId) {
      const players = await getPlayers();
      if (players.length > 0) {
        currentPlayerId = players[0].playerid;
        console.log('Auto-selected player:', players[0].name);
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

      if (!isCasting && CHROMECAST_IP) {
        console.log('Play detected, starting cast...');
        await startCasting();
      }
    } else if (mode === 'pause' || mode === 'stop') {
      if (isCasting && !pauseTimer) {
        console.log(`Pause/stop detected, will stop cast in ${PAUSE_TIMEOUT/1000} seconds...`);
        pauseTimer = setTimeout(() => {
          console.log('Pause timeout reached, stopping cast');
          stopCasting();
          pauseTimer = null;
        }, PAUSE_TIMEOUT);
      }
    }

    lastMode = mode;
  } catch (e) {
    console.error('Poll error:', e.message);
  }
}

function getLocalIp() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ============================================
// Keyboard / IR Remote Control (Flirc USB)
// ============================================

let keymap = null;
let keyboardEnabled = false;

function loadKeymap() {
  const keymapPath = path.join(__dirname, 'keymap.json');
  try {
    if (fs.existsSync(keymapPath)) {
      const data = fs.readFileSync(keymapPath, 'utf8');
      keymap = JSON.parse(data);
      console.log('Keymap loaded:', Object.keys(keymap.mappings || {}).length, 'key mappings');
      return true;
    }
  } catch (e) {
    console.error('Failed to load keymap.json:', e.message);
  }
  return false;
}

async function executeKeyCommand(mapping) {
  if (!currentPlayerId) {
    const players = await getPlayers();
    if (players.length > 0) {
      currentPlayerId = players[0].playerid;
    } else {
      console.log('No player available for command');
      return;
    }
  }

  const { command, value } = mapping;
  console.log(`Executing command: ${command}${value !== undefined ? ` (${value})` : ''}`);

  try {
    switch (command) {
      case 'pause':
      case 'play':
        await lmsRequest(currentPlayerId, ['pause']);
        break;
        
      case 'stop':
        await lmsRequest(currentPlayerId, ['stop']);
        break;
        
      case 'next':
        await lmsRequest(currentPlayerId, ['playlist', 'index', '+1']);
        break;
        
      case 'previous':
        await lmsRequest(currentPlayerId, ['playlist', 'index', '-1']);
        break;
        
      case 'volume_up':
        await lmsRequest(currentPlayerId, ['mixer', 'volume', `+${value || 5}`]);
        break;
        
      case 'volume_down':
        await lmsRequest(currentPlayerId, ['mixer', 'volume', `-${value || 5}`]);
        break;
        
      case 'mute':
        await lmsRequest(currentPlayerId, ['mixer', 'muting', 'toggle']);
        break;
        
      case 'shuffle':
        const status = await getPlayerStatus(currentPlayerId);
        const currentShuffle = status['playlist shuffle'] || 0;
        await lmsRequest(currentPlayerId, ['playlist', 'shuffle', currentShuffle ? '0' : '1']);
        break;
        
      case 'playlist':
        if (keymap.presets && keymap.presets[value]) {
          const preset = keymap.presets[value];
          console.log(`Playing preset: ${preset.name}`);
          
          // Get playlists and find matching one
          const result = await lmsRequest(currentPlayerId, ['playlists', '0', '999']);
          const playlists = result.playlists_loop || [];
          const match = playlists.find(p => 
            p.playlist.toLowerCase().includes(preset.name.toLowerCase())
          );
          
          if (match) {
            if (preset.shuffle) {
              await lmsRequest(currentPlayerId, ['playlist', 'shuffle', '1']);
            }
            await lmsRequest(currentPlayerId, ['playlistcontrol', 'cmd:load', `playlist_id:${match.id}`]);
            console.log(`Started playlist: ${match.playlist}`);
          } else {
            console.log(`Preset playlist not found: ${preset.name}`);
          }
        }
        break;
        
      default:
        console.log(`Unknown command: ${command}`);
    }
  } catch (e) {
    console.error('Command error:', e.message);
  }
}

function handleKeypress(key) {
  if (!keymap || !keymap.mappings) return;
  
  // Normalize key name
  let keyName = key.name || key.sequence;
  
  // Handle special keys
  if (key.ctrl) keyName = `ctrl+${keyName}`;
  if (key.alt) keyName = `alt+${keyName}`;
  if (key.meta) keyName = `meta+${keyName}`;
  
  const mapping = keymap.mappings[keyName];
  if (mapping) {
    console.log(`Key pressed: ${keyName} -> ${mapping.description || mapping.command}`);
    executeKeyCommand(mapping);
  }
}

function startKeyboardListener() {
  if (!ENABLE_KEYBOARD) {
    console.log('Keyboard control disabled (set ENABLE_KEYBOARD=true to enable)');
    return;
  }

  if (!loadKeymap()) {
    console.log('Keyboard control disabled (keymap.json not found)');
    return;
  }

  if (!keymap.enabled) {
    console.log('Keyboard control disabled in keymap.json');
    return;
  }

  // Check if running in a TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    console.log('Keyboard control: Not running in interactive terminal');
    console.log('  For IR remote with Flirc, run server in a terminal session');
    return;
  }

  try {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    
    process.stdin.on('keypress', (str, key) => {
      // Exit on Ctrl+C
      if (key && key.ctrl && key.name === 'c') {
        console.log('Exiting...');
        process.exit();
      }
      
      if (key) {
        handleKeypress(key);
      }
    });
    
    keyboardEnabled = true;
    console.log('Keyboard/IR remote control enabled');
    console.log('  Press keys to control playback (Ctrl+C to exit)');
    
  } catch (e) {
    console.log('Keyboard control unavailable:', e.message);
  }
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/now-playing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'now-playing.html'));
});

app.get('/api/status', async (req, res) => {
  res.json({
    lmsHost: LMS_HOST,
    lmsPort: LMS_PORT,
    chromecastIp: CHROMECAST_IP,
    isCasting,
    currentPlayerId,
    lastMode,
    keyboardEnabled
  });
});

app.listen(PORT, '0.0.0.0', () => {
  serverIp = getLocalIp();
  
  console.log('');
  console.log('===========================================');
  console.log('  SoundStream Display Server');
  console.log('===========================================');
  console.log('');
  console.log(`  Server running on port ${PORT}`);
  console.log(`  Local IP: ${serverIp}`);
  console.log('');
  console.log('  Configuration:');
  console.log(`    LMS Host: ${LMS_HOST}`);
  console.log(`    LMS Port: ${LMS_PORT}`);
  console.log(`    Chromecast IP: ${CHROMECAST_IP || '(not set)'}`);
  console.log(`    Pause Timeout: ${PAUSE_TIMEOUT/1000} seconds`);
  console.log('');
  console.log('  Environment Variables:');
  console.log('    LMS_HOST=<ip>        - LMS server IP');
  console.log('    LMS_PORT=<port>      - LMS port (default: 9000)');
  console.log('    CHROMECAST_IP=<ip>   - Chromecast IP for auto-cast');
  console.log('    PAUSE_TIMEOUT=<ms>   - Pause timeout (default: 5000)');
  console.log('    ENABLE_KEYBOARD=true - Enable keyboard/IR control');
  console.log('');
  console.log('  Now Playing URL:');
  console.log(`    http://${serverIp}:${PORT}/now-playing`);
  console.log('');
  console.log('===========================================');
  console.log('');

  if (Client) {
    console.log('Starting LMS status polling...');
    setInterval(pollLmsStatus, 2000);
    pollLmsStatus();
  } else {
    console.log('Install castv2-client for Chromecast auto-casting:');
    console.log('  npm install castv2-client');
    console.log('');
  }

  // Start keyboard/IR remote listener
  startKeyboardListener();
});
