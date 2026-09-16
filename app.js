'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { Jimp } = require('jimp');
const { getStore } = require('@netlify/blobs');
const { db, pool, migrate } = require('./db');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
// Set by both `netlify dev` and production Netlify Functions — false when
// running as a plain local server (`node server.js`) against a Docker/local
// Postgres, which is when uploads fall back to writing to disk instead of
// Netlify Blobs (Blobs needs a real or emulated Netlify site context).
const onNetlify = !!process.env.NETLIFY;

if (isProd && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be set in production.');
if (isProd && !process.env.ADMIN_EMAIL) throw new Error('ADMIN_EMAIL must be set in production.');
// Comma-separated allowlist of emails allowed to become admin after a
// successful Netlify Identity login — Identity only proves *who* logged in,
// this decides whether that person gets admin access.
const ADMIN_EMAILS = (process.env.ADMIN_EMAIL || '')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

// ---------- View engine & middleware ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // behind Netlify's / Dokploy's reverse proxy

// Adds the standard protective response headers (X-Frame-Options,
// X-Content-Type-Options, Referrer-Policy, HSTS, hides X-Powered-By, etc).
// The CSP is scoped to what this app actually loads — every view relies on
// inline <script> blocks and inline style="" attributes, so 'unsafe-inline'
// is needed for script/style; a full lockdown would mean moving every inline
// script to an external file with a nonce, which is a much bigger refactor
// than this pass. What this still buys: the browser will refuse to load a
// script, stylesheet, or frame from any *other* domain — the main practical
// protection even with inline allowed, and worth having independent of that.
// identity.netlify.com is allow-listed for the Netlify Identity widget the
// admin login page loads.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://identity.netlify.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameSrc: ["'self'", 'https://identity.netlify.com'],
    },
  },
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'noir-dev-secret',
  resave: false,
  saveUninitialized: true,
  // 'auto' marks the cookie Secure only when the request actually arrived
  // over HTTPS (respecting X-Forwarded-Proto via `trust proxy` above) —
  // a hardcoded `isProd` broke login on any production deploy still on
  // plain HTTP, which is exactly this VM until it has a real domain.
  cookie: { maxAge: 1000 * 60 * 60 * 24, secure: 'auto', sameSite: 'lax' },
}));

// ---------- Image uploads (admin) ----------
// Product photos are cropped server-side to a fixed square tile, so every card
// on the storefront lines up the same way regardless of what she uploads.
// On Netlify, the function's filesystem is read-only/ephemeral (no disk to
// persist to between invocations), so processed images are stored in a
// Netlify Blobs store and served back through the /uploads/:name route below
// instead of living in public/uploads. Local `node server.js` (no Netlify
// context) keeps writing straight to public/uploads for simplicity.
const TILE_SIZE = 1000;
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const BLOBS_STORE = 'product-images';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype));
  },
});

async function processUploadedImage(file) {
  const outName = `p-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  const img = await Jimp.read(file.buffer);
  img.cover({ w: TILE_SIZE, h: TILE_SIZE });
  if (onNetlify) {
    const buffer = await img.getBuffer('image/jpeg', { quality: 85 });
    await getStore(BLOBS_STORE).set(outName, buffer);
  } else {
    await img.write(path.join(UPLOAD_DIR, outName), { quality: 85 });
  }
  return '/uploads/' + outName;
}

// Express 4 doesn't forward a rejected promise from an async route handler to
// the error middleware on its own — this wrapper makes sure it gets there.
// Every route touches Postgres now (all async), so every route gets wrapped.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Only reached on Netlify — uploaded-since-migration images live in Blobs;
// pre-existing/local images are real static files under public/uploads,
// which express.static above already serves before a request gets here.
app.get('/uploads/:name', asyncHandler(async (req, res) => {
  const blob = await getStore(BLOBS_STORE).get(req.params.name, { type: 'arrayBuffer' });
  if (!blob) return res.status(404).end();
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(blob));
}));

// ---------- Helpers ----------
const money = (n) => '$' + Number(n || 0).toFixed(2);
// Postgres returns TIMESTAMPTZ columns as native JS Date objects (SQLite
// gave back a short plain-text string) — printed with no formatting, a Date
// renders as its full toString(), e.g. "Sun Aug 30 2026 19:36:00 GMT+0300
// (Eastern European Summer Time)". This keeps every date in views short and
// consistent instead of that raw dump.
const formatDate = (d) => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function getCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY sort, name').all();
}

// Ratings are never stored on the product itself — they're always computed
// live from actual customer reviews, so this is the only place a rating
// number gets attached to a product row before it reaches a view.
async function attachRatings(products) {
  const list = Array.isArray(products) ? products : [products];
  if (!list.length) return products;
  const ids = [...new Set(list.map((p) => p.id))];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT product_id, AVG(rating)::float avg_rating, COUNT(*) cnt FROM reviews WHERE product_id IN (${placeholders}) GROUP BY product_id`
  ).all(...ids);
  const byId = new Map(rows.map((r) => [r.product_id, r]));
  list.forEach((p) => {
    const r = byId.get(p.id);
    p.rating = r ? r.avg_rating : 0;
    p.rating_count = r ? r.cnt : 0;
  });
  return products;
}

// Products with size options are added to the cart as "12v3" (product 12,
// variant 3) instead of just "12" — a plain numeric key still means "no
// variant chosen", so existing carts/routes with bare product ids keep working.
function cartKey(productId, variantId) {
  return variantId ? `${productId}v${variantId}` : `${productId}`;
}
function parseCartKey(key) {
  const m = String(key).match(/^(\d+)(?:v(\d+))?$/);
  return m
    ? { product_id: parseInt(m[1], 10), variant_id: m[2] ? parseInt(m[2], 10) : null }
    : { product_id: parseInt(key, 10) || 0, variant_id: null };
}

async function attachVariants(products) {
  const list = Array.isArray(products) ? products : [products];
  if (!list.length) return products;
  const ids = [...new Set(list.map((p) => p.id))];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT * FROM product_variants WHERE product_id IN (${placeholders}) ORDER BY sort_order, price`
  ).all(...ids);
  const byProduct = new Map();
  rows.forEach((v) => {
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
    byProduct.get(v.product_id).push(v);
  });
  list.forEach((p) => {
    p.variants = byProduct.get(p.id) || [];
    p.has_variants = p.variants.length > 0;
    p.min_price = p.has_variants ? Math.min(...p.variants.map((v) => v.price)) : p.price;
  });
  return products;
}

async function cartFromSession(req) {
  const raw = req.session.cart || {};
  const keys = Object.keys(raw);
  if (!keys.length) return { items: [], total: 0, count: 0 };
  const parsed = keys.map((k) => ({ key: k, ...parseCartKey(k) }));

  const productIds = [...new Set(parsed.map((k) => k.product_id))];
  const pPlaceholders = productIds.map(() => '?').join(',');
  const products = await db.prepare(`SELECT * FROM products WHERE id IN (${pPlaceholders})`).all(...productIds);
  const productById = new Map(products.map((p) => [p.id, p]));

  const variantIds = [...new Set(parsed.map((k) => k.variant_id).filter(Boolean))];
  let variantById = new Map();
  if (variantIds.length) {
    const vPlaceholders = variantIds.map(() => '?').join(',');
    const variants = await db.prepare(`SELECT * FROM product_variants WHERE id IN (${vPlaceholders})`).all(...variantIds);
    variantById = new Map(variants.map((v) => [v.id, v]));
  }

  const items = [];
  let total = 0, count = 0;
  for (const { key, product_id, variant_id } of parsed) {
    const product = productById.get(product_id);
    if (!product || !product.available) continue;
    // A variant only counts if it actually belongs to this product. Without
    // this check, a tampered cart entry could pair an expensive product with
    // a cheaper product's variant id and be priced at that variant's price —
    // this is the authoritative point where every order's price is decided,
    // so it has to be correct regardless of what wrote the session cart.
    const variant = variant_id ? variantById.get(variant_id) : null;
    if (variant_id && (!variant || variant.product_id !== product_id)) continue;
    const qty = raw[key];
    const price = variant ? variant.price : product.price;
    const line = price * qty;
    total += line;
    count += qty;
    items.push({ key, product, variant, qty, price, line });
  }
  return { items, total, count };
}

// Make common data available to every view
app.use(asyncHandler(async (req, res, next) => {
  res.locals.categories = await getCategories();
  res.locals.cartCount = (await cartFromSession(req)).count;
  res.locals.money = money;
  res.locals.formatDate = formatDate;
  res.locals.currentPath = req.path;
  res.locals.isAdmin = !!req.session.isAdmin;
  next();
}));

// ================= STOREFRONT =================

app.get('/', asyncHandler(async (req, res) => {
  const featured = await db.prepare(
    'SELECT * FROM products WHERE featured = 1 AND available = 1 ORDER BY RANDOM() LIMIT 6'
  ).all();
  await attachRatings(featured);
  await attachVariants(featured);
  res.render('index', { title: 'Noir — Chocolate • Coffee • Cakes', featured });
}));

app.get('/story', (req, res) => {
  res.render('story', { title: 'Our Story — Noir' });
});

app.get('/shop', asyncHandler(async (req, res) => {
  const cats = await getCategories();
  // Single-page order menu: every category with its items (sold-out ones shown, greyed).
  const grouped = [];
  for (const c of cats) {
    const catProducts = await db.prepare(
      'SELECT * FROM products WHERE category_id = ? ORDER BY available DESC, sort_order, name'
    ).all(c.id);
    if (catProducts.length) grouped.push({ ...c, products: catProducts });
  }
  const featured = await db.prepare(
    'SELECT * FROM products WHERE featured = 1 AND available = 1 ORDER BY RANDOM() LIMIT 8'
  ).all();
  for (const c of grouped) { await attachRatings(c.products); await attachVariants(c.products); }
  await attachRatings(featured);
  await attachVariants(featured);
  res.render('shop', { title: 'Order — Noir', grouped, featured, cats });
}));

app.get('/product/:slug', asyncHandler(async (req, res) => {
  const product = await db.prepare('SELECT * FROM products WHERE slug = ?').get(req.params.slug);
  if (!product) return res.status(404).render('404', { title: 'Not found' });
  const category = product.category_id
    ? await db.prepare('SELECT * FROM categories WHERE id = ?').get(product.category_id) : null;
  const related = await db.prepare(`
    SELECT * FROM products WHERE category_id = ? AND id != ? AND available = 1
    ORDER BY RANDOM() LIMIT 3
  `).all(product.category_id, product.id);
  const reviews = await db.prepare('SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC').all(product.id);
  await attachRatings(product);
  await attachRatings(related);
  await attachVariants(product);
  await attachVariants(related);
  res.render('product', { title: `${product.name} — Noir`, product, category, related, reviews });
}));

// A handful of reviews at a time is normal; beyond that, slow the door down.
const reviewLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.redirect(req.get('Referer') || '/'),
});

app.post('/product/:slug/review', reviewLimiter, asyncHandler(async (req, res) => {
  const product = await db.prepare('SELECT id FROM products WHERE slug = ?').get(req.params.slug);
  if (!product) return res.status(404).render('404', { title: 'Not found' });
  const rating = parseInt(req.body.rating, 10);
  const author = (req.body.author_name || '').trim().slice(0, 60) || 'Anonymous';
  const comment = (req.body.comment || '').trim().slice(0, 600);
  if (rating >= 1 && rating <= 5) {
    await db.prepare('INSERT INTO reviews (product_id, author_name, rating, comment) VALUES (?, ?, ?, ?)')
      .run(product.id, author, rating, comment);
  }
  res.redirect(`/product/${req.params.slug}#reviews`);
}));

// ----- Cart -----
app.post('/cart/add', asyncHandler(async (req, res) => {
  const id = parseInt(req.body.product_id, 10);
  const variantId = req.body.variant_id ? parseInt(req.body.variant_id, 10) : null;
  const qty = Math.max(1, parseInt(req.body.qty, 10) || 1);
  const exists = await db.prepare('SELECT id FROM products WHERE id = ? AND available = 1').get(id);
  const variantOk = !variantId || await db.prepare('SELECT id FROM product_variants WHERE id = ? AND product_id = ?').get(variantId, id);
  if (exists && variantOk) {
    req.session.cart = req.session.cart || {};
    const key = cartKey(id, variantId);
    req.session.cart[key] = (req.session.cart[key] || 0) + qty;
  }
  res.redirect(req.body.redirect || '/cart');
}));

app.post('/cart/update', asyncHandler(async (req, res) => {
  const id = parseInt(req.body.product_id, 10);
  const variantId = req.body.variant_id ? parseInt(req.body.variant_id, 10) : null;
  const qty = parseInt(req.body.qty, 10);
  // Same checks as /cart/add — unlike that route, this one had none, which
  // let a request pair any product_id with any variant_id (see cartFromSession
  // for the authoritative fix; this stops the bad pair from being written at all).
  const exists = await db.prepare('SELECT id FROM products WHERE id = ? AND available = 1').get(id);
  const variantOk = !variantId || await db.prepare('SELECT id FROM product_variants WHERE id = ? AND product_id = ?').get(variantId, id);
  req.session.cart = req.session.cart || {};
  const key = cartKey(id, variantId);
  if (exists && variantOk && qty > 0) req.session.cart[key] = qty;
  else delete req.session.cart[key];
  res.redirect('/cart');
}));

app.post('/cart/remove', (req, res) => {
  const id = parseInt(req.body.product_id, 10);
  const variantId = req.body.variant_id ? parseInt(req.body.variant_id, 10) : null;
  if (req.session.cart) delete req.session.cart[cartKey(id, variantId)];
  res.redirect('/cart');
});

app.get('/cart', asyncHandler(async (req, res) => {
  res.render('cart', { title: 'Your Bag — Noir', cart: await cartFromSession(req) });
}));

// ----- Cart JSON API (used by the single-page order menu + drawer) -----
async function cartJSON(req) {
  const c = await cartFromSession(req);
  return {
    count: c.count,
    total: c.total,
    items: c.items.map((it) => ({
      id: it.product.id, name: it.product.name, slug: it.product.slug,
      variant_label: it.variant ? it.variant.label : null,
      price: it.price, image: it.product.image, qty: it.qty, line: it.line,
    })),
  };
}

app.get('/api/cart', asyncHandler(async (req, res) => res.json(await cartJSON(req))));

app.post('/api/cart/add', asyncHandler(async (req, res) => {
  const id = String(parseInt(req.body.product_id, 10));
  const qty = Math.max(1, parseInt(req.body.qty, 10) || 1);
  const ok = await db.prepare('SELECT id FROM products WHERE id = ? AND available = 1').get(id);
  if (ok) {
    req.session.cart = req.session.cart || {};
    req.session.cart[id] = (req.session.cart[id] || 0) + qty;
  }
  res.json(await cartJSON(req));
}));

app.post('/api/cart/update', asyncHandler(async (req, res) => {
  const id = String(parseInt(req.body.product_id, 10));
  const qty = parseInt(req.body.qty, 10);
  req.session.cart = req.session.cart || {};
  if (qty > 0) req.session.cart[id] = qty;
  else delete req.session.cart[id];
  res.json(await cartJSON(req));
}));

app.post('/api/cart/remove', asyncHandler(async (req, res) => {
  const id = String(parseInt(req.body.product_id, 10));
  if (req.session.cart) delete req.session.cart[id];
  res.json(await cartJSON(req));
}));

// ----- Checkout -----
app.get('/checkout', asyncHandler(async (req, res) => {
  const cart = await cartFromSession(req);
  if (!cart.items.length) return res.redirect('/shop');
  res.render('checkout', { title: 'Checkout — Noir', cart, error: null });
}));

// A real customer submits this once, maybe twice on a validation error;
// beyond that, slow the door down — this is the one storefront action that
// actually writes a permanent row, so it's the one worth guarding.
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: asyncHandler(async (req, res) => {
    res.status(429).render('checkout', {
      title: 'Checkout — Noir', cart: await cartFromSession(req),
      error: 'Too many attempts. Please wait a few minutes and try again.',
    });
  }),
});

app.post('/checkout', checkoutLimiter, asyncHandler(async (req, res) => {
  const cart = await cartFromSession(req);
  if (!cart.items.length) return res.redirect('/shop');

  const {
    customer_name, phone, method, address, notes,
    schedule_type, fulfill_date, fulfill_time, cake_message,
    is_gift, recipient_name, recipient_phone, recipient_address, gift_message,
  } = req.body;

  const gift = is_gift ? 1 : 0;
  const scheduled = schedule_type === 'scheduled';
  const fulfill_at = scheduled ? `${(fulfill_date || '').trim()} ${(fulfill_time || '').trim()}`.trim() : '';
  // A gift delivery goes to the recipient's address.
  const deliveryAddress = gift && method === 'delivery'
    ? (recipient_address || '').trim() : (address || '').trim();

  const missing = [];
  if (!customer_name || !phone) missing.push('your name and phone');
  if (method === 'delivery' && !deliveryAddress) missing.push(gift ? "the recipient's delivery address" : 'a delivery address');
  if (scheduled && !fulfill_date) missing.push('a date for your scheduled order');
  if (gift && !recipient_name) missing.push("the recipient's name");
  if (missing.length) {
    return res.render('checkout', {
      title: 'Checkout — Noir', cart,
      error: 'Please add ' + missing.join(', ') + '.',
    });
  }

  // Random, unguessable — this (not the numeric id) is what goes in the
  // customer-facing confirmation URL, so orders can't be enumerated by
  // walking /order/1, /order/2, .... The numeric id stays internal.
  const token = crypto.randomUUID();

  const orderToken = await db.transaction(async (tx) => {
    const info = await tx.prepare(`
      INSERT INTO orders
        (customer_name, phone, method, address, notes, total, status,
         schedule_type, fulfill_at, cake_message,
         is_gift, recipient_name, recipient_phone, recipient_address, gift_message, token)
      VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customer_name.trim(), phone.trim(), method || 'delivery',
      deliveryAddress, (notes || '').trim(), cart.total,
      scheduled ? 'scheduled' : 'asap', fulfill_at, (cake_message || '').trim(),
      gift, (recipient_name || '').trim(), (recipient_phone || '').trim(),
      (recipient_address || '').trim(), (gift_message || '').trim(), token,
    );
    const id = Number(info.lastInsertRowid);
    const insItem = tx.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const it of cart.items) {
      const lineName = it.variant ? `${it.product.name} (${it.variant.label})` : it.product.name;
      await insItem.run(id, it.product.id, lineName, it.price, it.qty);
    }
    return token;
  });

  req.session.cart = {};
  res.redirect('/order/' + orderToken);
}));

app.get('/order/:token', asyncHandler(async (req, res) => {
  const order = await db.prepare('SELECT * FROM orders WHERE token = ?').get(req.params.token);
  if (!order) return res.status(404).render('404', { title: 'Not found' });
  const items = await db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('order', { title: 'Order confirmed — Noir', order, items });
}));

app.get('/contact', (req, res) => {
  res.render('contact', { title: 'Visit Us — Noir' });
});

// ================= ADMIN =================

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

app.get('/admin/login', (req, res) => {
  res.render('admin/login', { title: 'Admin — Noir', error: req.query.error || null, layout: false });
});

// A handful of attempts is normal; beyond that, slow the door down. This now
// guards /admin/session (the Identity-JWT-to-admin-session exchange) instead
// of a password check, but the same "don't let this be hammered" logic applies.
const sessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' }),
});

// Exchanges a Netlify Identity login for our own admin session. The browser
// (see views/admin/login.ejs) logs in via the Netlify Identity widget, then
// POSTs here with the resulting JWT as a Bearer token. Netlify's own edge
// verifies that JWT before this function ever runs and — when valid —
// attaches the identity to the Lambda `context`, which netlify/functions/app.js
// forwards onto `req.clientContext`; locally (no Netlify context), this route
// simply isn't reachable in a way that can succeed, which is fine since local
// dev only matters via `netlify dev`, not plain `node server.js`, for anything
// admin-auth-related.
app.post('/admin/session', sessionLimiter, (req, res) => {
  const identityUser = req.clientContext && req.clientContext.user;
  const email = identityUser && identityUser.email && identityUser.email.toLowerCase();
  if (!email || !ADMIN_EMAILS.includes(email)) {
    return res.status(403).json({ error: 'This Netlify Identity account is not authorized for admin access.' });
  }
  // Regenerate the session id on every successful login. Without this, a
  // session id that existed before authentication (e.g. planted on the
  // admin's browser by an attacker — see session-fixation) would simply
  // become an authenticated one instead of being replaced.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Something went wrong, please try again.' });
    req.session.isAdmin = true;
    res.json({ ok: true });
  });
});

app.post('/admin/logout', (req, res) => {
  // Fully destroy the session (not just flip a flag) so the same id can't
  // linger in the store, and clear the cookie so the browser drops it too.
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

const ORDER_STATUSES = ['new', 'preparing', 'ready', 'completed', 'cancelled'];

// Shared analytics used by the Overview (desktop) and the Insights page (mobile)
async function computeInsights() {
  const topSellers = await db.prepare(`
    SELECT product_name, SUM(quantity) qty, SUM(unit_price*quantity) revenue
    FROM order_items GROUP BY product_name ORDER BY qty DESC LIMIT 6
  `).all();
  const byCategory = await db.prepare(`
    SELECT c.name, COALESCE(SUM(oi.unit_price*oi.quantity),0) revenue
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id
    LEFT JOIN order_items oi ON oi.product_id = p.id
    GROUP BY c.id ORDER BY revenue DESC
  `).all();
  const maxCat = Math.max(1, ...byCategory.map((c) => c.revenue));
  const rows = await db.prepare(`
    SELECT created_at::date::text d, SUM(total) rev FROM orders
    WHERE created_at >= CURRENT_DATE - INTERVAL '6 days' GROUP BY created_at::date
  `).all();
  const map = Object.fromEntries(rows.map((r) => [r.d, r.rev]));
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(); dt.setDate(dt.getDate() - i);
    const key = dt.toISOString().slice(0, 10);
    days.push({ label: dt.toLocaleDateString('en', { weekday: 'short' }), rev: map[key] || 0 });
  }
  const maxDay = Math.max(1, ...days.map((d) => d.rev));
  return { topSellers, byCategory, maxCat, days, maxDay };
}

// ----- Overview -----
app.get('/admin', requireAdmin, asyncHandler(async (req, res) => {
  const g = async (sql, ...p) => (await db.prepare(sql).get(...p)).v;
  const stats = {
    revenue:   await g('SELECT COALESCE(SUM(total),0) v FROM orders'),
    revToday:  await g("SELECT COALESCE(SUM(total),0) v FROM orders WHERE created_at::date = CURRENT_DATE"),
    orders:    await g('SELECT COUNT(*) v FROM orders'),
    newOrders: await g("SELECT COUNT(*) v FROM orders WHERE status='new'"),
    aov:       await g('SELECT COALESCE(AVG(total),0) v FROM orders'),
    products:  await g('SELECT COUNT(*) v FROM products'),
    soldOut:   await g('SELECT COUNT(*) v FROM products WHERE available=0'),
  };
  const recentOrders = await db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 6').all();
  res.render('admin/overview', {
    title: 'Overview — Noir Admin', stats, recentOrders, ...(await computeInsights()),
  });
}));

// ----- Insights (analytics; the mobile "details" destination) -----
app.get('/admin/insights', requireAdmin, asyncHandler(async (req, res) => {
  res.render('admin/insights', { title: 'Insights — Noir Admin', ...(await computeInsights()) });
}));

// ----- Orders (list + board) -----
app.get('/admin/orders', requireAdmin, asyncHandler(async (req, res) => {
  const view = req.query.view === 'board' ? 'board' : 'list';
  const status = req.query.status || 'all';
  const q = (req.query.q || '').trim();
  const date = (req.query.date || '').trim();
  const counts = { all: (await db.prepare('SELECT COUNT(*) n FROM orders').get()).n };
  for (const s of ORDER_STATUSES) counts[s] = (await db.prepare('SELECT COUNT(*) n FROM orders WHERE status=?').get(s)).n;

  let sql = `SELECT o.*, (SELECT COALESCE(SUM(quantity),0) FROM order_items WHERE order_id=o.id) item_count FROM orders o`;
  const where = [], params = [];
  if (view === 'list' && status !== 'all') { where.push('o.status = ?'); params.push(status); }
  if (q) { where.push('(o.customer_name ILIKE ? OR o.phone ILIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
  if (date) { where.push('o.created_at::date = ?::date'); params.push(date); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY o.created_at DESC';
  const orders = await db.prepare(sql).all(...params);

  res.render('admin/orders', {
    title: 'Orders — Noir Admin', orders, counts, status, view, statuses: ORDER_STATUSES, q, date,
  });
}));

// ----- Menu / products management -----
app.get('/admin/menu', requireAdmin, asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const catFilter = req.query.category || '';
  let sql = 'SELECT p.*, c.name category_name, c.slug category_slug FROM products p LEFT JOIN categories c ON c.id = p.category_id';
  const where = [], params = [];
  if (q) { where.push('p.name ILIKE ?'); params.push('%' + q + '%'); }
  if (catFilter) { where.push('c.slug = ?'); params.push(catFilter); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY c.sort, p.sort_order, p.name';
  const products = await db.prepare(sql).all(...params);
  res.render('admin/menu', {
    title: 'Menu — Noir Admin', products, cats: await getCategories(), q, catFilter,
    counts: {
      total: (await db.prepare('SELECT COUNT(*) n FROM products').get()).n,
      soldOut: (await db.prepare('SELECT COUNT(*) n FROM products WHERE available=0').get()).n,
    },
  });
}));

// Re-assigns sort_order to unique, evenly-spaced values within a category so
// the next move always has room to swap, even after many ties at 0.
async function resequenceProducts(categoryId) {
  const rows = await db.prepare(
    'SELECT id FROM products WHERE category_id = ? ORDER BY sort_order, name, id'
  ).all(categoryId);
  const upd = db.prepare('UPDATE products SET sort_order = ? WHERE id = ?');
  for (let i = 0; i < rows.length; i++) await upd.run(i * 10, rows[i].id);
  return rows.map((r) => r.id);
}

app.post('/admin/products/:id/move', requireAdmin, asyncHandler(async (req, res) => {
  const product = await db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (product && product.category_id) {
    const ids = await resequenceProducts(product.category_id);
    const idx = ids.indexOf(product.id);
    const swapIdx = req.body.direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx >= 0 && swapIdx < ids.length) {
      await db.prepare('UPDATE products SET sort_order = ? WHERE id = ?').run(swapIdx * 10, ids[idx]);
      await db.prepare('UPDATE products SET sort_order = ? WHERE id = ?').run(idx * 10, ids[swapIdx]);
    }
  }
  res.redirect(req.body.redirect || req.get('Referer') || '/admin/menu');
}));

// ----- Category management -----
app.get('/admin/categories', requireAdmin, asyncHandler(async (req, res) => {
  const cats = await db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id) product_count
    FROM categories c ORDER BY c.sort, c.name
  `).all();
  res.render('admin/categories', { title: 'Categories — Noir Admin', cats });
}));

app.post('/admin/categories', requireAdmin, asyncHandler(async (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) {
    let slug = slugify(name);
    if (await db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug)) slug += '-' + Date.now();
    const maxSort = (await db.prepare('SELECT COALESCE(MAX(sort), -10) m FROM categories').get()).m;
    await db.prepare('INSERT INTO categories (name, slug, sort) VALUES (?, ?, ?)').run(name, slug, maxSort + 10);
  }
  res.redirect('/admin/categories');
}));

app.post('/admin/categories/:id', requireAdmin, asyncHandler(async (req, res) => {
  const cur = await db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  const name = (req.body.name || '').trim();
  if (cur && name) {
    let slug = cur.slug;
    if (name !== cur.name) {
      slug = slugify(name);
      if (await db.prepare('SELECT 1 FROM categories WHERE slug = ? AND id != ?').get(slug, cur.id)) slug += '-' + Date.now();
    }
    await db.prepare('UPDATE categories SET name = ?, slug = ? WHERE id = ?').run(name, slug, cur.id);
  }
  res.redirect('/admin/categories');
}));

app.post('/admin/categories/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.redirect('/admin/categories');
}));

async function resequenceCategories() {
  const rows = await db.prepare('SELECT id FROM categories ORDER BY sort, name, id').all();
  const upd = db.prepare('UPDATE categories SET sort = ? WHERE id = ?');
  for (let i = 0; i < rows.length; i++) await upd.run(i * 10, rows[i].id);
  return rows.map((r) => r.id);
}

app.post('/admin/categories/:id/move', requireAdmin, asyncHandler(async (req, res) => {
  const ids = await resequenceCategories();
  const idx = ids.indexOf(parseInt(req.params.id, 10));
  const swapIdx = req.body.direction === 'up' ? idx - 1 : idx + 1;
  if (idx >= 0 && swapIdx >= 0 && swapIdx < ids.length) {
    await db.prepare('UPDATE categories SET sort = ? WHERE id = ?').run(swapIdx * 10, ids[idx]);
    await db.prepare('UPDATE categories SET sort = ? WHERE id = ?').run(idx * 10, ids[swapIdx]);
  }
  res.redirect('/admin/categories');
}));

// Replaces all size/variant rows for a product with whatever came from the
// form. Blank labels or invalid prices are dropped silently.
async function saveVariants(productId, req) {
  const labels = [].concat(req.body.variant_label || []);
  const prices = [].concat(req.body.variant_price || []);
  await db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(productId);
  const ins = db.prepare('INSERT INTO product_variants (product_id, label, price, sort_order) VALUES (?, ?, ?, ?)');
  let order = 0;
  for (let i = 0; i < labels.length; i++) {
    const trimmed = (labels[i] || '').trim();
    const price = parseFloat(prices[i]);
    if (trimmed && !Number.isNaN(price) && price >= 0) {
      await ins.run(productId, trimmed, price, order);
      order += 10;
    }
  }
}

app.get('/admin/products/new', requireAdmin, asyncHandler(async (req, res) => {
  res.render('admin/product-form', {
    title: 'New product — Noir Admin', product: null, cats: await getCategories(),
  });
}));

app.post('/admin/products', requireAdmin, upload.single('image'), asyncHandler(async (req, res) => {
  const { name, description, price, category_id, featured, available } = req.body;
  const image = req.file ? await processUploadedImage(req.file) : '/uploads/placeholder.svg';
  let slug = slugify(name);
  // Guarantee slug uniqueness
  if (await db.prepare('SELECT 1 FROM products WHERE slug = ?').get(slug)) slug += '-' + Date.now();
  const catId = category_id ? parseInt(category_id, 10) : null;
  // New products land at the end of their category's display order.
  const maxOrder = catId
    ? (await db.prepare('SELECT COALESCE(MAX(sort_order), -10) m FROM products WHERE category_id = ?').get(catId)).m
    : 0;
  const info = await db.prepare(`
    INSERT INTO products (name, slug, description, price, image, category_id, featured, available, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name.trim(), slug, (description || '').trim(), parseFloat(price) || 0, image,
         catId, featured ? 1 : 0, available ? 1 : 0, maxOrder + 10);
  await saveVariants(Number(info.lastInsertRowid), req);
  res.redirect('/admin/menu');
}));

app.get('/admin/products/:id/edit', requireAdmin, asyncHandler(async (req, res) => {
  const product = await db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.redirect('/admin');
  await attachRatings(product);
  await attachVariants(product);
  res.render('admin/product-form', {
    title: 'Edit product — Noir Admin', product, cats: await getCategories(),
  });
}));

app.post('/admin/products/:id', requireAdmin, upload.single('image'), asyncHandler(async (req, res) => {
  const cur = await db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!cur) return res.redirect('/admin');
  const { name, description, price, category_id, featured, available } = req.body;
  const image = req.file ? await processUploadedImage(req.file) : cur.image;
  await db.prepare(`
    UPDATE products SET name = ?, description = ?, price = ?, image = ?,
      category_id = ?, featured = ?, available = ? WHERE id = ?
  `).run(name.trim(), (description || '').trim(), parseFloat(price) || 0, image,
         category_id ? parseInt(category_id, 10) : null, featured ? 1 : 0,
         available ? 1 : 0, cur.id);
  await saveVariants(cur.id, req);
  res.redirect('/admin/menu');
}));

app.post('/admin/products/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.redirect('/admin/menu');
}));

// Toggle a product's availability (mark sold out / back in stock) inline
app.post('/admin/products/:id/toggle', requireAdmin, asyncHandler(async (req, res) => {
  await db.prepare('UPDATE products SET available = 1 - available WHERE id = ?').run(req.params.id);
  res.redirect(req.get('Referer') || '/admin/menu');
}));

app.get('/admin/orders/:id', requireAdmin, asyncHandler(async (req, res) => {
  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.redirect('/admin/orders');
  const items = await db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('admin/order', {
    title: `Order #${order.id} — Noir Admin`, order, items, statuses: ORDER_STATUSES,
  });
}));

app.post('/admin/orders/:id/status', requireAdmin, asyncHandler(async (req, res) => {
  await db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
  res.redirect(req.body.redirect || req.get('Referer') || '/admin/orders');
}));

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).render('404', { title: 'Not found — Noir' });
});

// ---------- Generic error handler (must have 4 args to be recognized as one) ----------
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('500', { title: 'Something went wrong — Noir' });
});

module.exports = { app, migrate, pool };
