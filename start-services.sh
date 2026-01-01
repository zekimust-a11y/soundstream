#!/bin/bash

# Soundstream Service Startup Script
# This ensures both API server (port 3000) and Expo server (port 8081) stay running

cd ~/Documents/Soundstream-server/soundstream

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting Soundstream Services...${NC}"

# Kill any existing services
echo "Stopping existing services..."
pkill -f "tsx server/index.ts" 2>/dev/null
pkill -f "expo start --port 8081" 2>/dev/null
sleep 2

# Start API Server (port 3000)
echo -e "${GREEN}Starting API Server on port 3000...${NC}"
nohup env PATH=/usr/local/bin:$PATH /usr/local/bin/npm exec tsx server/index.ts > /tmp/soundstream-api.log 2>&1 &
API_PID=$!
echo "API Server PID: $API_PID"

# Wait for API server to be ready
sleep 3

# Start Expo Server (port 8081)
echo -e "${GREEN}Starting Expo Server on port 8081...${NC}"
nohup env PATH=/usr/local/bin:$PATH EXPO_PUBLIC_DOMAIN=192.168.0.21:3000 /usr/local/bin/npm exec -- expo start --port 8081 > /tmp/soundstream-expo.log 2>&1 &
EXPO_PID=$!
echo "Expo Server PID: $EXPO_PID"

# Wait for services to start
sleep 5

# Check if services are running
echo ""
echo -e "${YELLOW}Checking services...${NC}"

if lsof -i :3000 | grep -q LISTEN; then
    echo -e "${GREEN}✓ API Server (port 3000): Running${NC}"
else
    echo -e "${RED}✗ API Server (port 3000): Not running${NC}"
fi

if lsof -i :8081 | grep -q LISTEN; then
    echo -e "${GREEN}✓ Expo Server (port 8081): Running${NC}"
else
    echo -e "${RED}✗ Expo Server (port 8081): Not running${NC}"
fi

echo ""
echo -e "${GREEN}Services started!${NC}"
echo "  - API Server:  http://192.168.0.21:3000"
echo "  - Web App:     http://192.168.0.21:8081"
echo ""
echo "Logs:"
echo "  - API:  tail -f /tmp/soundstream-api.log"
echo "  - Expo: tail -f /tmp/soundstream-expo.log"
