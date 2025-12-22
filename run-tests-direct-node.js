#!/usr/bin/env node

/**
 * Run all tests directly using Node.js child_process
 * This completely bypasses the broken shell
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;

function runTest(name, script, args = []) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${name}`);
    console.log('='.repeat(60));
    
    const scriptPath = path.join(projectRoot, script);
    
    if (!fs.existsSync(scriptPath)) {
      console.error(`\n❌ Script not found: ${scriptPath}`);
      resolve({ success: false, error: 'Script not found' });
      return;
    }
    
    console.log(`Running: node ${script} ${args.join(' ')}\n`);
    
    const child = spawn('node', [scriptPath, ...args], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...process.env }, // Clean environment
      shell: false, // Don't use shell
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `Exit code ${code}` });
      }
    });
    
    child.on('error', (error) => {
      console.error(`\n❌ Error: ${error.message}`);
      resolve({ success: false, error: error.message });
    });
  });
}

async function main() {
  console.log('\n🎵 dCS Varese Volume Control Test Suite');
  console.log('========================================\n');
  
  const results = [];
  
  // Test 1: Inspect Squeezelite
  results.push(await runTest(
    '1. Inspecting Squeezelite UPnP Bridge',
    'inspect-squeezelite-upnp.js'
  ));
  
  // Test 2: Test Squeezelite method
  results.push(await runTest(
    '2. Testing Squeezelite\'s Volume Control Method',
    'test-squeezelite-method.js'
  ));
  
  // Test 3: Discover dCS Varese services
  results.push(await runTest(
    '3. Discovering dCS Varese UPnP Services',
    'discover-upnp-services.js',
    ['192.168.0.42', '16500']
  ));
  
  // Test 4: Direct volume control (GET)
  results.push(await runTest(
    '4. Testing Direct Volume Control (GET)',
    'test-dcs-direct-volume.js',
    ['192.168.0.42', '16500', 'get']
  ));
  
  // Test 5: Direct volume control (SET)
  results.push(await runTest(
    '5. Testing Direct Volume Control (SET 50%)',
    'test-dcs-direct-volume.js',
    ['192.168.0.42', '16500', 'set', '50']
  ));
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test Summary');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\n✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total:  ${results.length}\n`);
  
  if (passed > 0) {
    console.log('💡 Check the output above to find the working control URL/method.\n');
  }
}

main().catch(console.error);


















