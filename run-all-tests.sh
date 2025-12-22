#!/bin/bash

# Test script runner for dCS Varese volume control
# Run this script to test all volume control methods

echo "=========================================="
echo "  dCS Varese Volume Control Tests"
echo "=========================================="
echo ""

DAC_IP="192.168.0.42"
DAC_PORT="16500"

echo "1. Discovering UPnP services on dCS Varese..."
echo "-------------------------------------------"
node discover-upnp-services.js $DAC_IP $DAC_PORT
echo ""

echo "2. Testing direct volume control (GET)..."
echo "-------------------------------------------"
node test-dcs-direct-volume.js $DAC_IP $DAC_PORT get
echo ""

echo "3. Testing direct volume control (SET to 50%)..."
echo "-------------------------------------------"
node test-dcs-direct-volume.js $DAC_IP $DAC_PORT set 50
echo ""

echo "4. Testing via server proxy (GET)..."
echo "-------------------------------------------"
node test-dcs-volume-via-server.js $DAC_IP $DAC_PORT get
echo ""

echo "5. Testing via server proxy (SET to 50%)..."
echo "-------------------------------------------"
node test-dcs-volume-via-server.js $DAC_IP $DAC_PORT set 50
echo ""

echo "=========================================="
echo "  Tests Complete"
echo "=========================================="


















