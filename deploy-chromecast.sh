#!/bin/bash

# Deploy chromecast-service.js to .21 server
# Run this script to copy the updated chromecast service

SOURCE_FILE="$HOME/My Drive/Personal/APPS/Soundstream/soundstream/server/chromecast-service.js"
DEST_PATH="~/Documents/Soundstream-server/soundstream/server/chromecast-service.js"
SERVER="zeki@192.168.0.21"

echo "📦 Deploying chromecast-service.js to .21 server..."

# Try with the soundstream SSH key
scp -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519_soundstream "$SOURCE_FILE" "$SERVER:$DEST_PATH" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ File deployed successfully!"
    echo ""
    echo "Now restart the API server:"
    echo "  ssh $SERVER"
    echo "  cd ~/Documents/Soundstream-server/soundstream"
    echo "  killall -9 node tsx"
    echo "  nohup env PATH=/usr/local/bin:\$PATH /usr/local/bin/npm exec -- tsx server/index.ts > /tmp/soundstream-api.log 2>&1 &"
else
    echo "❌ SCP failed. Trying alternative method..."
    
    # Alternative: Use cat over SSH
    ssh -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519_soundstream "$SERVER" "cat > $DEST_PATH" < "$SOURCE_FILE" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ File deployed successfully via SSH!"
    else
        echo "❌ Could not deploy file automatically."
        echo ""
        echo "Manual steps:"
        echo "1. Copy the file manually:"
        echo "   Source: $SOURCE_FILE"
        echo "   Destination: $SERVER:$DEST_PATH"
        echo ""
        echo "2. Or display the file content to copy manually:"
        echo "   cat '$SOURCE_FILE'"
    fi
fi

