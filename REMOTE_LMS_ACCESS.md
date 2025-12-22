# Remote LMS Access Setup Guide

This guide explains how to access your LMS (Logitech Media Server) from SoundStream when you're not on your local network, without using a VPN.

## Overview

SoundStream now supports remote LMS access using HTTPS and hostnames. This allows you to control your music server from anywhere in the world.

## Prerequisites

1. **LMS Server** must be running and accessible
2. **Network Configuration** - Your LMS server must be reachable from the internet
3. **HTTPS** (recommended) - For secure remote connections

## Step 1: Enable Remote Access in LMS

1. Open LMS web interface (usually `http://your-server-ip:9000`)
2. Go to **Settings** → **Advanced** → **Network**
3. Enable **Allow remote access** or **Allow remote streaming**
4. Note the port (default is 9000)
5. Save settings

## Step 2: Make LMS Accessible from Internet

You have several options:

### Option A: Port Forwarding (Simple but less secure)

1. On your router, forward port 9000 (or your LMS port) to your LMS server's local IP
2. Find your public IP address (visit `whatismyip.com`)
3. Use your public IP with the forwarded port

**Security Note:** This exposes LMS directly to the internet. Consider using HTTPS and authentication.

### Option B: Reverse Proxy with HTTPS (Recommended)

Use a reverse proxy (Nginx, Caddy, or Cloudflare Tunnel) to:
- Add HTTPS encryption
- Add authentication
- Hide your public IP

**Example with Caddy:**
```
lms.yourdomain.com {
    reverse_proxy localhost:9000
}
```

### Option C: Cloudflare Tunnel (Most Secure)

1. Install `cloudflared` on your server
2. Create a tunnel: `cloudflared tunnel create lms`
3. Configure tunnel to forward to `localhost:9000`
4. Run tunnel: `cloudflared tunnel run lms`
5. Use the provided `*.trycloudflare.com` URL or your own domain

## Step 3: Configure SoundStream

### For iOS (Native App)

1. Open SoundStream app
2. Go to **Settings**
3. Under **New LMS Connection**, enter your remote URL:
   - **Format:** `https://lms.example.com:9000` or `https://your-public-ip:9000`
   - **Examples:**
     - `https://lms.mydomain.com:9000`
     - `https://123.45.67.89:9000` (if using port forwarding)
     - `https://lms-abc123.trycloudflare.com:9000` (Cloudflare Tunnel)
4. Leave the port field empty (it's included in the URL)
5. Tap **Connect**

### For Web

The web version uses the same proxy server, so remote URLs work the same way.

## Connection Formats

SoundStream supports two connection formats:

### 1. Full URL (for remote access)
```
https://lms.example.com:9000
http://lms.example.com:9000
https://123.45.67.89:9000
```

### 2. IP + Port (for local access)
```
IP: 192.168.0.100
Port: 9000
```

## Security Considerations

1. **Use HTTPS** - Always use `https://` for remote connections to encrypt your traffic
2. **Authentication** - Consider adding authentication to your LMS or reverse proxy
3. **Firewall** - Only open necessary ports
4. **VPN Alternative** - For maximum security, consider using a VPN instead of exposing LMS directly

## Troubleshooting

### Connection Fails

1. **Check LMS is running** - Verify LMS is accessible locally
2. **Check firewall** - Ensure port 9000 (or your port) is open
3. **Check router** - Verify port forwarding is configured correctly
4. **Test URL** - Try accessing the URL in a web browser first
5. **Check HTTPS** - If using HTTPS, ensure certificate is valid

### "Network request failed"

- Verify the URL is correct (include `https://` or `http://`)
- Check if the server is reachable from your current network
- Try accessing the URL in a browser to verify connectivity

### "Request timeout"

- The server may be slow or unreachable
- Check your internet connection
- Verify the server is running and accessible

## Example Configurations

### Local Network (Same WiFi)
```
IP: 192.168.0.100
Port: 9000
```

### Remote with Port Forwarding
```
URL: https://123.45.67.89:9000
```

### Remote with Domain + Reverse Proxy
```
URL: https://lms.mydomain.com
```

### Remote with Cloudflare Tunnel
```
URL: https://lms-abc123.trycloudflare.com
```

## Notes

- **Local connections** still work as before (IP + Port format)
- **Remote connections** require full URL format (`https://hostname:port`)
- The app automatically detects which format you're using
- HTTPS is strongly recommended for remote access
- Some networks (corporate, public WiFi) may block certain ports

## LMS Remote Access Features

LMS has built-in remote access capabilities:
- **Remote Library** - Access your music library from anywhere
- **Remote Control** - Control players remotely
- **Streaming** - Stream music over the internet (may require transcoding)

Make sure these features are enabled in your LMS settings.














