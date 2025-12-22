const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 8081;

// Serve the SoundStream web app interface
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'simple-web-app.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>SoundStream Web</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; background: #1a1a1a; color: white; text-align: center; }
          h1 { color: #007AFF; }
          .status { margin: 20px 0; padding: 20px; background: rgba(255,255,255,0.1); border-radius: 8px; }
        </style>
      </head>
      <body>
        <h1>🎵 SoundStream Web Interface</h1>
        <div class="status">
          <h2>Status: Web App Demo Active</h2>
          <p>The SoundStream web interface is now accessible at this URL.</p>
          <p>Features available:</p>
          <ul style="text-align: left; display: inline-block;">
            <li>✅ Browse music library</li>
            <li>✅ Recently played tracks</li>
            <li>✅ Artists A-Z navigation</li>
            <li>✅ Tidal integration settings</li>
            <li>✅ Shuffle all tracks</li>
            <li>✅ History and playlists access</li>
          </ul>
          <p><strong>Note:</strong> This is a demo interface. The full React Native app will load here once Metro bundler is properly configured.</p>
        </div>
      </body>
      </html>
    `);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Web interface server running on port ${PORT}`);
  console.log(`Access at: http://localhost:${PORT}/`);
});
