# Qobuz Playlists Implementation Guide

This document explains how Qobuz playlists are implemented in the app. **Read this before modifying any playlist-related code.**

## Overview

Qobuz playlists work differently from local LMS playlists. The key difference is:
- **Local playlists**: Use standard LMS `playlists` commands with playlist IDs
- **Qobuz playlists**: Use the `qobuz items` command with hierarchical menu navigation

## How Qobuz Playlists Are Fetched

### 1. Fetching Playlist List (`getPlaylists` in `lmsClient.ts`)

Qobuz playlists are fetched by navigating the Qobuz plugin's menu structure:

```
Step 1: Get Qobuz main menu
  Command: qobuz items 0 100 menu:qobuz
  Returns: Menu items including "My Playlists" (usually item_id: 3)

Step 2: Find "My Playlists" menu item
  Look for item with name containing "my playlist"
  Extract item_id from: actions.go.params.item_id OR params.item_id OR item.id

Step 3: Fetch playlists from My Playlists
  Command: qobuz items 0 100 item_id:{myPlaylistsId} menu:qobuz
  Returns: List of user's Qobuz playlists
```

**Important**: Playlist IDs are hierarchical (e.g., `3.0`, `3.1`, `3.2`) where:
- `3` = My Playlists folder ID
- `.0`, `.1`, `.2` = Individual playlist indices

### 2. Fetching Playlist Tracks (`getPlaylistTracks` in `lmsClient.ts`)

**CRITICAL**: The track fetching method depends on the playlist source!

```typescript
// Detection logic - checks multiple sources
const isQobuz = playlistUrl?.includes('qobuz') || 
                playlistId.includes('qobuz') || 
                playlistName?.toLowerCase().includes('qobuz') ||
                playlistName?.startsWith('Qobuz:');

if (isQobuz) {
  // Use Qobuz-specific command
  Command: qobuz items 0 500 item_id:{playlistId} menu:qobuz
} else {
  // Use standard LMS command
  Command: playlists tracks 0 500 playlist_id:{playlistId} tags:acdlKNuT
}
```

**Warning**: The Qobuz `items` command returns menu navigation items, NOT full track metadata. The returned items have fields like:
- `text` - Track title
- `type` - Item type
- `params`, `goAction`, `presetParams` - Navigation data

These items do NOT include artwork URLs directly!

### 3. Playlist Artwork (`PlaylistsScreen.tsx`)

Artwork for playlist mosaics comes from two sources:

1. **Track Artwork** (preferred): Load tracks → Extract `artwork_url` from each → Display 4 random images
2. **Playlist Artwork** (fallback): Use `playlist.artwork_url` if available

**The Problem**: Qobuz playlist tracks returned by `qobuz items` don't include artwork URLs in the track data. The `parseTrack` function tries multiple fields:
- `image`, `icon`, `artwork_url`, `cover`, `coverart`
- `artwork_track_id`, `coverid`, `icon-id`

**Current Solution**: 
- When fetching playlists, capture `icon` or `image` from the playlist item itself
- Use this as fallback artwork if track artworks aren't available
- Added `artwork_url` field to `LmsPlaylist` interface

## Key Files

| File | Purpose |
|------|---------|
| `client/lib/lmsClient.ts` | `getPlaylists()`, `getPlaylistTracks()`, `parseTrack()` |
| `client/screens/PlaylistsScreen.tsx` | `loadPlaylistArtworks()`, `PlaylistGridItem`, `PlaylistMosaic` |
| `client/components/PlaylistMosaic.tsx` | Displays 4-tile artwork mosaic |

## Common Issues & Fixes

### Issue: Qobuz playlists not appearing
**Cause**: Menu navigation failing to find "My Playlists"
**Fix**: Check `getPlaylists()` - ensure it's extracting `item_id` from `actions.go.params.item_id`

### Issue: Playlists showing but no artwork
**Cause**: `parseTrack()` not finding artwork fields, or Qobuz items don't have artwork
**Fix**: 
1. Check `parseTrack()` handles `icon` field with `normalizeArtworkUrl()`
2. Ensure playlist's own `artwork_url` is captured as fallback
3. Check `renderGridItem()` uses fallback: `item.artwork_url` if track artworks empty

### Issue: Playlists not clickable
**Cause**: Overlay blocking pointer events
**Fix**: In `PlaylistsScreen.tsx`:
```typescript
gridOverlay: {
  pointerEvents: "none",  // NOT "box-none"
  ...
}
gridOverlayButton: {
  pointerEvents: "auto",  // Re-enable for buttons
  ...
}
```

### Issue: Track details showing "Unknown" in playlist detail
**Cause**: Qobuz `items` command returns navigation data, not track metadata
**Note**: This is expected behavior for Qobuz playlists. Full track metadata would require additional API calls.

## Testing Checklist

Before merging playlist changes:
- [ ] Local playlists display with artwork mosaic
- [ ] Qobuz playlists display with artwork (or Qobuz icon placeholder)
- [ ] SoundCloud playlists display with artwork (or SoundCloud icon placeholder)
- [ ] Clicking playlist navigates to detail screen
- [ ] Shuffle and Play buttons work
- [ ] Source icons (Qobuz/SoundCloud) appear in bottom-left

## Code Change Guidelines

1. **Never remove source detection** in `getPlaylistTracks()` - Qobuz needs different API
2. **Always pass `playlistName`** when calling `getPlaylistTracks()` - helps detect Qobuz playlists
3. **Keep fallback to standard command** - ensures local playlists still work
4. **Test both local AND Qobuz playlists** after any change
5. **Check `parseTrack()` handles new fields** if LMS/Qobuz plugin updates

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        PlaylistsScreen                          │
├─────────────────────────────────────────────────────────────────┤
│  loadPlaylists()  →  lmsClient.getPlaylists()                   │
│       │                    │                                     │
│       │                    ├── Local playlists (playlists cmd)   │
│       │                    ├── Qobuz playlists (qobuz items)     │
│       │                    └── SoundCloud (squeezecloud items)   │
│       ▼                                                          │
│  renderGridItem()  →  loadPlaylistArtworks()                    │
│       │                    │                                     │
│       │                    ├── getPlaylistTracks(id, url, name)  │
│       │                    │      │                              │
│       │                    │      ├── isQobuz? → qobuz items     │
│       │                    │      └── else → playlists tracks    │
│       │                    │                                     │
│       │                    └── parseTrack() → extract artwork    │
│       ▼                                                          │
│  PlaylistGridItem  →  PlaylistMosaic                            │
│       │                    │                                     │
│       │                    └── Display 4 artwork images          │
│       │                                                          │
│       └── SourceBadge (Qobuz/SoundCloud icon)                   │
└─────────────────────────────────────────────────────────────────┘
```

## Last Updated
December 16, 2024 - Fixed artwork loading by adding `icon` field handling and playlist-level artwork fallback.












