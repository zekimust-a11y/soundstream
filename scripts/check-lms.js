#!/usr/bin/env node

/**
 * LMS Server Health Check Script
 * Periodically checks if LMS server at 192.168.0.19:9000 is reachable
 */

const LMS_HOST = '192.168.0.19';
const LMS_PORT = 9000;
const CHECK_INTERVAL = 30000; // Check every 30 seconds
const LMS_URL = `http://${LMS_HOST}:${LMS_PORT}`;

let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_ALERT = 2; // Alert after 2 consecutive failures

async function checkLMS() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(`${LMS_URL}/jsonrpc.js`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        method: 'slim.request',
        params: ['', ['serverstatus', '0', '0']]
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      if (data.result) {
        consecutiveFailures = 0;
        const version = data.result.version || 'unknown';
        console.log(`[LMS Health Check] ✓ LMS server at ${LMS_URL} is reachable (version: ${version})`);
        return true;
      }
    }
    
    consecutiveFailures++;
    console.error(`[LMS Health Check] ✗ LMS server at ${LMS_URL} returned status ${response.status}`);
    return false;
  } catch (error) {
    consecutiveFailures++;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[LMS Health Check] ✗ LMS server at ${LMS_URL} is not reachable: ${errorMsg}`);
    
    if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT) {
      console.error(`\n⚠️  ALERT: LMS server at ${LMS_URL} has been unreachable for ${consecutiveFailures} consecutive checks`);
      console.error(`   Please check if the LMS server is running and accessible on the network.\n`);
    }
    
    return false;
  }
}

// Start monitoring
console.log(`[LMS Health Check] Starting LMS server health check...`);
console.log(`[LMS Health Check] Checking ${LMS_URL} every ${CHECK_INTERVAL / 1000} seconds\n`);

// Initial check
checkLMS();

// Periodic checks
setInterval(checkLMS, CHECK_INTERVAL);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[LMS Health Check] Shutting down...');
  process.exit(0);
});






