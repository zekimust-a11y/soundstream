#!/bin/bash
# Test script for Android Mosaic ACTUS Relay

echo "🧪 Testing Android Mosaic ACTUS Relay"
echo ""

# Check if server is running
if ! curl -s http://localhost:3000/api/android-mosaic/status > /dev/null 2>&1; then
  echo "❌ Server not running or relay not enabled"
  echo "   Make sure:"
  echo "   1. Server is running (npm run server:dev)"
  echo "   2. ENABLE_ANDROID_MOSAIC_RELAY=true is set"
  exit 1
fi

echo "✅ Server is running"
echo ""

# Test 1: Get status
echo "📊 Test 1: Get relay status"
curl -s http://localhost:3000/api/android-mosaic/status | jq '.' || echo "Failed"
echo ""

# Test 2: Get current volume
echo "🔊 Test 2: Get current volume"
curl -s -X POST http://localhost:3000/api/android-mosaic/volume \
  -H "Content-Type: application/json" \
  -d '{"action": "get"}' | jq '.' || echo "Failed"
echo ""

# Test 3: Volume up
echo "⬆️  Test 3: Volume up (5 steps)"
curl -s -X POST http://localhost:3000/api/android-mosaic/volume \
  -H "Content-Type: application/json" \
  -d '{"action": "up", "value": 5}' | jq '.' || echo "Failed"
echo ""

sleep 2

# Test 4: Volume down
echo "⬇️  Test 4: Volume down (3 steps)"
curl -s -X POST http://localhost:3000/api/android-mosaic/volume \
  -H "Content-Type: application/json" \
  -d '{"action": "down", "value": 3}' | jq '.' || echo "Failed"
echo ""

sleep 2

# Test 5: Set specific volume
echo "🎚️  Test 5: Set volume to 50%"
curl -s -X POST http://localhost:3000/api/android-mosaic/volume \
  -H "Content-Type: application/json" \
  -d '{"action": "set", "value": 50}' | jq '.' || echo "Failed"
echo ""

echo "✅ Tests complete!"
echo ""
echo "💡 Check the emulator to see if volume changed in Mosaic ACTUS app"


