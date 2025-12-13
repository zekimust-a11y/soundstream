# Audio Dropout Troubleshooting - LMS + Squeezelite + dCS Varese DAC

**Issue**: Audio dropouts when using LMS with Squeezelite player to dCS Varese DAC via UPnP bridge.

## Overview

The dCS Varese DAC doesn't officially support Squeeze server over UPnP, but it works via the UPnP bridge in Squeezelite. Audio dropouts can be caused by buffer underruns, network issues, or incorrect LMS/Squeezelite settings.

## Critical Settings to Check

### 1. Squeezelite Buffer Settings

**Most Important**: Increase Squeezelite's audio buffer to prevent dropouts.

#### Command Line Options (if running Squeezelite manually):
```bash
# Increase buffer size (default is often too small)
-b 4096:8192    # Buffer size in frames (4096-8192 is good for high-res)
-r 44100-192000 # Sample rate range (match your DAC's capabilities)
-a 100:4:16:0   # ALSA buffer settings (100ms, 4 periods, 16 frames, 0 for auto)
```

#### LMS Player Settings (via Web UI):
1. Go to LMS Web Interface → Settings → Player → [Your Squeezelite Player]
2. **Audio** tab:
   - **Buffer Size**: Increase to **4096** or **8192** frames
   - **Streaming Buffer**: Set to **100%** or higher
   - **Rebuffer at**: Set to **0%** (prevents rebuffering)

### 2. LMS Streaming Settings

#### Player Settings → Audio:
- **Streaming Method**: Use **Streaming** (not "Proxied Streaming")
- **Streaming Buffer**: **100%** or higher
- **Rebuffer at**: **0%** (prevents interruptions)
- **Buffer Size**: **4096** or **8192** frames

#### Advanced Settings:
- **Streaming Buffer Size**: Increase to **65536** bytes or higher
- **Streaming Timeout**: Increase to **30** seconds or higher

### 3. Transcoding Settings (CRITICAL)

**Disable all transcoding** - The app already does this, but verify in LMS:

#### Player Settings → Audio:
- **Transcoding**: Set to **Disabled** or **Never**
- **FLAC Transcoding**: **Disabled**
- **DSD Transcoding**: **Disabled**
- **MP3 Transcoding**: **Disabled**

#### Why this matters:
- Transcoding adds latency and can cause buffer underruns
- dCS Varese should receive native FLAC/DSD streams
- Transcoding defeats the purpose of high-res audio

### 4. Network Buffer Settings

#### LMS Settings → Advanced → Network:
- **Streaming Buffer Size**: **65536** bytes (64KB) or higher
- **HTTP Streaming Buffer**: **65536** bytes or higher
- **Streaming Timeout**: **30** seconds

### 5. Sample Rate and Format Settings

#### Player Settings → Audio:
- **Sample Rate**: Match your DAC's capabilities (e.g., **192000** for 192kHz)
- **Bit Depth**: **24-bit** or **32-bit** (match DAC)
- **Format**: **FLAC** (native, no transcoding)

#### Squeezelite Command Line:
```bash
-r 44100-192000  # Sample rate range
-C 5             # Timeout for connecting (5 seconds)
-W               # Output to stdout (for UPnP bridge)
```

### 6. UPnP Bridge Specific Settings

Since you're using UPnP bridge, check these:

#### LMS Settings → Plugins → UPnP/DLNA Bridge:
- **Buffer Size**: Increase to **8192** frames or higher
- **Streaming Buffer**: **100%**
- **Sample Rate**: Match DAC capabilities
- **Bit Depth**: **24-bit** or **32-bit**

### 7. Gapless Playback Settings

#### Player Settings → Audio:
- **Gapless Playback**: **Enabled** (reduces gaps between tracks)
- **Crossfade**: **Disabled** (can cause dropouts if enabled)
- **Replay Gain**: **Disabled** (adds processing overhead)

### 8. System-Level Settings

#### If running Squeezelite on Linux/macOS:
```bash
# Increase system audio buffer
# For ALSA (Linux):
# In /etc/asound.conf or ~/.asoundrc:
pcm.!default {
    type hw
    card 0
    buffer_size 8192
    period_size 2048
}
```

#### Network Settings:
- Ensure **wired Ethernet** connection (WiFi can cause dropouts)
- Check network latency: `ping <LMS_SERVER_IP>` (should be < 10ms)
- Disable **QoS/bandwidth limiting** on network equipment

## Recommended Configuration

### LMS Player Settings (for Squeezelite + dCS Varese):

```
Player Settings → Audio:
├── Streaming Method: Streaming
├── Streaming Buffer: 100%
├── Rebuffer at: 0%
├── Buffer Size: 8192 frames
├── Transcoding: Disabled
├── FLAC Transcoding: Disabled
├── DSD Transcoding: Disabled
├── Sample Rate: 192000 Hz (or match DAC)
├── Bit Depth: 24-bit
└── Gapless: Enabled

Advanced → Network:
├── Streaming Buffer Size: 131072 bytes (128KB)
├── HTTP Streaming Buffer: 131072 bytes
└── Streaming Timeout: 30 seconds
```

### Squeezelite Command Line (if running manually):

```bash
squeezelite \
  -n "dCS Varese" \
  -o <UPnP_OUTPUT> \
  -b 8192:16384 \
  -r 44100-192000 \
  -a 100:4:16:0 \
  -C 5 \
  -W
```

## Diagnostic Steps

### 1. Check Current Buffer Settings
- LMS Web UI → Settings → Player → [Your Player] → Audio
- Note current buffer size and streaming buffer percentage

### 2. Monitor Network Performance
```bash
# Check network latency to LMS server
ping <LMS_SERVER_IP>

# Check for packet loss
ping -c 100 <LMS_SERVER_IP> | grep "packet loss"
```

### 3. Check LMS Logs
- LMS Web UI → Settings → Advanced → Logging
- Enable **Player.streaming** and **Player.source** logging
- Look for "buffer underrun" or "rebuffer" messages

### 4. Test with Different File Formats
- Try 44.1kHz/16-bit FLAC (lowest bandwidth)
- Try 96kHz/24-bit FLAC (medium)
- Try 192kHz/24-bit FLAC (highest bandwidth)
- If dropouts only occur with high-res, it's likely a buffer/bandwidth issue

## Common Causes of Dropouts

1. **Buffer Too Small**: Most common cause - increase buffer size
2. **Network Latency**: High latency or packet loss
3. **Transcoding Enabled**: Adds latency and processing overhead
4. **WiFi Connection**: Unstable WiFi can cause dropouts
5. **System Load**: High CPU usage on LMS server or Squeezelite device
6. **Sample Rate Mismatch**: DAC can't handle the sample rate being sent
7. **UPnP Bridge Buffer**: UPnP bridge buffer may be too small

## Quick Fix Checklist

- [ ] Increase Squeezelite buffer to **8192** frames
- [ ] Set streaming buffer to **100%** in LMS
- [ ] Disable **all transcoding** in LMS player settings
- [ ] Increase network buffer size to **131072** bytes
- [ ] Use **wired Ethernet** instead of WiFi
- [ ] Disable **crossfade** and **replay gain**
- [ ] Match sample rate to DAC capabilities
- [ ] Check LMS logs for buffer underrun messages

## Testing After Changes

1. Play a high-res track (192kHz/24-bit FLAC)
2. Monitor for dropouts during:
   - Initial playback start
   - Track transitions (if gapless enabled)
   - Network activity spikes
   - System load spikes

3. If dropouts persist:
   - Further increase buffer sizes
   - Check network stability
   - Consider reducing sample rate to 96kHz
   - Check if DAC firmware needs updating

## Notes

- **Buffer size vs. latency trade-off**: Larger buffers = less dropouts but more latency
- **UPnP bridge overhead**: The UPnP bridge adds some latency - this is normal
- **dCS Varese compatibility**: Since it doesn't officially support Squeeze, some dropouts may be unavoidable
- **Network is critical**: Wired connection is strongly recommended for high-res audio

---

**Priority Settings** (fix these first):
1. ✅ Increase buffer size to 8192 frames
2. ✅ Disable all transcoding
3. ✅ Set streaming buffer to 100%
4. ✅ Use wired Ethernet connection


