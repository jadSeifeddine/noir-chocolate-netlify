'use strict';

require('dotenv').config();
const crypto = require('node:crypto');
const { Pool } = require('pg');

// Netlify DB (Neon) injects its own connection string at runtime rather than
// a hand-set DATABASE_URL — prefer that when present (i.e. actually running
// on Netlify, dev or prod), and fall back to a plain DATABASE_URL for local
// dev or any other host. `NETLIFY` isn't actually set in the Functions
// runtime (only URL/SITE_NAME/SITE_ID are documented as available there) —
// SITE_ID is what's reliably present in both `netlify dev` and production.
let connectionString = process.env.DATABASE_URL;
if (process.env.SITE_ID) {
  connectionString = require('@netlify/database').getConnectionString();
}

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in for local dev.');
}

const pool = new Pool({
  connectionString,
  // Managed/hosted Postgres (Neon, Dokploy, most cloud providers) sits behind
  // a cert chain that isn't in Node's default trust store — verifying it
  // strictly would just break connections.
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  // Serverless functions can spin up many concurrent containers, each with
  // its own pool — keep each pool small so a traffic spike doesn't blow past
  // Neon's connection limit. Fine for this app's read/write volume either way.
  max: process.env.SITE_ID ? 3 : 10,
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error', err);
});

// ---------- better-sqlite3-shaped shim over pg ----------
// The rest of the app was written against better-sqlite3's synchronous
// `db.prepare(sql).get/all/run(...params)` API using `?` placeholders. Rather
// than rewrite ~80 call sites' SQL text, this shim keeps that exact interface
// (now returning Promises) and handles the two real behavioral differences:
//   1. `?` -> `$1, $2, ...` positional placeholders.
//   2. Postgres returns COUNT/SUM/BIGINT results as strings (to protect
//      precision beyond 2^53) — every column in this schema is a genuine
//      number, so numeric-looking strings are coerced back to JS numbers.
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function coerceRow(row) {
  for (const k in row) {
    const v = row[k];
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) row[k] = Number(v);
  }
  return row;
}

function makeStatement(sql, exec) {
  const pgSql = toPgSql(sql);
  return {
    async get(...params) {
      const res = await exec(pgSql, params);
      return res.rows[0] ? coerceRow(res.rows[0]) : undefined;
    },
    async all(...params) {
      const res = await exec(pgSql, params);
      return res.rows.map(coerceRow);
    },
    async run(...params) {
      let finalSql = pgSql;
      if (/^\s*insert/i.test(sql) && !/returning/i.test(sql)) finalSql += ' RETURNING id';
      const res = await exec(finalSql, params);
      return { lastInsertRowid: res.rows[0] ? res.rows[0].id : undefined, changes: res.rowCount };
    },
  };
}

function makeDb(exec) {
  return {
    prepare: (sql) => makeStatement(sql, exec),
    exec: (sql) => exec(sql),
  };
}

const db = makeDb((sql, params) => pool.query(sql, params));

// Runs a batch of statements on one dedicated connection inside BEGIN/COMMIT
// — pool.query() alone can't be used for transactions since consecutive
// calls may land on different pooled connections.
db.transaction = async function transaction(fn) {
  const client = await pool.connect();
  const tx = makeDb((sql, params) => client.query(sql, params));
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ---------- Schema ----------
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id     SERIAL PRIMARY KEY,
      name   TEXT NOT NULL UNIQUE,
      slug   TEXT NOT NULL UNIQUE,
      sort   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      slug         TEXT NOT NULL UNIQUE,
      description  TEXT NOT NULL DEFAULT '',
      price        REAL NOT NULL DEFAULT 0,
      image        TEXT NOT NULL DEFAULT '',
      category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      featured     INTEGER NOT NULL DEFAULT 0,
      available    INTEGER NOT NULL DEFAULT 1,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      -- Unguessable id used in the customer-facing confirmation URL, so
      -- /order/<token> can't be enumerated the way /order/1, /order/2... could.
      -- The numeric id above stays internal (admin panel, order_items FK).
      token             TEXT,
      customer_name     TEXT NOT NULL,
      phone             TEXT NOT NULL,
      method            TEXT NOT NULL DEFAULT 'delivery',
      address           TEXT NOT NULL DEFAULT '',
      notes             TEXT NOT NULL DEFAULT '',
      total             REAL NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'new',
      schedule_type     TEXT NOT NULL DEFAULT 'asap',
      fulfill_at        TEXT NOT NULL DEFAULT '',
      cake_message      TEXT NOT NULL DEFAULT '',
      is_gift           INTEGER NOT NULL DEFAULT 0,
      recipient_name    TEXT NOT NULL DEFAULT '',
      recipient_phone   TEXT NOT NULL DEFAULT '',
      recipient_address TEXT NOT NULL DEFAULT '',
      gift_message      TEXT NOT NULL DEFAULT '',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id            SERIAL PRIMARY KEY,
      order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name  TEXT NOT NULL,
      unit_price    REAL NOT NULL,
      quantity      INTEGER NOT NULL
    );

    -- Size/quantity options for products that come in more than one size
    -- (e.g. a bonbon box sold as 8 / 18 / 36 pieces). Products with no rows
    -- here are just sold at their flat products.price, same as before.
    CREATE TABLE IF NOT EXISTS product_variants (
      id           SERIAL PRIMARY KEY,
      product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      label        TEXT NOT NULL,
      price        REAL NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0
    );

    -- Customer-submitted reviews. The rating shown anywhere on the site is
    -- always computed live from these rows — nobody, including the admin,
    -- sets a product's rating directly.
    CREATE TABLE IF NOT EXISTS reviews (
      id            SERIAL PRIMARY KEY,
      product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      author_name   TEXT NOT NULL DEFAULT 'Anonymous',
      rating        INTEGER NOT NULL,
      comment       TEXT NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Kept for parity with earlier SQLite migrations that ran ADD COLUMN by
  // hand — harmless no-ops now that the columns are in CREATE TABLE above,
  // but IF NOT EXISTS/IF EXISTS make them safe to re-run against an older DB.
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE products DROP COLUMN IF EXISTS rating;`);
  await pool.query(`ALTER TABLE products DROP COLUMN IF EXISTS rating_count;`);

  // Backfill tokens for any orders placed before this column existed, so
  // every order (old or new) has an unguessable id to look itself up by.
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS token TEXT;`);
  const untokened = await pool.query(`SELECT id FROM orders WHERE token IS NULL`);
  for (const row of untokened.rows) {
    await pool.query('UPDATE orders SET token = $1 WHERE id = $2', [crypto.randomUUID(), row.id]);
  }
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS orders_token_idx ON orders (token);`);
}

module.exports = { db, pool, migrate };
