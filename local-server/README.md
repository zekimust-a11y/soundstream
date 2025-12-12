# SoundStream Display Server

A standalone server that displays Now Playing information from your Logitech Media Server (LMS) and automatically casts to Chromecast when music starts playing.

## Features

- **Now Playing Display**: Beautiful full-screen display showing album art, track info, and progress
- **LMS Integration**: Connects to your LMS server and polls for playback status
- **Chromecast Auto-Casting**: Automatically starts casting when you press play on LMS
- **Smart Pause Detection**: Stops casting after 5 seconds of pause (configurable)
- **Background Operation**: Runs continuously, always ready to cast

## Quick Start

### Prerequisites
- Node.js installed (https://nodejs.org)
- Logitech Media Server running on your network
- (Optional) Chromecast for auto-casting

### Installation

1. Copy the `local-server` folder to a computer on your local network

2. Install dependencies:
   ```bash
   cd local-server
   npm install
   ```

3. Set environment variables and start:
   ```bash
   # Linux/Mac
   export LMS_HOST=192.168.0.19
   export CHROMECAST_IP=192.168.0.50
   npm start

   # Windows PowerShell
   $env:LMS_HOST="192.168.0.19"
   $env:CHROMECAST_IP="192.168.0.50"
   npm start
   ```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `LMS_HOST` | IP address of your LMS server | `192.168.0.19` |
| `LMS_PORT` | LMS port | `9000` |
| `CHROMECAST_IP` | IP address of your Chromecast | (none) |
| `PAUSE_TIMEOUT` | Milliseconds to wait before stopping cast on pause | `5000` |
| `PORT` | Server port | `5000` |

## How It Works

1. **Server starts** and connects to your LMS server
2. **Polls LMS** every 2 seconds to check playback status
3. **When play starts**: Automatically casts the Now Playing page to your Chromecast
4. **When paused for 5+ seconds**: Stops casting to save power
5. **When play resumes**: Starts casting again

## Finding Your Chromecast IP

1. Open the Google Home app on your phone
2. Tap on your Chromecast device
3. Tap the gear icon (settings)
4. Scroll down to find the IP address

Or check your router's connected devices list.

## Running as a Background Service

### Using systemd (Linux/Raspberry Pi)

Create `/etc/systemd/system/soundstream-display.service`:

```ini
[Unit]
Description=SoundStream Display Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/local-server
Environment=LMS_HOST=192.168.0.19
Environment=CHROMECAST_IP=192.168.0.50
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable soundstream-display
sudo systemctl start soundstream-display
```

### Using PM2 (Cross-platform)

```bash
npm install -g pm2
LMS_HOST=192.168.0.19 CHROMECAST_IP=192.168.0.50 pm2 start server.js --name soundstream-display
pm2 save
pm2 startup
```

## Manual Casting (Without Auto-Cast)

If you don't set CHROMECAST_IP, you can still cast manually:

1. Open Chrome on your PC
2. Go to `http://localhost:5000`
3. Enter your LMS server IP and click "Launch Now Playing Display"
4. Click Chrome menu (three dots) > Cast
5. Select your Chromecast or TV

### Direct URL

Bookmark this for quick access:
```
http://<SERVER_IP>:5000/now-playing?host=<LMS_IP>&port=9000
```

## API Endpoints

- `GET /` - Home page with setup form
- `GET /now-playing` - Full-screen Now Playing display
- `GET /api/status` - Current server status (JSON)
- `GET /api/chromecasts` - Discover Chromecast devices on the network (requires mdns-js)

## IR Remote Control (Flirc USB)

Use any IR remote to control your music with a Flirc USB adapter.

### What is Flirc?

Flirc USB is a small device that plugs into your computer and receives infrared signals from any remote control, converting them to keyboard presses. This lets you use a TV remote, universal remote, or any IR remote to control LMS playback.

### Setup

1. **Get a Flirc USB** from [flirc.tv](https://flirc.tv)

2. **Install Flirc software** on your computer

3. **Program your remote** using the Flirc software:
   - Open Flirc app
   - Go to Controllers → Full Keyboard
   - Click a key, then press the corresponding button on your remote
   - Recommended mappings:

   | Remote Button | Program to Key | Action |
   |---------------|----------------|--------|
   | Play/Pause | Space or P | Toggle play/pause |
   | Next | Right Arrow or N | Next track |
   | Previous | Left Arrow or B | Previous track |
   | Volume Up | Up Arrow | Volume +5% |
   | Volume Down | Down Arrow | Volume -5% |
   | Mute | M | Toggle mute |
   | Stop | S | Stop playback |
   | Shuffle | R | Toggle shuffle |
   | Preset 1 | 1 | Play first preset |
   | Preset 2 | 2 | Play second preset |
   | Preset 3 | 3 | Play third preset |

4. **Plug Flirc into your server** (Raspberry Pi, PC, etc.)

5. **Start the server in a terminal**:
   ```bash
   LMS_HOST=192.168.0.19 ENABLE_KEYBOARD=true npm start
   ```

### Customizing Key Mappings

Edit `keymap.json` to customize key mappings and presets:

```json
{
  "enabled": true,
  "mappings": {
    "space": { "command": "pause", "description": "Play/Pause" },
    "right": { "command": "next", "description": "Next track" },
    "up": { "command": "volume_up", "value": 5, "description": "Volume +5%" }
  },
  "presets": [
    { "name": "Jazz", "shuffle": true },
    { "name": "Classical", "shuffle": false }
  ]
}
```

### Available Commands

| Command | Value | Description |
|---------|-------|-------------|
| `pause` | - | Toggle play/pause |
| `stop` | - | Stop playback |
| `next` | - | Next track |
| `previous` | - | Previous track |
| `volume_up` | 1-100 | Increase volume |
| `volume_down` | 1-100 | Decrease volume |
| `mute` | - | Toggle mute |
| `shuffle` | - | Toggle shuffle |
| `playlist` | 0-9 | Play preset by index |

### Running as Background Service with IR

When running as a systemd service, you need to configure it to have access to the terminal. Add to your service file:

```ini
[Service]
Environment=ENABLE_KEYBOARD=true
StandardInput=tty
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
```

Alternatively, run in a tmux/screen session for easier access.

## Troubleshooting

### Chromecast not connecting
- Make sure the Chromecast and server are on the same network
- Verify the Chromecast IP is correct
- Some firewalls block Chromecast traffic (port 8009)

### Cast stops unexpectedly
- Chromecast may go to sleep - increase pause timeout
- Check for network stability issues

### LMS not found
- Verify LMS is running and accessible
- Check the LMS_HOST IP address is correct
- Make sure port 9000 is not blocked

### No artwork showing
- Some tracks may not have embedded artwork
- LMS needs artwork in the music files or downloaded

## License

MIT - Feel free to modify for your needs!
