# SoundStream Deployment Notes

## Environment Configuration

### EXPO_PUBLIC_DOMAIN Configuration

The `EXPO_PUBLIC_DOMAIN` environment variable is critical for native iOS/Android apps to connect to the development server for features like color extraction from album artwork.

#### Current Development Setup

- **Local IP Address**: `192.168.0.65:3000`
- **Configuration Files**:
  - `.env` file contains: `EXPO_PUBLIC_DOMAIN=192.168.0.65:3000`
  - `app.config.js` reads from `.env` and sets `extra.serverUrl`
  - `app.json` includes fallback server URL in `extra` field

#### For Local Development

Use the provided npm scripts:
```bash
# Start Expo with local IP configured
npm run expo:dev:local

# Start both server and Expo with local IP
npm run all:dev:local
```

#### For Production/Deployment

**Important**: Update `EXPO_PUBLIC_DOMAIN` to your production server URL:

1. **Update `.env` file**:
   ```
   EXPO_PUBLIC_DOMAIN=your-production-domain.com:3000
   ```

2. **Or set environment variable** when building:
   ```bash
   EXPO_PUBLIC_DOMAIN=your-production-domain.com:3000 npx expo build
   ```

3. **For EAS Build**, add to `eas.json`:
   ```json
   {
     "build": {
       "production": {
         "env": {
           "EXPO_PUBLIC_DOMAIN": "your-production-domain.com:3000"
         }
       }
     }
   }
   ```

#### Notes

- The `.env` file is gitignored to keep local IPs out of version control
- If `EXPO_PUBLIC_DOMAIN` is not set, the app falls back to hash-based color extraction (less accurate but still functional)
- The server endpoint `/api/color/extract` must be accessible from the mobile device
- For local development, ensure your Mac and iOS device are on the same network
- The IP address `192.168.0.65` may change if your network configuration changes - update `.env` accordingly

#### Troubleshooting

If color extraction isn't working on native:
1. Check that `EXPO_PUBLIC_DOMAIN` is set correctly
2. Verify the server is running and accessible at that address
3. Check network connectivity between device and server
4. Review console logs for network errors
5. The app will automatically fall back to hash-based colors if server is unreachable
















