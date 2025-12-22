# SSDP Bridge Setup Guide

The SSDP Bridge is a small helper that runs on your Mac (or Windows PC) to discover your dCS Varese and MinimServer on your home network. It then shares this information with the SoundStream app on your iPhone.

## Why is this needed?

The Expo Go app on your iPhone cannot perform SSDP discovery (the network protocol used to find UPnP devices). The bridge runs on your computer where this works, and provides the discovered device information to your phone via a simple web API.

## Quick Start

### Step 1: Open Terminal on your Mac

Press `Cmd + Space`, type "Terminal", and press Enter.

### Step 2: Navigate to the project folder

If you've downloaded the project, navigate to it:
```bash
cd /path/to/your/soundstream-project
```

### Step 3: Run the bridge

```bash
npx tsx server/ssdp-bridge.ts
```

You should see output like:
```
============================================================
  SoundStream SSDP Bridge
  Discovers UPnP devices on your network
============================================================

[SSDP] Listening for multicast on 239.255.255.250:1900
[Bridge] HTTP API running on http://localhost:3847

Available endpoints:
  GET /devices    - All discovered UPnP devices
  GET /renderers  - Media renderers (DACs, streamers)
  GET /servers    - Media servers (MinimServer, etc.)
  GET /discover   - Trigger new SSDP search

[SSDP] Sent discovery requests
[SSDP] Found device: uuid:938555d3-b45d-cdb9-7a3b-00e04c68c799::upnp:rootdevice
       Location: http://192.168.0.35:49152/device.xml
[SSDP] Device details: dCS Varese
       AVTransport: http://192.168.0.35:49152/uuid-.../AVTransport/control
```

### Step 4: Connect your iPhone

1. Make sure your iPhone is on the **same WiFi network** as your Mac
2. Open the SoundStream app (via Expo Go)
3. Go to **Settings > SSDP Bridge**
4. Tap **Refresh Bridge Devices**
5. You should see your Varese and/or MinimServer appear!

## Finding Your Mac's IP Address

By default, the app tries to connect to `localhost:3847` which only works when testing on the same computer. To connect from your iPhone, you need your Mac's IP address:

1. On your Mac, go to **System Settings > Network**
2. Click on your WiFi connection
3. Note the IP address (e.g., `192.168.0.42`)

Then in the app, you can configure the bridge URL to `http://192.168.0.42:3847`

## Troubleshooting

### "Bridge Not Available" error
- Make sure the bridge is running in Terminal
- Check that your iPhone and Mac are on the same WiFi network
- Try using your Mac's IP address instead of localhost

### No devices found
- Wait 10-15 seconds for SSDP discovery to complete
- Make sure your Varese and MinimServer are powered on
- Check that they're on the same network as your Mac

### Bridge crashes on startup
- Make sure you have Node.js installed
- Run `npm install` in the project directory first

## Keeping the Bridge Running

The bridge needs to stay running in Terminal while you use the app. You can:

1. Keep the Terminal window open in the background
2. Or use a tool like `screen` or `tmux` to run it in the background

## UPnP Proxy Feature

The bridge now includes a **proxy endpoint** that forwards UPnP control requests from your iPhone to local network devices. This solves a common issue where Expo Go's networking cannot reliably reach certain devices on your local network.

### How it works:
1. When the app detects the bridge is running, it automatically routes UPnP requests through it
2. The bridge forwards requests to your Varese (or other UPnP devices)
3. Responses are relayed back to your iPhone

This means playback and volume control will work as long as the bridge is running!

## Security Note

The bridge only listens on your local network and provides device discovery and control relay. It does not expose any sensitive data or allow control of your devices from outside your home network.
