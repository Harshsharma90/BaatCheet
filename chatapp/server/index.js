require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');
const { pool, init } = require('./db');
const mail = require('./mail');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

const app = express();
app.use(cors({ origin: APP_URL }));
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: APP_URL } });
const online = new Map(); // userId -> open socket count

// ---------- Helpers ----------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const pub = u => ({ id: u.id, name: u.name, email: u.email, about: u.about || '', avatarUrl: u.avatar_url || '', createdAt: u.created_at });
const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '30d' });
const validEmail = e => /^\S+@\S+\.\S+$/.test(e || '');
const wrap = f => (req, res) => Promise.resolve(f(req, res)).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });
const auth = (req, res, next) => { try { req.uid = jwt.verify((req.headers.authorization || '').slice(7), SECRET).id; next(); } catch { res.status(401).json({ error: 'Unauthorized' }); } };

async function isFriend(a, b) {
  const r = await pool.query('SELECT 1 FROM friends WHERE a=$1 AND b=$2', [a, b]);
  return r.rowCount > 0;
}
async function userById(id) {
  const r = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
  return r.rows[0];
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const emailHtml = (title, intro, label, url) => `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
<h2 style="color:#128c7e;margin-top:0">💬 ChatApp</h2>
<h3>${title}</h3>
<p style="color:#444;line-height:1.5">${intro}</p>
<p style="text-align:center;margin:28px 0"><a href="${url}" style="background:#128c7e;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${label}</a></p>
<p style="color:#888;font-size:12px">If the button doesn't work, copy this link into your browser:<br>${url}</p>
<p style="color:#888;font-size:12px">If you didn't request this, you can ignore this email.</p></div>`;

// ---------- Uploads ----------
const UP = path.join(__dirname, 'uploads');
fs.mkdirSync(UP, { recursive: true });
const IMG = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
app.use('/uploads', express.static(UP, {
  setHeaders: (res, file) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!IMG.includes(path.extname(file).toLowerCase())) res.setHeader('Content-Disposition', 'attachment');
  },
}));
const upload = multer({
  storage: multer.diskStorage({
    destination: UP,
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase().slice(0, 10)),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ---------- Auth ----------
app.post('/api/auth/signup', wrap(async (req, res) => {
  const { name, email, password } = req.body;
   const strongPassword = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
  if (!name?.trim() || !validEmail(email) || !strongPassword.test(password || ''))
    return res.status(400).json({ error: 'Password needs 8+ characters, with a letter, a number and a special character' });
  const e = email.toLowerCase().trim();
  const exists = await pool.query('SELECT 1 FROM users WHERE email=$1', [e]);
  if (exists.rowCount) return res.status(409).json({ error: 'Email already registered' });
  const hash = await bcrypt.hash(password, 10);
  const r = await pool.query(
    'INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING *',
    [name.trim(), e, hash]
  );
  const u = r.rows[0];
  res.status(201).json({ token: sign(u), user: pub(u) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM users WHERE email=$1', [(req.body.email || '').toLowerCase().trim()]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(req.body.password || '', u.password_hash)))
    return res.status(401).json({ error: 'Wrong email or password' });
  res.json({ token: sign(u), user: pub(u) });
}));

app.post('/api/auth/forgot', wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM users WHERE email=$1', [(req.body.email || '').toLowerCase().trim()]);
  const u = r.rows[0];
  if (u) {
    const t = crypto.randomBytes(32).toString('hex');
    await pool.query('DELETE FROM reset_tokens WHERE user_id=$1', [u.id]);
    await pool.query('INSERT INTO reset_tokens VALUES($1,$2,$3)', [sha(t), u.id, Date.now() + 3600e3]);
    try {
      const link = `${APP_URL}/?reset=${t}`;
      await mail(u.email, 'Reset your password', `Reset your password (link valid for 1 hour):\n${link}`,
        emailHtml('Reset your password', 'We received a request to reset your password. This link works for 1 hour.', 'Reset password', link));
    } catch (e) { console.error('Could not send reset email:', e.message); }
  }
  res.json({ ok: true });
}));

app.post('/api/auth/reset', wrap(async (req, res) => {
  const { token, password } = req.body;
  const r = await pool.query('SELECT * FROM reset_tokens WHERE token_hash=$1', [sha(token || '')]);
  const row = r.rows[0];
  const strongPassword = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
  if (!row || Number(row.expires_at) < Date.now() || !strongPassword.test(password || ''))
    return res.status(400).json({ error: 'Invalid or expired link, or your new password does not meet the requirements' });
  const hash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, row.user_id]);
  await pool.query('DELETE FROM reset_tokens WHERE user_id=$1', [row.user_id]);
  res.json({ ok: true });
}));

app.get('/api/me', auth, wrap(async (req, res) => {
  const u = await userById(req.uid);
  u ? res.json(pub(u)) : res.status(404).json({ error: 'Not found' });
}));

// ---------- Profile ----------
app.put('/api/profile', auth, wrap(async (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 50);
  const about = (req.body.about || '').trim().slice(0, 140);
  if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
  await pool.query('UPDATE users SET name=$1, about=$2 WHERE id=$3', [name, about, req.uid]);
  res.json(pub(await userById(req.uid)));
}));

app.post('/api/profile/photo', auth, (req, res) => {
  upload.single('file')(req, res, async err => {
    if (err || !req.file) return res.status(400).json({ error: 'Upload failed (max 10 MB)' });
    if (!IMG.includes(path.extname(req.file.filename))) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Please choose a JPG, PNG, GIF or WEBP image' });
    }
    try {
      await pool.query('UPDATE users SET avatar_url=$1 WHERE id=$2', ['/uploads/' + req.file.filename, req.uid]);
      res.json(pub(await userById(req.uid)));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });
});

app.post('/api/upload', auth, (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 10 MB)' : 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    res.json({ url: '/uploads/' + req.file.filename, name: req.file.originalname, type: req.file.mimetype, size: req.file.size });
  });
});

// ---------- Search & invites ----------
app.get('/api/users/search', auth, wrap(async (req, res) => {
  const q = `%${(req.query.q || req.query.email || '').toLowerCase()}%`;
  if (q.length < 4) return res.json([]); // "%" + at least 3 chars
  const r = await pool.query(
    `SELECT u.id, u.name, u.email,
            EXISTS(SELECT 1 FROM friends f WHERE f.a=$2 AND f.b=u.id) AS friend
       FROM users u
      WHERE u.id <> $2 AND (u.email ILIKE $1 OR u.name ILIKE $1)
      ORDER BY u.email LIMIT 10`,
    [q, req.uid]
  );
  res.json(r.rows);
}));

app.post('/api/invites', auth, wrap(async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  const me = await userById(req.uid);
  if (!validEmail(email) || email === me.email) return res.status(400).json({ error: 'Enter a valid email that is not your own' });

  const tr = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  const target = tr.rows[0];
  if (target && (await isFriend(me.id, target.id))) return res.status(409).json({ error: 'Already connected' });

  const dup = await pool.query("SELECT 1 FROM invites WHERE from_id=$1 AND to_email=$2 AND status='pending'", [me.id, email]);
  if (dup.rowCount) return res.status(409).json({ error: 'Invite already sent' });

  const token = crypto.randomBytes(16).toString('hex');
  await pool.query('INSERT INTO invites(from_id,to_email,token) VALUES($1,$2,$3)', [me.id, email, token]);

  if (target) {
    io.to('u' + target.id).emit('invite:new');
  } else {
    try {
      const link = `${APP_URL}/?invite=${token}`;
      await mail(email, `${me.name} invited you to chat`, `${me.name} invited you. Sign up here:\n${link}`,
        emailHtml('You have been invited', `<b>${esc(me.name)}</b> invited you to chat on ChatApp. Create your account to accept.`, 'Join ChatApp', link));
    } catch (e) { console.error('Could not send invite email:', e.message); }
  }
  res.status(201).json({ registered: !!target });
}));

app.get('/api/invites', auth, wrap(async (req, res) => {
  const me = await userById(req.uid);
  const r = await pool.query(
    "SELECT i.id, u.name, u.email FROM invites i JOIN users u ON u.id=i.from_id WHERE i.to_email=$1 AND i.status='pending'",
    [me.email]
  );
  res.json(r.rows);
}));

app.get('/api/invites/by-token/:t', wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT i.to_email AS email, u.name AS "fromName"
       FROM invites i JOIN users u ON u.id=i.from_id
      WHERE token=$1 AND status='pending'`,
    [req.params.t]
  );
  r.rows[0] ? res.json(r.rows[0]) : res.status(404).json({ error: 'Invite not found' });
}));

app.post('/api/invites/:id/:action', auth, wrap(async (req, res) => {
  const me = await userById(req.uid);
  const act = req.params.action;
  if (!['accept', 'decline'].includes(act)) return res.status(400).json({ error: 'Invalid action' });
  const r = await pool.query("SELECT * FROM invites WHERE id=$1 AND to_email=$2 AND status='pending'", [req.params.id, me.email]);
  const i = r.rows[0];
  if (!i) return res.status(404).json({ error: 'Not found' });

  await pool.query('UPDATE invites SET status=$1 WHERE id=$2', [act === 'accept' ? 'accepted' : 'declined', i.id]);
  if (act === 'accept') {
    await pool.query('INSERT INTO friends VALUES($1,$2) ON CONFLICT DO NOTHING', [me.id, i.from_id]);
    await pool.query('INSERT INTO friends VALUES($1,$2) ON CONFLICT DO NOTHING', [i.from_id, me.id]);
    io.to('u' + i.from_id).to('u' + me.id).emit('friends:changed');
  }
  res.json({ ok: true });
}));

// ---------- Friends & messages ----------
app.get('/api/friends', auth, wrap(async (req, res) => {
  const me = req.uid;
  const r = await pool.query(
    `SELECT u.id, u.name, u.email, u.about, u.avatar_url AS avatar,
            (SELECT COALESCE(NULLIF(body,''), '📎 ' || COALESCE(file_name,'File'))
               FROM messages WHERE (from_id=u.id AND to_id=$1) OR (from_id=$1 AND to_id=u.id)
               ORDER BY id DESC LIMIT 1) AS last_body,
            (SELECT created_at FROM messages WHERE (from_id=u.id AND to_id=$1) OR (from_id=$1 AND to_id=u.id)
               ORDER BY id DESC LIMIT 1) AS last_at,
            (SELECT COUNT(*)::int FROM messages WHERE from_id=u.id AND to_id=$1 AND read_at IS NULL) AS unread
       FROM friends f JOIN users u ON u.id=f.b
      WHERE f.a=$1
      ORDER BY last_at DESC NULLS LAST`,
    [me]
  );
  res.json(r.rows.map(row => ({ ...row, online: online.has(row.id) })));
}));

app.get('/api/messages/:fid', auth, wrap(async (req, res) => {
  const f = +req.params.fid;
  if (!(await isFriend(req.uid, f))) return res.status(403).json({ error: 'Not connected' });
  const r = await pool.query(
    `SELECT * FROM (
       SELECT * FROM messages WHERE (from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1)
       ORDER BY id DESC LIMIT 100
     ) x ORDER BY id`,
    [req.uid, f]
  );
  res.json(r.rows);
}));

app.post('/api/messages/:fid/read', auth, wrap(async (req, res) => {
  const f = +req.params.fid;
  const r = await pool.query(
    'UPDATE messages SET read_at=now() WHERE from_id=$1 AND to_id=$2 AND read_at IS NULL RETURNING id',
    [f, req.uid]
  );
  if (r.rowCount) io.to('u' + f).emit('messages:read', { by: req.uid });
  res.json({ ok: true });
}));

// ---------- Real-time ----------
io.use((s, next) => { try { s.uid = jwt.verify(s.handshake.auth.token, SECRET).id; next(); } catch { next(new Error('unauthorized')); } });

io.on('connection', s => {
  s.join('u' + s.uid);
  online.set(s.uid, (online.get(s.uid) || 0) + 1);
  io.emit('presence', { id: s.uid, online: true });

  s.on('message:send', async ({ to, body, file }, ack) => {
    try {
      body = (body || '').trim();
      const f = file && typeof file.url === 'string' && file.url.startsWith('/uploads/') && !file.url.includes('..') ? file : null;
      if ((!body && !f) || body.length > 4000 || !(await isFriend(s.uid, to))) return ack?.({ error: 'Cannot send this message' });
      const r = await pool.query(
        `INSERT INTO messages(from_id,to_id,body,file_url,file_name,file_type,file_size)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [s.uid, to, body, f ? f.url : null, f ? String(f.name || 'file').slice(0, 200) : null, f ? String(f.type || '').slice(0, 100) : null, f ? Number(f.size) || 0 : null]
      );
      io.to('u' + to).to('u' + s.uid).emit('message:new', r.rows[0]);
      ack?.({ ok: true });
    } catch (e) { console.error(e); ack?.({ error: 'Server error' }); }
  });

  s.on('typing', async ({ to }) => {
    if (await isFriend(s.uid, to)) s.to('u' + to).emit('typing', { from: s.uid });
  });

  s.on('disconnect', () => {
    const n = (online.get(s.uid) || 1) - 1;
    if (n) online.set(s.uid, n);
    else { online.delete(s.uid); io.emit('presence', { id: s.uid, online: false }); }
  });
});

// ---------- Start ----------
init()
  .then(() => {
    server.listen(process.env.PORT || 4000, () => console.log('API + sockets on http://localhost:' + (process.env.PORT || 4000)));
  })
  .catch(e => { console.error('Could not set up the database:', e.message); process.exit(1); });