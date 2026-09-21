const express = require('express');
const path = require('path');
const app = express();
const PORT = 5500;

// Cross-origin <script type="module"> fetches (unlike classic <script src>)
// are subject to CORS — see docs/decisions/2026-09-18--esm-module-split-and-cors.md.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n✓ Server running at http://127.0.0.1:${PORT}`);
  console.log(`✓ Load script in Tampermonkey from: http://127.0.0.1:${PORT}/main.js\n`);
});
