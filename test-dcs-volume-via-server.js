#!/usr/bin/env node

/**
 * Test dCS Varese volume control via the server proxy endpoint
 * This uses the same method the app uses, which we know works
 * 
 * Usage:
 *   node test-dcs-volume-via-server.js <dac-ip> [dac-port] [action] [value]
 * 
 * Examples:
 *   node test-dcs-volume-via-server.js 192.168.0.42 80 get
 *   node test-dcs-volume-via-server.js 192.168.0.42 80 set 50
 */

const DAC_IP = process.argv[2] || '192.168.0.42';
const DAC_PORT = parseInt(process.argv[3] || '80', 10);
const ACTION = process.argv[4] || 'get';
const VALUE = process.argv[5];
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

async function testVolumeControl() {
  console.log(`\n🎵 Testing dCS Varese volume control via server proxy`);
  console.log(`   DAC: ${DAC_IP}:${DAC_PORT}`);
  console.log(`   Server: ${SERVER_URL}`);
  console.log(`   Action: ${ACTION}`);
  if (VALUE) console.log(`   Value: ${VALUE}`);
  console.log(`\n`);

  try {
    if (ACTION === 'get') {
      const response = await fetch(`${SERVER_URL}/api/upnp/volume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'get',
          ip: DAC_IP,
          port: DAC_PORT,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const data = await response.json();
      console.log(`✅ Success!`);
      console.log(`   Volume: ${data.volume}%`);
      if (data.dbVolume !== undefined) {
        console.log(`   dB: ${data.dbVolume}dB`);
      }
      console.log(`   Format: ${data.format || 'standard'}`);

    } else if (ACTION === 'set') {
      if (!VALUE) {
        console.error('❌ Error: Set volume requires a value (0-100)');
        process.exit(1);
      }

      const volume = parseFloat(VALUE);
      if (isNaN(volume) || volume < 0 || volume > 100) {
        console.error('❌ Error: Volume must be between 0 and 100');
        process.exit(1);
      }

      const response = await fetch(`${SERVER_URL}/api/upnp/volume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'set',
          ip: DAC_IP,
          port: DAC_PORT,
          volume: volume,
          useDbFormat: true, // dCS Varese uses dB format
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const data = await response.json();
      console.log(`✅ Success!`);
      console.log(`   Volume set to: ${data.volume}%`);
      
      // Verify by getting volume again
      console.log(`\n🔍 Verifying...`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const verifyResponse = await fetch(`${SERVER_URL}/api/upnp/volume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'get',
          ip: DAC_IP,
          port: DAC_PORT,
        }),
      });

      if (verifyResponse.ok) {
        const verifyData = await verifyResponse.json();
        console.log(`   Current volume: ${verifyData.volume}%`);
        if (verifyData.dbVolume !== undefined) {
          console.log(`   dB: ${verifyData.dbVolume}dB`);
        }
      }

    } else {
      console.error(`❌ Error: Unknown action "${ACTION}". Use "get" or "set"`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.message.includes('ECONNREFUSED') || error.message.includes('Failed to connect')) {
      console.error(`\n💡 Tip: Make sure the Express server is running on ${SERVER_URL}`);
      console.error(`   Start it with: npm run server:dev`);
    }
    process.exit(1);
  }
}

testVolumeControl();


















