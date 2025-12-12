const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/now-playing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'now-playing.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('===========================================');
  console.log('  SoundStream Display Server');
  console.log('===========================================');
  console.log('');
  console.log(`  Server running on port ${PORT}`);
  console.log('');
  console.log('  Open in browser:');
  console.log(`  http://localhost:${PORT}/now-playing`);
  console.log('');
  console.log('  Or from other devices on your network:');
  console.log(`  http://<YOUR_PC_IP>:${PORT}/now-playing`);
  console.log('');
  console.log('  Add LMS parameters:');
  console.log(`  ?host=192.168.0.19&port=9000&player=<MAC>`);
  console.log('');
  console.log('===========================================');
});
