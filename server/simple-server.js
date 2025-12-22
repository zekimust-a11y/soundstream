console.log('🚀 Starting SoundStream server...');
const express = require('express');
const { createServer } = require('http');
const http = require('http'); // For LMS requests
const crypto = require('crypto');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');

// Import Tidal API client
let TidalApiClient;
try {
  // Note: simple-server.js is in server/ directory, so use relative path to parent
  const tidalApiModule = require('../tidal-api-client');
  TidalApiClient = tidalApiModule.TidalApiClient;
  console.log('✅ Tidal API client loaded');
} catch (error) {
  console.warn('⚠️  Tidal API client not available:', error.message);
  TidalApiClient = null;
}

// Load environment variables
require('dotenv').config();
console.log('📝 Environment loaded');

// Tidal configuration - Using official developer credentials
const TIDAL_CLIENT_ID = 'pUlCxd80DuDSem4J'; // Official client ID from Tidal Developer Portal
const TIDAL_CLIENT_SECRET = process.env.TIDAL_CLIENT_SECRET || '';

console.log('🎵 TIDAL Server-Side OAuth (Compatible with Official SDK):');
console.log('TIDAL_CLIENT_ID:', TIDAL_CLIENT_ID);
console.log('TIDAL_CLIENT_SECRET:', TIDAL_CLIENT_SECRET ? '***' + TIDAL_CLIENT_SECRET.slice(-4) : 'Not set');
console.log('🔐 Using official developer credentials from Tidal Developer Portal');
console.log('📚 Based on @tidal-music/auth OAuth flow');

// Global variables for OAuth flow
let tidalTokens = null;

// Token persistence file path
const TIDAL_TOKENS_FILE = path.join(__dirname, '..', '.tidal-tokens.json');

// Load Tidal tokens from file on startup
function loadTidalTokens() {
  try {
    if (fs.existsSync(TIDAL_TOKENS_FILE)) {
      const data = fs.readFileSync(TIDAL_TOKENS_FILE, 'utf8');
      const tokens = JSON.parse(data);
      if (tokens.accessToken && tokens.refreshToken) {
        tidalTokens = tokens;
        console.log('✅ Loaded Tidal tokens from file');
        console.log(`   User ID: ${tokens.userId || 'N/A'}`);
        return true;
      }
    }
  } catch (error) {
    console.warn('⚠️  Failed to load Tidal tokens from file:', error.message);
  }
  return false;
}

// Save Tidal tokens to file
function saveTidalTokens() {
  try {
    if (tidalTokens && tidalTokens.accessToken) {
      fs.writeFileSync(TIDAL_TOKENS_FILE, JSON.stringify(tidalTokens, null, 2), 'utf8');
      console.log('💾 Saved Tidal tokens to file');
      return true;
    }
  } catch (error) {
    console.error('❌ Failed to save Tidal tokens to file:', error.message);
  }
  return false;
}

// Load tokens on startup
loadTidalTokens();

// Handle port conflicts gracefully
const PORT = process.env.PORT || 3000;

const app = express();

// CORS headers - allow specific origins for credentials
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} from ${req.headers.origin || 'unknown origin'}`);
  const allowedOrigins = [
    'http://192.168.0.21:8081',  // Expo dev server
    'http://192.168.0.65:8081',  // Development machine
    'http://localhost:8081',     // Local development
    'http://127.0.0.1:8081',     // Local development
    'http://192.168.0.21:8081/', // Expo dev server with trailing slash
    'http://192.168.0.65:8081/', // Development machine with trailing slash
    'http://localhost:8081/',    // Local development with trailing slash
    'http://127.0.0.1:8081/'     // Local development with trailing slash
  ];

  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  } else if (!origin) {
    // If no origin header, allow all (for testing)
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Credentials', 'false');
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use(express.json());

// Root route - redirect to health check for now
app.get('/', (req, res) => {
  res.redirect('/api/health');
});

// =============================================================================
// TIDAL INTEGRATION - Official Developer Platform Implementation
// =============================================================================
//
// This implementation follows TIDAL's official developer guidelines:
// - API Reference: https://tidal-music.github.io/tidal-api-reference/
// - SDK Documentation: https://tidal-music.github.io/tidal-sdk-web/
// - Authorization Guide: https://developer.tidal.com/documentation/api-sdk/api-sdk-authorization
//
// For production use, register at TIDAL Developer Portal and use official credentials.
// The official TIDAL SDK (@tidal-music/tidal-sdk-web) should be used for proper integration.
//
// Current implementation: Custom OAuth with PKCE (compatible with TIDAL SDK approach)
// =============================================================================

// TIDAL_CLIENT_ID and TIDAL_CLIENT_SECRET already declared above

// Fallback client IDs for rotation if needed
const TIDAL_FALLBACK_IDS = [
  '7m7Ap0JC9j1cOM3n', // Alternative 1
  'zU4XHVVkc2tDP8X',  // Alternative 2
  'OmDtrzFZSg8Ff2e',  // Alternative 3
  'KMZrGg3rJQJcZz9',  // Alternative 4
];

let currentClientIdIndex = 0;

function getCurrentClientId() {
  // Use environment variable or fallback to known working client ID
  return TIDAL_CLIENT_ID;
}

function cycleClientId() {
  currentClientIdIndex = (currentClientIdIndex + 1) % (TIDAL_FALLBACK_IDS.length + 1);
  const clientId = currentClientIdIndex === 0 ? TIDAL_CLIENT_ID : TIDAL_FALLBACK_IDS[currentClientIdIndex - 1];
  console.log(`🔄 Switched to Tidal Client ID: ${clientId} (index: ${currentClientIdIndex})`);
  return clientId;
}
// Direct Tidal authentication (if user has tokens)
const TIDAL_ACCESS_TOKEN = process.env.TIDAL_ACCESS_TOKEN;
const TIDAL_REFRESH_TOKEN = process.env.TIDAL_REFRESH_TOKEN;
const TIDAL_USER_ID = process.env.TIDAL_USER_ID;

// Initialize with environment tokens if available
if (TIDAL_ACCESS_TOKEN && TIDAL_REFRESH_TOKEN) {
  tidalTokens = {
    accessToken: TIDAL_ACCESS_TOKEN,
    refreshToken: TIDAL_REFRESH_TOKEN,
    userId: TIDAL_USER_ID || null
  };
  // Save tokens to file
  saveTidalTokens();
  console.log('✅ Tidal initialized with direct tokens from environment');
}

// Function to refresh Tidal access token
async function refreshTidalTokens() {
  if (!tidalTokens?.refreshToken) {
    return false;
  }

  try {
    const refreshUrl = 'https://login.tidal.com/oauth2/token';
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tidalTokens.refreshToken,
      client_id: TIDAL_CLIENT_ID,
    });

    // Create Basic Auth header with client credentials
    const auth = Buffer.from(`${TIDAL_CLIENT_ID}:${TIDAL_CLIENT_SECRET}`).toString('base64');

    const response = await new Promise((resolve, reject) => {
      const req = https.request(refreshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${auth}`,
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (res.statusCode === 200) {
              resolve(result);
            } else {
              reject(new Error(`Token refresh failed: ${res.statusCode} - ${result.error || data}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse refresh response: ${e}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Refresh request failed: ${error.message}`));
      });

      req.write(params.toString());
      req.end();
    });

    // Update tokens
    tidalTokens.accessToken = response.access_token;
    if (response.refresh_token) {
      tidalTokens.refreshToken = response.refresh_token;
    }

    console.log('✅ Tidal tokens refreshed successfully');
    return true;
  } catch (error) {
    console.error('❌ Tidal token refresh failed:', error.message);
    return false;
  }
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'proxy-server',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// LMS Proxy - direct connection to real LMS now that it's back online
app.post('/api/lms/proxy', async (req, res) => {
  console.log('[LMS Proxy] Processing request');

  const { command, playerId, host, port } = req.body;

  if (!command) {
    return res.status(400).json({ error: 'Missing command' });
  }

  // Use host and port from request, or default to 192.168.0.19:9000
  const lmsHost = host || '192.168.0.19';
  const lmsPort = port || 9000;

  // Build JSON-RPC request
  const jsonRpcRequest = {
    id: 1,
    method: 'slim.request',
    params: [playerId || '', command]
  };

  const postData = JSON.stringify(jsonRpcRequest);

  console.log(`[LMS Proxy] Connecting to ${lmsHost}:${lmsPort}, Command:`, JSON.stringify(command));

  // Use Node.js http module to connect to LMS
  const http = require('http');
  
  try {
    await new Promise((resolve, reject) => {
      const options = {
        hostname: lmsHost,
        port: lmsPort,
        path: '/jsonrpc.js',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 15000
      };

      const req = http.request(options, (lmsRes) => {
        let data = '';
        lmsRes.on('data', (chunk) => {
          data += chunk;
        });
        lmsRes.on('end', () => {
          try {
            const response = JSON.parse(data);
            res.json(response);
            resolve();
          } catch (parseError) {
            reject(new Error(`Failed to parse LMS response: ${parseError.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(postData);
      req.end();
    });
  } catch (error) {
    console.error('[LMS Proxy] LMS request failed:', error.message);
    res.status(500).json({
      error: 'LMS request failed',
      details: error.message
    });
  }
});

// LMS server connection proxy (for web platform to avoid CORS)
app.post('/api/lms/connect', async (req, res) => {
  try {
    const { url, host, port, protocol } = req.body;
    
    // Support both full URL format (for remote access) and host:port format (for local)
    let lmsUrl;
    let lmsHost;
    let lmsPort;
    
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

// Server discovery - search for LMS servers on the local network
app.get('/api/servers/discover', async (req, res) => {
  console.log('[Discovery] Starting server discovery...');
  
  const discoveredServers = [];
  const timeout = 1500;
  
  // Create a list of IPs to probe
  const ipsToProbe = [];
  
  // 1. Add known servers and local interface
  ipsToProbe.push('192.168.0.19'); // User's LMS
  ipsToProbe.push('192.168.0.21'); // This server
  ipsToProbe.push('127.0.0.1');
  
  // 2. Add range of IPs on the same subnet (192.168.0.1 to 192.168.0.50 for a quick scan)
  for (let i = 1; i <= 50; i++) {
    const ip = `192.168.0.${i}`;
    if (!ipsToProbe.includes(ip)) {
      ipsToProbe.push(ip);
    }
  }

  // Probing function
  const probe = async (host) => {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(`http://${host}:9000/jsonrpc.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          method: 'slim.request',
          params: ['', ['serverstatus', '0', '1']]
        }),
        signal: controller.signal
      });
      
      clearTimeout(id);
      
      if (response.ok) {
        const data = await response.json();
        if (data.result) {
          return {
            name: data.result.version ? `LMS (${host})` : 'Logitech Media Server',
            host: host,
            port: 9000,
            version: data.result.version,
            type: 'lms'
          };
        }
      }
    } catch (e) {
      // Ignore failures
    }
    return null;
  };

  // Run probes in batches to avoid overwhelming the system
  const batchSize = 10;
  for (let i = 0; i < ipsToProbe.length; i += batchSize) {
    const batch = ipsToProbe.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(probe));
    results.forEach(s => {
      if (s) discoveredServers.push(s);
    });
  }

  console.log(`[Discovery] Found ${discoveredServers.length} servers`);
  res.json({ servers: discoveredServers });
});

// Tidal API endpoints
// Rate limiting for Tidal auth URL requests (prevent rapid requests that trigger anti-bot)
const tidalAuthUrlRequests = new Map();
const TIDAL_AUTH_RATE_LIMIT_MS = 2000; // Minimum 2 seconds between requests from same IP

app.get('/api/tidal/auth-url', (req, res) => {
  try {
    // Rate limiting: prevent rapid requests that might trigger Tidal's anti-bot
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const lastRequestTime = tidalAuthUrlRequests.get(clientIp);
    const now = Date.now();
    
    if (lastRequestTime && (now - lastRequestTime) < TIDAL_AUTH_RATE_LIMIT_MS) {
      const waitTime = Math.ceil((TIDAL_AUTH_RATE_LIMIT_MS - (now - lastRequestTime)) / 1000);
      console.warn(`Rate limit: Too many requests from ${clientIp}. Please wait ${waitTime} seconds.`);
      return res.status(429).json({
        error: 'Too many requests. Please wait a few seconds before trying again.',
        retryAfter: waitTime
      });
    }
    
    tidalAuthUrlRequests.set(clientIp, now);
    
    console.log('Generating TIDAL OAuth URL (Official Developer Portal)...');

    // Detect platform from query parameter or origin
    const platform = req.query.platform || (req.headers.origin ? 'web' : 'mobile');
    const isWeb = platform === 'web';

    // Use appropriate redirect URI based on platform
    // For web: HTTP redirect URI (must be registered in Tidal Developer Portal)
    // IMPORTANT: This must match EXACTLY what's registered in Tidal Developer Portal
    // Common options:
    // - http://192.168.0.21:3000/api/tidal/callback
    // - https://192.168.0.21:3000/api/tidal/callback (if using HTTPS)
    // - http://localhost:3000/api/tidal/callback
    // For mobile: Custom URL scheme
    const redirectUri = isWeb 
      ? `http://192.168.0.21:3000/api/tidal/callback` // Update this to match your registered URI exactly
      : 'soundstream://callback';

    console.log(`Platform detected: ${platform}, using redirect_uri: ${redirectUri}`);

    // Generate PKCE code verifier and challenge (as per official SDK)
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    // State parameter for security (official SDK requirement)
    const state = crypto.randomBytes(16).toString('hex');

    // OAuth parameters matching official Tidal SDK
    // IMPORTANT: Use the actual scope names from Tidal Developer Portal, not short codes!
    // Available scopes from Developer Portal:
    // - user.read (Read access to user's account information)
    // - collection.read (Read access to user's "My Collection")
    // - collection.write (Write access to user's "My Collection")
    // - playlists.read (Required to list playlists created by user)
    // - playlists.write (Write access to user's playlists)
    // - search.read (Required to read personalized search results)
    // - search.write (Required to update personalized search results)
    // - playback (Required to play media content and control playback)
    // - recommendations.read (Read access to user's personal recommendations)
    // - entitlements.read (Read access to user entitlements)
    // Using space-separated scope names (as per Tidal documentation)
    // Only use official scope names from Tidal Developer Portal (r_usr is legacy and causes Error 1002)
    const scope = 'user.read collection.read collection.write playlists.read playlists.write search.read search.write playback recommendations.read entitlements.read'; 
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'pUlCxd80DuDSem4J', // Your official developer client ID
      redirect_uri: redirectUri,
      scope: scope,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256', // PKCE required by Tidal
      state: state, // CSRF protection
    });
    
    // Log all parameters for debugging
    console.log('=== TIDAL OAuth Request Parameters ===');
    console.log('Client ID:', 'pUlCxd80DuDSem4J');
    console.log('Redirect URI:', redirectUri);
    console.log('Redirect URI (URL-encoded):', encodeURIComponent(redirectUri));
    console.log('Scope:', scope);
    console.log('Code Challenge Method:', 'S256');
    console.log('Has State:', !!state);
    console.log('Full Auth URL will be generated...');

    const authUrl = `https://login.tidal.com/authorize?${params.toString()}`;
    console.log('Generated TIDAL OAuth URL (matching official SDK flow)');

    // Store code verifier, state, and redirect URI for later use in token exchange
    global.codeVerifier = codeVerifier;
    global.oauthState = state;
    global.tidalRedirectUri = redirectUri; // Store redirect URI for token exchange

    // Set headers to look more like official SDK requests
    res.set({
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'X-Requested-With': 'XMLHttpRequest'
    });

    res.json({
      authUrl: authUrl,
      clientId: 'pUlCxd80DuDSem4J',
      redirectUri: redirectUri,
      platform: platform,
      note: 'Using official Tidal developer credentials from TIDAL Developer Portal'
    });
  } catch (error) {
    console.error('Tidal auth URL error:', error);
    res.status(500).json({
      error: error.message || 'Failed to generate auth URL'
    });
  }
});

// Cycle to next client ID
app.post('/api/tidal/cycle-client-id', (req, res) => {
  try {
    const oldId = getCurrentClientId();
    const newId = cycleClientId();
    res.json({
      success: true,
      oldClientId: oldId,
      newClientId: newId,
      message: `Switched from ${oldId} to ${newId}`
    });
  } catch (error) {
    console.error('Tidal cycle client ID error:', error);
    res.status(500).json({
      error: error.message || 'Failed to cycle client ID'
    });
  }
});

// OAuth callback handler for web
app.get('/api/tidal/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      console.error('Tidal OAuth error:', error);
      return res.send(`
        <html>
          <head><title>Tidal Authentication Error</title></head>
          <body>
            <h1>Authentication Error</h1>
            <p>Error: ${error}</p>
            <p>Please try again.</p>
            <script>
              // Close window after 3 seconds
              setTimeout(() => window.close(), 3000);
            </script>
          </body>
        </html>
      `);
    }

    if (!code) {
      return res.status(400).send(`
        <html>
          <head><title>Tidal Authentication Error</title></head>
          <body>
            <h1>Authentication Error</h1>
            <p>No authorization code received.</p>
            <script>
              setTimeout(() => window.close(), 3000);
            </script>
          </body>
        </html>
      `);
    }

    // Verify state
    if (state && global.oauthState && state !== global.oauthState) {
      return res.status(400).send(`
        <html>
          <head><title>Tidal Authentication Error</title></head>
          <body>
            <h1>Authentication Error</h1>
            <p>Invalid state parameter.</p>
            <script>
              setTimeout(() => window.close(), 3000);
            </script>
          </body>
        </html>
      `);
    }

    // Exchange code for tokens
    console.log('Exchanging code for tokens via callback...');
    
    const redirectUri = global.tidalRedirectUri || 'http://192.168.0.21:3000/api/tidal/callback';
    const tokenUrl = 'https://login.tidal.com/oauth2/token';
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: 'pUlCxd80DuDSem4J',
      redirect_uri: redirectUri,
      code_verifier: global.codeVerifier || '',
    });
    // Note: client_secret is NOT included for public clients using PKCE

    const response = await new Promise((resolve, reject) => {
      const req = https.request(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'TIDAL/1.0',
          'Accept': 'application/json',
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (res.statusCode === 200) {
              resolve(result);
            } else {
              reject(new Error(`Token exchange failed: ${res.statusCode} - ${result.error || data}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse token response: ${e}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Token request failed: ${error.message}`));
      });

      req.write(params.toString());
      req.end();
    });

    // Store tokens
    tidalTokens = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      userId: response.user?.id || response.user_id
    };

    // Save tokens to file for persistence
    saveTidalTokens();

    // Clean up stored values
    delete global.codeVerifier;
    delete global.oauthState;
    delete global.tidalRedirectUri;

    console.log('TIDAL OAuth authentication successful via callback');

    // Return success page
    res.send(`
      <html>
        <head><title>Tidal Authentication Success</title></head>
        <body>
          <h1>Authentication Successful!</h1>
          <p>You can close this window now.</p>
          <script>
            // Notify parent window if opened in popup
            if (window.opener) {
              window.opener.postMessage({ type: 'TIDAL_AUTH_SUCCESS', tokens: ${JSON.stringify(tidalTokens)} }, '*');
            }
            // Close window after 2 seconds
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('TIDAL OAuth callback error:', error);
    res.status(500).send(`
      <html>
        <head><title>Tidal Authentication Error</title></head>
        <body>
          <h1>Authentication Error</h1>
          <p>${error.message || 'Failed to complete authentication'}</p>
          <script>
            setTimeout(() => window.close(), 3000);
          </script>
        </body>
      </html>
    `);
  }
});

app.post('/api/tidal/authenticate', async (req, res) => {
  try {
    const { code, state } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Authorization code required' });
    }

    if (!global.codeVerifier) {
      return res.status(400).json({ error: 'No code verifier available. Please generate auth URL first.' });
    }

    // Verify state if provided
    if (state && global.oauthState && state !== global.oauthState) {
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    console.log('Exchanging code for tokens using official TIDAL OAuth...');

    // Use stored redirect URI or default to mobile scheme
    const redirectUri = global.tidalRedirectUri || 'soundstream://callback';

    // Use official Tidal OAuth token endpoint
    const tokenUrl = 'https://login.tidal.com/oauth2/token';
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: 'pUlCxd80DuDSem4J', // Your official developer client ID
        redirect_uri: redirectUri,
        code_verifier: global.codeVerifier,
      });
      // Note: client_secret is NOT included for public clients using PKCE

    const response = await new Promise((resolve, reject) => {
      const req = https.request(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'TIDAL/1.0', // Match official client
          'Accept': 'application/json',
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (res.statusCode === 200) {
              resolve(result);
            } else {
              reject(new Error(`Token exchange failed: ${res.statusCode} - ${result.error || data}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse token response: ${e}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Token request failed: ${error.message}`));
      });

      req.write(params.toString());
      req.end();
    });

    // Store tokens
    tidalTokens = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      userId: response.user?.id || response.user_id
    };

    // Clean up stored values
    delete global.codeVerifier;
    delete global.oauthState;

    console.log('TIDAL OAuth authentication successful');

    res.json({
      success: true,
      tokens: tidalTokens
    });
  } catch (error) {
    console.error('TIDAL OAuth authentication error:', error);
    res.status(500).json({
      error: error.message || 'Failed to authenticate with Tidal'
    });
  }
});

app.post('/api/tidal/set-tokens', (req, res) => {
  try {
    const { accessToken, refreshToken, userId } = req.body;
    if (!accessToken || !refreshToken) {
      return res.status(400).json({ error: 'Access token and refresh token required' });
    }

    tidalTokens = { accessToken, refreshToken, userId };
    // Save tokens to file for persistence
    saveTidalTokens();
    console.log('✅ Tidal tokens set via API');
    res.json({ success: true });
  } catch (error) {
    console.error('Tidal set tokens error:', error);
    res.status(500).json({
      error: error.message || 'Failed to set Tidal tokens'
    });
  }
});

// Set Tidal tokens via environment variables (for direct auth)
app.post('/api/tidal/set-env-tokens', (req, res) => {
  try {
    const { accessToken, refreshToken, userId } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: 'Access token required' });
    }

    // Set in memory (these would normally be persisted)
    tidalTokens = {
      accessToken,
      refreshToken: refreshToken || tidalTokens?.refreshToken,
      userId: userId || tidalTokens?.userId
    };

    // Save tokens to file
    saveTidalTokens();

    console.log('✅ Tidal environment tokens set');
    res.json({
      success: true,
      message: 'Tidal tokens set. Note: These are stored in memory only and will be lost on server restart.',
      userId: tidalTokens.userId
    });
  } catch (error) {
    console.error('Tidal set env tokens error:', error);
    res.status(500).json({
      error: error.message || 'Failed to set Tidal environment tokens'
    });
  }
});

/**
 * Helper to fetch all items from a Tidal collection relationship by following cursors
 */
async function fetchAllTidalCollectionItems(userId, relationship, include = '', maxItems = 1000) {
  let allItems = [];
  let nextUrl = `https://openapi.tidal.com/v2/userCollections/${userId}/relationships/${relationship}?page[size]=100&countryCode=IE${include ? '&include=' + include : ''}`;
  
  console.log(`[Tidal] Starting recursive fetch for ${relationship} (maxItems: ${maxItems})...`);
  let pageCount = 0;
  
  while (nextUrl && allItems.length < maxItems) {
    pageCount++;
    try {
      const response = await makeTidalApiCall(nextUrl);
      if (!response.ok) {
        const text = await response.text();
        console.warn(`[Tidal] Failed to fetch page ${pageCount} for ${relationship}: ${response.status} ${text}`);
        break;
      }
      
      const data = await response.json();
      
      if (include) {
        const included = data.included || [];
        const typeMap = {
          'albums': 'albums',
          'artists': 'artists',
          'tracks': 'tracks',
          'playlists': 'playlists',
          'mixes': 'mixes'
        };
        const targetType = typeMap[relationship] || relationship;
        const pageItems = included.filter(item => item.type === targetType);
        allItems = allItems.concat(pageItems);
      } else {
        const dataItems = data.data || [];
        allItems = allItems.concat(dataItems);
      }
      
      console.log(`[Tidal] Fetched page ${pageCount} for ${relationship}: ${allItems.length} items so far`);
      
      if (data.links?.next) {
        let path = data.links.next;
        // Tidal v2 API often returns broken 'next' links that miss the '/v2' prefix
        if (path.startsWith('/userCollections') || path.startsWith('/albums') || path.startsWith('/playlists') || path.startsWith('/userRecommendations')) {
          path = '/v2' + path;
        }
        nextUrl = path.startsWith('http') ? path : `https://openapi.tidal.com${path}`;
        
        // Add a small delay between pages to avoid hitting rate limits too fast
        await new Promise(resolve => setTimeout(resolve, 300));
      } else {
        nextUrl = null;
      }
    } catch (error) {
      console.error(`[Tidal] Error during recursive fetch page ${pageCount} for ${relationship}:`, error);
      break;
    }
  }
  
  console.log(`[Tidal] Finished fetching ${relationship}: total ${allItems.length} items found across ${pageCount} pages`);
  return allItems;
}

app.get('/api/tidal/status', (req, res) => {
  try {
    const authenticated = !!tidalTokens?.accessToken;
    const hasEnvTokens = !!(TIDAL_ACCESS_TOKEN && TIDAL_REFRESH_TOKEN);

    res.json({
      authenticated,
      hasTokens: authenticated,
      hasEnvTokens,
      userId: tidalTokens?.userId,
      authMethod: hasEnvTokens ? 'direct_tokens' : 'oauth'
    });
  } catch (error) {
    console.error('Tidal status error:', error);
    res.status(500).json({
      error: error.message || 'Failed to get Tidal status'
    });
  }
});

// Test direct token authentication
app.get('/api/tidal/test-tokens', async (req, res) => {
  try {
    if (!tidalTokens?.accessToken) {
      return res.status(401).json({ error: 'No Tidal tokens available' });
    }

    // Test the tokens by making a simple API call
    const testResponse = await fetch('https://api.tidal.com/v1/user/profile', {
      headers: {
        'Authorization': `Bearer ${tidalTokens.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!testResponse.ok) {
      // Try to refresh token if it's expired
      if (testResponse.status === 401 && tidalTokens.refreshToken) {
        console.log('Access token expired, attempting refresh...');
        const refreshSuccess = await refreshTidalTokens();
        if (refreshSuccess) {
          // Retry the test call with new token
          const retryResponse = await fetch('https://api.tidal.com/v1/user/profile', {
            headers: {
              'Authorization': `Bearer ${tidalTokens.accessToken}`,
              'Content-Type': 'application/json'
            }
          });
          if (retryResponse.ok) {
            const profile = await retryResponse.json();
            return res.json({
              success: true,
              method: 'refreshed_tokens',
              user: profile
            });
          }
        }
      }
      throw new Error(`Token test failed: ${testResponse.status}`);
    }

    const profile = await testResponse.json();
    res.json({
      success: true,
      method: 'direct_tokens',
      user: profile
    });
  } catch (error) {
    console.error('Tidal token test error:', error);
    res.status(500).json({
      error: error.message || 'Failed to test Tidal tokens'
    });
  }
});

// Helper function to make Tidal API calls with automatic token refresh
async function makeTidalApiCall(url, options = {}, retryCount = 0) {
  if (!tidalTokens?.accessToken) {
    throw new Error('Not authenticated with Tidal');
  }

  // According to Tidal discussions, GET requests should ONLY include Authorization header
  // and NO other headers like Accept or Content-Type to avoid 404/403 issues with v2
  const headers = {
    'Authorization': `Bearer ${tidalTokens.accessToken}`,
    ...options.headers
  };

  // Only add Content-Type for non-GET requests
  if (options.method && options.method !== 'GET') {
    headers['Content-Type'] = 'application/vnd.tidal.v1+json';
  }

  let response = await fetch(url, {
    ...options,
    headers: headers
  });

  // Handle rate limiting (429)
  if (response.status === 429 && retryCount < 3) {
    const waitTime = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
    console.warn(`[Tidal] Rate limited (429). Waiting ${Math.round(waitTime)}ms before retry ${retryCount + 1}...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return makeTidalApiCall(url, options, retryCount + 1);
  }

  // If token expired, try to refresh and retry once
  if (response.status === 401 && tidalTokens.refreshToken) {
    console.log('[Tidal] Token expired, attempting refresh...');
    const refreshSuccess = await refreshTidalTokens();
    if (refreshSuccess) {
      // Retry with new token
      headers['Authorization'] = `Bearer ${tidalTokens.accessToken}`;
      response = await fetch(url, {
        ...options,
        headers: headers
      });
    }
  }

  return response;
}

// Tidal API endpoints
app.get('/api/tidal/mixes', async (req, res) => {
  try {
    if (!tidalTokens?.accessToken || !tidalTokens?.userId) {
      return res.status(401).json({ error: 'Not authenticated with Tidal' });
    }

    console.log('Fetching Tidal custom mixes...');
    // userRecommendations endpoint for mixes
    const endpoint = `https://openapi.tidal.com/v2/userRecommendations/${tidalTokens.userId}/relationships/myMixes?include=mixes,mixes.coverArt&countryCode=US`;
    
    const response = await makeTidalApiCall(endpoint);
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[Tidal] Mixes request failed with status ${response.status}: ${errorText}`);
      return res.json({ items: [], total: 0 });
    }

    const data = await response.json();
    const included = data.included || [];
    const mixData = included.filter(item => item.type === 'mixes');
    const artworkData = included.filter(item => item.type === 'artworks');

    const mixes = mixData.map(mix => {
      const coverRel = mix.relationships?.coverArt?.data?.[0];
      const artwork = coverRel ? artworkData.find(a => a.id === coverRel.id) : null;
      const coverUrl = artwork?.attributes?.files?.find(f => f.href.includes('320x320'))?.href || 
                       artwork?.attributes?.files?.[0]?.href;

      return {
        id: String(mix.id),
        title: mix.attributes?.title || 'Custom Mix',
        description: mix.attributes?.subTitle || '',
        artwork_url: coverUrl || null,
        lmsUri: `tidal://mix:${mix.id}`,
        source: 'tidal'
      };
    });

    res.json({ items: mixes, total: mixes.length });
  } catch (error) {
    console.error('Tidal mixes error:', error);
    res.status(500).json({ error: error.message || 'Failed to get Tidal mixes' });
  }
});

  app.get('/api/tidal/tracks', async (req, res) => {
    try {
      if (!tidalTokens?.accessToken || !tidalTokens?.userId) {
        return res.status(401).json({ error: 'Not authenticated with Tidal' });
      }

      const limit = parseInt(req.query.limit) || 1000;
      const offset = parseInt(req.query.offset) || 0;

      console.log(`Fetching Tidal tracks using recursive helper for user ${tidalTokens.userId}...`);

      const trackData = await fetchAllTidalCollectionItems(
        tidalTokens.userId,
        'tracks',
        'tracks,tracks.albums,tracks.artists,tracks.albums.coverArt',
        limit + offset
      );

      const tracks = trackData.map(track => {
        const albumRel = track.relationships?.albums?.data?.[0]?.id;
        return {
          id: String(track.id),
          title: track.attributes?.title || 'Unknown Track',
          artist: track.attributes?.artistName || 'Unknown Artist',
          album: track.attributes?.albumName || 'Unknown Album',
          albumId: albumRel,
          duration: track.attributes?.duration ? (typeof track.attributes.duration === 'string' ? parseIsoDuration(track.attributes.duration) : track.attributes.duration) : 0,
          artwork_url: null,
          lmsUri: `tidal://track:${track.id}`,
          source: 'tidal'
        };
      });

      const pagedTracks = tracks.slice(offset, offset + limit);
      res.json({ items: pagedTracks, total: tracks.length });
    } catch (error) {
      console.error('[Tidal] Failed to fetch tracks:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch Tidal tracks' });
    }
  });

// Helper to parse ISO 8601 duration (e.g. PT3M45S)
function parseIsoDuration(isoDuration) {
  const matches = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!matches) return 0;
  const hours = parseInt(matches[1] || 0);
  const minutes = parseInt(matches[2] || 0);
  const seconds = parseInt(matches[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

  app.get('/api/tidal/artists', async (req, res) => {
    try {
      if (!tidalTokens?.accessToken || !tidalTokens?.userId) {
        return res.status(401).json({ error: 'Not authenticated with Tidal' });
      }

      const limit = parseInt(req.query.limit) || 1000;
      const offset = parseInt(req.query.offset) || 0;

      console.log(`Fetching Tidal artists using recursive helper...`);
      
      const artistData = await fetchAllTidalCollectionItems(
        tidalTokens.userId,
        'artists',
        'artists',
        limit + offset
      );

      const artists = artistData.map(artist => ({
        id: String(artist.id),
        name: artist.attributes?.name || 'Unknown Artist',
        picture: artist.attributes?.picture?.[0]?.url || null,
        imageUrl: artist.attributes?.picture?.[0]?.url || null,
        source: 'tidal'
      }));

      const pagedArtists = artists.slice(offset, offset + limit);
      res.json({ items: pagedArtists, total: artists.length });
    } catch (error) {
      console.error('[Tidal] Failed to fetch artists:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch Tidal artists' });
    }
  });

let tidalTotalsCache = {
  data: null,
  timestamp: 0
};

  app.get('/api/tidal/totals', async (req, res) => {
    try {
      if (!tidalTokens?.accessToken || !tidalTokens?.userId) {
        return res.json({ albums: 0, artists: 0, tracks: 0, playlists: 0 });
      }

      // Return cache if it's less than 30 minutes old
      const now = Date.now();
      if (tidalTotalsCache.data && (now - tidalTotalsCache.timestamp < 30 * 60 * 1000)) {
        console.log('[Tidal] Returning cached library totals');
        return res.json(tidalTotalsCache.data);
      }

      console.log('[Tidal] Fetching library totals (cache expired or missing)...');
      
      const relationships = ['albums', 'artists', 'tracks', 'playlists'];
      const totals = {};
      
      // Fetch sequentially to avoid rate limits
      for (const rel of relationships) {
        try {
          const items = await fetchAllTidalCollectionItems(tidalTokens.userId, rel, '', 5000); 
          totals[rel] = items.length;
          // Add a small delay between relationships
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
          console.warn(`[Tidal Totals] Failed to get count for ${rel}:`, err.message);
          totals[rel] = 0;
        }
      }

      console.log('[Tidal] Library totals updated:', totals);
      tidalTotalsCache = {
        data: totals,
        timestamp: now
      };
      
      res.json(totals);
    } catch (error) {
      console.error('[Tidal] Failed to fetch library totals:', error);
      res.status(500).json({ error: 'Failed to fetch Tidal library totals' });
    }
  });

  app.get('/api/tidal/albums', async (req, res) => {
    try {
      if (!tidalTokens?.accessToken || !tidalTokens?.userId) {
        return res.status(401).json({ error: 'Not authenticated with Tidal' });
      }

      const limit = parseInt(req.query.limit) || 1000;
      const offset = parseInt(req.query.offset) || 0;

      console.log(`Fetching Tidal albums using recursive helper for user ${tidalTokens.userId} with max limit ${limit}...`);

      const albumData = await fetchAllTidalCollectionItems(
        tidalTokens.userId, 
        'albums', 
        'albums,albums.artists,albums.coverArt',
        limit + offset
      );
      
      const albums = albumData.map(album => {
        // In recursive fetch, included data mapping is hard without full 'included' map
        // but for now we'll use what's in attributes
        return {
          id: String(album.id),
          title: album.attributes?.title || 'Unknown Album',
          artist: album.attributes?.artistName || 'Unknown Artist',
          artistId: album.relationships?.artists?.data?.[0]?.id || null,
          cover: album.attributes?.imageCover?.[0]?.url || null,
          artwork_url: album.attributes?.imageCover?.[0]?.url || null,
          year: album.attributes?.releaseDate ? new Date(album.attributes.releaseDate).getFullYear() : null,
          numberOfTracks: album.attributes?.trackCount || 0,
          lmsUri: `tidal://album:${album.id}`,
          source: 'tidal'
        };
      });

      const pagedAlbums = albums.slice(offset, offset + limit);
      res.json({ items: pagedAlbums, total: albums.length });
    } catch (error) {
      console.error('[Tidal] Failed to fetch albums:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch Tidal albums' });
    }
  });

  app.get('/api/tidal/playlists', async (req, res) => {
    try {
      if (!tidalTokens?.accessToken || !tidalTokens?.userId) {
        return res.status(401).json({ error: 'Not authenticated with Tidal' });
      }

      const limit = parseInt(req.query.limit) || 1000;
      const offset = parseInt(req.query.offset) || 0;

      console.log(`Fetching Tidal playlists using recursive helper for user ${tidalTokens.userId}...`);

      const playlistData = await fetchAllTidalCollectionItems(
        tidalTokens.userId,
        'playlists',
        'playlists,playlists.coverArt',
        limit + offset
      );

      const playlists = playlistData.map(playlist => ({
        id: String(playlist.id),
        title: playlist.attributes?.name || 'Unknown Playlist',
        description: playlist.attributes?.description || '',
        creator: 'Me',
        numberOfTracks: playlist.attributes?.numberOfItems || 0,
        cover: playlist.attributes?.imageCover?.[0]?.url || null,
        lastUpdated: playlist.attributes?.lastModifiedAt || null,
        lmsUri: `tidal://playlist:${playlist.id}`,
        source: 'tidal'
      }));

      const pagedPlaylists = playlists.slice(offset, offset + limit);
      res.json({ items: pagedPlaylists, total: playlists.length });
    } catch (error) {
      console.error('[Tidal] Failed to fetch playlists:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch Tidal playlists' });
    }
  });

// Get album tracks
app.get('/api/tidal/albums/:albumId/tracks', async (req, res) => {
  try {
    if (!tidalTokens?.accessToken) {
      return res.status(401).json({ error: 'Not authenticated with Tidal' });
    }

    const { albumId } = req.params;

    // Use Tidal OpenAPI v2 directly
    const response = await fetch(`https://api.tidal.com/v2/albums/${albumId}/tracks?countryCode=US`, {
      headers: {
        'Authorization': `Bearer ${tidalTokens.accessToken}`,
        'accept': 'application/vnd.tidal.v1+json',
        'Content-Type': 'application/vnd.tidal.v1+json',
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tidal API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const items = data.items || data.data || [];

    // Transform to match our format
    const formattedTracks = items.map(track => {
      const artist = track.artist || (track.artists && track.artists[0]) || { id: '', name: 'Unknown Artist' };
      const album = track.album || { id: albumId, title: 'Unknown Album', cover: track.cover };
      const coverId = album.cover || album.imageId || album.coverId || track.cover;
      return {
        id: String(track.id),
        title: track.title || track.name || 'Unknown Track',
        artist: artist.name || 'Unknown Artist',
        artistId: String(artist.id || ''),
        album: album.title || album.name || 'Unknown Album',
        albumId: String(album.id || albumId),
        duration: track.duration || track.playbackSeconds || 0,
        trackNumber: track.trackNumber || track.track || track.number,
        artwork_url: coverId ? `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/320x320.jpg` : null,
        lmsUri: `tidal://track:${track.id}`,
        source: 'tidal'
      };
    });

    res.json({ items: formattedTracks });
  } catch (error) {
    console.error('Tidal album tracks error:', error);
    res.status(500).json({
      error: error.message || 'Failed to get Tidal album tracks'
    });
  }
});

// Get playlist tracks
app.get('/api/tidal/playlists/:playlistId/tracks', async (req, res) => {
  try {
    if (!tidalTokens?.accessToken) {
      return res.status(401).json({ error: 'Not authenticated with Tidal' });
    }

    const { playlistId } = req.params;

    // Use Tidal OpenAPI v2 directly
    const response = await fetch(`https://api.tidal.com/v2/playlists/${playlistId}/tracks?countryCode=US`, {
      headers: {
        'Authorization': `Bearer ${tidalTokens.accessToken}`,
        'accept': 'application/vnd.tidal.v1+json',
        'Content-Type': 'application/vnd.tidal.v1+json',
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tidal API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const items = data.items || data.data || [];

    // Transform to match our format
    const formattedTracks = items.map(track => {
      const artist = track.artist || (track.artists && track.artists[0]) || { id: '', name: 'Unknown Artist' };
      const album = track.album || { id: '', title: 'Unknown Album', cover: track.cover };
      const coverId = album.cover || album.imageId || album.coverId || track.cover;
      return {
        id: String(track.id),
        title: track.title || track.name || 'Unknown Track',
        artist: artist.name || 'Unknown Artist',
        artistId: String(artist.id || ''),
        album: album.title || album.name || 'Unknown Album',
        albumId: String(album.id || ''),
        duration: track.duration || track.playbackSeconds || 0,
        trackNumber: track.trackNumber || track.track || track.number,
        artwork_url: coverId ? `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/320x320.jpg` : null,
        lmsUri: `tidal://track:${track.id}`,
        source: 'tidal'
      };
    });

    res.json({ items: formattedTracks });
  } catch (error) {
    console.error('Tidal playlist tracks error:', error);
    res.status(500).json({
      error: error.message || 'Failed to get Tidal playlist tracks'
    });
  }
});

// Search Tidal
app.get('/api/tidal/search', async (req, res) => {
  try {
    if (!tidalTokens?.accessToken) {
      return res.status(401).json({ error: 'Not authenticated with Tidal' });
    }

    const { q, type, limit } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const searchLimit = parseInt(limit) || 20;

    const results = {};

    // Search albums
    if (!type || type === 'albums') {
      try {
        const response = await fetch(`https://api.tidal.com/v2/search/albums?query=${encodeURIComponent(q)}&limit=${searchLimit}&countryCode=US`, {
          headers: {
            'Authorization': `Bearer ${tidalTokens.accessToken}`,
            'accept': 'application/vnd.tidal.v1+json',
            'Content-Type': 'application/vnd.tidal.v1+json',
          }
        });
        if (response.ok) {
          const data = await response.json();
          const items = data.items || data.data || [];
          results.albums = items.map(album => {
            const artist = album.artist || (album.artists && album.artists[0]) || { id: '', name: 'Unknown Artist' };
            const coverId = album.cover || album.imageId || album.coverId;
            return {
              id: String(album.id),
              title: album.title || album.name || 'Unknown Album',
              artist: artist.name || 'Unknown Artist',
              artistId: String(artist.id || ''),
              artwork_url: coverId ? `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/320x320.jpg` : null,
              year: album.releaseDate ? new Date(album.releaseDate).getFullYear() : null,
              numberOfTracks: album.numberOfTracks || album.trackCount,
              lmsUri: `tidal://album:${album.id}`,
              source: 'tidal'
            };
          });
        }
      } catch (e) {
        console.error('Tidal albums search error:', e);
        results.albums = [];
      }
    }

    // Search artists
    if (!type || type === 'artists') {
      try {
        const response = await fetch(`https://api.tidal.com/v2/search/artists?query=${encodeURIComponent(q)}&limit=${searchLimit}&countryCode=US`, {
          headers: {
            'Authorization': `Bearer ${tidalTokens.accessToken}`,
            'accept': 'application/vnd.tidal.v1+json',
            'Content-Type': 'application/vnd.tidal.v1+json',
          }
        });
        if (response.ok) {
          const data = await response.json();
          const items = data.items || data.data || [];
          results.artists = items.map(artist => {
            const pictureId = artist.picture || artist.imageId || artist.coverId;
            return {
              id: String(artist.id),
              name: artist.name || 'Unknown Artist',
              picture: pictureId ? `https://resources.tidal.com/images/${pictureId.replace(/-/g, '/')}/320x320.jpg` : null
            };
          });
        }
      } catch (e) {
        console.error('Tidal artists search error:', e);
        results.artists = [];
      }
    }

    // Search tracks
    if (!type || type === 'tracks') {
      try {
        const response = await fetch(`https://api.tidal.com/v2/search/tracks?query=${encodeURIComponent(q)}&limit=${searchLimit}&countryCode=US`, {
          headers: {
            'Authorization': `Bearer ${tidalTokens.accessToken}`,
            'accept': 'application/vnd.tidal.v1+json',
            'Content-Type': 'application/vnd.tidal.v1+json',
          }
        });
        if (response.ok) {
          const data = await response.json();
          const items = data.items || data.data || [];
          results.tracks = items.map(track => {
            const artist = track.artist || (track.artists && track.artists[0]) || { id: '', name: 'Unknown Artist' };
            const album = track.album || { id: '', title: 'Unknown Album', cover: track.cover };
            const coverId = album.cover || album.imageId || album.coverId || track.cover;
            return {
              id: String(track.id),
              title: track.title || track.name || 'Unknown Track',
              artist: artist.name || 'Unknown Artist',
              artistId: String(artist.id || ''),
              album: album.title || album.name || 'Unknown Album',
              albumId: String(album.id || ''),
              duration: track.duration || track.playbackSeconds || 0,
              artwork_url: coverId ? `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/320x320.jpg` : null,
              lmsUri: `tidal://track:${track.id}`,
              source: 'tidal'
            };
          });
        }
      } catch (e) {
        console.error('Tidal tracks search error:', e);
        results.tracks = [];
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Tidal search error:', error);
    res.status(500).json({
      error: error.message || 'Failed to search Tidal'
    });
  }
});

// Test page for Tidal connect
app.get('/test-tidal', (req, res) => {
  res.sendFile(__dirname + '/test-tidal.html');
});

// Roon Volume Control endpoints (mock implementation)
app.get('/api/roon/status', (req, res) => {
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

    res.json({
      success: true,
      connected: status.connected,
      outputCount: status.outputCount,
      currentOutput: status.currentOutput,
      currentOutputName: status.currentOutputName,
      outputs: Array.from(roonControl.getOutputs().values()).map(output => ({
        output_id: output.output_id,
        zone_id: output.zone_id,
        display_name: output.display_name,
        volume: output.volume
      })),
      zones: Array.from(roonControl.getZones().values()).map(zone => ({
        zone_id: zone.zone_id,
        display_name: zone.display_name,
        outputs: zone.outputs
      }))
    });
  } catch (error) {
    console.error('Roon status error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get Roon status'
    });
  }
});

app.post('/api/roon/output', (req, res) => {
  try {
    const { output_id } = req.body;

    if (!output_id) {
      return res.status(400).json({
        success: false,
        error: 'output_id is required'
      });
    }

    // Mock response - Roon not connected
    res.json({
      success: false,
      error: 'Roon volume control not connected'
    });
  } catch (error) {
    console.error('Roon set output error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to set Roon output'
    });
  }
});

app.get('/api/roon/volume', async (req, res) => {
  try {
    const roonControl = globalRoonControl;

    if (!roonControl) {
      return res.status(503).json({
        success: false,
        error: 'Roon volume control not initialized'
      });
    }

    if (!roonControl.isReady()) {
      return res.status(503).json({
        success: false,
        error: 'Roon volume control not ready'
      });
    }

    const volume = await roonControl.getVolume();
    res.json({
      success: true,
      volume: volume
    });
  } catch (error) {
    console.error('Roon get volume error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get Roon volume'
    });
  }
});

app.post('/api/roon/volume', async (req, res) => {
  try {
    const roonControl = globalRoonControl;

    if (!roonControl) {
      return res.status(503).json({
        success: false,
        error: 'Roon volume control not initialized'
      });
    }

    if (!roonControl.isReady()) {
      return res.status(503).json({
        success: false,
        error: 'Roon volume control not ready'
      });
    }

    const { action, value } = req.body;

    if (!action) {
      return res.status(400).json({
        success: false,
        error: 'action is required'
      });
    }

    let result;
    if (action === 'set') {
      if (value === undefined || value === null) {
        return res.status(400).json({
          success: false,
          error: 'value is required for set action'
        });
      }
      await roonControl.setVolume(value);
      result = { volume: value };
    } else if (action === 'up') {
      const step = value || 2;
      const newVolume = await roonControl.volumeUp(step);
      result = { volume: newVolume };
    } else if (action === 'down') {
      const step = value || 2;
      const newVolume = await roonControl.volumeDown(step);
      result = { volume: newVolume };
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Use set, up, or down'
      });
    }

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Roon set volume error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to set Roon volume'
    });
  }
});

// Chromecast device discovery endpoint using mDNS
app.get('/api/chromecast/discover', async (req, res) => {
  try {
    console.log('[Chromecast] Discovery requested');
    
    let mdns;
    try {
      // Try to load mdns-js library
      mdns = require('mdns-js');
    } catch (e) {
      console.warn('[Chromecast] mDNS library not available, falling back to manual discovery');
      // Fallback: return empty array or check for known server on 192.168.0.21
      const fallbackDevices = [];
      
      // Try to check if there's a server on 192.168.0.21 that might have device info
      try {
        const response = await fetch('http://192.168.0.21:5000/api/chromecasts', {
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.devices && Array.isArray(data.devices)) {
            return res.json(data.devices.map((d) => ({
              ip: d.ip,
              name: d.name,
            })));
          }
        }
      } catch (e) {
        console.log('[Chromecast] Fallback server not available:', e instanceof Error ? e.message : String(e));
      }
      
      return res.json(fallbackDevices);
    }

    const timeout = parseInt(req.query.timeout) || 5000;
    const devices = [];
    const seen = new Set();

    return new Promise((resolve) => {
      try {
        const browser = mdns.createBrowser(mdns.tcp('googlecast'));
        
        browser.on('ready', () => {
          console.log('[Chromecast] mDNS browser ready, starting discovery...');
          browser.discover();
        });
        
        browser.on('update', (data) => {
          if (data.addresses && data.addresses.length > 0) {
            // Find IPv4 address (contains dots)
            const ip = data.addresses.find(addr => addr.includes('.')) || data.addresses[0];
            const key = `${ip}:${data.port || 8009}`;
            
            if (!seen.has(key)) {
              seen.add(key);
              
              let name = data.fullname || data.host || 'Unknown';
              if (name.includes('._googlecast')) {
                name = name.split('._googlecast')[0];
              }
              name = name.replace(/-/g, ' ').replace(/\._tcp\.local$/, '');
              
              // Parse TXT record for friendly name and model
              const txtRecord = data.txt || [];
              let friendlyName = name;
              let model = '';
              
              txtRecord.forEach(entry => {
                if (typeof entry === 'string') {
                  if (entry.startsWith('fn=')) {
                    friendlyName = entry.substring(3);
                  } else if (entry.startsWith('md=')) {
                    model = entry.substring(3);
                  }
                } else if (entry && typeof entry === 'object') {
                  // Handle object format
                  if (entry.fn) friendlyName = entry.fn;
                  if (entry.md) model = entry.md;
                }
              });
              
              const device = {
                ip: ip,
                name: friendlyName,
                model: model,
                port: data.port || 8009
              };
              
              devices.push(device);
              console.log(`[Chromecast] Discovered: ${friendlyName} at ${ip}`);
            }
          }
        });
        
        browser.on('error', (error) => {
          console.error('[Chromecast] mDNS browser error:', error);
        });
        
        // Stop discovery after timeout
        setTimeout(() => {
          try {
            browser.stop();
          } catch (e) {
            // Ignore errors when stopping
          }
          
          console.log(`[Chromecast] Discovery complete, found ${devices.length} device(s)`);
          res.json(devices.sort((a, b) => a.name.localeCompare(b.name)));
          resolve();
        }, timeout);
        
      } catch (error) {
        console.error('[Chromecast] Discovery setup error:', error);
        res.status(500).json({ 
          error: error instanceof Error ? error.message : 'Discovery setup failed' 
        });
        resolve();
      }
    });
    
  } catch (error) {
    console.error('[Chromecast] Discovery error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Discovery failed' 
    });
  }
});

// Serve Now Playing display page
app.get('/now-playing', (req, res) => {
  try {
    const nowPlayingPath = path.join(__dirname, 'templates', 'now-playing.html');
    let nowPlayingTemplate = fs.readFileSync(nowPlayingPath, 'utf8');
    
    // Extract parameters from query string and embed them in the HTML
    const host = req.query.host || '';
    const port = req.query.port || '9000';
    const player = req.query.player || '';
    
    // If parameters are provided, embed them directly in the HTML as JavaScript variables
    // This ensures they're available even if Chromecast strips query parameters
    if (host && player) {
      const embeddedScript = `
    <script>
      // Embedded parameters (in case Chromecast strips query params)
      window.EMBEDDED_PARAMS = {
        host: ${JSON.stringify(host)},
        port: ${JSON.stringify(port)},
        player: ${JSON.stringify(player)}
      };
    </script>
`;
      // Insert before the existing script tag
      nowPlayingTemplate = nowPlayingTemplate.replace('<script>', embeddedScript + '<script>');
    }
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Prevent caching so Chromecast always gets the latest version
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.status(200).send(nowPlayingTemplate);
  } catch (error) {
    console.error('[Now Playing] Error serving template:', error);
    res.status(500).send('<html><body><h1>Error loading Now Playing page</h1></body></html>');
  }
});

// Image proxy endpoint - proxies LMS images to avoid CORS issues
app.get('/api/image-proxy', async (req, res) => {
  const { url } = req.query;
  
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  try {
    // Decode the URL if it's encoded
    const imageUrl = decodeURIComponent(url);
    
    // Validate URL is from a private network (security)
    let parsedUrl;
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
      
      // Check if it's a private IP address
      const isPrivate = 
        (octets[0] === 10) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 127);
      
      if (!isPrivate && hostname !== 'localhost') {
        return res.status(403).json({ error: 'Only private network URLs are allowed' });
      }
    } else if (hostname !== 'localhost') {
      // For hostnames, require full URL validation
      return res.status(403).json({ error: 'Only IP addresses or localhost are allowed' });
    }
    
    // Fetch and proxy the image
    const https = require('https');
    const http = require('http');
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    client.get(imageUrl, (imageRes) => {
      if (imageRes.statusCode !== 200) {
        return res.status(imageRes.statusCode || 500).json({ error: 'Failed to fetch image' });
      }
      
      // Set appropriate content type
      const contentType = imageRes.headers['content-type'] || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      
      // Pipe the image data to the response
      imageRes.pipe(res);
    }).on('error', (error) => {
      console.error('[Image Proxy] Error fetching image:', error);
      res.status(500).json({ error: 'Failed to fetch image: ' + error.message });
    });
  } catch (error) {
    console.error('[Image Proxy] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ============================================
// Chromecast Casting (Integrated into main server)
// ============================================

// Chromecast state
let chromecastIp = '';
let chromecastName = '';
let chromecastEnabled = false;
let isCasting = false;
let pauseTimer = null;
let preferredPlayerId = '';
let preferredPlayerName = '';
let currentPlayerId = '';
let lastMode = '';
let castingLmsHost = '';
let castingLmsPort = 9000;

// Check if catt is available for Chromecast casting
let cattAvailable = false;
let cattCmd = 'catt'; // Default command

// Try multiple paths for catt - check user bin first, then python3 -m catt
exec('test -f /Users/zeki/Library/Python/3.9/bin/catt', (pathError) => {
  if (!pathError) {
    cattAvailable = true;
    cattCmd = '/Users/zeki/Library/Python/3.9/bin/catt';
    console.log('[Chromecast] Support enabled (using /Users/zeki/Library/Python/3.9/bin/catt)');
  } else {
    // Try python3 -m catt
    exec('python3 -m catt --help 2>&1 | head -1', (error, stdout) => {
      if (!error || stdout.includes('catt') || stdout.includes('usage') || stdout.includes('Commands:')) {
        cattAvailable = true;
        cattCmd = 'python3 -m catt';
        console.log('[Chromecast] Support enabled (using python3 -m catt)');
      } else {
        // Try which catt
        exec('which catt', (cmdError) => {
          if (!cmdError) {
            cattAvailable = true;
            cattCmd = 'catt';
            console.log('[Chromecast] Support enabled (using catt)');
          } else {
            console.log('[Chromecast] Support disabled (install catt: pip3 install catt)');
          }
        });
      }
    });
  }
});

// Get server's local IP address
function getServerIp() {
  const networkInterfaces = os.networkInterfaces();
  for (const interfaceName in networkInterfaces) {
    const interfaces = networkInterfaces[interfaceName];
    if (interfaces) {
      for (const iface of interfaces) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  }
  return 'localhost';
}

// LMS request helper
async function lmsRequest(playerId, command) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      id: 1,
      method: 'slim.request',
      params: [playerId, command]
    });

    const options = {
      hostname: castingLmsHost || '192.168.0.19',
      port: castingLmsPort || 9000,
      path: '/jsonrpc.js',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.result || {});
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', reject);
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
    const result = await lmsRequest(playerId, ['status', '-', '1', 'tags:aAlcdegiIKloNrstuwy']);
    if (!result) {
      console.log(`[Chromecast] getPlayerStatus returned null for player ${playerId}`);
    }
    return result;
  } catch (e) {
    console.error(`[Chromecast] getPlayerStatus error for player ${playerId}:`, e.message);
    return null;
  }
}

async function startCasting() {
  if (isCasting) {
    console.log('[Chromecast] startCasting called but isCasting is already true, skipping');
    return;
  }
  
  if (!cattAvailable) {
    console.log('[Chromecast] Not available (install catt: pip3 install catt)');
    return;
  }
  if (!chromecastIp) {
    console.log('[Chromecast] Not configured');
    return;
  }
  if (!chromecastEnabled) {
    console.log('[Chromecast] Disabled');
    return;
  }

  // Set flag immediately to prevent duplicate calls
  isCasting = true;

  // Use preferredPlayerId if set, otherwise use currentPlayerId
  const playerToUse = preferredPlayerId || currentPlayerId;
  const serverIp = getServerIp();
  const nowPlayingUrl = `http://${serverIp}:${PORT}/now-playing?host=${castingLmsHost || '192.168.0.19'}&port=${castingLmsPort || 9000}&player=${encodeURIComponent(playerToUse)}`;
  
  console.log(`[Chromecast] Starting cast to ${chromecastIp}: ${nowPlayingUrl} (player: ${playerToUse})`);

  // Use catt to cast the URL to Chromecast
  const cmd = `${cattCmd} -d "${chromecastIp}" cast_site "${nowPlayingUrl}"`;
  
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error('[Chromecast] Error starting cast:', error.message);
      console.error('[Chromecast] stderr:', stderr);
      isCasting = false; // Reset on error so it can retry
      return;
    }
    console.log('[Chromecast] Cast started successfully');
    if (stdout) console.log('[Chromecast] stdout:', stdout);
  });
}

function stopCasting() {
  if (!isCasting) return;
  if (!cattAvailable || !chromecastIp) return;

  console.log('[Chromecast] Stopping cast...');
  
  exec(`${cattCmd} -d "${chromecastIp}" stop`, (error) => {
    if (error) {
      console.error('[Chromecast] Error stopping cast:', error.message);
    } else {
      console.log('[Chromecast] Cast stopped');
    }
  });
  
  isCasting = false;
  if (pauseTimer) {
    clearTimeout(pauseTimer);
    pauseTimer = null;
  }
}

const PAUSE_TIMEOUT = 5000; // 5 seconds

async function pollLmsStatus() {
  try {
    if (!chromecastEnabled || !chromecastIp) {
      if (isCasting) {
        console.log('[Chromecast] Disabled or no IP, stopping cast');
        stopCasting();
      }
      return;
    }

    // Determine which player to use: prefer preferredPlayerId (set by app), otherwise use currentPlayerId
    let activePlayerId = preferredPlayerId || currentPlayerId;
    
    if (!activePlayerId) {
      // No player selected yet, try to get one
      if (preferredPlayerId) {
        activePlayerId = preferredPlayerId;
        currentPlayerId = preferredPlayerId;
        console.log('[Chromecast] Using preferred player:', preferredPlayerName || preferredPlayerId);
      } else {
        const players = await getPlayers();
        if (players.length > 0) {
          activePlayerId = players[0].playerid;
          currentPlayerId = activePlayerId;
          console.log('[Chromecast] Auto-selected player:', players[0].name);
        } else {
          return;
        }
      }
    } else if (preferredPlayerId && preferredPlayerId !== currentPlayerId) {
      // Preferred player changed, update currentPlayerId
      currentPlayerId = preferredPlayerId;
      activePlayerId = preferredPlayerId;
      console.log('[Chromecast] Switched to preferred player:', preferredPlayerName || preferredPlayerId);
    }

    const status = await getPlayerStatus(activePlayerId);
    if (!status) {
      console.log('[Chromecast] No status returned from LMS');
      return;
    }

    const mode = status.mode;
    const hasTrack = status.playlist_loop && status.playlist_loop.length > 0;

    console.log(`[Chromecast] Poll status: mode=${mode}, hasTrack=${hasTrack}, isCasting=${isCasting}, chromecastEnabled=${chromecastEnabled}, chromecastIp=${chromecastIp}`);

    if (mode === 'play' && hasTrack) {
      if (pauseTimer) {
        clearTimeout(pauseTimer);
        pauseTimer = null;
      }

      if (!isCasting && chromecastIp && chromecastEnabled) {
        console.log('[Chromecast] Play detected, starting cast...');
        await startCasting();
      } else if (isCasting) {
        // isCasting flag is true, but verify cast is actually active
        // If cast failed silently, reset flag and retry
        console.log('[Chromecast] isCasting flag is true, but verifying cast is active...');
        // Reset flag and retry - if cast is actually active, startCasting will detect it
        // If cast failed, this will allow a retry
        isCasting = false;
        await startCasting();
      } else if (!chromecastIp) {
        console.log('[Chromecast] No Chromecast IP configured');
      } else if (!chromecastEnabled) {
        console.log('[Chromecast] Casting disabled');
      }
    } else if (mode === 'stop' || (mode !== 'play' && !hasTrack)) {
      // Stop mode - stop casting immediately
      // Also stop if mode is not 'play' and there's no track (playlist empty)
      if (isCasting) {
        if (pauseTimer) {
          clearTimeout(pauseTimer);
          pauseTimer = null;
        }
        console.log(`[Chromecast] Stop detected (mode=${mode}, hasTrack=${hasTrack}), stopping cast immediately...`);
        stopCasting();
      }
    } else if (mode === 'pause') {
      // Pause mode - wait a bit before stopping (user might resume)
      if (isCasting && !pauseTimer) {
        console.log(`[Chromecast] Pause detected, will stop cast in ${PAUSE_TIMEOUT/1000} seconds...`);
        pauseTimer = setTimeout(() => {
          console.log('[Chromecast] Pause timeout reached, stopping cast');
          stopCasting();
          pauseTimer = null;
        }, PAUSE_TIMEOUT);
      }
    }

    lastMode = mode;
  } catch (e) {
    console.error('[Chromecast] Poll error:', e.message);
  }
}

// Start polling LMS status every 2 seconds
let pollInterval = null;

function startPolling() {
  if (pollInterval) {
    console.log('[Chromecast] Polling already started, skipping');
    return;
  }
  console.log('[Chromecast] Starting LMS status polling...', { chromecastEnabled, chromecastIp, castingLmsHost, castingLmsPort });
  pollInterval = setInterval(pollLmsStatus, 2000);
  pollLmsStatus(); // Initial poll
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('[Chromecast] Stopped LMS status polling');
  }
}

// Chromecast configuration endpoint
app.post('/api/chromecast/config', async (req, res) => {
  try {
    const { ip, name, enabled, lmsHost, lmsPort, playerId, playerName } = req.body;
    
    if (ip !== undefined) {
      chromecastIp = ip;
      chromecastName = name || '';
      console.log(`[Chromecast] Configured: ${chromecastName || chromecastIp} (${chromecastIp})`);
    }
    
    if (enabled !== undefined) {
      chromecastEnabled = enabled;
      console.log(`[Chromecast] Enabled set to: ${chromecastEnabled}`);
      
      if (!chromecastEnabled && isCasting) {
        stopCasting();
      }
      
      if (chromecastEnabled && chromecastIp) {
        startPolling();
      } else {
        stopPolling();
      }
    }
    
    if (lmsHost !== undefined) {
      castingLmsHost = lmsHost;
      castingLmsPort = lmsPort || 9000;
      console.log(`[Chromecast] LMS server set to: ${castingLmsHost}:${castingLmsPort}`);
    }
    
    if (playerId !== undefined) {
      preferredPlayerId = playerId;
      preferredPlayerName = playerName || '';
      console.log(`[Chromecast] Preferred player set to: ${preferredPlayerName || preferredPlayerId}`);
    }
    
    res.json({
      success: true,
      message: chromecastIp ? `Configured ${chromecastName || chromecastIp}` : 'Chromecast disabled',
      chromecastIp,
      chromecastName,
      chromecastEnabled,
      lmsHost: castingLmsHost,
      lmsPort: castingLmsPort,
      playerId: preferredPlayerId
    });
  } catch (error) {
    console.error('[Chromecast] Config error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to configure Chromecast' 
    });
  }
});

// Chromecast casting endpoint
app.post('/api/chromecast/cast', async (req, res) => {
  try {
    const { ip, lmsHost, lmsPort, playerId, playerName } = req.body;
    
    if (!ip) {
      return res.status(400).json({ error: 'Chromecast IP is required' });
    }
    
    console.log('[Chromecast] Cast endpoint called', { ip, lmsHost, lmsPort, playerId });
    
    // Configure Chromecast
    chromecastIp = ip;
    chromecastEnabled = true;
    
    if (lmsHost) {
      castingLmsHost = lmsHost;
      castingLmsPort = lmsPort || 9000;
    }
    
    if (playerId) {
      preferredPlayerId = playerId;
      preferredPlayerName = playerName || '';
    }
    
    // Start polling if not already started
    startPolling();
    
    // Casting will start automatically when music plays (via polling)
    res.json({ 
      success: true, 
      message: 'Chromecast configured. Casting will start automatically when music plays.',
      chromecastIp,
      chromecastEnabled: true
    });
    
  } catch (error) {
    console.error('[Chromecast] Cast error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Cast failed' 
    });
  }
});

// Chromecast enabled state endpoint
app.post('/api/chromecast/enabled', async (req, res) => {
  try {
    const { enabled } = req.body;
    console.log('[Chromecast] Enabled state:', enabled);
    
    chromecastEnabled = enabled;
    
    if (!chromecastEnabled && isCasting) {
      stopCasting();
    }
    
    if (chromecastEnabled && chromecastIp) {
      startPolling();
    } else {
      stopPolling();
    }
    
    res.json({ success: true, enabled: chromecastEnabled });
  } catch (error) {
    console.error('[Chromecast] Enabled state error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to set enabled state' 
    });
  }
});

// Initialize Roon volume control
let globalRoonControl = null;

if (process.env.ENABLE_ROON_VOLUME_CONTROL === 'true') {
  console.log('[Server] Roon volume control is enabled, initializing...');
  try {
    // Import the Roon volume control module
    const { initializeRoonVolumeControl } = require('./roon-volume-control.ts');

    globalRoonControl = initializeRoonVolumeControl({
      enabled: true
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
} else {
  console.log('[Server] Roon volume control is disabled (set ENABLE_ROON_VOLUME_CONTROL=true to enable)');
}

// Static file serving for web app - serve from project root
const projectRoot = path.join(__dirname, '..');
app.use(express.static(projectRoot));

// Removed duplicate root route

// Additional static serving for public directory
app.use(express.static('public'));

const server = createServer(app);

console.log(`🚀 Starting SoundStream server on port ${PORT}...`);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SoundStream server running on http://192.168.0.21:${PORT}`);
  console.log(`✅ Health check: http://192.168.0.21:${PORT}/api/health`);
  
  // Start Chromecast polling if enabled
  if (chromecastEnabled && chromecastIp) {
    startPolling();
  }
  
  if (!cattAvailable) {
    console.log('[Chromecast] Install catt for Chromecast support: pip3 install catt');
  }
}).on('error', (err) => {
  console.error(`❌ Failed to start server:`, err.message);
  process.exit(1);
});
