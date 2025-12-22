#!/bin/bash
echo 🚀 Starting SoundStream Expo Server...
export EXPO_PUBLIC_DOMAIN=192.168.0.21:3000
echo 📡 API Server: 
/usr/local/bin/node node_modules/.bin/expo start --web --port 8081 --host lan --clear
