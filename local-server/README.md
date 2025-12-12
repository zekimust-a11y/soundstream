# SoundStream Display Server

A simple local server that displays "Now Playing" information from your Logitech Media Server on your TV or Chromecast.

## Quick Start

### Prerequisites
- Node.js installed on your PC (https://nodejs.org)
- A Logitech Media Server running on your network

### Installation

1. Copy this entire `local-server` folder to your PC

2. Open a terminal/command prompt in the folder

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start the server:
   ```bash
   npm start
   ```

5. Open in browser:
   ```
   http://localhost:5000
   ```

### Casting to TV

1. Open Chrome on your PC
2. Go to `http://localhost:5000`
3. Enter your LMS server IP and click "Launch Now Playing Display"
4. Click the three dots menu in Chrome > Cast
5. Select your Chromecast or TV

### Direct URL

You can also bookmark this URL for quick access:
```
http://<YOUR_PC_IP>:5000/now-playing?host=<LMS_IP>&port=9000&player=<PLAYER_MAC>
```

Example:
```
http://192.168.0.100:5000/now-playing?host=192.168.0.19&port=9000
```

### Finding Your Player MAC

1. Open LMS web interface: `http://<LMS_IP>:9000`
2. Go to Settings > Player
3. The MAC address is shown for each player

Or leave the `player` parameter empty to auto-select the first available player.

## Troubleshooting

**"Cannot connect to LMS server"**
- Make sure LMS is running
- Check the IP address and port
- Ensure your PC can reach the LMS server

**Display not updating**
- Check that music is playing on your Squeezebox player
- Refresh the page

**No artwork showing**
- Some tracks may not have embedded artwork
- LMS needs artwork in the music files or downloaded

## License

MIT - Feel free to modify for your needs!
