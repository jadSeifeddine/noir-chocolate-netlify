'use strict';

// Local/non-Netlify runner. On Netlify, netlify/functions/app.js wraps the
// same app.js export instead of this file — this is only what runs `node
// server.js` / `npm run dev` on a developer machine or a non-Netlify host.
require('dotenv').config();
const { app, migrate, pool } = require('./app');

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

async function start() {
  await migrate();
  const server = app.listen(PORT, () => {
    console.log(`\n  Noir is running →  http://localhost:${PORT}`);
    if (!isProd) console.log(`  Admin panel     →  http://localhost:${PORT}/admin/login\n`);
  });
  const shutdown = () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('Failed to start Noir:', err);
  process.exit(1);
});
