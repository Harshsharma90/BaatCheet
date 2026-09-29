import { useEffect, useRef, useState } from 'react';
import { api, connectSocket, upload } from './api';
import Profile from './Profile';
import Avatar from './Avatar';
import EmojiPicker from './EmojiPicker';

const time = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtSize = n => (!n ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.start();
    o.stop(ctx.currentTime + 0.15);
    o.onended = () => { ctx.close(); };
  } catch (e) { /* sound is optional */ }
}

function FileBubble({ m }) {
  if (!m.file_url) return null;
  if (/\.(jpe?g|png|gif|webp)$/i.test(m.file_url)) {
    return (
      <a href={m.file_url} target="_blank" rel="noreferrer">
        <img className="pic" src={m.file_url} alt={m.file_name || 'image'} />
      </a>
    );
  }
  return (
    <a className="file" href={m.file_url} download={m.file_name || ''} target="_blank" rel="noreferrer">
      <span style={{ fontSize: 24 }}>📄</span>
      <span><b>{m.file_name || 'File'}</b><small>{fmtSize(m.file_size)}</small></span>
    </a>
  );
}

export default function Chat({ user, onLogout }) {
  const [friends, setFriends] = useState([]);
  const [invites, setInvites] = useState([]);
  const [active, setActive] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [note, setNote] = useState('');
  const [me, setMe] = useState(user);
  const [showProfile, setShowProfile] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [notifPerm, setNotifPerm] = useState('Notification' in window ? Notification.permission : 'unsupported');
  const sock = useRef(null);
  const activeRef = useRef(null);
  const friendsRef = useRef([]);
  const msgsRef = useRef(null);
  const fileRef = useRef(null);
    const inputRef = useRef(null);
  const tTimer = useRef(null);
  activeRef.current = active;
  friendsRef.current = friends;

  const loadFriends = () => {
    api('/friends').then(d => { if (Array.isArray(d)) setFriends(d); }).catch(console.error);
  };
  const loadInvites = () => {
    api('/invites').then(d => { if (Array.isArray(d)) setInvites(d); }).catch(console.error);
  };

  // Connect once: load lists and listen for live events
  useEffect(() => {
    loadFriends();
    loadInvites();
    const s = connectSocket();
    sock.current = s;

    s.on('message:new', m => {
      const other = m.from_id === user.id ? m.to_id : m.from_id;
      if (m.from_id !== user.id) {
        const viewing = activeRef.current && activeRef.current.id === other && document.visibilityState === 'visible';
        if (!viewing) {
          beep();
          if ('Notification' in window && Notification.permission === 'granted') {
            const from = friendsRef.current.find(f => f.id === m.from_id);
            new Notification(from ? from.name : 'New message', { body: m.body || '📎 ' + (m.file_name || 'File') });
          }
        }
      }
      if (activeRef.current && activeRef.current.id === other) {
        setMsgs(x => [...x, m]);
        if (m.from_id !== user.id) {
          api('/messages/' + other + '/read', 'POST').then(loadFriends).catch(console.error);
          return;
        }
      }
      loadFriends();
    });
    s.on('messages:read', ({ by }) => {
      if (activeRef.current && activeRef.current.id === by) {
        setMsgs(x => x.map(m => (m.from_id === user.id && !m.read_at ? { ...m, read_at: new Date().toISOString() } : m)));
      }
    });
    s.on('typing', ({ from }) => {
      if (!activeRef.current || activeRef.current.id !== from) return;
      setTyping(true);
      clearTimeout(tTimer.current);
      tTimer.current = setTimeout(() => setTyping(false), 1500);
    });
    s.on('presence', ({ id, online }) => {
      setFriends(f => f.map(x => (x.id === id ? { ...x, online } : x)));
    });
    s.on('invite:new', loadInvites);
    s.on('friends:changed', () => { loadFriends(); loadInvites(); });

    return () => { s.disconnect(); };
  }, []);

  // Show total unread count in the browser tab title
  useEffect(() => {
    const total = friends.reduce((n, f) => n + (f.unread || 0), 0);
    document.title = total > 0 ? `(${total}) Chat` : 'Chat';
  }, [friends]);

  // Scroll the message area to the bottom (only that box, not the page)
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, typing]);

  // Debounced search by email
  useEffect(() => {
    if (q.trim().length < 3) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      api('/users/search?email=' + encodeURIComponent(q.trim()))
        .then(d => { if (Array.isArray(d)) setResults(d); })
        .catch(console.error);
    }, 300);
    return () => { clearTimeout(t); };
  }, [q]);

  async function open(f) {
    setActive(f);
    setTyping(false);
    setShowInfo(false);
    try {
      const list = await api('/messages/' + f.id);
      setMsgs(Array.isArray(list) ? list : []);
      await api('/messages/' + f.id + '/read', 'POST');
      loadFriends();
    } catch (e) { console.error(e); }
  }

  function send(e) {
    e.preventDefault();
    if (!text.trim() || !active) return;
      sock.current.emit('message:send', { to: active.id, body: text }, r => {
      if (r && r.error) alert(r.error);
    });
    setText('');
    setShowEmoji(false);
  }

  async function onPick(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !active) return;
    setUploading(true);
    try {
      const f = await upload('/upload', file);
      sock.current.emit('message:send', { to: active.id, body: text, file: f }, r => {
        if (r && r.error) alert(r.error);
      });
      setText('');
    } catch (err) {
      alert(err.message);
    }
    setUploading(false);
  }

    function addEmoji(em) {
    const el = inputRef.current;
    const s = el && el.selectionStart != null ? el.selectionStart : text.length;
    const en = el && el.selectionEnd != null ? el.selectionEnd : text.length;
    setText(text.slice(0, s) + em + text.slice(en));
    requestAnimationFrame(() => {
      if (el) { el.focus(); el.setSelectionRange(s + em.length, s + em.length); }
    });
  }

  function onType(e) {
    setText(e.target.value);
    if (active) sock.current.emit('typing', { to: active.id });
  }

  async function invite(email) {
    try {
      const r = await api('/invites', 'POST', { email });
      setNote(r.registered ? 'Invite sent!' : 'Not registered yet: invite link emailed.');
      setQ('');
    } catch (e) { setNote(e.message); }
  }

  async function respond(id, action) {
    try { await api(`/invites/${id}/${action}`, 'POST'); } catch (e) { console.error(e); }
    loadInvites();
    loadFriends();
  }

  async function enableNotifs() {
    const p = await Notification.requestPermission();
    setNotifPerm(p);
  }

  const email = q.trim().toLowerCase();
  const isEmail = /^\S+@\S+\.\S+$/.test(email);
  const showInviteByEmail = isEmail && !results.some(r => r.email === email);
  const activeFriend = (active && friends.find(f => f.id === active.id)) || active;

  return (
    <div className={'app' + (active ? ' has-active' : '')}>
      <aside>
        {showProfile && (
          <Profile me={me} onClose={() => setShowProfile(false)} onSaved={u => setMe(u)} onLogout={onLogout} />
        )}
        <header>
          <div className="me-head" onClick={() => setShowProfile(true)}>
            <Avatar name={me.name} url={me.avatarUrl} />
            <div><b>{me.name}</b><small>View profile</small></div>
          </div>
          <a onClick={onLogout}>Log out</a>
        </header>
        {notifPerm === 'default' && (
          <div className="search"><button onClick={enableNotifs}>🔔 Enable notifications</button></div>
        )}
        {notifPerm === 'denied' && (
          <p className="note" style={{ padding: '8px 12px' }}>
            Notifications are blocked. Click the lock icon in the address bar and allow Notifications.
          </p>
        )}
        <div className="search">
          <input placeholder="Search or invite by email" value={q} onChange={e => { setQ(e.target.value); setNote(''); }} />
          {note && <p className="note">{note}</p>}
          {results.map(r => (
            <div className="row" key={r.id}>
              <div><b>{r.name}</b><small>{r.email}</small></div>
              {r.friend ? <small>Connected</small> : <button onClick={() => invite(r.email)}>Invite</button>}
            </div>
          ))}
          {showInviteByEmail && (
            <div className="row"><small>{email}</small><button onClick={() => invite(email)}>Invite by email</button></div>
          )}
        </div>
        {invites.length > 0 && (
          <div className="invites">
            <small>Invitations</small>
            {invites.map(i => (
              <div className="row" key={i.id}>
                <div><b>{i.name}</b><small>{i.email}</small></div>
                <span>
                  <button onClick={() => respond(i.id, 'accept')}>Accept</button>{' '}
                  <button className="ghost" onClick={() => respond(i.id, 'decline')}>Decline</button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="list">
          {friends.length === 0 && <p className="empty">No chats yet. Search for a friend's email above.</p>}
          {friends.map(f => (
            <div key={f.id} className={'row chat' + (active && active.id === f.id ? ' sel' : '')} onClick={() => open(f)}>
              <Avatar name={f.name} url={f.avatar} online={f.online} />
              <div className="meta"><b>{f.name}</b><small>{f.last_body || 'Say hi!'}</small></div>
              <div className="right">
                {f.last_at && <small>{time(f.last_at)}</small>}
                {f.unread > 0 && <span className="badge">{f.unread}</span>}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main>
        {!active ? (
          <div className="placeholder">Select a chat to start messaging</div>
        ) : (
          <>
            {showInfo && activeFriend && (
              <div className="profile">
                <div className="top">
                  <a onClick={() => setShowInfo(false)}>‹</a>
                  <span>Contact info</span>
                </div>
                <div className="big">
                  {activeFriend.avatar ? <img src={activeFriend.avatar} alt="" /> : (activeFriend.name || '?')[0].toUpperCase()}
                </div>
                <div className="field"><label>Name</label><div>{activeFriend.name}</div></div>
                <div className="field"><label>About</label><div>{activeFriend.about || 'Hey there! I am using Chat.'}</div></div>
                <div className="field"><label>Email</label><div>{activeFriend.email}</div></div>
              </div>
            )}
            <header>
              <a className="back" onClick={() => { setActive(null); setShowInfo(false); }}>‹</a>
              <div className="chat-head" onClick={() => setShowInfo(true)}>
                <Avatar name={active.name} url={activeFriend && activeFriend.avatar} size={38} />
                <div>
                  <b>{active.name}</b>
                  <small>{typing ? 'typing…' : activeFriend && activeFriend.online ? 'online' : 'offline'}</small>
                </div>
              </div>
            </header>
            <div className="msgs" ref={msgsRef}>
              {msgs.map(m => (
                <div key={m.id} className={'msg ' + (m.from_id === user.id ? 'me' : 'them')}>
                  <FileBubble m={m} />
                  {m.body}
                  <small>
                    {time(m.created_at)}
                    {m.from_id === user.id && <span className={m.read_at ? 'read' : ''}> {m.read_at ? '✓✓' : '✓'}</span>}
                  </small>
                </div>
              ))}
              {typing && <div className="msg them">…</div>}
            </div>
                      <form className="composer" onSubmit={send}>
              {showEmoji && <EmojiPicker onPick={addEmoji} />}
              <input type="file" ref={fileRef} hidden onChange={onPick} />
              <button type="button" className="attach" onClick={() => setShowEmoji(!showEmoji)} title="Emojis">😊</button>
              <button type="button" className="attach" onClick={() => fileRef.current.click()} disabled={uploading} title="Attach a file">
                {uploading ? '⏳' : '📎'}
              </button>
              <input ref={inputRef} placeholder="Type a message" value={text} onChange={onType} autoFocus />
              <button className="primary">Send</button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}