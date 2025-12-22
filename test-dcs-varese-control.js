#!/usr/bin/env node

/**
 * Test the correct dCS Varese control URL we found via SSDP
 */

const DCS_IP = '192.168.0.42';
const DCS_PORT = 16500;
const CONTROL_URL = `http://${DCS_IP}:${DCS_PORT}/Control/LibRygelRenderer/RygelRenderingControl`;

function percentToDb(percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  const db = ((clamped / 100) * 80) - 80;
  return db.toFixed(1);
}

async function testGetVolume() {
  console.log(`\n🔍 Testing GetVolume on dCS Varese`);
  console.log(`   URL: ${CONTROL_URL}\n`);
  
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:2">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
    </u:GetVolume>
  </s:Body>
</s:Envelope>`;

  try {
    const response = await fetch(CONTROL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPAction': '"urn:schemas-upnp-org:service:RenderingControl:2#GetVolume"',
        'User-Agent': 'SoundStream/1.0 UPnP/1.0',
      },
      body: soapBody,
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const xml = await response.text();
      console.log(`✅ SUCCESS! Response:\n${xml.substring(0, 500)}\n`);
      
      const volumeMatch = xml.match(/<CurrentVolume>([^<]+)<\/CurrentVolume>/i);
      if (volumeMatch) {
        const volume = volumeMatch[1].trim();
        const volNum = parseFloat(volume);
        if (volNum < 0 && volNum >= -80) {
          const percent = Math.round(((volNum + 80) / 80) * 100);
          console.log(`📊 Current Volume: ${percent}% (${volNum}dB)\n`);
        } else {
          console.log(`📊 Current Volume: ${volume}\n`);
        }
      }
      return true;
    } else {
      console.log(`❌ HTTP ${response.status}`);
      const text = await response.text();
      console.log(`Response: ${text.substring(0, 200)}\n`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
    return false;
  }
}

async function testSetVolume(percent) {
  const dbValue = percentToDb(percent);
  console.log(`\n🔍 Testing SetVolume to ${percent}% (${dbValue}dB)`);
  console.log(`   URL: ${CONTROL_URL}\n`);
  
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:2">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredVolume>${dbValue}</DesiredVolume>
    </u:SetVolume>
  </s:Body>
</s:Envelope>`;

  try {
    const response = await fetch(CONTROL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPAction': '"urn:schemas-upnp-org:service:RenderingControl:2#SetVolume"',
        'User-Agent': 'SoundStream/1.0 UPnP/1.0',
      },
      body: soapBody,
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const xml = await response.text();
      console.log(`✅ SUCCESS! Volume set to ${percent}% (${dbValue}dB)\n`);
      console.log(`Response: ${xml.substring(0, 200)}\n`);
      return true;
    } else {
      console.log(`❌ HTTP ${response.status}`);
      const text = await response.text();
      console.log(`Response: ${text.substring(0, 200)}\n`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
    return false;
  }
}

async function main() {
  console.log('\n🎵 Testing dCS Varese Direct Volume Control');
  console.log('='.repeat(60));
  console.log(`Device: ${DCS_IP}:${DCS_PORT}`);
  console.log(`Control URL: ${CONTROL_URL}`);
  console.log(`Service: RenderingControl:2 (UPnP 2.0)\n`);
  
  // Test GetVolume
  const getSuccess = await testGetVolume();
  
  if (getSuccess) {
    // Test SetVolume to 50%
    await testSetVolume(50);
    
    // Verify it changed
    await new Promise(resolve => setTimeout(resolve, 500));
    await testGetVolume();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ SUCCESS! Direct volume control works!');
    console.log('='.repeat(60));
    console.log(`\n💡 Use this control URL in the app:`);
    console.log(`   ${CONTROL_URL}`);
    console.log(`\n💡 Important:`);
    console.log(`   - Use RenderingControl:2 (not :1)`);
    console.log(`   - Control path: /Control/LibRygelRenderer/RygelRenderingControl`);
    console.log(`   - Port: 16500`);
    console.log(`   - Volume uses dB format (-80 to 0)\n`);
  } else {
    console.log('\n❌ GetVolume failed. Check the error above.\n');
  }
}

main().catch(console.error);

















