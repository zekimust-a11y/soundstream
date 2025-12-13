# How to Download Mosaic ACTUS APK

## Official Sources

### 1. dCS Website
- **URL**: https://www.dcsltd.co.uk/support/software/
- Look for "Mosaic" or "Mosaic ACTUS" section
- Download Android APK version

### 2. dCS Support
- Email: support@dcsltd.co.uk
- Ask for: "Mosaic ACTUS Android APK download link"
- They may provide direct download or instructions

## Alternative Methods

### 3. Extract from Android Device
If you have an Android device with Mosaic ACTUS installed:

**Using ADB:**
```bash
# Find the package name
adb shell pm list packages | grep -i mosaic

# Extract APK (replace package.name with actual package)
adb shell pm path com.dcs.mosaic
adb pull /data/app/com.dcs.mosaic-*/base.apk mosaic-actus.apk
```

**Using APK Extractor App:**
- Install "APK Extractor" from Play Store
- Open app → Find Mosaic ACTUS → Extract
- Share/save the APK file

### 4. APK Download Sites (Use with Caution)
- **APKPure**: https://apkpure.com (search "dCS Mosaic")
- **APKMirror**: https://www.apkmirror.com (search "Mosaic ACTUS")
- ⚠️ Only download from trusted sources
- Verify checksums if available

### 5. Google Play Store (if available)
- Search "Mosaic ACTUS" in Play Store
- Use tools like "APK Downloader" to get APK from Play Store link
- Or use: https://apps.evozi.com/apk-downloader/

## Once You Have the APK

1. **Save it somewhere accessible**, e.g.:
   ```bash
   ~/Downloads/mosaic-actus.apk
   ```

2. **Tell me the path** and I'll install it:
   ```bash
   adb install ~/Downloads/mosaic-actus.apk
   ```

3. **Or drag and drop** the APK file onto the emulator window

## Quick Check

To see if you already have it somewhere:
```bash
find ~ -name "*mosaic*.apk" -o -name "*actus*.apk" 2>/dev/null
```


