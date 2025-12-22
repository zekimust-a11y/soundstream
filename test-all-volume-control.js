#!/usr/bin/env node

/**
 * Comprehensive test for dCS Varese volume control
 * Tests all methods: Squeezelite bridge, direct connection, service discovery
 * Run this with: node test-all-volume-control.js
 */

const SQUEEZELITE_IP = '192.168.0.19';
const DCS_VARESE_IP = '192.168.0.42';
const DCS_VARESE_PORT = 16500;

async function testSqueezeliteBridge() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: Inspecting Squeezelite UPnP Bridge');
  console.log('='.repeat(60));
  
  const ports = [80, 3483, 49152, 49153];
  const descriptionPaths = ['/description.xml', '/device.xml', '/'];
  
  for (const port of ports) {
    for (const path of descriptionPaths) {
      try {
        const url = `http://${SQUEEZELITE_IP}:${port}${path}`;
        console.log(`Trying: ${url}...`);
        
        const response = await fetch(url, {
          signal: AbortSignal.timeout(3000),
          headers: { 'User-Agent': 'SoundStream/1.0 UPnP/1.0' }
        });
        
        if (response.ok) {
          const xml = await response.text();
          
          if (xml.includes('RenderingControl') || xml.includes('serviceType')) {
            console.log(`\n✅ Found UPnP description at: ${url}\n`);
            
            // Extract RenderingControl control URL
            const serviceMatch = xml.match(/<service>[\s\S]*?<serviceType>urn:schemas-upnp-org:service:RenderingControl:1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>[\s\S]*?<\/service>/i);
            
            if (serviceMatch) {
              let controlUrl = serviceMatch[1].trim();
              if (!controlUrl.startsWith('http')) {
                const baseUrl = `http://${SQUEEZELITE_IP}:${port}`;
                controlUrl = controlUrl.startsWith('/') ? `${baseUrl}${controlUrl}` : `${baseUrl}/${controlUrl}`;
              }
              
              console.log(`📋 RenderingControl URL: ${controlUrl}\n`);
              
              // Test it
              const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
    </u:GetVolume>
  </s:Body>
</s:Envelope>`;

              const volResponse = await fetch(controlUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'text/xml; charset="utf-8"',
                  'SOAPAction': '"urn:schemas-upnp-org:service:RenderingControl:1#GetVolume"',
                  'User-Agent': 'SoundStream/1.0 UPnP/1.0',
                },
                body: soapBody,
                signal: AbortSignal.timeout(5000),
              });

              if (volResponse.ok) {
                const volXml = await volResponse.text();
                const volumeMatch = volXml.match(/<CurrentVolume>([^<]+)<\/CurrentVolume>/i);
                
                console.log(`✅ SUCCESS! Volume control works through Squeezelite!`);
                if (volumeMatch) {
                  const volume = volumeMatch[1].trim();
                  const volNum = parseFloat(volume);
                  if (volNum < 0 && volNum >= -80) {
                    const percent = Math.round(((volNum + 80) / 80) * 100);
                    console.log(`   Current Volume: ${percent}% (${volNum}dB)`);
                  } else {
                    console.log(`   Current Volume: ${volume}%`);
                  }
                }
                console.log(`\n💡 Use this URL to control dCS Varese: ${controlUrl}\n`);
                return { success: true, controlUrl };
              }
            }
          }
        }
      } catch (error) {
        // Continue
      }
    }
  }
  
  return { success: false };
}

async function testDirectDCS() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Direct Connection to dCS Varese');
  console.log('='.repeat(60));
  
  const controlPaths = [
    '/RenderingControl/ctrl',
    '/RenderingControl/control',
    '/upnp/control/RenderingControl',
    '/ctl/RenderingControl',
  ];
  
  for (const path of controlPaths) {
    const url = `http://${DCS_VARESE_IP}:${DCS_VARESE_PORT}${path}`;
    console.log(`Trying: ${url}...`);
    
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
    </u:GetVolume>
  </s:Body>
</s:Envelope>`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'SOAPAction': '"urn:schemas-upnp-org:service:RenderingControl:1#GetVolume"',
          'User-Agent': 'SoundStream/1.0 UPnP/1.0',
        },
        body: soapBody,
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        const xml = await response.text();
        const volumeMatch = xml.match(/<CurrentVolume>([^<]+)<\/CurrentVolume>/i);
        
        if (volumeMatch) {
          console.log(`\n✅ SUCCESS! Direct connection works!`);
          console.log(`   Control URL: ${url}`);
          const volume = volumeMatch[1].trim();
          const volNum = parseFloat(volume);
          if (volNum < 0 && volNum >= -80) {
            const percent = Math.round(((volNum + 80) / 80) * 100);
            console.log(`   Current Volume: ${percent}% (${volNum}dB)`);
          }
          return { success: true, controlUrl: url };
        }
      } else {
        console.log(`   HTTP ${response.status}`);
      }
    } catch (error) {
      console.log(`   Error: ${error.message}`);
    }
  }
  
  return { success: false };
}

async function main() {
  console.log('\n🎵 dCS Varese Volume Control - Comprehensive Test');
  console.log('='.repeat(60));
  console.log(`Squeezelite: ${SQUEEZELITE_IP}`);
  console.log(`dCS Varese: ${DCS_VARESE_IP}:${DCS_VARESE_PORT}\n`);
  
  // Test 1: Through Squeezelite
  const squeezeliteResult = await testSqueezeliteBridge();
  
  // Test 2: Direct to dCS
  const directResult = await testDirectDCS();
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  if (squeezeliteResult.success) {
    console.log(`\n✅ Squeezelite method works!`);
    console.log(`   Control URL: ${squeezeliteResult.controlUrl}`);
    console.log(`\n💡 This is how Squeezelite controls dCS Varese.`);
    console.log(`   Use this URL in the app to bypass Squeezelite.\n`);
  } else if (directResult.success) {
    console.log(`\n✅ Direct connection works!`);
    console.log(`   Control URL: ${directResult.controlUrl}`);
    console.log(`\n💡 You can control dCS Varese directly without Squeezelite.\n`);
  } else {
    console.log(`\n❌ Neither method worked.`);
    console.log(`\n💡 The dCS Varese may require:`);
    console.log(`   - Different authentication`);
    console.log(`   - Special headers`);
    console.log(`   - Or only accepts connections from Squeezelite\n`);
  }
}

main().catch(console.error);


















