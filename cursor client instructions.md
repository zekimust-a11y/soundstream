# Cursor Client Instructions

## Important: Always check this file first before executing any command

This file contains specific instructions for how to handle commands and requests in this project.

---

## Server Management

### 1. Server Restart
**When the user says "restart server" or any variation:**
- **YOU must run the restart commands, NOT the user**
- Kill any existing server processes
- Start the server using the appropriate npm script
- Verify the server is running before confirming completion

**Commands to use:**
```bash
# Kill existing processes
pkill -f "tsx.*server" 2>/dev/null; pkill -f "node.*server" 2>/dev/null

# Start server
cd /Users/zeki/Documents/Audio\ Streamer\ Cursor/soundstream
npm run server:dev
```

**Always verify server is running:**
```bash
sleep 3 && curl -s http://localhost:3000/api/health
```

**Periodically check if API server is running:**
- Check every 30-60 seconds if API server is responding on port 3000
- If server is not running or not responding:
  - Investigate why it stopped (check processes, port usage, logs)
  - **Notify the user** with details about what was found
  - Kill any existing server processes
  - Restart the server automatically
  - Verify the restart was successful
  - Log the restart action and reason

**Commands to use:**
```bash
# Check if server is running
curl -s http://localhost:3000/api/health

# Check if port is in use
lsof -ti:3000

# Check for server processes
ps aux | grep -E "(tsx.*server|node.*server)" | grep -v grep

# Kill and restart server
pkill -f "tsx.*server" 2>/dev/null; pkill -f "node.*server" 2>/dev/null; sleep 2
cd /Users/zeki/Documents/Audio\ Streamer\ Cursor/soundstream && npm run server:dev
```

### 2. Metro Bundler Management
**ALWAYS start Metro bundler automatically:**
- **YOU must start Metro bundler, NOT the user**
- Metro bundler serves the web app directly at `http://localhost:8081`
- Start Metro using: `npm run expo:dev:local`
- Metro should run on port 8081
- **Web app is accessed directly at localhost:8081, NOT through the proxy server**

**Periodically check if Metro is running:**
- Check every 30-60 seconds if Metro is responding on port 8081
- If Metro is not running or not responding:
  - Kill any existing Metro processes
  - Restart Metro bundler automatically
  - Log the restart action

### 3. LMS Server Health Checks
**LMS Server Configuration:**
- **LMS IP Address**: 192.168.0.19 (updated from .21)
- **LMS Port**: 9000 (default)
- **LMS URL**: http://192.168.0.19:9000

**Periodically check if LMS is reachable:**
- Check every 30-60 seconds if LMS is responding on 192.168.0.19:9000
- Test by calling: `curl -s http://192.168.0.19:9000/jsonrpc.js` with a simple status request
- If LMS is not reachable:
  - Log the error: "[LMS Health Check] LMS server at 192.168.0.19:9000 is not reachable"
  - Notify the user immediately: "⚠️ LMS server at 192.168.0.19:9000 is not reachable"
  - Continue checking periodically

**Commands to use:**
```bash
# Check if LMS is reachable
curl -s -X POST http://192.168.0.19:9000/jsonrpc.js \
  -H "Content-Type: application/json" \
  -d '{"id":1,"method":"slim.request","params":["",["serverstatus","0","0"]]}' \
  -w "%{http_code}" -o /dev/null

# Or simpler check
curl -s -o /dev/null -w "%{http_code}" http://192.168.0.19:9000/ 2>&1
```

**During periodic checks, ALWAYS:**
- Connect to browser at http://localhost:3000 (API server) and http://localhost:8081 (web app)
- Check browser console logs for errors
- Check network requests for failed requests
- Check LMS server reachability at 192.168.0.19:9000
- Fix any errors found immediately
- Verify the web app is loading correctly at localhost:8081
- **Notify user if LMS is not reachable**

**Commands to use:**
```bash
# Check if Metro is running
curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/ 2>&1

# Kill Metro processes
pkill -f "expo.*start" 2>/dev/null; pkill -f "metro" 2>/dev/null

# Start Metro bundler
cd /Users/zeki/Documents/Audio\ Streamer\ Cursor/soundstream
npm run expo:dev:local
```

**When starting servers, ALWAYS start both:**
1. Proxy server (port 3000)
2. Metro bundler (port 8081)

**Important Notes:**
- Metro bundler may take 15-30 seconds to fully start
- Check Metro status by: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/`
- If Metro fails to start due to permissions, use: `npx expo start --localhost` directly
- **Web app is accessed directly at http://localhost:8081 (Metro's port), NOT through the proxy server**
- Port 3000 is for API routes and server functionality only

---

## General Principles

1. **Always check this file first** before executing any user command
2. **Run server commands yourself** - don't ask the user to run them
3. **Verify operations** - check that commands succeeded before reporting completion
4. **Be proactive** - if a server needs restarting, do it automatically when fixing issues
5. **Always start Metro bundler** - Metro is required for web app functionality
6. **Periodically check Metro** - Every 30-60 seconds, check if Metro is running on port 8081
7. **Auto-restart Metro** - If Metro is not running, automatically restart it
8. **Periodically check API server** - Every 30-60 seconds, check if API server is running on port 3000
9. **Investigate and restart API server** - If API server stops, investigate why (check processes, port, logs), notify user with details, and restart it
10. **Periodically check LMS** - Every 30-60 seconds, check if LMS server at 192.168.0.19:9000 is reachable
11. **Notify if LMS unreachable** - If LMS is not reachable, immediately notify the user

---

## Additional Instructions

### Content Sources
**The app displays content from 5 sources, all available via LMS:**
1. **Qobuz** - via LMS plugin
2. **Tidal** - via LMS plugin  
3. **SoundCloud** - via LMS plugin
4. **Spotify** - via LMS plugin
5. **Music folder** - local LMS library

**Important Notes:**
- All content sources are controlled by integration toggles in Settings
- When a toggle is off, content from that service should not appear anywhere in the app
- Tidal, Spotify, and SoundCloud commands must be in the allowed commands list in `server/routes.ts`
- Never tell the user the server needs to be restarted - just restart it automatically

### Server Restart Policy
**CRITICAL: Never tell the user to restart the server**
- If code changes require a server restart, automatically restart it yourself
- Use the commands in section 1 above to kill and restart
- Verify the restart was successful before continuing
- This applies to any server-related changes (routes, proxy settings, etc.)

_More instructions will be added here as needed._

