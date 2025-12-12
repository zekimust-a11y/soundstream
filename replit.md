# SoundStream - Music Player App

## Overview
SoundStream is a mobile music player app built with Expo/React Native. It connects to **Logitech Media Server (LMS)** to browse music libraries and control playback on LMS-connected players (Squeezebox devices, piCorePlayer, etc.). Audio streams directly from server to player for bit-perfect playback.

## Current State
- **Version**: 1.1.0
- **Status**: LMS integration complete with Radio support
- **Last Updated**: December 12, 2024
- **Theme**: Light theme (default)
- **Build Type**: Works in Expo Go
- **Latest Update**: Added Radio tab for favorite stations, moved Settings to Browse screen, improved navigation

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
3. **Browse Tab**: Library browsing with artists, albums, recently played + Settings access
4. **Playlists Tab**: Browse playlists with mosaic artwork, shuffle or play buttons
5. **Albums Tab**: Browse all albums with infinite scrolling
6. **Artists Tab**: Browse all artists with album counts
7. **Radio Tab**: Browse favorite radio stations from LMS
8. **Search Tab**: Search music library
9. **Settings Screen**: Server management, player selection, playback settings (accessed from Browse)
10. **Now Playing**: Full-screen modal with player controls and audio quality display
11. **iOS Shortcuts**: Server endpoints for Siri voice control via iOS Shortcuts app

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

## User's Local Environment
- **Mac IP**: 192.168.0.21
- **LMS Server**: 192.168.0.19:9000
- **Preferred Player**: OLADRAplayer (bb:bb:37:be:02:c2)
- **Chromecast IP**: 192.168.0.239
- **Local Server Port**: 3000
- **dCS Varese**: Core at 192.168.0.17, Interface at 192.168.0.42 (UPnP port 16500)
- **Local Server Path**: `/Users/zeki/Library/CloudStorage/GoogleDrive-zekimust@gmail.com/My Drive/Personal/Audio App/local-server`
- **Restart Command**: `cd "/Users/zeki/Library/CloudStorage/GoogleDrive-zekimust@gmail.com/My Drive/Personal/Audio App/local-server" && npm start`

## Getting Started

### Prerequisites
- Logitech Media Server running on your network (default port: 9000)
- At least one Squeezebox-compatible player connected to LMS

### Setup
1. Open the app
2. Tap the Settings icon (gear) in the top right of the Browse screen
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

## dCS Mosaic Volume Control

The local-server includes Mosaic volume control via macOS accessibility APIs.

### How It Works
- `mosaic-volume.swift` uses macOS accessibility APIs to find and control the volume slider in the Mosaic app
- Requires accessibility permission granted to Terminal in System Settings
- Can be compiled for faster execution: `swiftc -O -o mosaic-volume mosaic-volume.swift`

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mosaic/volume` | GET | Get current volume |
| `/api/mosaic/volume` | POST | Set volume (action: set/up/down/mute) |
| `/api/mosaic/sliders` | GET | List all sliders (debug) |

### CLI Usage

```bash
./mosaic-volume --get           # Get current volume
./mosaic-volume --set 75        # Set volume to 75%
./mosaic-volume --up 5          # Volume up 5%
./mosaic-volume --down 5        # Volume down 5%
./mosaic-volume --mute          # Toggle mute
```

### Prerequisites
1. macOS only (uses accessibility APIs)
2. Mosaic app running (can be in background)
3. Accessibility permission granted to Terminal

## Flirc USB / IR Remote Control

The local-server includes keyboard listener support for Flirc USB adapters, allowing any IR remote to control LMS playback.

### How It Works
- Flirc USB receives IR signals from any remote and converts them to keyboard presses
- The local-server listens for keyboard events in stdin raw mode
- Key mappings are defined in `local-server/keymap.json`
- Commands are sent to LMS via JSON-RPC

### Key Notes
- Requires `process.stdin.resume()` after `setRawMode(true)` for keypress events to fire
- Only works when running in an interactive terminal (TTY)
- Configure `ENABLE_KEYBOARD=true` environment variable

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
