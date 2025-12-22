# dCS Varese Volume Control Implementation

**Status: WORKING** ✅  
**Last Verified: Current implementation in Cursor preview**

This document describes the working implementation for controlling the dCS Varese DAC volume via UPnP. **DO NOT MODIFY** this implementation without thorough testing, as it is currently working perfectly.

## Overview

The dCS Varese DAC uses UPnP RenderingControl service for volume control. The volume is represented in **decibels (dB)** with a range of **-80dB to 0dB**, not the standard 0-100 percentage scale used by most devices.

### Important: Player Requirement

**UPnP volume control only works when using the Squeezelite player.**

- If the LMS player is **Squeezelite**, the app can control volume over UPnP
- If using a different player type, UPnP volume control will not work
- This is because Squeezelite exposes the UPnP RenderingControl service that the dCS Varese uses

## Architecture

### Client-Side (`client/lib/upnpVolumeClient.ts`)

1. **Platform Detection**
   - **Mobile (iOS/Android)**: Always uses server-side proxy endpoint (`/api/upnp/volume`)
   - **Web**: Tries direct connection first, falls back to proxy if it fails

2. **Path Discovery**
   - Tries multiple common UPnP control paths:
     - `/RenderingControl/ctrl` (most common for dCS)
     - `/upnp/control/RenderingControl`
     - `/ctl/RenderingControl`
     - `/MediaRenderer/RenderingControl/Control`
   - **Caches working path** after first successful connection
   - Uses cached path for subsequent requests (performance optimization)

3. **Volume Conversion**
   - **Percentage to dB**: `((percent / 100) * 80) - 80`
     - 0% = -80dB
     - 50% = -40dB
     - 100% = 0dB
   - **dB to Percentage**: `((dB + 80) / 80) * 100`
     - -80dB = 0%
     - -40dB = 50%
     - 0dB = 100%

4. **Request Flow**
   - Constructs SOAP envelope with proper UPnP namespace
   - For mobile: sends JSON to proxy endpoint with `useDbFormat: true`
   - For web: sends SOAP directly, or falls back to proxy

### Server-Side (`server/routes.ts` - `/api/upnp/volume`)

1. **Security**
   - Validates IP address is private network (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
   - Rejects public IPs for security

2. **Path Discovery**
   - Tries same list of control paths as client
   - Iterates through paths until one succeeds

3. **Volume Parsing (GetVolume)**
   - Tries multiple XML patterns:
     - Standard: `<CurrentVolume>50</CurrentVolume>` (0-100 integer)
     - dB format: `<CurrentVolume>-34.5</CurrentVolume>` (negative decimal)
     - Alternative: `<Volume>-34.5</Volume>`
   - **Auto-detects dB format** by checking if value is negative
   - Converts dB to percentage for client

4. **Volume Setting (SetVolume)**
   - Checks `useDbFormat` flag from request body
   - If `useDbFormat: true`, converts percentage to dB before sending
   - Sends dB value in SOAP envelope: `<DesiredVolume>-40.0</DesiredVolume>`

### Integration (`client/hooks/usePlayback.tsx`)

1. **Volume Control Logic**
   - When DAC is configured and enabled, volume slider controls DAC instead of LMS player
   - Uses **debouncing** (50ms timeout) to batch rapid volume changes
   - Updates local state immediately for responsive UI
   - Sends actual volume command after debounce period

2. **Key Code Pattern**
   ```typescript
   if (dacConfig?.enabled && upnpVolumeClient.isConfigured()) {
     setDacVolume(volumePercent); // Update UI immediately
     pendingVolumeRef.current = volumePercent;
     
     // Debounce: clear previous timeout, set new one
     if (volumeTimeoutRef.current) {
       clearTimeout(volumeTimeoutRef.current);
     }
     
     volumeTimeoutRef.current = setTimeout(async () => {
       const finalVol = pendingVolumeRef.current;
       if (finalVol === null) return;
       pendingVolumeRef.current = null;
       
       await upnpVolumeClient.setVolume(finalVol);
     }, 50); // 50ms debounce
     return; // Don't control LMS volume
   }
   ```

## Critical Implementation Details

### 1. dB Format Flag
**MUST** include `useDbFormat: true` in proxy request body when setting volume:
```typescript
requestBody.useDbFormat = true; // dCS DACs use dB format
```

### 2. Path Caching
The client caches the working path after first successful connection:
```typescript
this.workingPath = path; // Remember working path
```
This significantly improves performance by avoiding path discovery on every request.

### 3. Mobile Proxy Requirement
Mobile platforms **MUST** use the proxy endpoint because:
- Direct UPnP requests are blocked by mobile OS network restrictions
- Proxy endpoint handles path discovery and dB conversion server-side

### 4. Volume Range Validation
Always clamp volume values:
- Percentage: `Math.max(0, Math.min(100, volume))`
- dB: `-80 <= dB <= 0`

### 5. SOAP Envelope Format
**CRITICAL**: Must use exact SOAP format:
```xml
<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredVolume>-40.0</DesiredVolume>
    </u:SetVolume>
  </s:Body>
</s:Envelope>
```

## Configuration

### Settings Screen
- User configures DAC IP, port, and name in Settings
- Stored in `AsyncStorage` with key `@soundstream_dac_config`
- When enabled, volume slider automatically controls DAC instead of LMS player

### Default Port
- Default UPnP port: **80** (standard HTTP)
- dCS Varese typically uses port 80

## Troubleshooting

### If Volume Control Stops Working

1. **Check Player Type**
   - **CRITICAL**: Verify you are using **Squeezelite** as the LMS player
   - UPnP volume control only works with Squeezelite players
   - Other player types (e.g., SqueezePlay, SqueezeBox) do not support UPnP volume control
   - Check player name/type in LMS web interface or Settings screen

2. **Check Path Discovery**
   - Look for `[UPnP] Trying SetVolume` logs in server console
   - Verify which path succeeds (should be `/RenderingControl/ctrl` for dCS)

3. **Verify dB Conversion**
   - Check server logs for: `[UPnP] Setting volume: 50% -> -40.0dB`
   - Verify SOAP envelope contains dB value, not percentage

4. **Check Proxy Endpoint**
   - Mobile requests must go through `/api/upnp/volume`
   - Verify `useDbFormat: true` is in request body

5. **Network Issues**
   - Ensure DAC is on same network
   - Verify IP address is correct
   - Check firewall isn't blocking UPnP traffic

## Files Involved

1. **Client**
   - `client/lib/upnpVolumeClient.ts` - UPnP client implementation
   - `client/hooks/usePlayback.tsx` - Volume control integration

2. **Server**
   - `server/routes.ts` - `/api/upnp/volume` endpoint (lines ~950-1200)

## Key Success Factors

1. ✅ **Squeezelite Player** - **REQUIRED**: Must use Squeezelite player for UPnP volume control
2. ✅ **dB Format Conversion** - Properly converts between percentage and dB
3. ✅ **Path Discovery** - Tries multiple paths, caches working one
4. ✅ **Mobile Proxy** - Uses server-side proxy for mobile platforms
5. ✅ **Debouncing** - Batches rapid volume changes for smooth control
6. ✅ **Error Handling** - Gracefully handles path failures, tries alternatives
7. ✅ **Security** - Validates private IP addresses only

## DO NOT CHANGE

- **Player requirement**: Must use Squeezelite player (UPnP volume control won't work with other players)
- The dB conversion formula: `((percent / 100) * 80) - 80`
- The `useDbFormat: true` flag in proxy requests
- The path discovery order (try `/RenderingControl/ctrl` first)
- The 50ms debounce timeout (optimal for smooth control)
- The mobile proxy requirement (security/network restrictions)

---

**Note**: This implementation has been tested and verified working. Any changes should be thoroughly tested before deployment.

