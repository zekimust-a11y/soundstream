# SoundStream Project Summary

**Last Updated:** Current session  
**Project:** SoundStream - Audio streaming app for LMS (Logitech Media Server) with Qobuz integration

## Overview

SoundStream is a React Native (Expo) application that provides a modern, polished interface for controlling Logitech Media Server (LMS) and streaming music from Qobuz. The app supports both native mobile (iOS/Android) and web platforms.

## Key Features Implemented

### 1. Library Browsing
- **Playlists**: Grid/list view with play and shuffle buttons
- **Albums**: Grid/list view with source badges (Local/Qobuz)
- **Artists**: Round tiles with artist portraits from TheAudioDB API
- **Radio**: Favorite radio stations from LMS with station logos
- **History**: Recently played tracks (last 50)

### 2. Search
- Combined search across local library and Qobuz catalog
- Source filtering (Local, Qobuz, All)
- Type filtering (Tracks, Albums, Artists)
- Offline server detection and messaging

### 3. Playback Control
- Now Playing screen with album art, track info, and controls
- Play, pause, skip, seek functionality
- Volume control with +/- buttons for single-step adjustments
- Queue management
- Multi-player support with "Play To" modal
- Player enable/disable toggles

### 4. Volume Control
- **LMS Player Volume**: Standard 0-100% control
- **UPnP DAC Volume**: Direct control of dCS Varese DAC via UPnP RenderingControl service
  - dB scale conversion (-80dB to 0dB)
  - Path discovery and caching
  - Server-side proxy for mobile platforms
- **Hardware Volume Buttons**: iOS hardware volume button control (requires dev build)

### 5. Server Management
- Auto-discovery of LMS servers on local network
- Manual server addition
- Server connection status checking
- Active server selection
- Library statistics (albums, artists, tracks, radio stations, playlists)

### 6. UI/UX Polish
- Instagram/Discord/Shopify-style menu buttons
- Spring animations using React Native Reanimated
- Skeleton loading screens
- Smooth screen transitions
- Consistent grid/list view toggles
- Source badges on album artwork
- Refined spacing, shadows, and visual hierarchy

### 7. Chromecast Support
- mDNS-based Chromecast discovery
- TV display for now playing information
- Automatic casting when music plays

### 8. Artist Information
- Artist portraits from TheAudioDB API
- Artist biographies and metadata
- Discography display

## Technical Architecture

### Client-Side (React Native/Expo)
- **Framework**: Expo with React Native
- **Navigation**: React Navigation (Stack + Tab navigators)
- **State Management**: React Context API
  - `useMusic`: Library data, server management, recently played
  - `usePlayback`: Playback state, player management, volume control
  - `useSettings`: App settings, hardware volume control
- **Data Fetching**: React Query (`@tanstack/react-query`)
- **Animations**: React Native Reanimated
- **Storage**: AsyncStorage for client-side persistence

### Server-Side (Express.js)
- **Port**: 3000 (changed from 5000 due to AirTunes conflict)
- **CORS**: Configured for web and mobile platforms
- **Proxy Endpoints**:
  - `/api/lms/discover`: Server-side LMS discovery (bypasses browser CORS)
  - `/api/lms/connect`: Single server connection proxy
  - `/api/lms/proxy`: All LMS JSON-RPC requests
  - `/api/upnp/volume`: UPnP volume control proxy
  - `/api/chromecast/discover`: Chromecast discovery
  - `/api/chromecast/cast`: Start casting
  - `/api/chromecast/stop`: Stop casting

### Key Libraries
- `react-native-reanimated`: Animations
- `expo-blur`: Tab bar blur effects
- `expo-image`: Optimized image loading
- `@tanstack/react-query`: Data fetching and caching
- `mdns-js`: Chromecast discovery
- `react-native-volume-manager`: iOS hardware volume control (native module)

## File Structure

### Client Code
```
client/
├── screens/          # All screen components
├── components/       # Reusable UI components
├── hooks/           # Custom React hooks
├── lib/             # Client-side libraries (LMS client, UPnP client)
├── navigation/      # Navigation configuration
└── constants/       # Theme, colors, spacing
```

### Server Code
```
server/
├── index.ts         # Express server setup
├── routes.ts        # API route handlers
├── android-mosaic-relay.ts  # Android Mosaic ACTUS relay (for dCS Varese)
└── templates/       # HTML templates
```

## Important Configuration

### LMS Integration
- Uses LMS JSON-RPC API
- Commands: `status`, `playlist`, `playlistcontrol`, `mixer`, `favorites`, `search`, `qobuz`, `globalsearch`
- Player preferences: `transcode`, `transcodeFLAC`, `transcodeDSD`

### UPnP Volume Control
- **Service**: RenderingControl
- **Format**: dB scale (-80dB to 0dB) for dCS Varese
- **Paths**: Multiple paths tried with caching
- **Proxy**: Required for mobile platforms

### Format Handling
- **Native Playback**: Let LMS handle format negotiation automatically
- **Forced Transcoding**: Only for DSD formats (not supported natively via UPnP)
- **FLAC**: Plays natively if DAC supports it (dCS Varese supports FLAC up to 192kHz)

## Known Issues & Solutions

### Audio Dropouts
- **Solution**: Buffer settings configuration via Settings screen
- **Documentation**: `AUDIO_DROPOUT_TROUBLESHOOTING.md`

### White Noise on High-Res Files
- **Solution**: Removed aggressive transcoding; let LMS handle format negotiation
- **Note**: Only DSD formats are force-transcoded

### Web App CORS Issues
- **Solution**: Server-side proxy endpoints for all LMS requests

### Mobile Network Restrictions
- **Solution**: Server-side proxy for UPnP volume control

### iOS App Crashes
- **Fixed**: Navigation safety checks in Now Playing screen
- **Fixed**: Hardware volume control defensive checks for Expo Go

## Documentation Files

- `AUDIO_DROPOUT_TROUBLESHOOTING.md`: Comprehensive guide for audio dropout issues
- `DCS_VARESE_VOLUME_CONTROL.md`: UPnP volume control implementation details
- `REMOTE_DEBUGGING.md`: iPhone remote debugging setup
- `QUICK_DEV_BUILD_SETUP.md`: Development build setup instructions
- `ANDROID_MOSAIC_SETUP.md`: Android Mosaic ACTUS relay setup (for dCS Varese)
- `DOWNLOAD_MOSAIC_APK.md`: Instructions for downloading Mosaic ACTUS APK

## Recent Changes

### Format Handling
- Removed aggressive FLAC transcoding
- Only force transcoding for DSD formats
- Let LMS and UPnP bridge handle format negotiation automatically

### Volume Control
- Direct UPnP control of dCS Varese DAC (working)
- Hardware volume button support for iOS (requires dev build)
- Android Mosaic ACTUS relay (experimental, for dCS Varese)

### UI Improvements
- Consistent header layouts across all screens
- Source badges on album artwork
- History screen for recently played tracks
- Shuffle all functionality on Browse screen

## Git Status

**Modified Files (not committed):**
- 30+ modified files across client, server, and configuration

**Untracked Files (not added to git):**
- `client/components/SkeletonLoader.tsx`
- `client/components/SourceBadge.tsx`
- `client/screens/HistoryScreen.tsx`
- `server/android-mosaic-relay.ts`
- Multiple documentation files (`.md`)
- Test scripts (`test-*.sh`)
- `mobile-preview.html`

## Next Steps / Pending Work

1. **Direct dCS Varese Volume Control**: Test direct UPnP volume control (without Squeezelite)
2. **Format Support Query**: Implement UPnP capability querying to check DAC format support
3. **Git Commit**: Commit all changes and new files
4. **Testing**: Test direct DAC control vs Squeezelite player

## Environment Variables

- `EXPO_PUBLIC_DOMAIN`: Server domain (defaults to `localhost:3000`)
- `ENABLE_ANDROID_MOSAIC_RELAY`: Enable Android Mosaic relay (set to `'true'`)
- `ADB_PATH`: Path to ADB executable
- `ANDROID_DEVICE_SERIAL`: Android device/emulator serial
- `MOSAIC_PACKAGE_NAME`: Mosaic ACTUS package name (auto-detected)

## Server Ports

- **Express Server**: 3000
- **Expo Dev Server**: 8081
- **LMS Server**: 9000 (default)
- **UPnP Devices**: Various (typically 16500 for dCS Varese)

## Platform Support

- ✅ **Web**: Full support via React Native Web
- ✅ **iOS**: Full support (requires dev build for hardware volume control)
- ✅ **Android**: Full support (requires dev build for native modules)

## Notes

- The app is designed to work with LMS servers running on the local network
- UPnP volume control requires a Squeezelite player or direct UPnP device connection
- Some features (hardware volume control) require a development build, not Expo Go
- The Android Mosaic ACTUS relay is experimental and may have stability issues

