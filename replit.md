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
- Multi-zone audio playback
- Offline downloads
- Playlist creation and management
