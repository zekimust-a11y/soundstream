#!/bin/bash

# Keep-Alive Script for Soundstream Services
# Monitors and restarts services if they crash
# Run this in the background: nohup ./keep-alive.sh > /tmp/keep-alive.log 2>&1 &

SOUNDSTREAM_DIR="$HOME/Documents/Soundstream-server/soundstream"
API_PORT=3000
EXPO_PORT=8081
CHECK_INTERVAL=30  # Check every 30 seconds

cd "$SOUNDSTREAM_DIR" || exit 1

echo "[$(date)] Keep-Alive script started"

while true; do
    # Check API Server
    if ! lsof -i :${API_PORT} -sTCP:LISTEN > /dev/null 2>&1; then
        echo "[$(date)] ❌ API Server down, restarting..."
        pkill -f "tsx server/index.ts" 2>/dev/null
        sleep 2
        nohup env PATH=/usr/local/bin:$PATH /usr/local/bin/npm exec tsx server/index.ts > /tmp/soundstream-api.log 2>&1 &
        echo "[$(date)] ✅ API Server restarted (PID: $!)"
    fi
    
    # Check Expo Server
    if ! lsof -i :${EXPO_PORT} -sTCP:LISTEN > /dev/null 2>&1; then
        echo "[$(date)] ❌ Expo Server down, restarting..."
        pkill -f "expo start --port ${EXPO_PORT}" 2>/dev/null
        sleep 2
        nohup env PATH=/usr/local/bin:$PATH EXPO_PUBLIC_DOMAIN=192.168.0.21:3000 /usr/local/bin/npx expo start --port ${EXPO_PORT} > /tmp/expo_web.log 2>&1 &
        echo "[$(date)] ✅ Expo Server restarted (PID: $!)"
    fi
    
    sleep ${CHECK_INTERVAL}
done

