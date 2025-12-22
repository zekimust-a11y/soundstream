# Roon Volume Control Setup

This document describes how to enable and use Roon volume control in Soundstream.

## Overview

Roon volume control provides fast, programmatic volume control for Roon Core without UI popups or delays. The volume control is as responsive as manually dragging a slider.

## Prerequisites

1. **Roon Core** must be running on your network
2. **Node.js** dependencies installed (see Installation below)

## Installation

The Roon API packages are installed from GitHub:

```bash
npm install
```

This will install:
- `node-roon-api` - Core Roon API library
- `node-roon-api-transport` - Transport service for volume control
- `node-roon-api-status` - Status service for connection monitoring

## Enabling Roon Volume Control

### Server Configuration

Set the environment variable to enable Roon volume control:

```bash
export ENABLE_ROON_VOLUME_CONTROL=true
```

Or add it to your `.env` file:

```
ENABLE_ROON_VOLUME_CONTROL=true
```

### Optional Configuration

You can optionally specify Roon Core IP and port if auto-discovery fails:

```bash
export ROON_CORE_IP=192.168.1.100
export ROON_CORE_PORT=9100
```

Or specify a specific output to control:

```bash
export ROON_OUTPUT_ID=output-id-here
export ROON_ZONE_ID=zone-id-here
```

## How It Works

1. **Auto-Discovery**: The service automatically discovers Roon Core on your network
2. **Output Selection**: The first available output with volume control is automatically selected
3. **Fast Control**: Volume changes use 50ms debouncing for responsive, smooth control
4. **No Popups**: Direct API control means no UI popups interfere with the volume slider

## Current Limitations

**Zone Selection**: Currently, the extension automatically selects the first available output/zone with volume control. If you have multiple zones, it will use the first one discovered (typically "Living room" if that's your primary zone).

**Future Enhancement**: The ability to manually select which zone/output to control will be added in a future update. For now, the extension works with the auto-selected zone.

## API Endpoints

### Get Status
```
GET /api/roon/status
```

Returns connection status and available outputs.

### Set Output
```
POST /api/roon/output
Body: { "output_id": "output-id-here" }
```

Selects a specific output to control.

**Note**: While this endpoint exists, the extension currently auto-selects the first available output. Manual zone selection via the API will work, but a UI for zone selection in the Roon extension settings is planned for a future update.

### Get Volume
```
GET /api/roon/volume?action=get
```

Returns current volume (0-100).

### Set Volume
```
POST /api/roon/volume
Body: { "action": "set", "value": 50 }
```

Sets volume to a specific value (0-100).

### Volume Up/Down
```
POST /api/roon/volume
Body: { "action": "up", "value": 2 }
Body: { "action": "down", "value": 2 }
```

Adjusts volume by a step amount.

## Client Integration

The Roon volume client is automatically integrated into the playback hook. When enabled:

1. Volume slider controls Roon instead of LMS
2. Volume syncs from Roon to the app
3. Changes are debounced for smooth control

## Troubleshooting

### Roon Core Not Found

- Ensure Roon Core is running
- Check that Roon Core and the server are on the same network
- Verify firewall isn't blocking Roon API communication

### Volume Control Not Working

- Check server logs for connection status
- Verify `ENABLE_ROON_VOLUME_CONTROL=true` is set
- Ensure an output is selected (check `/api/roon/status`)

### Output Not Selected

- The service auto-selects the first available output
- Use `/api/roon/output` endpoint to manually select an output
- Check available outputs via `/api/roon/status`

## Performance

- **Debounce**: 50ms for smooth, responsive control
- **Latency**: Direct API calls ensure minimal latency
- **Reliability**: Auto-reconnection handles network issues

## Notes

- Volume control takes priority over LMS volume control when enabled
- The volume slider remains visible and responsive at all times
- No UI popups or dialogs interfere with volume control

## Current Behavior

- **Auto-Zone Selection**: The extension automatically selects the first available zone/output with volume control (typically "Living room" if it's your primary zone)
- **Manual Selection**: You can manually select a different output using the `/api/roon/output` endpoint, but there's no UI for this yet
- **Future Enhancement**: A zone selection interface will be added to allow users to choose which zone to control directly from the Roon extension settings

