# White Noise Troubleshooting Guide

## Quick Fix Checklist

If you're experiencing white noise when playing tracks on OLADRAplayer, check these LMS settings:

### 1. Open LMS Web Interface
- URL: http://192.168.0.19:9000
- Go to: **Settings → Player → OLADRAplayer → Audio**

### 2. Critical Settings to Check

#### Transcoding Settings (MOST IMPORTANT)
- **Transcoding**: Set to **"Disabled"** or **"Never"**
- **FLAC Transcoding**: Set to **"Disabled"** 
- **DSD Transcoding**: Set to **"Disabled"** (unless you're playing DSD files)
- **MP3 Transcoding**: Set to **"Disabled"**

**Why this matters**: Transcoding can cause white noise if the format conversion is incorrect or if the player/DAC doesn't support the transcoded format properly.

#### Streaming Buffer Settings
- **Streaming Buffer**: Set to **"100%"**
- **Rebuffer at**: Set to **"0%"**
- **Streaming Method**: Use **"Streaming"** (not "Proxied Streaming")

#### Audio Processing Settings
- **Crossfade**: Set to **"Off"**
- **Replay Gain**: Set to **"Off"**
- **Replay Gain Mode**: Set to **"Off"**

#### Sample Rate and Bit Depth
- **Sample Rate**: Match your DAC's capabilities (e.g., **192000** for 192kHz)
- **Bit Depth**: Match your DAC (e.g., **24-bit**)

### 3. Server-Wide Network Settings

Go to: **Settings → Advanced → Network**

- **Streaming Buffer Size**: Set to **131072** bytes (128KB) or higher
- **HTTP Streaming Buffer**: Set to **131072** bytes (128KB) or higher
- **Streaming Timeout**: Set to **30** seconds

## Common Causes of White Noise

1. **Transcoding Enabled**: Most common cause - disable all transcoding
2. **Wrong Sample Rate**: DAC can't handle the sample rate being sent
3. **Streaming Buffer Too Low**: Causes audio processing issues
4. **Crossfade/Replay Gain Enabled**: Audio processing can cause white noise
5. **Format Mismatch**: Player trying to play a format the DAC doesn't support

## Recommended Settings for OLADRAplayer

```
Player Settings → Audio:
├── Transcoding: Disabled
├── FLAC Transcoding: Disabled
├── DSD Transcoding: Disabled
├── Streaming Buffer: 100%
├── Rebuffer at: 0%
├── Streaming Method: Streaming
├── Crossfade: Off
├── Replay Gain: Off
├── Sample Rate: 192000 Hz (or match your DAC)
└── Bit Depth: 24-bit

Advanced → Network:
├── Streaming Buffer Size: 131072 bytes (128KB)
├── HTTP Streaming Buffer: 131072 bytes
└── Streaming Timeout: 30 seconds
```

## Testing After Changes

1. Make the changes in LMS web interface
2. Restart playback (stop and play again)
3. Test with different file formats:
   - 44.1kHz/16-bit FLAC
   - 96kHz/24-bit FLAC
   - 192kHz/24-bit FLAC
4. If white noise persists with specific formats, that format may not be supported by your DAC

## If White Noise Persists

1. Check the current track format in the app (Now Playing screen shows format info)
2. Verify your DAC supports that format at that sample rate/bit depth
3. Try playing a lower resolution file (44.1kHz/16-bit) to see if the issue is format-specific
4. Check LMS logs: Settings → Advanced → Logging → Enable "Player.streaming" and "Player.source"

## Notes

- **Native Playback**: The app is configured to use native playback (no transcoding) for all supported formats
- **DSD Files**: DSD files may need transcoding as they're not natively supported by most DACs via LMS
- **Format Negotiation**: LMS should automatically handle format negotiation with your DAC - if it's not working, check DAC compatibility

















