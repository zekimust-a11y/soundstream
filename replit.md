# SoundStream - Music Player App

## Overview
SoundStream is a mobile music player app built with Expo/React Native. It connects to **Logitech Media Server (LMS)** to browse music libraries and control playback on LMS-connected players (Squeezebox devices, piCorePlayer, etc.). Audio streams directly from server to player for bit-perfect playback.

## Current State
- **Version**: 1.0.0
- **Status**: LMS integration complete
- **Last Updated**: December 12, 2024
- **Theme**: Light theme (default)
- **Build Type**: Works in Expo Go
- **Latest Update**: Replaced UPnP/SSDP with LMS JSON-RPC API for simpler, more reliable server connectivity

## Architecture

### Control Point Design
```
LMS Server ──── Audio Stream ────> Squeezebox Player
     ↑                                    ↑
     └───── SoundStream App ──────────────┘
            browses library via JSON-RPC,
            sends playback commands to players
```

The app connects to Logitech Media Server's JSON-RPC API to:
- Browse the music library (artists, albums, tracks)
- Discover connected players
- Control playback on any player
- Manage queues and playlists

### Tech Stack
- **Frontend**: Expo SDK 54 + React Native
- **Navigation**: React Navigation 7 (bottom tabs + stack navigators)
- **State Management**: React Context + React Query
- **Storage**: AsyncStorage for persistence
- **UI**: Roon-inspired light theme with liquid glass aesthetics
- **Server Protocol**: LMS JSON-RPC API (http://server:9000/jsonrpc.js)

### Directory Structure
```
client/
├── components/       # Reusable UI components
├── constants/        # Theme and design tokens
├── hooks/           # Custom hooks
│   ├── usePlayback.tsx    # Playback state and LMS player control
│   ├── useMusic.tsx       # Library data and LMS browsing
│   └── useLms.tsx         # LMS server discovery and connection
├── lib/
│   ├── lmsClient.ts       # LMS JSON-RPC client
│   └── debugLog.ts        # Debug logging utility
├── navigation/      # Navigation structure
├── screens/         # App screens
└── assets/          # Local assets
```

### Key Features
1. **LMS Connection**: Connect to LMS server by IP address
2. **Player Selection**: Discover and select from available players
3. **Browse Tab**: Library browsing with artists, albums, and recently played
4. **Playlists Tab**: Browse playlists, tap to view tracks, shuffle or play buttons
5. **Queue Tab**: Playback queue management with drag-to-reorder
6. **Search Tab**: Search music library
7. **Settings Tab**: Server management, player selection, playback settings
8. **Now Playing**: Full-screen modal with player controls
9. **iOS Shortcuts**: Server endpoints for Siri voice control via iOS Shortcuts app

### LMS JSON-RPC API
The app uses LMS's JSON-RPC API at `http://<server>:9000/jsonrpc.js`:
- **Server status**: Get server info and player count
- **Player discovery**: List all connected players
- **Library browsing**: Artists, albums, tracks, search
- **Playback control**: Play, pause, next, previous, seek, volume
- **Queue management**: Add/remove/reorder tracks

## User Preferences
- Light theme as default throughout app
- No placeholder/demo data - real server connections only
- Maximum sound quality - audio streams directly to players
- Manual refresh button in Settings for library updates
- Focus on album artwork and typography
- Liquid glass UI effects where supported

## Getting Started

### Prerequisites
- Logitech Media Server running on your network (default port: 9000)
- At least one Squeezebox-compatible player connected to LMS

### Setup
1. Open the app
2. Go to Settings tab
3. Enter your LMS server IP address (e.g., 192.168.0.100)
4. Tap "Connect to LMS"
5. Select a player from the Players section
6. Tap "Refresh Library" to load your music

## Running the App

The app runs on port 5000 (web) and 8081 (Expo dev server):
```bash
npm run all:dev
```

For mobile testing:
- Scan the QR code with Expo Go (Android) or Camera (iOS)

## Recent Changes (December 2024)

### LMS Integration
- Replaced UPnP/SSDP discovery with LMS JSON-RPC API
- Added lmsClient.ts for all LMS communication
- Updated usePlayback to control LMS players instead of UPnP renderers
- Updated useMusic to fetch library from LMS
- Updated SettingsScreen with LMS connection UI
- Updated DebugScreen with LMS testing tools

### Removed
- UPnP client (upnpClient.ts)
- SSDP discovery (useSsdpDiscovery.tsx)
- SSDP bridge server (ssdp-bridge.ts)

## iOS Shortcuts Integration

The server exposes REST endpoints for iOS Shortcuts to enable Siri voice control.

### Available Endpoints

All endpoints require `host` (LMS IP) and `playerId` (MAC address) parameters.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/shortcuts/play` | POST | Toggle play/pause |
| `/api/shortcuts/next` | POST | Skip to next track |
| `/api/shortcuts/previous` | POST | Skip to previous track |
| `/api/shortcuts/volume` | POST | Set volume (0-100) |
| `/api/shortcuts/playlist` | POST | Play playlist by name (supports shuffle) |
| `/api/shortcuts/playlists` | GET | List available playlists |
| `/api/shortcuts/status` | GET | Get current playback status |
| `/api/shortcuts/players` | GET | List available players |

### Example: Create "Play Jazz" Shortcut
1. Open iOS Shortcuts app
2. Create new shortcut
3. Add "Get Contents of URL" action
4. URL: `https://your-app-url/api/shortcuts/playlist`
5. Method: POST, Request Body: JSON
6. Body: `{"host": "192.168.0.100", "playerId": "00:11:22:33:44:55", "name": "Jazz", "shuffle": true}`
7. Save and add to Siri
