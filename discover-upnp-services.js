#!/usr/bin/env node

/**
 * UPnP Service Discovery Tool
 * Discovers all UPnP services on a device, including RenderingControl
 * 
 * Usage:
 *   node discover-upnp-services.js <device-ip> [port]
 * 
 * Example:
 *   node discover-upnp-services.js 192.168.0.42 16500
 */

const DEVICE_IP = process.argv[2] || '192.168.0.42';
const DEVICE_PORT = parseInt(process.argv[3] || '16500', 10);

// Common device description paths
const DESCRIPTION_PATHS = [
  '/description.xml',
  '/device.xml',
  '/desc.xml',
  '/upnp/desc.xml',
  '/dev/desc.xml',
  '/DeviceDescription.xml',
  '/',
];

async function fetchDeviceDescription(baseUrl) {
  console.log(`\n🔍 Discovering UPnP services on ${baseUrl}\n`);
  
  for (const path of DESCRIPTION_PATHS) {
    try {
      const url = `${baseUrl}${path}`;
      console.log(`Trying: ${url}...`);
      
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3000),
        headers: {
          'User-Agent': 'SoundStream/1.0 UPnP/1.0',
        }
      });
      
      if (response.ok) {
        const xml = await response.text();
        console.log(`✅ Found device description at: ${url}\n`);
        return { xml, url };
      } else {
        console.log(`   HTTP ${response.status}`);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`   Timeout`);
      } else {
        console.log(`   Error: ${error.message}`);
      }
    }
  }
  
  return null;
}

function parseDeviceDescription(xml, baseUrl) {
  const services = [];
  
  // Extract all services
  const serviceMatches = xml.matchAll(/<service>[\s\S]*?<\/service>/gi);
  
  for (const serviceMatch of serviceMatches) {
    const serviceXml = serviceMatch[0];
    
    const serviceTypeMatch = serviceXml.match(/<serviceType>([^<]+)<\/serviceType>/i);
    const serviceIdMatch = serviceXml.match(/<serviceId>([^<]+)<\/serviceId>/i);
    const controlUrlMatch = serviceXml.match(/<controlURL>([^<]+)<\/controlURL>/i);
    const eventSubUrlMatch = serviceXml.match(/<eventSubURL>([^<]+)<\/eventSubURL>/i);
    const scpdUrlMatch = serviceXml.match(/<SCPDURL>([^<]+)<\/SCPDURL>/i);
    
    if (serviceTypeMatch) {
      const serviceType = serviceTypeMatch[1].trim();
      const serviceId = serviceIdMatch ? serviceIdMatch[1].trim() : 'Unknown';
      let controlUrl = controlUrlMatch ? controlUrlMatch[1].trim() : null;
      const eventSubUrl = eventSubUrlMatch ? eventSubUrlMatch[1].trim() : null;
      const scpdUrl = scpdUrlMatch ? scpdUrlMatch[1].trim() : null;
      
      // Make control URL absolute if relative
      if (controlUrl && !controlUrl.startsWith('http')) {
        // Handle relative URLs
        if (controlUrl.startsWith('/')) {
          controlUrl = `${baseUrl}${controlUrl}`;
        } else {
          // Relative to base URL
          const basePath = new URL(baseUrl).pathname;
          const baseDir = basePath.substring(0, basePath.lastIndexOf('/')) || '';
          controlUrl = `${baseUrl}${baseDir}/${controlUrl}`;
        }
      }
      
      services.push({
        serviceType,
        serviceId,
        controlUrl,
        eventSubUrl,
        scpdUrl,
      });
    }
  }
  
  // Also extract device base URL
  const urlBaseMatch = xml.match(/<URLBase>([^<]+)<\/URLBase>/i);
  const urlBase = urlBaseMatch ? urlBaseMatch[1].trim() : baseUrl;
  
  return { services, urlBase };
}

function testRenderingControl(controlUrl) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
    </u:GetVolume>
  </s:Body>
</s:Envelope>`;

  return fetch(controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPAction': '"urn:schemas-upnp-org:service:RenderingControl:1#GetVolume"',
      'User-Agent': 'SoundStream/1.0 UPnP/1.0',
    },
    body: soapBody,
    signal: AbortSignal.timeout(3000),
  });
}

async function main() {
  const baseUrl = `http://${DEVICE_IP}:${DEVICE_PORT}`;
  
  console.log(`\n🎵 UPnP Service Discovery Tool`);
  console.log(`   Device: ${DEVICE_IP}:${DEVICE_PORT}`);
  console.log(`   Base URL: ${baseUrl}\n`);
  
  try {
    // Step 1: Fetch device description
    const descResult = await fetchDeviceDescription(baseUrl);
    
    if (!descResult) {
      console.log(`\n❌ Could not find device description`);
      console.log(`\n💡 The device may not be a standard UPnP device, or it may require authentication.`);
      process.exit(1);
    }
    
    // Step 2: Parse services
    const { services, urlBase } = parseDeviceDescription(descResult.xml, baseUrl);
    
    if (services.length === 0) {
      console.log(`\n⚠️  No services found in device description`);
      console.log(`\nDevice description (first 500 chars):`);
      console.log(descResult.xml.substring(0, 500));
      process.exit(1);
    }
    
    console.log(`📋 Found ${services.length} UPnP service(s):\n`);
    
    // Step 3: Display all services
    for (const service of services) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Service Type: ${service.serviceType}`);
      console.log(`Service ID:   ${service.serviceId}`);
      if (service.controlUrl) {
        console.log(`Control URL:  ${service.controlUrl}`);
      }
      if (service.scpdUrl) {
        console.log(`SCPD URL:     ${service.scpdUrl}`);
      }
      if (service.eventSubUrl) {
        console.log(`Event URL:    ${service.eventSubUrl}`);
      }
      
      // Step 4: Test RenderingControl service
      if (service.serviceType.includes('RenderingControl')) {
        console.log(`\n🧪 Testing RenderingControl service...`);
        
        if (service.controlUrl) {
          try {
            const response = await testRenderingControl(service.controlUrl);
            
            if (response.ok) {
              const xml = await response.text();
              const volumeMatch = xml.match(/<CurrentVolume>([^<]+)<\/CurrentVolume>/i);
              
              console.log(`✅ SUCCESS! RenderingControl is working`);
              console.log(`   Response: ${xml.substring(0, 200)}...`);
              
              if (volumeMatch) {
                const volume = volumeMatch[1].trim();
                console.log(`   Current Volume: ${volume}`);
                
                // Check if it's dB format
                const volNum = parseFloat(volume);
                if (volNum < 0 && volNum >= -80) {
                  const percent = Math.round(((volNum + 80) / 80) * 100);
                  console.log(`   Volume: ${percent}% (${volNum}dB)`);
                } else {
                  console.log(`   Volume: ${volume}%`);
                }
              }
            } else {
              console.log(`❌ HTTP ${response.status}: ${await response.text().then(t => t.substring(0, 100))}`);
            }
          } catch (error) {
            console.log(`❌ Error: ${error.message}`);
          }
        } else {
          console.log(`⚠️  No control URL found for RenderingControl`);
        }
      }
      
      console.log(``);
    }
    
    // Step 5: Summary
    const renderingControl = services.find(s => s.serviceType.includes('RenderingControl'));
    
    if (renderingControl && renderingControl.controlUrl) {
      console.log(`\n✅ RECOMMENDED CONTROL URL:`);
      console.log(`   ${renderingControl.controlUrl}\n`);
      console.log(`💡 Use this URL in your test scripts and app configuration.\n`);
    } else {
      console.log(`\n⚠️  No RenderingControl service found`);
      console.log(`\nAvailable services:`);
      services.forEach(s => console.log(`   - ${s.serviceType}`));
    }
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();


















