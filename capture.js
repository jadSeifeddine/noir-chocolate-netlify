'use strict';

// Saves full-resolution PNG screenshots of the live store into ./demo-screenshots
// Run with:  node capture.js   (the store must be running on http://localhost:3000)

const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'demo-screenshots');
fs.mkdirSync(OUT, { recursive: true });

async function shoot(page, urlPath, file) {
  await page.goto(BASE + urlPath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500); // let fonts settle
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  console.log('  saved', file);
}

(async () => {
  const browser = await chromium.launch();

  // ---------- Desktop ----------
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const d = await desktop.newPage();

  // build a cart in this session so cart/checkout look real
  for (const [id, qty] of [['7', '1'], ['6', '1'], ['13', '1']]) {
    await desktop.request.post(BASE + '/cart/add', { form: { product_id: id, qty } });
  }
  // authenticate admin in this session
  await desktop.request.post(BASE + '/admin/login', { form: { password: process.env.ADMIN_PASSWORD || 'noir-admin' } });

  console.log('Desktop:');
  await shoot(d, '/',                         '01-home.png');
  await shoot(d, '/shop',                     '02-menu.png');
  await shoot(d, '/shop?category=chocolate-boxes', '03-menu-boxes.png');
  await shoot(d, '/product/noir-bonbons',     '04-product.png');
  await shoot(d, '/cart',                     '05-cart.png');
  await shoot(d, '/checkout',                 '06-checkout.png');
  await shoot(d, '/admin',                    '07-admin-dashboard.png');
  await shoot(d, '/admin/products/new',       '08-admin-add-product.png');
  await desktop.close();

  // ---------- Mobile ----------
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
  const m = await mobile.newPage();
  for (const [id, qty] of [['7', '1'], ['6', '1']]) {
    await mobile.request.post(BASE + '/cart/add', { form: { product_id: id, qty } });
  }
  console.log('Mobile:');
  await shoot(m, '/',                     'mobile-01-home.png');
  await shoot(m, '/shop',                 'mobile-02-menu.png');
  await shoot(m, '/product/noir-bonbons', 'mobile-03-product.png');
  await shoot(m, '/cart',                 'mobile-04-cart.png');
  await mobile.close();

  await browser.close();
  console.log('\nDone → ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
