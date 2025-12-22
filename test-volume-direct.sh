#!/bin/bash
# Direct volume control test script

export PATH="$PATH:$HOME/Library/Android/sdk/platform-tools"

echo "🧪 DIRECT VOLUME CONTROL TEST"
echo "=============================="
echo ""

# Make sure Mosaic ACTUS is open
echo "1️⃣ Opening Mosaic ACTUS app..."
adb -s emulator-5554 shell am start -n uk.co.dcsltd.mosaic2/uk.co.dcsltd.mosaic2.MainActivity
sleep 2

# Get initial volume
echo ""
echo "2️⃣ Getting initial volume display..."
adb -s emulator-5554 shell uiautomator dump /sdcard/ui-before.xml
adb -s emulator-5554 pull /sdcard/ui-before.xml /tmp/ui-before.xml 2>/dev/null
INITIAL_VOL=$(grep -oP 'content-desc="[^"]*-[0-9]+\.[0-9]+[^"]*dB[^"]*"' /tmp/ui-before.xml | head -1 | grep -oP '-[0-9]+\.[0-9]+' || echo "unknown")
echo "   Initial volume: $INITIAL_VOL dB"

# Test volume up button
echo ""
echo "3️⃣ Tapping Volume Up button at (540, 1146)..."
adb -s emulator-5554 shell input tap 540 1146
sleep 1
adb -s emulator-5554 shell input tap 540 1146
sleep 1
adb -s emulator-5554 shell input tap 540 1146
sleep 1

# Get updated volume
echo ""
echo "4️⃣ Getting updated volume display..."
adb -s emulator-5554 shell uiautomator dump /sdcard/ui-after.xml
adb -s emulator-5554 pull /sdcard/ui-after.xml /tmp/ui-after.xml 2>/dev/null
UPDATED_VOL=$(grep -oP 'content-desc="[^"]*-[0-9]+\.[0-9]+[^"]*dB[^"]*"' /tmp/ui-after.xml | head -1 | grep -oP '-[0-9]+\.[0-9]+' || echo "unknown")
echo "   Updated volume: $UPDATED_VOL dB"

# Compare
echo ""
if [ "$INITIAL_VOL" != "$UPDATED_VOL" ] && [ "$INITIAL_VOL" != "unknown" ] && [ "$UPDATED_VOL" != "unknown" ]; then
  echo "✅ SUCCESS! Volume changed from $INITIAL_VOL dB to $UPDATED_VOL dB"
else
  echo "❌ Volume did not change (or couldn't detect change)"
  echo "   This could mean:"
  echo "   - Button coordinates are wrong"
  echo "   - Buttons need different interaction (long press, swipe)"
  echo "   - App needs to be in a specific state"
  echo ""
  echo "   👀 Please check the emulator manually - did you see the volume change?"
fi

echo ""
echo "5️⃣ Testing Volume Down button at (540, 1581)..."
adb -s emulator-5554 shell input tap 540 1581
sleep 1

echo ""
echo "✅ Test complete! Check the emulator to see if volume changed."


