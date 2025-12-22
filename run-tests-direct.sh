#!/usr/bin/env bash
# Direct test runner that bypasses shell issues

cd "/Users/zeki/Documents/Audio Streamer Cursor/soundstream" || exit 1

echo "=========================================="
echo "  Testing dCS Varese Volume Control"
echo "=========================================="
echo ""

echo "1. Inspecting Squeezelite UPnP bridge..."
echo "-------------------------------------------"
node inspect-squeezelite-upnp.js
echo ""

echo "2. Testing Squeezelite's method..."
echo "-------------------------------------------"
node test-squeezelite-method.js
echo ""

echo "3. Discovering dCS Varese UPnP services..."
echo "-------------------------------------------"
node discover-upnp-services.js 192.168.0.42 16500
echo ""

echo "4. Testing direct volume control (GET)..."
echo "-------------------------------------------"
node test-dcs-direct-volume.js 192.168.0.42 16500 get
echo ""

echo "5. Testing direct volume control (SET 50%)..."
echo "-------------------------------------------"
node test-dcs-direct-volume.js 192.168.0.42 16500 set 50
echo ""

echo "=========================================="
echo "  Tests Complete"
echo "=========================================="


















