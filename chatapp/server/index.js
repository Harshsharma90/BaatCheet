require('dotenv').config();
const express = require('express'), cors = require('cors'), http = require('http'), crypto = require('crypto');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), { Server } = require('socket.io');
const db = require('./db'), mail = require('./mail');
const multer = require('multer'), path = require('path'), fs = require('fs');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const app = express();
app.use(cors({ origin: APP_URL })); app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: APP_URL } });
const online = new Map(); // userId -> open socket count

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const pub = u => 
  ({ id: u.id, name: u.name, email: u.email, about: u.about || '', avatarUrl: u.avatar_url || '', createdAt: u.created_at });const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '30d' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const emailHtml = (title, intro, label, url) => `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
<h2 style="color:#128c7e;margin-top:0">💬 ChatApp</h2>
<h3>${title}</h3>
<p style="color:#444;line-height:1.5">${intro}</p>
<p style="text-align:center;margin:28px 0"><a href="${url}" style="background:#128c7e;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${label}</a></p>
<p style="color:#888;font-size:12px">If the button doesn't work, copy this link into your browser:<br>${url}</p>
<p style="color:#888;font-size:12px">If you didn't request this, you can ignore this email.</p></div>`;
const validEmail = e => /^\S+@\S+\.\S+$/.test(e || '');
const wrap = f => (req, res) => Promise.resolve(f(req, res)).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });
const auth = (req, res, next) => { try { req.uid = jwt.verify((req.headers.authorization || '').slice(7), SECRET).id; next(); } catch { res.status(401).json({ error: 'Unauthorized' }); } };
const isFriend = (a, b) => !!db.prepare('SELECT 1 FROM friends WHERE a=? AND b=?').get(a, b);
const userById = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
// ---------- Uploads ----------
const UP = path.join(__dirname, 'uploads');
fs.mkdirSync(UP, { recursive: true });
const IMG = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
app.use('/uploads', express.static(UP, {
  setHeaders: (res, file) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // only real images open in the browser; everything else downloads (safer)
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
  if (!name?.trim() || !validEmail(email) || (password || '').length < 6)
    return res.status(400).json({ error: 'Name, valid email and a 6+ character password are required' });
  const e = email.toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(e)) return res.status(409).json({ error: 'Email already registered' });
  const r = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name.trim(), e, await bcrypt.hash(password, 10));
  const u = userById(r.lastInsertRowid);
  res.status(201).json({ token: sign(u), user: pub(u) });
}));
app.post('/api/auth/login', wrap(async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((req.body.email || '').toLowerCase().trim());
  if (!u || !(await bcrypt.compare(req.body.password || '', u.password_hash))) return res.status(401).json({ error: 'Wrong email or password' });
  res.json({ token: sign(u), user: pub(u) });
}));
app.post('/api/auth/forgot', wrap(async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((req.body.email || '').toLowerCase().trim());
  if (u) {
    const t = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM reset_tokens WHERE user_id=?').run(u.id);
    db.prepare('INSERT INTO reset_tokens VALUES(?,?,?)').run(sha(t), u.id, Date.now() + 3600e3);
    try {
      const link = `${APP_URL}/?reset=${t}`;
      await mail(u.email, 'Reset your password', `Reset your password (link valid for 1 hour):\n${link}`,
        emailHtml('Reset your password', 'We received a request to reset your password. This link works for 1 hour.', 'Reset password', link));
    }    catch (e) { console.error('Could not send reset email:', e.message); }
  }
  res.json({ ok: true }); // same answer whether or not the email exists
}));
app.post('/api/auth/reset', wrap(async (req, res) => {
  const { token, password } = req.body;
  const r = db.prepare('SELECT * FROM reset_tokens WHERE token_hash=?').get(sha(token || ''));
  if (!r || r.expires_at < Date.now() || (password || '').length < 6) return res.status(400).json({ error: 'Invalid or expired link, or password too short' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await bcrypt.hash(password, 10), r.user_id);
  db.prepare('DELETE FROM reset_tokens WHERE user_id=?').run(r.user_id);
  res.json({ ok: true });
}));
app.get('/api/me', auth, (req, res) => { const u = userById(req.uid); u ? res.json(pub(u)) : res.status(404).json({ error: 'Not found' }); });
app.put('/api/profile', auth, (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 50);
  const about = (req.body.about || '').trim().slice(0, 140);
  if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
  db.prepare('UPDATE users SET name=?, about=? WHERE id=?').run(name, about, req.uid);
  res.json(pub(userById(req.uid)));
});
app.post('/api/upload', auth, (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 10 MB)' : 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    res.json({ url: '/uploads/' + req.file.filename, name: req.file.originalname, type: req.file.mimetype, size: req.file.size });
  });
});
app.post('/api/profile/photo', auth, (req, res) => {
  upload.single('file')(req, res, err => {
    if (err || !req.file) return res.status(400).json({ error: 'Upload failed (max 10 MB)' });
    if (!IMG.includes(path.extname(req.file.filename))) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Please choose a JPG, PNG, GIF or WEBP image' });
    }
    db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run('/uploads/' + req.file.filename, req.uid);
    res.json(pub(userById(req.uid)));
  });
});
// ---------- Search & invites ----------
app.get('/api/users/search', auth, (req, res) => {
  const q = (req.query.email || '').toLowerCase().trim();
  if (q.length < 3) return res.json([]);
  const rows = db.prepare('SELECT id,name,email FROM users WHERE email LIKE ? AND id<>? LIMIT 10').all(`%${q}%`, req.uid);
  res.json(rows.map(u => ({ ...u, friend: isFriend(req.uid, u.id) })));
});
app.post('/api/invites', auth, wrap(async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim(), me = userById(req.uid);
  if (!validEmail(email) || email === me.email) return res.status(400).json({ error: 'Enter a valid email that is not your own' });
  const target = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (target && isFriend(me.id, target.id)) return res.status(409).json({ error: 'Already connected' });
  if (db.prepare("SELECT 1 FROM invites WHERE from_id=? AND to_email=? AND status='pending'").get(me.id, email)) return res.status(409).json({ error: 'Invite already sent' });
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO invites(from_id,to_email,token) VALUES(?,?,?)').run(me.id, email, token);
  if (target) io.to('u' + target.id).emit('invite:new');            // registered: notify live
  else {
    try {
      const link = `${APP_URL}/?invite=${token}`;
      await mail(email, `${me.name} invited you to chat`, `${me.name} invited you. Sign up here:\n${link}`,
        emailHtml('You have been invited', `<b>${esc(me.name)}</b> invited you to chat on ChatApp. Create your account to accept.`, 'Join ChatApp', link));
    } catch (e) { console.error('Could not send invite email:', e.message); }
  }  res.status(201).json({ registered: !!target });
}));
app.get('/api/invites', auth, (req, res) => {
  const me = userById(req.uid);
  res.json(db.prepare("SELECT i.id,u.name,u.email FROM invites i JOIN users u ON u.id=i.from_id WHERE i.to_email=? AND i.status='pending'").all(me.email));
});
app.get('/api/invites/by-token/:t', (req, res) => {
  const i = db.prepare("SELECT i.to_email email, u.name fromName FROM invites i JOIN users u ON u.id=i.from_id WHERE token=? AND status='pending'").get(req.params.t);
  i ? res.json(i) : res.status(404).json({ error: 'Invite not found' });
});
app.post('/api/invites/:id/:action', auth, (req, res) => {
  const me = userById(req.uid), act = req.params.action;
  const i = db.prepare("SELECT * FROM invites WHERE id=? AND to_email=? AND status='pending'").get(req.params.id, me.email);
  if (!i || !['accept', 'decline'].includes(act)) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE invites SET status=? WHERE id=?').run(act === 'accept' ? 'accepted' : 'declined', i.id);
  if (act === 'accept') {
    db.prepare('INSERT OR IGNORE INTO friends VALUES(?,?)').run(me.id, i.from_id);
    db.prepare('INSERT OR IGNORE INTO friends VALUES(?,?)').run(i.from_id, me.id);
    io.to('u' + i.from_id).to('u' + me.id).emit('friends:changed');
  }
  res.json({ ok: true });
});

// ---------- Friends & messages ----------
app.get('/api/friends', auth, (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.name,u.email,u.about,u.avatar_url avatar,
    (SELECT COALESCE(NULLIF(body,''), '📎 ' || COALESCE(file_name,'File')) FROM messages WHERE (from_id=u.id AND to_id=@me) OR (from_id=@me AND to_id=u.id) ORDER BY id DESC LIMIT 1) last_body,
    (SELECT created_at FROM messages WHERE (from_id=u.id AND to_id=@me) OR (from_id=@me AND to_id=u.id) ORDER BY id DESC LIMIT 1) last_at,
    (SELECT COUNT(*) FROM messages WHERE from_id=u.id AND to_id=@me AND read_at IS NULL) unread
    FROM friends f JOIN users u ON u.id=f.b WHERE f.a=@me ORDER BY last_at DESC`).all({ me: req.uid });
  res.json(rows.map(r => ({ ...r, online: online.has(r.id) })));
});
app.get('/api/messages/:fid', auth, (req, res) => {
  const f = +req.params.fid;
  if (!isFriend(req.uid, f)) return res.status(403).json({ error: 'Not connected' });
  res.json(db.prepare(`SELECT * FROM (SELECT * FROM messages WHERE (from_id=@a AND to_id=@b) OR (from_id=@b AND to_id=@a) ORDER BY id DESC LIMIT 100) ORDER BY id`).all({ a: req.uid, b: f }));
});
app.post('/api/messages/:fid/read', auth, (req, res) => {
  const f = +req.params.fid;
  const r = db.prepare('UPDATE messages SET read_at=? WHERE from_id=? AND to_id=? AND read_at IS NULL').run(new Date().toISOString(), f, req.uid);
  if (r.changes) io.to('u' + f).emit('messages:read', { by: req.uid });
  res.json({ ok: true });
});

// ---------- Real-time ----------
io.use((s, next) => { try { s.uid = jwt.verify(s.handshake.auth.token, SECRET).id; next(); } catch { next(new Error('unauthorized')); } });
io.on('connection', s => {
  s.join('u' + s.uid);
  online.set(s.uid, (online.get(s.uid) || 0) + 1);
  io.emit('presence', { id: s.uid, online: true });
   s.on('message:send', ({ to, body, file }, ack) => {
    body = (body || '').trim();
    const f = file && typeof file.url === 'string' && file.url.startsWith('/uploads/') && !file.url.includes('..') ? file : null;
    if ((!body && !f) || body.length > 4000 || !isFriend(s.uid, to)) return ack?.({ error: 'Cannot send this message' });
    const r = db.prepare('INSERT INTO messages(from_id,to_id,body,file_url,file_name,file_type,file_size) VALUES(?,?,?,?,?,?,?)')
      .run(s.uid, to, body, f ? f.url : null, f ? String(f.name || 'file').slice(0, 200) : null, f ? String(f.type || '').slice(0, 100) : null, f ? Number(f.size) || 0 : null);
    io.to('u' + to).to('u' + s.uid).emit('message:new', db.prepare('SELECT * FROM messages WHERE id=?').get(r.lastInsertRowid));
    ack?.({ ok: true });
  });
  s.on('typing', ({ to }) => { if (isFriend(s.uid, to)) io.to('u' + to).emit('typing', { from: s.uid }); });
  s.on('disconnect', () => {
    const n = (online.get(s.uid) || 1) - 1;
    if (n) online.set(s.uid, n); else { online.delete(s.uid); io.emit('presence', { id: s.uid, online: false }); }
  });
});

server.listen(process.env.PORT || 4000, () => console.log('API + sockets on http://localhost:' + (process.env.PORT || 4000)));
