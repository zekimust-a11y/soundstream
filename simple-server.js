console.log('🚀 Starting SoundStream server...');
const express = require('express');
const { createServer } = require('http');
const crypto = require('crypto');
const https = require('https');
const path = require('path');
const fs = require('fs');

// Import Tidal API client
let TidalApiClient;
try {
  // Note: simple-server.js is in server/ directory, so use relative path
  const tidalApiModule = require('./tidal-api-client');
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
app.post('/api/lms/proxy', (req, res) => {
  console.log('[LMS Proxy] Processing request');

  const { command, playerId } = req.body;

  // Build JSON-RPC request
  const jsonRpcRequest = {
    id: 1,
    method: 'slim.request',
    params: [playerId || '', command]
  };

  const postData = JSON.stringify(jsonRpcRequest);

  console.log(`[LMS Proxy] Command:`, JSON.stringify(command));

  // Use execSync with curl to connect to real LMS
  const { execSync } = require('child_process');

  try {
    const curlCommand = `curl -s -X POST -H 'Content-Type: application/json' -H 'Connection: close' --connect-timeout 5 --max-time 15 --data '${postData.replace(/'/g, "'\\''")}' http://192.168.0.19:9000/jsonrpc.js`;

    const stdout = execSync(curlCommand, {
      encoding: 'utf8',
      timeout: 20000
    });

    console.log('[LMS Proxy] Raw response length:', stdout.length);

    if (!stdout || !stdout.trim()) {
      throw new Error('No response from LMS');
    }

    const response = JSON.parse(stdout.trim());
    res.json(response);

  } catch (error) {
    console.error('[LMS Proxy] LMS request failed:', error.message);
    res.status(500).json({
      error: 'LMS request failed',
      details: error.message
    });
  }
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
    // Include r_usr (legacy scope) which is required for favorites/playlists endpoints
    // r_usr might be automatically granted with user.read, but we'll request it explicitly
    const scope = 'r_usr user.read collection.read collection.write playlists.read playlists.write search.read search.write playback recommendations.read entitlements.read'; // All available scopes including r_usr
    
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
      client_secret: '',
      redirect_uri: redirectUri,
      code_verifier: global.codeVerifier || '',
    });

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
      client_secret: '', // No secret needed for public clients
      redirect_uri: redirectUri,
      code_verifier: global.codeVerifier,
    });

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

app.get('/api/tidal/albums', async (req, res) => {
  try {
    if (!tidalTokens?.accessToken) {
      return res.status(401).json({ error: 'Not authenticated with Tidal' });
    }

    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    console.log('Fetching Tidal albums using TidalApiClient...');

    // Use TidalApiClient if available, otherwise fall back to direct API calls
    if (TidalApiClient) {
      try {
        const tidalClient = new TidalApiClient({
          clientId: TIDAL_CLIENT_ID,
          accessToken: tidalTokens.accessToken,
          refreshToken: tidalTokens.refreshToken,
          userId: tidalTokens.userId
        });

        await tidalClient.authenticate();
        const result = await tidalClient.getMyAlbums(limit, offset);
        
        // Transform to match our format
        const albums = result.items.map(album => ({
          id: album.id,
          title: album.title,
          artist: album.artist.name,
          artistId: album.artist.id,
          artwork_url: album.cover ? `https://resources.tidal.com/images/${album.cover.replace(/-/g, '/')}/320x320.jpg` : null,
          year: album.year,
          numberOfTracks: album.numberOfTracks,
          lmsUri: album.lmsUri,
          source: 'tidal'
        }));

        return res.json({
          items: albums,
          total: result.total
        });
      } catch (error) {
        console.error('TidalApiClient failed:', error.message);
        // If favorites endpoint doesn't exist or user has no favorites, return empty
        // The user might not have any favorite albums yet
        console.log('Returning empty albums list - user may not have favorites or endpoint unavailable');
        return res.json({
          items: [],
          total: 0,
          message: 'No favorite albums found. Try adding albums to your Tidal favorites.'
        });
      }
    }

    // Fallback: Use Tidal OpenAPI directly
    // Try /v1/users/{userId}/favorites/albums first
    let response;
    let endpoint = `https://api.tidal.com/v1/users/${tidalTokens.userId}/favorites/albums?limit=${limit}&offset=${offset}&countryCode=US`;
    
    response = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${tidalTokens.accessToken}`,
        'accept': 'application/vnd.tidal.v1+json',
        'Content-Type': 'application/vnd.tidal.v1+json',
      }
    });
    
    // If that fails, try without userId (using authenticated user)
    if (!response.ok && response.status === 404) {
      console.log('Trying alternative endpoint format...');
      endpoint = `https://api.tidal.com/v1/favorites/albums?limit=${limit}&offset=${offset}&countryCode=US`;
      response = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${tidalTokens.accessToken}`,
          'accept': 'application/vnd.tidal.v1+json',
          'Content-Type': 'application/vnd.tidal.v1+json',
        }
      });
    }
    
    // If still fails, try v2
    if (!response.ok && response.status === 404) {
      console.log('Trying v2 endpoint...');
      endpoint = `https://api.tidal.com/v2/users/${tidalTokens.userId}/favorites/albums?limit=${limit}&offset=${offset}&countryCode=US`;
      response = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${tidalTokens.accessToken}`,
          'accept': 'application/vnd.tidal.v1+json',
          'Content-Type': 'application/vnd.tidal.v1+json',
        }
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Tidal API error ${response.status}:`, errorText);
      throw new Error(`Tidal API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const items = data.items || data.data || [];

    // Transform to match our format
    const albums = items.map(album => {
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

    res.json({
      items: albums,
      total: data.totalNumberOfItems || data.total || albums.length
    });
  } catch (error) {
    console.error('Tidal albums error:', error);
    res.status(500).json({
      error: error.message || 'Failed to get Tidal albums'
    });
  }
});

app.get('/api/tidal/artists', async (req, res) => {
  try {
    if (!tidalTokens?.accessToken) {
      return res.status(401).json({ error: 'Not authenticated with Tidal' });
    }

    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    // Use Tidal OpenAPI v2 directly
    const response = await fetch(`https://api.tidal.com/v2/users/${tidalTokens.userId}/favorites/artists?limit=${limit}&offset=${offset}&countryCode=US`, {
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
    const artists = items.map(artist => {
      const pictureId = artist.picture || artist.imageId || artist.coverId;
      return {
        id: String(artist.id),
        name: artist.name || 'Unknown Artist',
        picture: pictureId ? `https://resources.tidal.com/images/${pictureId.replace(/-/g, '/')}/320x320.jpg` : null
      };
    });

    res.json({
      items: artists,
      total: data.totalNumberOfItems || data.total || artists.length
    });
  } catch (error) {
    console.error('Tidal artists error:', error);
    res.status(500).json({
      error: error.message || 'Failed to get Tidal artists'
    });
  }
});

app.get('/api/tidal/playlists', async (req, res) => {
  try {
    if (!tidalTokens?.accessToken) {
      return res.status(401).json({ error: 'Not authenticated with Tidal' });
    }

    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // Use Tidal OpenAPI v2 directly
    const response = await fetch(`https://api.tidal.com/v2/users/${tidalTokens.userId}/playlists?limit=${limit}&offset=${offset}&countryCode=US`, {
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
    const playlists = items.map(playlist => {
      const coverId = playlist.cover || playlist.imageId || playlist.coverId || playlist.squareImage;
      return {
        id: String(playlist.id),
        title: playlist.title || playlist.name || 'Unknown Playlist',
        description: playlist.description,
        creator: playlist.creator?.name,
        numberOfTracks: playlist.numberOfTracks || playlist.trackCount,
        cover: coverId ? `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/320x320.jpg` : null,
        lastUpdated: playlist.lastUpdated || playlist.updatedAt,
        lmsUri: `tidal://playlist:${playlist.id}`,
        source: 'tidal'
      };
    });

    res.json({
      items: playlists,
      total: data.totalNumberOfItems || data.total || playlists.length
    });
  } catch (error) {
    console.error('Tidal playlists error:', error);
    res.status(500).json({
      error: error.message || 'Failed to get Tidal playlists'
    });
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

// Chromecast device discovery endpoint
app.get('/api/chromecast/discover', async (req, res) => {
  try {
    console.log('[Chromecast] Discovery requested');
    // Return empty array for now - mDNS discovery can be added later if needed
    // The client can handle manual IP entry
    res.json([]);
  } catch (error) {
    console.error('[Chromecast] Discovery error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Discovery failed' 
    });
  }
});

// Chromecast enabled state endpoint
app.post('/api/chromecast/enabled', async (req, res) => {
  try {
    const { enabled } = req.body;
    console.log('[Chromecast] Enabled state:', enabled);
    // Store enabled state (can be persisted if needed)
    res.json({ success: true, enabled });
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
}).on('error', (err) => {
  console.error(`❌ Failed to start server:`, err.message);
  process.exit(1);
});
