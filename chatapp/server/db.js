const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      about TEXT DEFAULT '',
      avatar_url TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS reset_tokens(
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites(
      id SERIAL PRIMARY KEY,
      from_id INTEGER NOT NULL,
      to_email TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS friends(
      a INTEGER NOT NULL,
      b INTEGER NOT NULL,
      PRIMARY KEY(a,b)
    );
    CREATE TABLE IF NOT EXISTS messages(
      id SERIAL PRIMARY KEY,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      body TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      read_at TIMESTAMPTZ,
      file_url TEXT,
      file_name TEXT,
      file_type TEXT,
      file_size INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_msg ON messages(from_id, to_id, id);
  `);
  console.log('Database tables ready');
}

module.exports = { pool, init };