'use strict';

const serverless = require('serverless-http');
const { app, migrate } = require('../../app');

// A Lambda container is reused across invocations while it's warm, so this
// only actually runs the CREATE TABLE IF NOT EXISTS migration once per cold
// start, not on every request — running it fresh every request would add a
// database round trip to every single page load for no benefit.
let migrated = null;
function ensureMigrated() {
  if (!migrated) migrated = migrate();
  return migrated;
}

const serverlessApp = serverless(app, {
  // Netlify's Identity-aware invocation verifies a request's `Authorization:
  // Bearer <jwt>` header and — when it's a valid Netlify Identity token —
  // attaches the user to `context.clientContext`. serverless-http doesn't
  // forward that onto the Express req by default, so this does it explicitly;
  // see the /admin/session route in app.js for where it's read.
  request(req, event, context) {
    req.clientContext = context.clientContext;
  },
});

module.exports.handler = async (event, context) => {
  await ensureMigrated();
  return serverlessApp(event, context);
};
