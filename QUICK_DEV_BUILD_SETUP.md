# Quick Development Build Setup

## Why Development Build?

Your app already uses native modules (`react-native-udp`, `react-native-volume-manager`) that don't work in Expo Go. A development build will:
- ✅ Enable hardware volume control
- ✅ Better debugging (native logs, Xcode debugger)
- ✅ All features will work
- ✅ Still get hot reload for JS changes

## Quick Setup (15 minutes)

### 1. Generate iOS Native Code
```bash
npx expo prebuild --platform ios
```

### 2. Install iOS Dependencies
```bash
cd ios
pod install
cd ..
```

### 3. Build and Run on Your iPhone
```bash
npx expo run:ios --device
```

Select your iPhone from the list, and it will build and install.

### 4. Trust Developer Certificate
On your iPhone:
- Settings > General > VPN & Device Management
- Tap your developer certificate
- Tap "Trust"

## After Setup

**Development workflow:**
- JS changes: Hot reload works instantly (just like Expo Go!)
- Native changes: Need to rebuild (but rare)
- Debugging: Use Xcode for native logs, Chrome DevTools for JS

**To start development:**
```bash
npx expo start --dev-client
```

Then open the app on your iPhone - it will connect to the dev server automatically.

## Debugging Benefits

With development build, you get:
1. **Xcode Console**: See all native logs
2. **Chrome DevTools**: Full JS debugging (works same as before)
3. **React Native Debugger**: Better than Expo Go
4. **Native Breakpoints**: Debug native code
5. **Better Error Messages**: More detailed crash reports

## Troubleshooting

**"No devices found"**: 
- Make sure iPhone is unlocked
- Tap "Trust" when prompted

**Build fails**:
- Make sure Xcode is installed and opened at least once
- Run `cd ios && pod install && cd ..` again

**App won't connect to dev server**:
- Make sure iPhone and Mac are on same WiFi
- Check firewall settings


