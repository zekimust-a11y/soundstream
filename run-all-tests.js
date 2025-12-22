#!/usr/bin/env node

/**
 * Run all dCS Varese volume control tests
 * This bypasses shell issues by running everything in Node.js
 */

const { execSync } = require('child_process');
const path = require('path');

const projectRoot = __dirname;

function runTest(name, script, args = []) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${name}`);
  console.log('='.repeat(60));
  
  try {
    const scriptPath = path.join(projectRoot, script);
    
    // Check if file exists
    const fs = require('fs');
    if (!fs.existsSync(scriptPath)) {
      console.error(`\n❌ Script not found: ${scriptPath}`);
      return { success: false, error: 'Script not found' };
    }
    
    const command = `node "${scriptPath}" ${args.map(a => `"${a}"`).join(' ')}`;
    console.log(`Running: ${command}\n`);
    const output = execSync(command, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'inherit',
    });
    return { success: true, output };
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('\n🎵 dCS Varese Volume Control Test Suite');
  console.log('========================================\n');
  
  const results = [];
  
  // Test 1: Inspect Squeezelite
  results.push(runTest(
    '1. Inspecting Squeezelite UPnP Bridge',
    'inspect-squeezelite-upnp.js'
  ));
  
  // Test 2: Test Squeezelite method
  results.push(runTest(
    '2. Testing Squeezelite\'s Volume Control Method',
    'test-squeezelite-method.js'
  ));
  
  // Test 3: Discover dCS Varese services
  results.push(runTest(
    '3. Discovering dCS Varese UPnP Services',
    'discover-upnp-services.js',
    ['192.168.0.42', '16500']
  ));
  
  // Test 4: Direct volume control (GET)
  results.push(runTest(
    '4. Testing Direct Volume Control (GET)',
    'test-dcs-direct-volume.js',
    ['192.168.0.42', '16500', 'get']
  ));
  
  // Test 5: Direct volume control (SET)
  results.push(runTest(
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

