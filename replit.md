# SoundStream - Music Player App

## Overview
SoundStream is a Roon-inspired mobile music player app built with Expo/React Native. It allows users to browse and stream music from UPNP/LMS servers on their local network, with Qobuz integration for high-resolution streaming.

## Current State
- **Version**: 1.0.0
- **Status**: MVP Complete
- **Last Updated**: December 2024

## Project Architecture

### Tech Stack
- **Frontend**: Expo SDK 54 + React Native
- **Navigation**: React Navigation 7 (bottom tabs + stack navigators)
- **State Management**: React Context + React Query
- **Storage**: AsyncStorage for persistence
- **UI**: Custom Roon-inspired dark theme with liquid glass aesthetics

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

### Data Flow
- `useMusic` hook provides library data (artists, albums, servers)
- `usePlayback` hook manages playback state (current track, queue, controls)
- Demo data is included for testing; real UPNP/LMS integration planned

## User Preferences
- Dark theme with Roon-inspired aesthetics
- Focus on album artwork and typography
- Liquid glass UI effects where supported

## Recent Changes
- Initial MVP implementation
- Custom dark theme matching Roon aesthetic
- Tab navigation with Browse, Queue, Search, Settings
- Now Playing modal with full playback controls
- Server management for UPNP/LMS servers
- Qobuz account connection flow

### Latest Updates (December 2024)
- **Persistent Playback State**: Playback state (currentTrack, currentTime, queue, volume, shuffle, repeat) now persists via AsyncStorage
- **Multi-Zone Audio**: Zone selector modal in Now Playing screen allows multi-zone audio control with per-zone volume
- **Favorites & Playlists**: Full favorites and playlist management with AsyncStorage persistence
  - Toggle favorite on artists, albums, and tracks
  - Create, rename, delete playlists
  - Add/remove tracks, reorder playlist contents
- **Enhanced Search**: Source filtering (Local/Qobuz/All), type filtering, favorites indicators, Qobuz badges
- **Playlists Screen**: New dedicated screen accessible from Browse with full CRUD operations

### Hooks API Summary
- `usePlayback`: currentTrack, isPlaying, queue, zones, volume, shuffle, repeat, playTrack(), togglePlayPause(), next(), previous(), seek(), setActiveZone(), toggleZone(), setZoneVolume()
- `useMusic`: artists, albums, servers, qobuzConnected, favorites, playlists, searchMusic(), toggleFavoriteTrack(), createPlaylist(), addToPlaylist(), etc.

## Running the App
```bash
npm run dev
```
- Expo dev server runs on port 8081
- Express backend runs on port 5000
- Scan QR code with Expo Go to test on physical device

## Future Enhancements
- Real UPNP/DLNA server discovery and browsing
- LMS (Logitech Media Server) integration
- Actual Qobuz API integration for streaming
- Offline downloads
- Audio waveform visualization
- Lyrics display
- Crossfade and gapless playback
