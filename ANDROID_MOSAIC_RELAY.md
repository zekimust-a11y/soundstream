# Android Mosaic ACTUS Relay Server

## Concept

Since dCS Varese uses the proprietary ACTUS protocol (not UPnP), and the Android Mosaic ACTUS app can control the DAC volume, we can use an Android emulator as a relay:

```
SoundStream App → Relay Server → ADB → Android Emulator → Mosaic ACTUS App → dCS Varese (ACTUS)
```

## Architecture

1. **Android Emulator** (running on Mac)
   - Install Mosaic ACTUS app
   - Connect to same network as dCS Varese
   - App controls DAC via ACTUS protocol

2. **Relay Server** (Node.js on Mac)
   - Receives volume commands from SoundStream
   - Uses ADB to automate Mosaic ACTUS app
   - Translates volume % to app interactions

3. **ADB Automation**
   - Tap volume controls in Mosaic ACTUS
   - Or use accessibility services if available
   - Or intercept app network traffic (ACTUS protocol)

## Setup Options

### Option 1: ADB UI Automation (Easiest)
- Use `adb shell input tap` to tap volume buttons
- Use `adb shell input swipe` for volume slider
- Requires knowing UI element coordinates

### Option 2: Accessibility Services
- Enable Android accessibility service
- Use `adb shell uiautomator` to find UI elements
- More reliable than coordinates

### Option 3: Network Interception (Most Reliable)
- Use `adb shell tcpdump` or `mitmproxy` to capture ACTUS traffic
- Reverse engineer ACTUS protocol
- Send commands directly (bypasses app UI)

## Implementation Plan

### Step 1: Setup Android Emulator
```bash
# Install Android Studio
# Create Android Virtual Device (AVD)
# Install Mosaic ACTUS app via APK or Play Store
```

### Step 2: Install ADB
```bash
# ADB comes with Android Studio
# Or install via Homebrew:
brew install android-platform-tools
```

### Step 3: Create Relay Server
```javascript
// android-mosaic-relay.js
const { exec } = require('child_process');
const express = require('express');

// Use ADB to control Mosaic ACTUS app
async function setVolume(volume) {
  // Option 1: Tap volume buttons
  // Option 2: Use accessibility to find slider
  // Option 3: Send ACTUS commands directly
}
```

### Step 4: Integrate with SoundStream
- Add endpoint to server: `/api/dcs/volume`
- SoundStream calls this instead of UPnP
- Relay server controls Android app

## Challenges

1. **UI Element Detection**: Need to find volume controls in Mosaic ACTUS
2. **Network Access**: Emulator must be on same network as DAC
3. **ACTUS Protocol**: May need to reverse engineer if direct control needed
4. **Performance**: Emulator adds latency

## Alternative: Physical Android Device

Instead of emulator, use a physical Android device:
- More reliable network connection
- Better performance
- Can leave it running 24/7
- Still use ADB over WiFi

## Next Steps

1. Test if Mosaic ACTUS can be automated via ADB
2. Determine best method (UI automation vs protocol interception)
3. Create relay server
4. Integrate with SoundStream


