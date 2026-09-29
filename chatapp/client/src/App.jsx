import { useEffect, useState } from 'react';
import { api } from './api';
import Chat from './Chat';

const params = new URLSearchParams(location.search);

const svg = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const I = {
  mail: <svg {...svg}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>,
  lock: <svg {...svg}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>,
  user: <svg {...svg}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
  eye: <svg {...svg}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  eyeOff: <svg {...svg}><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.1-5.9M9.9 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2M1 1l22 22" /></svg>,
};

const TEXT = {
  login: ['Welcome back', 'Log in to continue chatting'],
  signup: ['Create your account', 'It only takes a minute'],
  forgot: ['Forgot password?', "Enter your email and we'll send you a reset link"],
  reset: ['Set a new password', 'Choose a password you will remember'],
};
const BTN = { login: 'Log in', signup: 'Create account', forgot: 'Send reset link', reset: 'Update password' };

function Field({ icon, password, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className="fld">
      <span className="ico">{icon}</span>
      <input {...props} type={password ? (show ? 'text' : 'password') : props.type || 'text'} />
      {password && (
        <button type="button" className="eye" tabIndex={-1} onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? I.eyeOff : I.eye}
        </button>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem('token')) { setReady(true); return; }
    api('/me').then(setUser).catch(() => localStorage.removeItem('token')).finally(() => setReady(true));
  }, []);
  if (!ready) return null;
  if (user) return <Chat user={user} onLogout={() => { localStorage.removeItem('token'); setUser(null); }} />;
  return <Auth onAuth={({ token, user }) => { localStorage.setItem('token', token); history.replaceState({}, '', '/'); setUser(user); }} />;
}

function Auth({ onAuth }) {
  const [mode, setMode] = useState(params.get('reset') ? 'reset' : params.get('invite') ? 'signup' : 'login');
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviter, setInviter] = useState('');
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const go = m => { setMode(m); setErr(''); setMsg(''); setF(x => ({ ...x, password: '', confirm: '' })); };

  useEffect(() => {
    const t = params.get('invite');
    if (t) {
      api('/invites/by-token/' + t)
        .then(i => { setF(x => ({ ...x, email: i.email })); setInviter(i.fromName); })
        .catch(() => {});
    }
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setMsg('');
    if ((mode === 'signup' || mode === 'reset') && f.password !== f.confirm) {
      setErr('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        onAuth(await api('/auth/login', 'POST', { email: f.email, password: f.password }));
      } else if (mode === 'signup') {
        onAuth(await api('/auth/signup', 'POST', { name: f.name, email: f.email, password: f.password }));
      } else if (mode === 'forgot') {
        await api('/auth/forgot', 'POST', { email: f.email });
        setMsg('If that email is registered, a reset link is on its way. Check your inbox and spam folder.');
      } else {
        await api('/auth/reset', 'POST', { token: params.get('reset'), password: f.password });
        history.replaceState({}, '', '/');
        go('login');
        setMsg('Password updated. You can log in now.');
      }
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  }

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="logo">💬 ChatApp</div>
        <h1>Stay connected with the people who matter.</h1>
        <p>Fast, private conversations that feel instant, wherever you are.</p>
        <ul>
          <li>⚡ Real-time messaging</li>
          <li>📎 Share photos and files</li>
          <li>😊 Emojis and read receipts</li>
          <li>🔔 Instant notifications</li>
        </ul>
      </div>

      <div className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="card-logo">💬 ChatApp</div>
          <h2>{TEXT[mode][0]}</h2>
          <p className="sub">{TEXT[mode][1]}</p>

          {inviter && mode === 'signup' && (
            <div className="auth-msg ok"><b>{inviter}</b> invited you to chat. Sign up to accept!</div>
          )}

          {mode === 'signup' && (
            <Field icon={I.user} placeholder="Full name" value={f.name} onChange={set('name')} required />
          )}
          {mode !== 'reset' && (
            <Field icon={I.mail} type="email" placeholder="Email address" value={f.email} onChange={set('email')} required />
          )}
          {mode !== 'forgot' && (
            <Field icon={I.lock} password placeholder={mode === 'reset' ? 'New password' : 'Password'} value={f.password} onChange={set('password')} required minLength={6} />
          )}
          {(mode === 'signup' || mode === 'reset') && (
            <Field icon={I.lock} password placeholder="Confirm password" value={f.confirm} onChange={set('confirm')} required minLength={6} />
          )}

          {err && <div className="auth-msg err">{err}</div>}
          {msg && <div className="auth-msg ok">{msg}</div>}

          <button className="btn-main" disabled={busy}>{busy ? 'Please wait...' : BTN[mode]}</button>

          <div className="auth-links">
            {mode === 'login' && (
              <>
                <a onClick={() => go('forgot')}>Forgot password?</a>
                <a onClick={() => go('signup')}>Create account</a>
              </>
            )}
            {mode === 'signup' && <a onClick={() => go('login')}>Already have an account? Log in</a>}
            {(mode === 'forgot' || mode === 'reset') && <a onClick={() => go('login')}>Back to log in</a>}
          </div>
        </form>
      </div>
    </div>
  );
}