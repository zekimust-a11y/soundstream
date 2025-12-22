#!/usr/bin/env node

/**
 * Test volume control using Squeezelite's method
 * Since Squeezelite works, let's see if we can use the same approach
 * 
 * Strategy:
 * 1. Try to discover UPnP services through Squeezelite bridge (192.168.0.19)
 * 2. If that works, use the same control URL Squeezelite uses
 * 3. This should work because Squeezelite is already controlling the dCS Varese
 */

const SQUEEZELITE_IP = '192.168.0.19';
const DCS_VARESE_IP = '192.168.0.42';
const DCS_VARESE_PORT = 16500;

async function testThroughSqueezelite() {
  console.log(`\n🔍 Testing volume control through Squeezelite bridge`);
  console.log(`   Squeezelite: ${SQUEEZELITE_IP}`);
  console.log(`   dCS Varese: ${DCS_VARESE_IP}:${DCS_VARESE_PORT}\n`);
  
  // Try to find UPnP services on Squeezelite
  const ports = [80, 3483, 49152, 49153];
  const descriptionPaths = ['/description.xml', '/device.xml', '/'];
  
  for (const port of ports) {
    for (const path of descriptionPaths) {
      try {
        const url = `http://${SQUEEZELITE_IP}:${port}${path}`;
        console.log(`Trying: ${url}...`);
        
        const response = await fetch(url, {
          signal: AbortSignal.timeout(3000),
          headers: {
            'User-Agent': 'SoundStream/1.0 UPnP/1.0',
          }
        });
        
        if (response.ok) {
          const xml = await response.text();
          
          if (xml.includes('RenderingControl') || xml.includes('serviceType')) {
            console.log(`✅ Found UPnP description!\n`);
            
            // Extract RenderingControl control URL
            const serviceMatch = xml.match(/<service>[\s\S]*?<serviceType>urn:schemas-upnp-org:service:RenderingControl:1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>[\s\S]*?<\/service>/i);
            
            if (serviceMatch) {
              let controlUrl = serviceMatch[1].trim();
              
              // Make absolute
              if (!controlUrl.startsWith('http')) {
                const baseUrl = `http://${SQUEEZELITE_IP}:${port}`;
                controlUrl = controlUrl.startsWith('/') ? `${baseUrl}${controlUrl}` : `${baseUrl}/${controlUrl}`;
              }
              
              console.log(`📋 Found RenderingControl URL: ${controlUrl}\n`);
              
              // Test it
              console.log(`🧪 Testing volume control...`);
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
                
                console.log(`✅ SUCCESS! Volume control works through Squeezelite bridge!`);
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
                
                console.log(`\n💡 This is how Squeezelite controls dCS Varese!`);
                console.log(`   Control URL: ${controlUrl}`);
                console.log(`\n   Use this URL in the app to bypass Squeezelite.\n`);
                
                return { controlUrl, working: true };
              } else {
                console.log(`❌ HTTP ${volResponse.status}`);
              }
            }
          }
        }
      } catch (error) {
        // Continue
      }
    }
  }
  
  return { working: false };
}

async function testDirectToDCS() {
  console.log(`\n🔍 Testing direct connection to dCS Varese`);
  console.log(`   dCS Varese: ${DCS_VARESE_IP}:${DCS_VARESE_PORT}\n`);
  
  // Try the same paths that might work
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
          console.log(`✅ SUCCESS! Direct connection works!`);
          console.log(`   Control URL: ${url}`);
          
          const volume = volumeMatch[1].trim();
          const volNum = parseFloat(volume);
          
          if (volNum < 0 && volNum >= -80) {
            const percent = Math.round(((volNum + 80) / 80) * 100);
            console.log(`   Current Volume: ${percent}% (${volNum}dB)`);
          }
          
          return { controlUrl: url, working: true };
        }
      } else {
        console.log(`   HTTP ${response.status}`);
      }
    } catch (error) {
      console.log(`   Error: ${error.message}`);
    }
  }
  
  return { working: false };
}

async function main() {
  console.log(`\n🎵 Testing Squeezelite's Volume Control Method`);
  console.log(`================================================\n`);
  
  // First try through Squeezelite bridge
  const squeezeliteResult = await testThroughSqueezelite();
  
  if (squeezeliteResult.working) {
    console.log(`\n✅ SOLUTION FOUND: Use Squeezelite's control URL`);
    console.log(`   ${squeezeliteResult.controlUrl}\n`);
    return;
  }
  
  // Then try direct to dCS Varese
  const directResult = await testDirectToDCS();
  
  if (directResult.working) {
    console.log(`\n✅ SOLUTION FOUND: Direct connection works!`);
    console.log(`   ${directResult.controlUrl}\n`);
    return;
  }
  
  console.log(`\n❌ Could not find working method`);
  console.log(`\n💡 Next steps:`);
  console.log(`   1. Check if Squeezelite is running and accessible`);
  console.log(`   2. Try using the app's existing DAC volume control (Settings)`);
  console.log(`   3. The app may already be working if dCS Mosaic works\n`);
}

main().catch(console.error);


















