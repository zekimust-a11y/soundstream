# Build SoundStream on Your Mac

## What You Need
- A Mac with Xcode installed (free from App Store)
- Your iPhone connected with a USB cable
- About 15 minutes

## Step 1: Download Xcode (if you don't have it)
Open the App Store on your Mac, search for "Xcode", and install it. This takes a while (it's big).

## Step 2: Download This Project
1. On this Replit page, click the three dots menu (top right)
2. Click "Download as zip"
3. Unzip the downloaded file on your Mac
4. Open Terminal (search "Terminal" in Spotlight)

## Step 3: Open Terminal and Navigate to the Project
In Terminal, type these commands one at a time (press Enter after each):

```
cd ~/Downloads/soundstream-main
```

(If your folder has a different name, use that name instead)

## Step 4: Install Dependencies
```
npm install
```

Wait for it to finish (1-2 minutes).

## Step 5: Generate iOS Files
```
npx expo prebuild --platform ios --clean
```

Wait for it to finish.

## Step 6: Install iOS Dependencies
```
cd ios
pod install
cd ..
```

## Step 7: Connect Your iPhone
1. Plug your iPhone into your Mac with the USB cable
2. On your iPhone, tap "Trust" if asked
3. Make sure your iPhone is unlocked

## Step 8: Build and Install
```
npx expo run:ios --device
```

This will:
- Ask you to select your iPhone from a list (use arrow keys, press Enter)
- Build the app (takes 5-10 minutes first time)
- Install it on your iPhone

## Step 9: Trust the Developer
On your iPhone:
1. Go to Settings > General > VPN & Device Management
2. Find "Apple Development" under Developer App
3. Tap it and tap "Trust"

## Done!
Open SoundStream on your iPhone. It will now connect directly to your MinimServer and Varese without any bridge needed!

---

## Troubleshooting

**"No devices found"**: Make sure your iPhone is unlocked and you tapped "Trust"

**Build errors**: Make sure Xcode is fully installed. Open Xcode once first to accept the license.

**"Unable to install"**: You may need an Apple Developer account (free at developer.apple.com)
