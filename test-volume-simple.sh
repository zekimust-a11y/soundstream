#!/bin/bash
# Simple volume control test

echo "🧪 Testing Android Mosaic Volume Control"
echo "========================================"
echo ""

echo "📱 Make sure the emulator is visible and Mosaic ACTUS is open"
echo ""

echo "1️⃣ Getting current status..."
curl -s http://localhost:3000/api/android-mosaic/status | jq '.'
echo ""

echo "2️⃣ Sending volume UP command (5 steps)..."
echo "   Watch the emulator - you should see:"
echo "   - Volume display tapped (bottom right)"
echo "   - Volume control screen appears"
echo "   - Volume up button tapped 5 times"
echo ""
curl -s -X POST http://localhost:3000/api/android-mosaic/volume \
  -H "Content-Type: application/json" \
  -d '{"action": "up", "value": 5}' | jq '.'
echo ""

echo "⏳ Waiting 4 seconds for changes to take effect..."
sleep 4

echo ""
echo "3️⃣ Getting updated status..."
curl -s http://localhost:3000/api/android-mosaic/status | jq '.'
echo ""

echo "✅ Test complete!"
echo ""
echo "Did you see the volume change in Mosaic ACTUS?"
echo "  - The volume display should have changed"
echo "  - The volume control screen should have appeared"
echo "  - The volume value should have increased"


