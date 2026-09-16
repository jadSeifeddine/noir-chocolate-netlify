'use strict';
// Screenshots of the new single-page order menu (+ open cart drawer).
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';
const OUT = path.join(__dirname, 'demo-screenshots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();

  // Desktop — full order page
  const d = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const dp = await d.newPage();
  await d.request.post(BASE + '/api/cart/add', { data: { product_id: 7, qty: 1 } });
  await d.request.post(BASE + '/api/cart/add', { data: { product_id: 6, qty: 1 } });
  await d.request.post(BASE + '/api/cart/add', { data: { product_id: 13, qty: 2 } });
  await dp.goto(BASE + '/shop', { waitUntil: 'networkidle' });
  await dp.waitForTimeout(600);
  await dp.screenshot({ path: path.join(OUT, 'order-01-menu.png'), fullPage: true });
  console.log('  order-01-menu.png');
  // open the cart drawer
  await dp.click('#fab');
  await dp.waitForTimeout(500);
  await dp.screenshot({ path: path.join(OUT, 'order-02-drawer.png') });
  console.log('  order-02-drawer.png');
  await d.close();

  // Mobile — order page + drawer
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
  const mp = await m.newPage();
  await m.request.post(BASE + '/api/cart/add', { data: { product_id: 7, qty: 1 } });
  await m.request.post(BASE + '/api/cart/add', { data: { product_id: 6, qty: 1 } });
  await mp.goto(BASE + '/shop', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(600);
  await mp.screenshot({ path: path.join(OUT, 'order-mobile-01-menu.png') });
  console.log('  order-mobile-01-menu.png');
  await mp.click('#fab');
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: path.join(OUT, 'order-mobile-02-drawer.png') });
  console.log('  order-mobile-02-drawer.png');
  await m.close();

  await browser.close();
  console.log('Done → ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
