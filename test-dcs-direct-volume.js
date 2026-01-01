#!/usr/bin/env node

/**
 * Test script to control dCS Varese DAC volume directly via UPnP
 * This mimics how Squeezelite controls volume on UPnP devices
 * 
 * Usage:
 *   node test-dcs-direct-volume.js <dac-ip> [dac-port] [action] [value]
 * 
 * Examples:
 *   node test-dcs-direct-volume.js 192.168.0.19 16500 get
 *   node test-dcs-direct-volume.js 192.168.0.19 16500 set 50
 *   node test-dcs-direct-volume.js 192.168.0.19 16500 set -40  (in dB)
 */

const DAC_IP = process.argv[2] || '192.168.0.19';
const DAC_PORT = parseInt(process.argv[3] || '80', 10); // dCS Varese typically uses port 80 for UPnP
const ACTION = process.argv[4] || 'get';
const VALUE = process.argv[5];

// Common UPnP RenderingControl paths (same as Squeezelite uses)
const CONTROL_PATHS = [
  '/RenderingControl/ctrl',
  '/RenderingControl/control',
  '/upnp/control/RenderingControl',
  '/ctl/RenderingControl',
  '/MediaRenderer/RenderingControl/Control',
  '/dev/RenderingControl/ctrl',
  '/RenderingControl',
];

function percentToDb(percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  const db = ((clamped / 100) * 80) - 80;
  return db.toFixed(1);
}

function dbToPercent(db) {
  const num = parseFloat(db);
  if (num <= 0 && num >= -80) {
    return Math.round(((num + 80) / 80) * 100);
  }
  return Math.round(Math.max(0, Math.min(100, num)));
}

function parseVolumeFromResponse(xml) {
  // Try to find CurrentVolume in response
  const match = xml.match(/<CurrentVolume>([^<]+)<\/CurrentVolume>/i);
  if (match) {
    const value = match[1].trim();
    const num = parseFloat(value);
    if (!isNaN(num)) {
      // Check if it's in dB format (-80 to 0)
      if (num <= 0 && num >= -80) {
        const percent = dbToPercent(num);
        console.log(`Volume: ${value}dB = ${percent}%`);
        return { value: num, percent, format: 'dB' };
      } else {
        // Standard 0-100 format
        console.log(`Volume: ${value}%`);
        return { value: num, percent: Math.round(num), format: 'percent' };
      }
    }
  }
  return null;
}

async function discoverControlPath(baseUrl) {
  // First, try to get device description to find the correct control URL
  try {
    const descUrl = `${baseUrl}/description.xml`;
    console.log(`[Discovery] Fetching device description from ${descUrl}...`);
    const descResponse = await fetch(descUrl, { 
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': 'SoundStream/1.0 UPnP/1.0',
      }
    });
    
    if (!descResponse.ok) {
      console.log(`[Discovery] Device description returned HTTP ${descResponse.status}`);
      throw new Error(`HTTP ${descResponse.status}`);
    }
    
    const descXml = await descResponse.text();
    
    // Parse device description to find RenderingControl service URL
    const serviceMatch = descXml.match(/<serviceType>urn:schemas-upnp-org:service:RenderingControl:1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/i);
    if (serviceMatch) {
      const controlUrl = serviceMatch[1];
      // Make it absolute if relative
      const fullUrl = controlUrl.startsWith('http') ? controlUrl : `${baseUrl}${controlUrl}`;
      console.log(`[Discovery] Found RenderingControl URL in description: ${fullUrl}`);
      return fullUrl;
    }
  } catch (error) {
    console.log(`[Discovery] Could not fetch device description: ${error.message}`);
    if (error.cause) {
      console.log(`[Discovery] Error cause: ${error.cause.message || error.cause}`);
    }
  }
  
  // Fallback: try common paths
  console.log(`[Discovery] Trying common control paths...`);
  for (const path of CONTROL_PATHS) {
    const url = `${baseUrl}${path}`;
    console.log(`[Discovery] Trying: ${url}`);
    // We'll test it when we make the actual request
  }
  
  return null;
}

async function makeSOAPRequest(url, soapBody, action) {
  console.log(`[SOAP] ${action} -> ${url}`);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPAction': `"urn:schemas-upnp-org:service:RenderingControl:1#${action}"`,
      'User-Agent': 'SoundStream/1.0 UPnP/1.0',
    },
    body: soapBody,
    signal: AbortSignal.timeout(5000),
  });
  
  return response;
}

async function getVolume(baseUrl, controlPath = null) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
    </u:GetVolume>
  </s:Body>
</s:Envelope>`;

  // Try discovered path first, then common paths
  const pathsToTry = controlPath 
    ? [controlPath, ...CONTROL_PATHS.map(p => `${baseUrl}${p}`)]
    : CONTROL_PATHS.map(p => `${baseUrl}${p}`);

  for (const url of pathsToTry) {
    try {
      const response = await makeSOAPRequest(url, soapBody, 'GetVolume');
      
      if (!response.ok) {
        console.log(`[GetVolume] Failed: HTTP ${response.status}`);
        continue;
      }
      
      const xml = await response.text();
      console.log(`[GetVolume] Response (first 500 chars):\n${xml.substring(0, 500)}`);
      
      const volume = parseVolumeFromResponse(xml);
      if (volume) {
        console.log(`\n✅ Success! Working control path: ${url}`);
        return { volume, workingPath: url };
      }
    } catch (error) {
      console.log(`[GetVolume] Error: ${error.message}`);
      continue;
    }
  }
  
  throw new Error('Could not get volume - all paths failed');
}

async function setVolume(baseUrl, volumeValue, useDb = false, controlPath = null) {
  // Determine if input is dB or percent
  let volumePercent, volumeDb;
  
  if (useDb || (volumeValue < 0 && volumeValue >= -80)) {
    // Input is in dB
    volumeDb = volumeValue.toFixed(1);
    volumePercent = dbToPercent(volumeValue);
  } else {
    // Input is in percent
    volumePercent = Math.max(0, Math.min(100, Math.round(volumeValue)));
    volumeDb = percentToDb(volumePercent);
  }
  
  console.log(`[SetVolume] Target: ${volumePercent}% (${volumeDb}dB)`);
  
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredVolume>${volumeDb}</DesiredVolume>
    </u:SetVolume>
  </s:Body>
</s:Envelope>`;

  // Try discovered path first, then common paths
  const pathsToTry = controlPath 
    ? [controlPath, ...CONTROL_PATHS.map(p => `${baseUrl}${p}`)]
    : CONTROL_PATHS.map(p => `${baseUrl}${p}`);

  for (const url of pathsToTry) {
    try {
      const response = await makeSOAPRequest(url, soapBody, 'SetVolume');
      
      if (!response.ok) {
        const text = await response.text();
        console.log(`[SetVolume] Failed: HTTP ${response.status}`);
        console.log(`[SetVolume] Response: ${text.substring(0, 200)}`);
        continue;
      }
      
      const xml = await response.text();
      console.log(`[SetVolume] Response (first 500 chars):\n${xml.substring(0, 500)}`);
      
      console.log(`\n✅ Success! Working control path: ${url}`);
      return { workingPath: url };
    } catch (error) {
      console.log(`[SetVolume] Error: ${error.message}`);
      continue;
    }
  }
  
  throw new Error('Could not set volume - all paths failed');
}

async function main() {
  const baseUrl = `http://${DAC_IP}:${DAC_PORT}`;
  
  console.log(`\n🎵 Testing direct UPnP volume control on dCS Varese`);
  console.log(`   DAC: ${DAC_IP}:${DAC_PORT}`);
  console.log(`   Action: ${ACTION}`);
  if (VALUE) console.log(`   Value: ${VALUE}`);
  console.log(`\n`);
  
  try {
    // Discover control path first
    const discoveredPath = await discoverControlPath(baseUrl);
    
    if (ACTION === 'get') {
      const result = await getVolume(baseUrl, discoveredPath);
      console.log(`\n📊 Current Volume:`);
      console.log(`   ${result.volume.percent}% (${result.volume.value}${result.volume.format === 'dB' ? 'dB' : ''})`);
      console.log(`   Working path: ${result.workingPath}`);
    } else if (ACTION === 'set') {
      if (!VALUE) {
        console.error('❌ Error: Set volume requires a value (0-100 or -80 to 0 for dB)');
        process.exit(1);
      }
      
      const volumeValue = parseFloat(VALUE);
      if (isNaN(volumeValue)) {
        console.error('❌ Error: Volume value must be a number');
        process.exit(1);
      }
      
      const useDb = volumeValue < 0 && volumeValue >= -80;
      const result = await setVolume(baseUrl, volumeValue, useDb, discoveredPath);
      console.log(`\n✅ Volume set successfully!`);
      console.log(`   Working path: ${result.workingPath}`);
      
      // Verify by getting volume again
      console.log(`\n🔍 Verifying...`);
      await new Promise(resolve => setTimeout(resolve, 500));
      const verify = await getVolume(baseUrl, result.workingPath);
      console.log(`   Current volume: ${verify.volume.percent}% (${verify.volume.value}${verify.volume.format === 'dB' ? 'dB' : ''})`);
    } else {
      console.error(`❌ Error: Unknown action "${ACTION}". Use "get" or "set"`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();

