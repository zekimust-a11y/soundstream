# Remote Debugging Setup for iPhone

This guide will help you set up remote debugging so you can see console logs, debug errors, and inspect your app running on your iPhone.

## Prerequisites

1. **Expo Dev Server Running** - Make sure `npm run expo:dev` is running
2. **iPhone Connected** - Either via Expo Go app or a development build
3. **Same WiFi Network** - Your Mac and iPhone must be on the same network

## Method 1: Expo DevTools (Easiest)

1. **Start the Expo dev server**:
   ```bash
   npm run expo:dev
   ```

2. **Open the app on your iPhone**:
   - If using Expo Go: Scan the QR code
   - If using development build: The app should auto-connect

3. **Access DevTools**:
   - Open the Expo dev server URL in your browser (usually `http://localhost:8081`)
   - Or press `d` in the terminal where Expo is running
   - This opens Expo DevTools in your browser

4. **View Logs**:
   - In Expo DevTools, you'll see console logs from your iPhone
   - Errors will appear in red
   - You can filter logs by level (info, warn, error)

## Method 2: React Native Debugger (Recommended)

1. **Install React Native Debugger**:
   ```bash
   brew install --cask react-native-debugger
   ```
   Or download from: https://github.com/jhen0409/react-native-debugger/releases

2. **Open React Native Debugger**:
   - Launch the app from Applications

3. **Enable Remote Debugging on iPhone**:
   - Shake your iPhone (or use the simulator menu)
   - Tap "Debug" or "Open Developer Menu"
   - Select "Debug with Chrome" or "Debug with React Native Debugger"

4. **View Logs and Debug**:
   - Console logs appear in React Native Debugger
   - You can set breakpoints
   - Inspect network requests
   - View Redux state (if using Redux)

## Method 3: Chrome DevTools

1. **Enable Remote Debugging**:
   - Shake your iPhone (or use the simulator menu)
   - Tap "Debug" or "Open Developer Menu"
   - Select "Debug with Chrome"

2. **Open Chrome DevTools**:
   - Chrome should automatically open to `http://localhost:8081/debugger-ui`
   - If not, navigate there manually

3. **View Console**:
   - Open the Console tab in Chrome DevTools
   - All `console.log()`, `console.error()`, etc. will appear here

## Method 4: Terminal Logs (Quick View)

1. **View logs directly in terminal**:
   - When Expo dev server is running, logs appear in the terminal
   - Look for messages prefixed with device info

2. **Filter logs**:
   - Use `console.log()` in your code
   - Use `debugLog.info()`, `debugLog.error()` from `@/lib/debugLog`
   - Logs will appear in the Expo terminal output

## Quick Access: Developer Menu on iPhone

To open the developer menu on your iPhone:

1. **Physical Device**:
   - Shake your iPhone vigorously
   - Or use a 3-finger tap (if enabled)

2. **Developer Menu Options**:
   - **Reload** - Reload the app
   - **Debug** - Enable remote debugging
   - **Show Perf Monitor** - Show performance metrics
   - **Enable Fast Refresh** - Hot reload on save
   - **Inspector** - Inspect UI elements

## Viewing Specific Logs

The app uses a custom `debugLog` utility. To see logs:

1. **In your code**, use:
   ```typescript
   import { debugLog } from "@/lib/debugLog";
   
   debugLog.info('Volume changed', `${volume}%`);
   debugLog.error('Failed to connect', error.message);
   ```

2. **Logs will appear in**:
   - Expo DevTools console
   - React Native Debugger
   - Chrome DevTools console
   - Terminal (Expo dev server output)

## Troubleshooting

### "Cannot connect to debugger"
- Make sure your Mac and iPhone are on the same WiFi network
- Check that port 8081 is not blocked by firewall
- Try restarting the Expo dev server

### "Remote debugging not working"
- Make sure you've enabled remote debugging in the developer menu
- Close and reopen the debugger
- Try Method 2 (React Native Debugger) instead

### "No logs appearing"
- Check that `console.log()` or `debugLog` is being called
- Make sure remote debugging is enabled
- Try reloading the app (shake device > Reload)

## Network Debugging

To see network requests:

1. **In Chrome DevTools**:
   - Open Network tab
   - Filter by XHR/Fetch
   - See all API calls to your server

2. **In React Native Debugger**:
   - Network tab shows all requests
   - Can inspect request/response headers and bodies

## Performance Monitoring

1. **Enable Perf Monitor**:
   - Shake device > "Show Perf Monitor"
   - Shows FPS, memory usage, etc.

2. **React DevTools Profiler**:
   - Install React DevTools browser extension
   - Profile component renders and performance

## Tips

- **Keep DevTools open** while developing for instant feedback
- **Use `debugLog`** instead of `console.log` for better formatting
- **Filter logs** by component or feature for easier debugging
- **Enable "Preserve log"** in Chrome DevTools to keep logs after page reload


