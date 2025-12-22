#!/usr/bin/env node

/**
 * SSDP (Simple Service Discovery Protocol) discovery for UPnP devices
 * This might find the dCS Varese that doesn't advertise via standard HTTP
 */

const dgram = require('dgram');

const SSDP_MULTICAST_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const SEARCH_TARGET = 'urn:schemas-upnp-org:device:MediaRenderer:1';

function discoverUPnPDevices() {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    const devices = [];
    const timeout = 5000; // 5 seconds
    
    client.on('message', (msg, rinfo) => {
      const response = msg.toString();
      console.log(`\n📡 Received response from ${rinfo.address}:${rinfo.port}`);
      console.log(response);
      
      // Parse LOCATION header
      const locationMatch = response.match(/LOCATION:\s*(.+)/i);
      if (locationMatch) {
        const location = locationMatch[1].trim();
        console.log(`\n📍 Device description URL: ${location}`);
        devices.push({
          ip: rinfo.address,
          port: rinfo.port,
          location: location,
        });
      }
    });
    
    client.on('error', (err) => {
      console.error('SSDP error:', err);
      client.close();
      reject(err);
    });
    
    // Send M-SEARCH request
    const searchMessage = [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_MULTICAST_ADDRESS}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      `ST: ${SEARCH_TARGET}`,
      'MX: 3',
      '',
      ''
    ].join('\r\n');
    
    console.log('🔍 Sending SSDP M-SEARCH request...');
    console.log(`   Target: ${SEARCH_TARGET}`);
    console.log(`   Multicast: ${SSDP_MULTICAST_ADDRESS}:${SSDP_PORT}\n`);
    
    client.bind(() => {
      client.setBroadcast(true);
      client.setMulticastTTL(128);
      client.send(searchMessage, SSDP_PORT, SSDP_MULTICAST_ADDRESS, (err) => {
        if (err) {
          console.error('Error sending SSDP request:', err);
          client.close();
          reject(err);
        }
      });
    });
    
    // Also try RenderingControl service
    setTimeout(() => {
      const renderingControlSearch = [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${SSDP_MULTICAST_ADDRESS}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        'ST: urn:schemas-upnp-org:service:RenderingControl:1',
        'MX: 3',
        '',
        ''
      ].join('\r\n');
      
      client.send(renderingControlSearch, SSDP_PORT, SSDP_MULTICAST_ADDRESS);
    }, 1000);
    
    setTimeout(() => {
      client.close();
      console.log(`\n✅ Discovery complete. Found ${devices.length} device(s).\n`);
      resolve(devices);
    }, timeout);
  });
}

async function testDeviceDescription(location) {
  console.log(`\n🔍 Testing device description: ${location}`);
  
  try {
    const response = await fetch(location, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'SoundStream/1.0 UPnP/1.0' }
    });
    
    if (response.ok) {
      const xml = await response.text();
      console.log(`✅ Got device description (${xml.length} bytes)\n`);
      
      // Look for RenderingControl service
      const serviceMatch = xml.match(/<service>[\s\S]*?<serviceType>urn:schemas-upnp-org:service:RenderingControl:1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>[\s\S]*?<\/service>/i);
      
      if (serviceMatch) {
        let controlUrl = serviceMatch[1].trim();
        const urlObj = new URL(location);
        
        if (!controlUrl.startsWith('http')) {
          controlUrl = controlUrl.startsWith('/') 
            ? `${urlObj.protocol}//${urlObj.host}${controlUrl}`
            : `${urlObj.protocol}//${urlObj.host}/${controlUrl}`;
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
          
          console.log(`✅ Volume control works!`);
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
          console.log(`\n💡 Use this URL: ${controlUrl}\n`);
          return { success: true, controlUrl };
        } else {
          console.log(`❌ HTTP ${volResponse.status}`);
        }
      } else {
        console.log(`❌ No RenderingControl service found`);
      }
    } else {
      console.log(`❌ HTTP ${response.status}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  
  return { success: false };
}

async function main() {
  console.log('\n🎵 SSDP Discovery for UPnP Devices');
  console.log('='.repeat(60));
  console.log('This will discover UPnP devices on your network...\n');
  
  try {
    const devices = await discoverUPnPDevices();
    
    if (devices.length === 0) {
      console.log('❌ No UPnP devices found via SSDP');
      console.log('\n💡 The dCS Varese might not respond to SSDP discovery.');
      console.log('   It may require direct connection or special authentication.\n');
      return;
    }
    
    console.log(`\n📋 Found ${devices.length} device(s):`);
    devices.forEach((device, i) => {
      console.log(`   ${i + 1}. ${device.ip}:${device.port} - ${device.location}`);
    });
    
    // Test each device
    for (const device of devices) {
      await testDeviceDescription(device.location);
    }
    
  } catch (error) {
    console.error('Discovery failed:', error);
  }
}

main().catch(console.error);

















