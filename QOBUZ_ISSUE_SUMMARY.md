# Qobuz Plugin Issue Summary

## Setup Details

**Client Application**: React Native app (Expo) that connects to LMS via JSON-RPC
- **Platform**: Web (Chrome) and iOS
- **Proxy Server**: Node.js/Express server running on `localhost:3000` to handle CORS for web client
- **LMS Server**: Logitech Media Server 8.5.2 running on `192.168.0.19:9000`
- **Qobuz Plugin**: Latest version (as of Dec 2024)
- **Player ID**: `00:30:18:0d:62:1b` (OLADRAplayer - squeezelite)

**Note**: All Qobuz commands now include the player ID as the first parameter in the `slim.request` params array, as you previously suggested.

## Issue Description

We can successfully retrieve the root Qobuz menu items, but we cannot browse into submenus (specifically "Bestsellers" and "Essentials") to retrieve albums.

## What Works

### 1. Getting Root Menu Items
**Command**: `qobuz items 0 30 want_url:1`
**Result**: Successfully returns 11 menu items in `result.loop_loop`:
- Search (id: 0, type: link)
- My Purchases (id: 1)
- My Favorites (id: 2)
- My Playlists (id: 3)
- Qobuz Playlists (id: 4)
- **Bestsellers (id: 5, hasitems: 1)** ← This is what we want to browse
- New Releases (id: 6)
- In the Press (id: 7)
- Qobuz Selection (id: 8)
- Genres (id: 9, type: link)
- My Weekly Q (id: 10, type: playlist)

**JSON-RPC Request**:
```json
{
  "id": 1,
  "method": "slim.request",
  "params": [
    "00:30:18:0d:62:1b",
    ["qobuz", "items", "0", "30", "want_url:1"]
  ]
}
```

**Response Structure**:
```json
{
  "result": {
    "count": 11,
    "loop_loop": [
      {
        "id": "5",
        "name": "Bestsellers",
        "image": "html/images/albums.png",
        "isaudio": 0,
        "hasitems": 1
      },
      ...
    ]
  }
}
```

## What Doesn't Work

### 1. Getting Items from Bestsellers Submenu
**Command**: `qobuz items 5 0 100 want_url:1`
**Result**: Returns only `count: 11` with **no items array** (no `loop_loop`, `items_loop`, `item_loop`, or `items` fields)

**JSON-RPC Request**:
```json
{
  "id": 1,
  "method": "slim.request",
  "params": [
    "00:30:18:0d:62:1b",
    ["qobuz", "items", "5", "0", "100", "want_url:1"]
  ]
}
```

**Response**:
```json
{
  "result": {
    "count": 11
  }
}
```

**Expected**: An array of albums in `result.loop_loop` or similar field.

### 2. Browse Commands Return Empty
**Command Attempts**:
- `qobuz browse 0 5 0 30 want_url:1` → Empty response (connection closed)
- `qobuz browse 5 0 30 want_url:1` → Empty response (connection closed)
- `qobuz browse 5` → Empty response (connection closed)

**JSON-RPC Request Example**:
```json
{
  "id": 1,
  "method": "slim.request",
  "params": [
    "00:30:18:0d:62:1b",
    ["qobuz", "browse", "0", "5", "0", "30", "want_url:1"]
  ]
}
```

**Response**: Empty (curl returns exit code 52 - empty reply from server)

### 3. Items Command with Tags
**Command**: `qobuz items 5 0 30 tags:al want_url:1`
**Result**: Same as above - only `count: 11`, no items array

## Commands We've Tried

1. ✅ `qobuz items 0 30 want_url:1` - Works (returns root menu)
2. ❌ `qobuz items 5 0 100 want_url:1` - Returns count only, no items
3. ❌ `qobuz items 5 0 100 tags:al want_url:1` - Returns count only, no items
4. ❌ `qobuz browse 0 5 0 30 want_url:1` - Empty response
5. ❌ `qobuz browse 5 0 30 want_url:1` - Empty response
6. ❌ `qobuz browse 5` - Empty response
7. ❌ `qobuz items 0 30 type:best-sellers want_url:1` - Returns menu items, not albums

## Questions

1. **What is the correct command format to browse into a submenu item?**
   - The `qobuz items 5` command returns `count: 11` but no items array. Is there a different parameter or command format needed?

2. **Is the `browse` command supported for Qobuz plugin?**
   - All browse commands return empty responses. Is this expected, or is there a different command for navigating submenus?

3. **How should we retrieve albums from menu items like "Bestsellers"?**
   - The menu item shows `hasitems: 1`, indicating it contains items, but we cannot retrieve them.

4. **Are there any additional parameters required?**
   - We're including `want_url:1` and the player ID. Are there other required parameters for browsing submenus?

## Additional Context

- The player ID (`00:30:18:0d:62:1b`) is included in all commands
- The Qobuz account is authenticated and working (we can search Qobuz successfully)
- Other Qobuz commands (like search) work correctly
- The issue is specifically with browsing into submenus to retrieve albums

## Goal

We want to programmatically retrieve albums from the "Bestsellers" and "Essentials" menu items to display them in our client application's browse screen.

Thank you for your help!














