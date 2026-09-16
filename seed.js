'use strict';

// Seeds the Noir database with categories, a starter catalog, and
// self-contained SVG placeholder images. Safe to re-run: it resets content.

const path = require('node:path');
const fs = require('node:fs');
const { db, pool, migrate } = require('./db');

const UPLOADS = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Build a small, elegant on-brand placeholder image so the site looks alive
// before the owner uploads real photos. Pure SVG => no external requests.
// `tint` gives boxes/pistachio items a distinct background so cards that
// share an emoji (limited Unicode vocabulary) don't all look identical.
const TINTS = {
  coral: ['#f6a49f', '#ec8a86'],
  pistachio: ['#d3e6ae', '#9cbf76'],
  gold: ['#f8dca6', '#e3ac57'],
};
function makePlaceholder(name, emoji, slug, tint = 'coral') {
  const [c1, c2] = TINTS[tint] || TINTS.coral;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>
    <radialGradient id="g" cx="50%" cy="35%" r="78%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </radialGradient>
  </defs>
  <rect width="800" height="800" fill="url(#g)"/>
  <rect x="28" y="28" width="744" height="744" fill="none" stroke="#fbeee7" stroke-width="2" opacity="0.7"/>
  <text x="400" y="360" font-size="230" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
  <text x="400" y="560" font-family="Georgia, serif" font-size="42" letter-spacing="3"
        text-anchor="middle" fill="#241615">${name.replace(/&/g, '&amp;')}</text>
  <text x="400" y="612" font-family="Georgia, serif" font-size="22" letter-spacing="8"
        text-anchor="middle" fill="#fbeee7">N O I R</text>
</svg>`;
  const file = `seed-${slug}.svg`;
  fs.writeFileSync(path.join(UPLOADS, file), svg, 'utf8');
  return `/uploads/${file}`;
}

const categories = [
  { name: 'Chocodonuts', sort: 1 },
  { name: 'Chocolate Boxes', sort: 2 },
  { name: 'Coffee', sort: 3 },
  { name: 'Desserts', sort: 4 },
  { name: 'Sandwiches', sort: 5 },
];

const products = [
  // Chocodonuts — one for $5
  { name: 'Caramel Praline Chocodonut', cat: 'Chocodonuts', price: 5, emoji: '🍩', featured: 1,
    desc: 'Crunchy, sweet and unforgettable — dipped in glossy Noir chocolate.' },
  { name: 'Tiramisu Chocodonut', cat: 'Chocodonuts', price: 5, emoji: '🍩',
    desc: 'The classic tiramisu that melts like coffee dreams.' },
  { name: 'Fudge Brownie Chocodonut', cat: 'Chocodonuts', price: 5, emoji: '🍩',
    desc: 'Deep chocolate — pure comfort for chocolate lovers.' },
  { name: 'Pistachio Beiruti Chocodonut', cat: 'Chocodonuts', price: 5, emoji: '🍩', featured: 1, tint: 'pistachio',
    desc: 'Pistachio & ashta in a chocolate ring. A taste of Beirut!' },
  { name: 'Brunch Box', cat: 'Chocodonuts', price: 18, emoji: '🍩', tint: 'gold',
    desc: 'A box of 4 chocodonuts — perfect for sharing.' },
  { name: 'Gathering Box', cat: 'Chocodonuts', price: 39, emoji: '🍩', featured: 1, tint: 'gold',
    desc: 'A box of 9 chocodonuts for the whole table.' },

  // Chocolate Boxes
  { name: 'Noir Bonbons', cat: 'Chocolate Boxes', price: 10, emoji: '🍬', featured: 1,
    desc: 'Bonbons filled with salted caramel, cheesecake, praline, mocha, Ferrero, pistachio kunafa, Bueno & gianduja. 8 / 18 / 36 pieces.',
    variants: [{ label: '8 pieces', price: 10 }, { label: '18 pieces', price: 20 }, { label: '36 pieces', price: 36 }] },
  { name: 'Crunchy Box', cat: 'Chocolate Boxes', price: 16, emoji: '🍫',
    desc: 'Chocolate squares with mixed nuts, salted caramel, peanuts & wafer. 16 or 32 pieces.',
    variants: [{ label: '16 pieces', price: 16 }, { label: '32 pieces', price: 30 }] },
  { name: 'Noir Box', cat: 'Chocolate Boxes', price: 19, emoji: '🎁', tint: 'gold',
    desc: 'Chocolate fingers, squares, mini bars & handcrafted bonbons — 17 pieces.' },
  { name: 'Caramella Box', cat: 'Chocolate Boxes', price: 17, emoji: '🍬',
    desc: '20 chocolate fingers filled with salted caramel, strawberry & Ferrero.' },
  { name: 'Kunafa Pistachio Box', cat: 'Chocolate Boxes', price: 20, emoji: '🥜', tint: 'pistachio',
    desc: 'A blend of kunafa & pistachio wrapped in rich Belgian chocolate — 16 pieces.' },

  // Coffee
  { name: 'Espresso', cat: 'Coffee', price: 3.5, emoji: '☕',
    desc: 'A tight, aromatic shot from our house Badaro roast.' },
  { name: 'Cappuccino', cat: 'Coffee', price: 5, emoji: '☕',
    desc: 'Espresso, steamed milk and a cloud of velvety foam.' },
  { name: 'Spanish Latte', cat: 'Coffee', price: 6, emoji: '☕', featured: 1,
    desc: 'Smooth, sweet and creamy — a house favourite.' },
  { name: 'Chocolate Frappe', cat: 'Coffee', price: 5.5, emoji: '🧋',
    desc: 'Iced, blended and richly chocolate.' },
  { name: 'Real Hot Chocolate', cat: 'Coffee', price: 6, emoji: '☕', featured: 1,
    desc: 'Made with real melted Belgian chocolate — dark or caramel.' },
  { name: 'Affogato Pop', cat: 'Coffee', price: 6.5, emoji: '🍨',
    desc: 'Espresso poured over a salted caramel, vanilla or pistachio popsicle.' },

  // Desserts
  { name: 'Cookies', cat: 'Desserts', price: 3.5, emoji: '🍪',
    desc: 'Warm, chewy chocolate-chip cookies.' },
  { name: 'Brownies', cat: 'Desserts', price: 4.5, emoji: '🍫',
    desc: 'Fudgy dark-chocolate squares.' },
  { name: 'Chocolate Cake', cat: 'Desserts', price: 6, emoji: '🍰', featured: 1,
    desc: 'A rich, moist layered slice.' },
  { name: 'Tiramisu', cat: 'Desserts', price: 6, emoji: '🍮',
    desc: 'The coffee-soaked Italian classic.' },
  { name: 'Brownie Cup', cat: 'Desserts', price: 7, emoji: '🫙',
    desc: 'A jar of brownie bites, ready to spoon.' },
  { name: 'Cookies Cup', cat: 'Desserts', price: 6, emoji: '🫙',
    desc: 'A jar of mini chocolate-chip cookies.' },

  // Sandwiches (Pastel & Sandwiches)
  { name: 'Halloumi Pesto Pastel', cat: 'Sandwiches', price: 5.5, emoji: '🥐',
    desc: 'Halloumi, homemade basil pesto and tomato confit.' },
  { name: 'Four Cheese Pastel', cat: 'Sandwiches', price: 5, emoji: '🥐',
    desc: 'A four-cheese mix with homemade basil pesto.' },
  { name: 'Nutella Hazelnut Pastel', cat: 'Sandwiches', price: 6, emoji: '🌰',
    desc: 'Drizzled with milk chocolate and topped with crushed hazelnuts.' },
  { name: 'Labneh Sandwich', cat: 'Sandwiches', price: 4.5, emoji: '🥪',
    desc: 'Herbed labneh, olive tapenade, cucumber, tomato, rocca & olive oil.' },
  { name: 'AvoTuna Sandwich', cat: 'Sandwiches', price: 7, emoji: '🥑',
    desc: 'Our signature tuna mix with fresh avocado.' },
  { name: 'Turkey & Cheese Sandwich', cat: 'Sandwiches', price: 7.5, emoji: '🥪',
    desc: 'Turkey, mozzarella, iceberg, tomato and house cheese sauce.' },
];

// A handful of sample customer reviews, seeded as real rows in the reviews
// table (not a fabricated aggregate) so the demo shows genuine-looking
// social proof while the actual math — average and count — is always
// computed live from these rows, same as it would be from real customers.
const reviewerNames = [
  'Rania K.', 'Karim S.', 'Layla H.', 'Elie M.', 'Nour A.', 'Tarek B.',
  'Maya G.', 'Jad F.', 'Sara N.', 'Ziad C.', 'Yara T.', 'Omar D.',
  'Christelle R.', 'Fadi J.', 'Dana W.', 'Ali H.',
];
const reviewComments = [
  'So good I ordered it again the next day.',
  'My favourite thing on the menu, no contest.',
  'Everyone at the office loved this.',
  'Perfect with a coffee in the afternoon.',
  'Tastes even better than it looks.',
  'A bit pricier than I expected, but worth it.',
  'Fresh, not overly sweet, exactly what I wanted.',
  'Ordered for a gathering and it disappeared fast.',
  'Been coming back for this one for months.',
  'Great texture, great flavour, will order again.',
  '',
  '',
];

async function seedReviews(productId) {
  // Each product gets 2–5 reviews, ratings weighted toward 4–5 stars.
  const n = 2 + Math.floor(Math.random() * 4);
  const insReview = db.prepare(
    'INSERT INTO reviews (product_id, author_name, rating, comment) VALUES (?, ?, ?, ?)'
  );
  for (let i = 0; i < n; i++) {
    const rating = [5, 5, 5, 4, 4, 3][Math.floor(Math.random() * 6)];
    const name = reviewerNames[Math.floor(Math.random() * reviewerNames.length)];
    const comment = reviewComments[Math.floor(Math.random() * reviewComments.length)];
    await insReview.run(productId, name, rating, comment);
  }
}

async function main() {
  await migrate();

  // Reset content (keeps schema). TRUNCATE ... CASCADE also resets the
  // SERIAL/IDENTITY sequences, same effect as SQLite's sqlite_sequence wipe.
  await db.exec('TRUNCATE TABLE reviews, order_items, orders, product_variants, products, categories RESTART IDENTITY CASCADE;');

  const insCat = db.prepare('INSERT INTO categories (name, slug, sort) VALUES (?, ?, ?)');
  const catId = {};
  for (const c of categories) {
    const info = await insCat.run(c.name, slugify(c.name), c.sort);
    catId[c.name] = Number(info.lastInsertRowid);
  }

  const insProd = db.prepare(`INSERT INTO products
    (name, slug, description, price, image, category_id, featured, available)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)`);
  const insVariant = db.prepare(
    'INSERT INTO product_variants (product_id, label, price, sort_order) VALUES (?, ?, ?, ?)'
  );

  let variantCount = 0;
  for (const p of products) {
    const slug = slugify(p.name);
    const image = makePlaceholder(p.name, p.emoji, slug, p.tint);
    const info = await insProd.run(p.name, slug, p.desc, p.price, image, catId[p.cat], p.featured ? 1 : 0);
    const productId = Number(info.lastInsertRowid);
    await seedReviews(productId);
    for (let i = 0; i < (p.variants || []).length; i++) {
      const v = p.variants[i];
      await insVariant.run(productId, v.label, v.price, i * 10);
      variantCount++;
    }
  }

  console.log(`Seeded ${categories.length} categories, ${products.length} products (${variantCount} size variants), with sample reviews.`);
  console.log('Placeholder images written to public/uploads/.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
