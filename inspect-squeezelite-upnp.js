#!/usr/bin/env node

/**
 * Inspect Squeezelite UPnP Bridge to see how it controls dCS Varese
 * Squeezelite is at 192.168.0.19, let's see what UPnP services it exposes
 */

const SQUEEZELITE_IP = '192.168.0.19';
const PORTS = [80, 3483, 49152, 49153];

async function discoverSqueezeliteServices(ip, port) {
  const baseUrl = `http://${ip}:${port}`;
  const descriptionPaths = [
    '/description.xml',
    '/device.xml',
    '/desc.xml',
    '/upnp/desc.xml',
    '/',
  ];

  for (const path of descriptionPaths) {
    try {
      const url = `${baseUrl}${path}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3000),
        headers: {
          'User-Agent': 'SoundStream/1.0 UPnP/1.0',
        }
      });

      if (response.ok) {
        const xml = await response.text();
        
        // Check if it's a UPnP device description
        if (xml.includes('deviceType') || xml.includes('serviceType')) {
          console.log(`\n✅ Found UPnP description at: ${url}\n`);
          
          // Extract RenderingControl service
          const renderingControlMatch = xml.match(/<service>[\s\S]*?<serviceType>urn:schemas-upnp-org:service:RenderingControl:1<\/serviceType>[\s\S]*?<\/service>/i);
          
          if (renderingControlMatch) {
            const serviceXml = renderingControlMatch[0];
            const controlUrlMatch = serviceXml.match(/<controlURL>([^<]+)<\/controlURL>/i);
            
            if (controlUrlMatch) {
              let controlUrl = controlUrlMatch[1].trim();
              
              // Make absolute if relative
              if (!controlUrl.startsWith('http')) {
                if (controlUrl.startsWith('/')) {
                  controlUrl = `${baseUrl}${controlUrl}`;
                } else {
                  controlUrl = `${baseUrl}/${controlUrl}`;
                }
              }
              
              console.log(`📋 RenderingControl Service Found:`);
              console.log(`   Control URL: ${controlUrl}\n`);
              
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

              try {
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
                  
                  console.log(`✅ Volume control works!`);
                  if (volumeMatch) {
                    const volume = volumeMatch[1].trim();
                    console.log(`   Current Volume: ${volume}`);
                    
                    // Check if dB format
                    const volNum = parseFloat(volume);
                    if (volNum < 0 && volNum >= -80) {
                      const percent = Math.round(((volNum + 80) / 80) * 100);
                      console.log(`   Volume: ${percent}% (${volNum}dB)`);
                    }
                  }
                  
                  console.log(`\n💡 Use this control URL to control dCS Varese:`);
                  console.log(`   ${controlUrl}\n`);
                  
                  return { controlUrl, baseUrl: baseUrl };
                } else {
                  console.log(`❌ HTTP ${volResponse.status}`);
                }
              } catch (error) {
                console.log(`❌ Error: ${error.message}`);
              }
            }
          }
          
          // Show full XML for debugging
          console.log(`\n📄 Device Description (first 1000 chars):`);
          console.log(xml.substring(0, 1000));
          console.log(`...\n`);
          
          return { xml, baseUrl };
        }
      }
    } catch (error) {
      // Continue to next path
    }
  }
  
  return null;
}

async function main() {
  console.log(`\n🔍 Inspecting Squeezelite UPnP Bridge`);
  console.log(`   IP: ${SQUEEZELITE_IP}\n`);
  
  for (const port of PORTS) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Testing port ${port}...`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    const result = await discoverSqueezeliteServices(SQUEEZELITE_IP, port);
    
    if (result && result.controlUrl) {
      console.log(`\n✅ Found working RenderingControl at port ${port}!`);
      console.log(`   This is how Squeezelite controls dCS Varese volume.\n`);
      break;
    }
  }
  
  console.log(`\n💡 Next steps:`);
  console.log(`   1. Use the control URL found above to control dCS Varese directly`);
  console.log(`   2. This bypasses Squeezelite and talks directly to dCS Varese`);
  console.log(`   3. Update the app to use this control URL\n`);
}

main().catch(console.error);


















