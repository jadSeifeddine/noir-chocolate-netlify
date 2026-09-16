'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
const OUT = path.join(__dirname, 'demo-screenshots');

(async () => {
  const browser = await chromium.launch();

  // Checkout with gift + schedule expanded (desktop)
  const d = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
  await d.request.post(BASE + '/api/cart/add', { data: { product_id: 6, qty: 1 } });
  const cp = await d.newPage();
  await cp.goto(BASE + '/checkout', { waitUntil: 'networkidle' });
  await cp.check('#is_gift');
  await cp.click('input[value="scheduled"]');
  await cp.waitForTimeout(300);
  await cp.screenshot({ path: path.join(OUT, 'order-03-checkout-gift.png'), fullPage: true });
  console.log('  order-03-checkout-gift.png');

  // Admin order detail (order #4 = the gift order) — desktop
  await d.request.post(BASE + '/admin/login', { form: { password: 'noir-admin' } });
  const ap = await d.newPage();
  await ap.goto(BASE + '/admin/orders/4', { waitUntil: 'networkidle' });
  await ap.waitForTimeout(300);
  await ap.screenshot({ path: path.join(OUT, 'admin-07-order-gift.png'), fullPage: true });
  console.log('  admin-07-order-gift.png');
  await d.close();

  // Mobile admin (point 6) — overview + menu
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
  await m.request.post(BASE + '/admin/login', { form: { password: 'noir-admin' } });
  const mp = await m.newPage();
  await mp.goto(BASE + '/admin', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: path.join(OUT, 'admin-mobile-01-overview.png'), fullPage: true });
  console.log('  admin-mobile-01-overview.png');
  await mp.goto(BASE + '/admin/menu', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: path.join(OUT, 'admin-mobile-02-menu.png'), fullPage: true });
  console.log('  admin-mobile-02-menu.png');
  await mp.goto(BASE + '/admin/orders?view=board', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: path.join(OUT, 'admin-mobile-03-board.png') });
  console.log('  admin-mobile-03-board.png');
  await m.close();

  await browser.close();
  console.log('Done');
})().catch((e) => { console.error(e); process.exit(1); });
