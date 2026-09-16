'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';
const OUT = path.join(__dirname, 'demo-screenshots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
  await ctx.request.post(BASE + '/admin/login', { form: { password: 'noir-admin' } });
  const p = await ctx.newPage();
  const shots = [
    ['/admin', 'admin-01-overview.png'],
    ['/admin/orders', 'admin-02-orders-list.png'],
    ['/admin/orders?view=board', 'admin-03-orders-board.png'],
    ['/admin/menu', 'admin-04-menu.png'],
    ['/admin/orders/2', 'admin-05-order-detail.png'],
    ['/admin/products/new', 'admin-06-add-product.png'],
  ];
  for (const [url, file] of shots) {
    await p.goto(BASE + url, { waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(OUT, file), fullPage: true });
    console.log('  ' + file);
  }
  await browser.close();
  console.log('Done → ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
