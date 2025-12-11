# SoundStream - Music Player App

## Overview
SoundStream is a Roon-inspired mobile music player app built with Expo/React Native. It acts as a **UPNP Control Point** to browse music from MinimServer and control playback on network renderers like the dCS Varese. Audio streams directly from server to DAC for bit-perfect playback.

## Current State
- **Version**: 1.0.0
- **Status**: Library browsing works, playback control limited (see Known Limitations)
- **Last Updated**: December 2024
- **Theme**: Light theme (default)
- **Build Type**: Works in Expo Go for browsing; development build needed for SSDP discovery

## Known Limitations

### OpenHome Service Discovery Issue
**Tested December 2024**: The dCS Varese requires SSDP (UDP multicast) discovery to expose its OpenHome service endpoints. Without SSDP, we cannot obtain the correct control URLs.

**What works:**
- Library browsing from MinimServer via ContentDirectory
- Queue management in the app
- AVTransport commands (SetAVTransportURI, Play, Pause, etc.) return success

**What doesn't work:**
- OpenHome services (Product, Playlist, Transport, Volume, Info) - all return UPnP error 404 "Invalid Action"
- AVTransport commands don't trigger actual audio playback on Varese (compatibility shim only)

**Why:**
1. Expo Go cannot do UDP multicast (needs native modules)
2. The Replit-hosted server cannot reach local network devices
3. The Varese's device description returns 403 Forbidden
4. Without SSDP discovery, OpenHome control URLs cannot be obtained

**Workaround:**
- Use the dCS Mosaic app for playback control
- This app can be used for library browsing and queue building

## Architecture

### Control Point Design
```
MinimServer ──── Audio Stream (bit-perfect) ────> dCS Varese
     ↑                                                ↑
     └─────── SoundStream App (Control Point) ───────┘
              discovers both via SSDP,
              browses library, sends playback commands
```

The app is a **UPNP Control Point** - it discovers devices, browses the music library, and tells the renderer (Varese) to play tracks from the server (MinimServer). Audio never passes through the phone for maximum quality.

### Tech Stack
- **Frontend**: Expo SDK 54 + React Native
- **Navigation**: React Navigation 7 (bottom tabs + stack navigators)
- **State Management**: React Context + React Query
- **Storage**: AsyncStorage for persistence
- **UI**: Custom Roon-inspired light theme with liquid glass aesthetics
- **Server Protocol**: UPNP/DLNA (SSDP discovery, SOAP control, DIDL-Lite metadata)
- **Native Modules**: react-native-udp for SSDP multicast discovery

### Directory Structure
```
client/
├── components/       # Reusable UI components
├── constants/        # Theme and design tokens
├── hooks/           # Custom hooks
│   ├── usePlayback.tsx    # Playback state and renderer control
│   ├── useMusic.tsx       # Library data and server browsing
│   └── useSsdpDiscovery.tsx  # Native SSDP device discovery
├── lib/
│   └── upnpClient.ts  # UPNP SOAP client for ContentDirectory & AVTransport
├── navigation/      # Navigation structure
├── screens/         # App screens
└── assets/          # Local assets
```

### Key Features
1. **SSDP Discovery**: Auto-discover MinimServer and dCS Varese on local network
2. **Browse Tab**: Library browsing with artists, albums, and recently played
3. **Queue Tab**: Playback queue management with drag-to-reorder
4. **Search Tab**: Global search across all music sources
5. **Settings Tab**: Network discovery, server management, Qobuz integration
6. **Now Playing**: Full-screen modal with renderer playback controls
7. **Renderer Control**: Send play/pause/seek commands to dCS Varese

### UPNP/DLNA Services Used
- **ContentDirectory** (MinimServer): Browse and search music library
- **AVTransport** (dCS Varese): SetAVTransportURI, Play, Pause, Stop, Seek, GetPositionInfo

## User Preferences
- Light theme as default throughout app
- No placeholder/demo data - real server connections only
- Maximum sound quality - audio streams directly to DAC
- Manual refresh button in Settings for library updates
- Focus on album artwork and typography
- Liquid glass UI effects where supported

## Building the App

### Why Development Build?
Expo Go cannot do SSDP discovery (requires UDP multicast). A development build includes native modules for:
- UDP sockets (SSDP multicast)
- Proper HTTP header control
- Local network permission handling

### Build Steps
See `BUILD_INSTRUCTIONS.md` for complete instructions. Quick summary:

```bash
# Generate native folders
npx expo prebuild

# Install iOS dependencies
cd ios && pod install && cd ..

# Build and run on device
npx expo run:ios --device
```

## Running in Development

```bash
npm run dev
```
- Expo dev server runs on port 8081
- Express backend runs on port 5000

**Note**: Network discovery only works in a development build. In Expo Go, you can manually add servers via Settings > Music Servers.

### Connecting to MinimServer & dCS Varese
1. Build and install the development build on your iPhone
2. Ensure your iPhone is on the same WiFi network
3. Go to Settings > Network Discovery > Discover Devices
4. MinimServer and dCS Varese should appear
5. Tap MinimServer to add it as a music source
6. Tap Refresh Library to load your music

## Hooks API Summary
- `usePlayback`: currentTrack, isPlaying, queue, zones, volume, playTrack(), togglePlayPause(), next(), previous(), seek()
- `useMusic`: artists, albums, servers, refreshLibrary(), searchMusic(), addServer()
- `useSsdpDiscovery`: devices, isDiscovering, startDiscovery(), getMediaServers(), getMediaRenderers(), getContentDirectoryUrl()

## Key Files
- `client/hooks/useSsdpDiscovery.tsx` - Native SSDP discovery via UDP multicast
- `client/lib/upnpClient.ts` - UPNP SOAP client for ContentDirectory and AVTransport
- `client/hooks/useMusic.tsx` - Music library state and server management
- `client/screens/SettingsScreen.tsx` - Network discovery UI
- `app.json` - iOS permissions for local network access

## Technical Notes
- iOS 14+ requires NSLocalNetworkUsageDescription permission
- SSDP uses multicast UDP to 239.255.255.250:1900
- Device descriptions are fetched via HTTP to discover service control URLs
- SOAP requests use uppercase SOAPACTION header (critical for OhNet compatibility)

## Future Enhancements
- Renderer selection (switch between multiple DACs/streamers)
- Qobuz API integration for streaming
- Gapless playback with queue lookahead
- DSD native streaming support
- Audio format display (sample rate, bit depth)
- Album art caching
