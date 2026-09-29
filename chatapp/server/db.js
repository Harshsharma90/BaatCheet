const Database = require('better-sqlite3');
const db = new Database(process.env.DB_FILE || 'chat.db');
db.pragma('journal_mode = WAL');
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT DEFAULT ${NOW});
CREATE TABLE IF NOT EXISTS reset_tokens(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invites(id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL, to_email TEXT NOT NULL, token TEXT UNIQUE NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT ${NOW});
CREATE TABLE IF NOT EXISTS friends(a INTEGER NOT NULL, b INTEGER NOT NULL, PRIMARY KEY(a,b));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT DEFAULT ${NOW}, read_at TEXT);
CREATE INDEX IF NOT EXISTS idx_msg ON messages(from_id, to_id, id);
`);
try { db.exec("ALTER TABLE users ADD COLUMN about TEXT DEFAULT ''"); } catch (e) { /* column already exists */ }
for (const sql of [
  "ALTER TABLE users ADD COLUMN avatar_url TEXT",
  "ALTER TABLE messages ADD COLUMN file_url TEXT",
  "ALTER TABLE messages ADD COLUMN file_name TEXT",
  "ALTER TABLE messages ADD COLUMN file_type TEXT",
  "ALTER TABLE messages ADD COLUMN file_size INTEGER",
]) { try { db.exec(sql); } catch (e) { /* column already exists */ } }
module.exports = db;
