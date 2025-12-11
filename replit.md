# SoundStream - Music Player App

## Overview
SoundStream is a Roon-inspired mobile music player app built with Expo/React Native. It allows users to browse and stream music from UPNP/LMS servers on their local network, with Qobuz integration for high-resolution streaming.

## Current State
- **Version**: 1.0.0
- **Status**: MVP with Real Server Connectivity
- **Last Updated**: December 2024
- **Theme**: Light theme (default)

## Project Architecture

### Tech Stack
- **Frontend**: Expo SDK 54 + React Native
- **Navigation**: React Navigation 7 (bottom tabs + stack navigators)
- **State Management**: React Context + React Query
- **Storage**: AsyncStorage for persistence
- **UI**: Custom Roon-inspired light theme with liquid glass aesthetics
- **Server Protocol**: UPNP/DLNA Content Directory Service (SOAP/DIDL-Lite)

### Directory Structure
```
client/
├── components/       # Reusable UI components
├── constants/        # Theme and design tokens
├── hooks/           # Custom hooks (usePlayback, useMusic)
├── navigation/      # Navigation structure
├── screens/         # App screens
├── lib/             # Utilities
└── assets/          # Local assets
```

### Key Features
1. **Browse Tab**: Library browsing with artists, albums, and recently played
2. **Queue Tab**: Playback queue management with drag-to-reorder
3. **Search Tab**: Global search across all music sources
4. **Settings Tab**: Server configuration and Qobuz integration
5. **Now Playing**: Full-screen modal with playback controls
6. **Real UPNP Server Connectivity**: Direct connection to MinimServer and other UPNP/DLNA servers

### UPNP/DLNA Server Connectivity
The app connects directly to UPNP/DLNA servers (like MinimServer) using:
- SOAP requests to ContentDirectory service
- DIDL-Lite XML parsing for metadata
- Multiple control URL fallbacks for compatibility

**Important**: Server connectivity only works when running on a mobile device (via Expo Go) on the same local network as the music server. Web browser version cannot access local network resources due to security restrictions.

### Data Flow
- `useMusic` hook provides library data (artists, albums, servers) and handles UPNP browsing
- `usePlayback` hook manages playback state (current track, queue, controls)
- Direct HTTP/SOAP requests from mobile app to local UPNP servers

## User Preferences
- Light theme as default throughout app
- No placeholder/demo data - real server connections only
- Manual refresh button in Settings for library updates
- Focus on album artwork and typography
- Liquid glass UI effects where supported

## Recent Changes
- Initial MVP implementation
- Light theme matching Roon aesthetic
- Tab navigation with Browse, Queue, Search, Settings
- Now Playing modal with full playback controls
- Server management for UPNP/LMS servers
- Qobuz account connection flow

### Latest Updates (December 2024)
- **Light Theme**: Switched from dark to light theme as default
- **Real UPNP Server Connectivity**: Direct SOAP/DIDL-Lite communication with MinimServer and other UPNP servers
- **No Demo Data**: Removed all placeholder content; library starts empty until servers connect
- **Persistent Playback State**: Playback state persists via AsyncStorage
- **Multi-Zone Audio**: Zone selector modal in Now Playing screen
- **Favorites & Playlists**: Full favorites and playlist management
- **Manual Refresh**: Refresh button in Settings to reload library from servers

### Hooks API Summary
- `usePlayback`: currentTrack, isPlaying, queue, zones, volume, shuffle, repeat, playTrack(), togglePlayPause(), next(), previous(), seek(), setActiveZone(), toggleZone(), setZoneVolume()
- `useMusic`: artists, albums, servers, qobuzConnected, favorites, playlists, searchMusic(), refreshLibrary(), toggleFavoriteTrack(), createPlaylist(), addToPlaylist(), etc.

## Running the App
```bash
npm run dev
```
- Expo dev server runs on port 8081
- Express backend runs on port 5000
- **Scan QR code with Expo Go to test on physical device** (required for local server connectivity)

### Testing with MinimServer
1. Ensure your phone is on the same WiFi network as MinimServer
2. Open Expo Go and scan the QR code
3. Go to Settings > Manage Servers > Add Server
4. Enter: Host = 192.168.0.19, Port = 9790 (or your server's address)
5. Tap Refresh Library in Settings to load music

## Technical Notes
- UPNP control URLs tried: `/dev/srv0/ctl/ContentDirectory`, `/ctl/ContentDirectory`, `/ContentDirectory/control`
- Container browsing starts at root (0) then tries common IDs: 1, 2, 3, 64, 65, Music, Albums, Artists
- Parses DIDL-Lite XML for containers (artists/albums) and items (tracks)

## Future Enhancements
- LMS (Logitech Media Server) integration
- Actual Qobuz API integration for streaming
- Offline downloads
- Audio waveform visualization
- Lyrics display
- Crossfade and gapless playback
