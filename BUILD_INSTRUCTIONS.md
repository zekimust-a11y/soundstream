# SoundStream Development Build Instructions

This app requires a **Development Build** (not Expo Go) to access native UPNP/SSDP features for discovering and connecting to MinimServer and your dCS Varese.

## Prerequisites

1. **Mac with Xcode** - Required for iOS builds
2. **Apple Developer Account** - Free account works for development
3. **Node.js 18+** - Already have this in Replit

## Building the App

### Option 1: Build on Your Mac (Recommended for Development)

1. **Clone or download the project** from Replit to your Mac

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Generate native iOS folder**:
   ```bash
   npx expo prebuild
   ```
   This creates the `ios/` folder with native code.

4. **Install iOS dependencies**:
   ```bash
   cd ios && pod install && cd ..
   ```

5. **Build and run on your device**:
   ```bash
   npx expo run:ios --device
   ```
   This will list connected devices. Select your iPhone.

6. **Trust the developer certificate** on your iPhone:
   - Go to Settings > General > VPN & Device Management
   - Tap your developer certificate and select "Trust"

### Option 2: Use EAS Build (Cloud Build - No Mac Required)

1. **Install EAS CLI**:
   ```bash
   npm install -g eas-cli
   ```

2. **Login to Expo**:
   ```bash
   eas login
   ```

3. **Configure EAS**:
   ```bash
   eas build:configure
   ```

4. **Create a development build**:
   ```bash
   eas build --profile development --platform ios
   ```

5. **Download and install** the build on your device via the link EAS provides.

## After Building

Once you have the development build installed:

1. **Open SoundStream** on your iPhone
2. Go to **Settings** > **Network Discovery**
3. Tap **Discover Devices**
4. The app will find MinimServer and your dCS Varese via SSDP
5. Tap a discovered server to add it
6. Tap **Refresh Library** to load your music

## Architecture

With the development build, the app works as a **Control Point**:

```
MinimServer ──── Audio Stream ────> dCS Varese
     ↑                                   ↑
     └────── SoundStream App ────────────┘
            (discovers both via SSDP,
             sends playback commands)
```

Audio flows directly from MinimServer to your Varese at full resolution - the app just controls what plays.

## Troubleshooting

### "UdpSocketsModule not found"
- Ensure you ran `npx expo prebuild`
- Rebuild: `npx expo prebuild --clean && npx expo run:ios`

### "Local network permission denied"
- Go to iPhone Settings > Privacy > Local Network
- Enable access for SoundStream

### Can't discover devices
- Ensure your iPhone is on the same WiFi as MinimServer and Varese
- Check that MinimServer is running
- Try restarting the discovery

## Submitting to App Store

When ready for App Store submission:

```bash
eas build --profile production --platform ios
eas submit --platform ios
```

This uses the same code, just optimized for production distribution.
