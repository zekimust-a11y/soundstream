#!/usr/bin/env node

/**
 * Metro Bundler Health Check Script
 * Periodically checks if Metro bundler is running and restarts it if needed
 */

const { exec } = require('child_process');
const path = require('path');

const METRO_URL = 'http://localhost:8081/';
const CHECK_INTERVAL = 30000; // Check every 30 seconds
const PROJECT_DIR = path.resolve(__dirname, '..');

let isRestarting = false;

function checkMetro() {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    fetch(METRO_URL, { 
      signal: controller.signal,
      method: 'HEAD'
    })
      .then(response => {
        clearTimeout(timeoutId);
        resolve(response.ok || response.status < 500);
      })
      .catch(() => {
        clearTimeout(timeoutId);
        resolve(false);
      });
  });
}

function killMetro() {
  return new Promise((resolve) => {
    console.log('[Metro Monitor] Killing existing Metro processes...');
    exec('pkill -f "expo.*start" 2>/dev/null; pkill -f "metro" 2>/dev/null', (error) => {
      // Ignore errors - process might not exist
      setTimeout(resolve, 1000); // Wait 1 second for processes to die
    });
  });
}

function startMetro() {
  return new Promise((resolve, reject) => {
    if (isRestarting) {
      return resolve();
    }
    
    isRestarting = true;
    console.log('[Metro Monitor] Starting Metro bundler...');
    
    const metroProcess = exec('npm run expo:dev:local', {
      cwd: PROJECT_DIR,
      env: { ...process.env, EXPO_PUBLIC_DOMAIN: 'localhost:3000' }
    }, (error) => {
      if (error) {
        console.error('[Metro Monitor] Failed to start Metro:', error.message);
        isRestarting = false;
        reject(error);
      }
    });
    
    // Detach process so it runs in background
    metroProcess.unref();
    
    // Wait a bit for Metro to start
    setTimeout(() => {
      isRestarting = false;
      resolve();
    }, 5000);
  });
}

async function monitorMetro() {
  const isRunning = await checkMetro();
  
  if (!isRunning && !isRestarting) {
    console.log('[Metro Monitor] Metro bundler is not running, restarting...');
    await killMetro();
    await startMetro();
  } else if (isRunning) {
    console.log('[Metro Monitor] Metro bundler is running ✓');
  }
}

// Start monitoring
console.log('[Metro Monitor] Starting Metro bundler health check...');
console.log(`[Metro Monitor] Checking every ${CHECK_INTERVAL / 1000} seconds`);

// Initial check and start
monitorMetro();

// Periodic checks
setInterval(monitorMetro, CHECK_INTERVAL);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Metro Monitor] Shutting down...');
  process.exit(0);
});






