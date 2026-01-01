#!/usr/bin/env node

/**
 * API Server Health Check Script
 * Periodically checks if API server on port 3000 is running
 * If it stops, investigates why and restarts it
 */

const SERVER_PORT = 3000;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const CHECK_INTERVAL = 30000; // Check every 30 seconds
const PROJECT_DIR = '/Users/zeki/Documents/Audio Streamer Cursor/soundstream';

let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_ALERT = 2; // Alert after 2 consecutive failures
let isRestarting = false;

async function checkServer() {
  return new Promise((resolve) => {
    const http = require('http');
    const url = require('url');
    
    const request = http.get(`${SERVER_URL}/api/health`, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        if (response.statusCode === 200) {
          try {
            const jsonData = JSON.parse(data);
            consecutiveFailures = 0;
            console.log(`[Server Health Check] ✓ API server on port ${SERVER_PORT} is running (${jsonData.service || 'unknown'})`);
            resolve(true);
          } catch (e) {
            consecutiveFailures = 0;
            console.log(`[Server Health Check] ✓ API server on port ${SERVER_PORT} is running`);
            resolve(true);
          }
        } else {
          consecutiveFailures++;
          console.error(`[Server Health Check] ✗ API server on port ${SERVER_PORT} returned status ${response.statusCode}`);
          if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT && !isRestarting) {
            console.error(`\n⚠️  ALERT: API server on port ${SERVER_PORT} has been unreachable for ${consecutiveFailures} consecutive checks`);
            investigateAndRestart().then(() => resolve(false));
          } else {
            resolve(false);
          }
        }
      });
    });
    
    request.on('error', async (error) => {
      consecutiveFailures++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Server Health Check] ✗ API server on port ${SERVER_PORT} is not reachable: ${errorMsg}`);
      
      if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT && !isRestarting) {
        console.error(`\n⚠️  ALERT: API server on port ${SERVER_PORT} has been unreachable for ${consecutiveFailures} consecutive checks`);
        await investigateAndRestart();
      }
      
      resolve(false);
    });
    
    request.setTimeout(3000, () => {
      request.destroy();
      consecutiveFailures++;
      console.error(`[Server Health Check] ✗ API server on port ${SERVER_PORT} request timed out`);
      
      if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT && !isRestarting) {
        console.error(`\n⚠️  ALERT: API server on port ${SERVER_PORT} has been unreachable for ${consecutiveFailures} consecutive checks`);
        investigateAndRestart().then(() => resolve(false));
      } else {
        resolve(false);
      }
    });
  });
}

async function investigateAndRestart() {
  if (isRestarting) return;
  isRestarting = true;
  
  console.log(`\n[Server Health Check] Investigating why server stopped...`);
  
  // Check if process is running
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  try {
    // Check if port is in use
    const { stdout: portCheck } = await execAsync(`lsof -ti:${SERVER_PORT} 2>/dev/null || echo ""`);
    const portInUse = portCheck.trim();
    
    if (portInUse) {
      console.log(`[Server Health Check] Port ${SERVER_PORT} is in use by PID: ${portInUse}`);
      console.log(`[Server Health Check] Process may have crashed or become unresponsive`);
    } else {
      console.log(`[Server Health Check] Port ${SERVER_PORT} is not in use - server process is not running`);
    }
    
    // Check for server processes
    const { stdout: processCheck } = await execAsync(`ps aux | grep -E "(tsx.*server|node.*server)" | grep -v grep || echo ""`);
    const processesRunning = processCheck.trim();
    
    if (processesRunning) {
      console.log(`[Server Health Check] Found server processes:\n${processesRunning}`);
    } else {
      console.log(`[Server Health Check] No server processes found`);
    }
    
    // Check for recent errors in logs (if any)
    console.log(`[Server Health Check] Attempting to restart server...`);
    
    // Kill any existing processes
    await execAsync(`pkill -f "tsx.*server" 2>/dev/null; pkill -f "node.*server" 2>/dev/null; sleep 1`);
    
    // Start the server
    const { spawn } = require('child_process');
    const serverProcess = spawn('npm', ['run', 'server:dev'], {
      cwd: PROJECT_DIR,
      stdio: 'inherit',
      shell: true,
      detached: true,
    });
    
    serverProcess.unref();
    
    console.log(`[Server Health Check] Server restart initiated (PID: ${serverProcess.pid})`);
    console.log(`[Server Health Check] Waiting 10 seconds for server to start...`);
    
    // Wait and verify
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    const isRunning = await checkServer();
    if (isRunning) {
      console.log(`[Server Health Check] ✓ Server successfully restarted!`);
      consecutiveFailures = 0;
    } else {
      console.error(`[Server Health Check] ✗ Server restart failed - still not responding`);
      console.error(`[Server Health Check] Please check server logs manually`);
    }
    
  } catch (error) {
    console.error(`[Server Health Check] Error during investigation/restart:`, error);
  } finally {
    isRestarting = false;
  }
}

// Start monitoring
console.log(`[Server Health Check] Starting API server health check...`);
console.log(`[Server Health Check] Checking every ${CHECK_INTERVAL / 1000} seconds`);
console.log(`[Server Health Check] Server URL: ${SERVER_URL}\n`);

// Initial check
checkServer();

// Periodic checks
setInterval(checkServer, CHECK_INTERVAL);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server Health Check] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Server Health Check] Shutting down...');
  process.exit(0);
});

