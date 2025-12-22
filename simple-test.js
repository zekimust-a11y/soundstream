const express = require('express');

const app = express();
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', test: true });
});

app.post('/api/lms/connect', (req, res) => {
  // Simple mock response for testing
  res.json({
    id: 'lms-192.168.0.19:9000',
    name: 'Logitech Media Server',
    host: '192.168.0.19',
    port: 9000,
    version: '8.5.2',
  });
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Test server running on 0.0.0.0:3000');
});
