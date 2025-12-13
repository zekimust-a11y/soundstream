# Android Mosaic ACTUS Relay Setup

## Overview

Since dCS Varese uses the proprietary ACTUS protocol (not UPnP), we can use the Android Mosaic ACTUS app as an intermediary to control volume:

```
SoundStream → Relay Server → ADB → Android Emulator/Device → Mosaic ACTUS → dCS Varese
```

## Prerequisites

1. **Android Studio** (for emulator) OR **Physical Android Device**
2. **ADB** (Android Debug Bridge) - comes with Android Studio
3. **Mosaic ACTUS APK** - Install on Android device/emulator
4. **Same Network** - Android device must be on same network as dCS Varese

## Setup Steps

### Option 1: Android Emulator (Recommended for Testing)

1. **Install Android Studio**:
   ```bash
   brew install --cask android-studio
   ```

2. **Create Android Virtual Device (AVD)**:
   - Open Android Studio
   - Tools → Device Manager
   - Create Virtual Device
   - Choose a device (e.g., Pixel 5)
   - Download a system image (API 30+)
   - Finish

3. **Start Emulator**:
   ```bash
   emulator -avd <AVD_NAME> &
   ```
   Or start from Android Studio

4. **Install Mosaic ACTUS**:
   - Download APK from dCS website or extract from your Android device
   - Drag APK onto emulator, or:
   ```bash
   adb install mosaic-actus.apk
   ```

5. **Configure Mosaic ACTUS**:
   - Open app on emulator
   - Connect to your dCS Varese (same network)
   - Test volume control manually

### Option 2: Physical Android Device

1. **Enable Developer Options** on Android device:
   - Settings → About Phone
   - Tap "Build Number" 7 times
   - Go back → Developer Options
   - Enable "USB Debugging"

2. **Connect via USB**:
   ```bash
   adb devices
   # Should show your device
   ```

3. **Or Connect via WiFi**:
   ```bash
   adb tcpip 5555
   adb connect <DEVICE_IP>:5555
   ```

4. **Install Mosaic ACTUS** (if not already installed)

## Server Configuration

1. **Enable the relay** in your server:
   ```bash
   export ENABLE_ANDROID_MOSAIC_RELAY=true
   export ANDROID_DEVICE_SERIAL=emulator-5554  # or your device serial
   # Optional:
   export ADB_PATH=/path/to/adb  # if not in PATH
   ```

2. **Start the server**:
   ```bash
   npm run server:dev
   ```

3. **Check status**:
   ```bash
   curl http://localhost:3000/api/android-mosaic/status
   ```

## Finding Volume Control Coordinates

The relay needs to know where the volume controls are in the Mosaic ACTUS app UI.

### Method 1: UI Automator (Recommended)

1. **Open Mosaic ACTUS** on Android device
2. **Get UI hierarchy**:
   ```bash
   adb shell uiautomator dump /dev/tty
   ```
   Or save to file:
   ```bash
   adb shell uiautomator dump /sdcard/ui.xml
   adb pull /sdcard/ui.xml
   ```

3. **Find volume controls** in the XML:
   - Look for "volume", "slider", or similar text
   - Note the `bounds` attribute (coordinates)

4. **Update server config** with coordinates

### Method 2: Manual Testing

1. **Enable pointer location** on Android:
   - Settings → Developer Options → "Pointer location"
   - Shows coordinates on screen

2. **Open Mosaic ACTUS** and note volume control positions

3. **Update server config** with coordinates

## API Endpoints

Once configured, the relay exposes these endpoints:

### Get Volume
```bash
GET /api/android-mosaic/volume
```

### Set Volume
```bash
POST /api/android-mosaic/volume
Content-Type: application/json

{
  "action": "set",
  "value": 75
}
```

### Volume Up/Down
```bash
POST /api/android-mosaic/volume
{
  "action": "up",
  "value": 5  # optional, default 2
}
```

## Integration with SoundStream

Update `upnpVolumeClient.ts` to use the relay when available:

```typescript
// Check if Android Mosaic relay is available
const relayAvailable = await checkRelayAvailable();
if (relayAvailable) {
  // Use relay instead of UPnP
  await fetch('/api/android-mosaic/volume', {
    method: 'POST',
    body: JSON.stringify({ action: 'set', value: volume })
  });
}
```

## Troubleshooting

### "ADB not found"
- Install Android Studio or `brew install android-platform-tools`
- Add to PATH: `export PATH=$PATH:~/Library/Android/sdk/platform-tools`

### "No devices found"
- Check `adb devices` - should show your device/emulator
- Make sure USB debugging is enabled (physical device)
- Make sure emulator is running

### "Mosaic ACTUS app not found"
- Check package name is correct
- Install app on device/emulator
- Verify with: `adb shell pm list packages | grep mosaic`

### Volume controls not working
- Check UI coordinates are correct
- Try UI Automator to find correct coordinates
- Ensure app is in foreground when controlling

### Network issues
- Android device must be on same network as dCS Varese
- Check firewall settings
- Verify Mosaic ACTUS can connect to DAC manually

## Alternative: Network Traffic Interception

For more reliable control, we could intercept ACTUS protocol traffic:

1. **Use mitmproxy** on Android device
2. **Capture ACTUS commands** when using Mosaic ACTUS
3. **Reverse engineer protocol**
4. **Send commands directly** (bypasses app UI)

This is more complex but more reliable than UI automation.


