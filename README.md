# NOIR — Sample Website

A full storefront **and** admin panel for **Noir** (Chocolate • Coffee • Cakes, Badaro).
Products, prices and images live in a real database, and the owner can add, edit or
remove products — and see incoming orders — from the admin panel. No coding required.

## What's inside

- **Storefront** — home, full menu (filter by category), product pages with ratings/
  reviews and size options, bag/cart, checkout, and an order confirmation.
- **Real database** (PostgreSQL) — products, categories, size variants, reviews, and
  customer orders.
- **Admin panel** (`/admin`) — add / edit / delete products with **image upload**,
  set prices, sizes, categories, "house favourite" and availability, plus view and
  update the status of every order.

## Run it

Requires **Node.js 20+** and a **PostgreSQL** database.

```bash
cp .env.example .env   # fill in DATABASE_URL, SESSION_SECRET, ADMIN_EMAIL
npm install             # first time only
npm run seed             # first time only — fills the menu with starter products
npm start                 # start the website
```

Then open:

- Storefront → **http://localhost:3000**
- Admin panel → **http://localhost:3000/admin/login** — plain `node server.js` can't
  complete a real admin login (that needs Netlify Identity, see below); use
  `npm run netlify:dev` for a local admin-panel-capable environment.

## How the owner manages content

1. Go to `/admin` and log in with Netlify Identity (an invited email + password).
2. **+ Add Product** → type a name, price, description, pick a category, upload a photo.
3. Toggle **House favourite** to feature it on the home page, or untick **Available**
   to hide it without deleting.
4. Orders placed on the site appear under **Recent Orders** — click one to see the
   customer's details and update its status.

## Notes

- This is a **sample/demo**. The starter photos are elegant placeholders — the owner
  replaces them with real photos by uploading images in the admin panel.
- Prices are shown in **USD**.
- Data lives in Postgres. Run `npm run seed` again to reset to the demo catalogue
  (this clears orders too).
- Deployed on **Netlify** — the Express app runs as a single Netlify Function
  (`netlify/functions/app.js`, via `serverless-http`), static assets (`public/`) are
  served straight from Netlify's CDN, uploaded product photos live in **Netlify Blobs**
  (served back through `/uploads/:name`), the database is **Netlify DB** (Postgres,
  powered by Neon), and admin login is **Netlify Identity**. See `netlify.toml`.
  A Docker/Dokploy path still exists (`Dockerfile`, `db.js`'s `DATABASE_URL` fallback)
  for anyone who wants to self-host instead.

## Tech

Node.js · Express · PostgreSQL (`pg`) · EJS templates · Multer + Netlify Blobs (image
uploads) · `connect-pg-simple` (sessions) · Netlify Functions + Identity.
