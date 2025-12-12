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
