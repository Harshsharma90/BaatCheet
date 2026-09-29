import { useState } from 'react';
import { api, upload } from './api';

export default function Profile({ me, onClose, onSaved, onLogout }) {
  const [name, setName] = useState(me.name);
  const [about, setAbout] = useState(me.about || '');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      const u = await api('/profile', 'PUT', { name, about });
      onSaved(u);
      setMsg('Saved!');
    } catch (e) {
      setMsg(e.message);
    }
    setSaving(false);
  }

  async function pickPhoto(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setMsg('Uploading...');
    try {
      const u = await upload('/profile/photo', file);
      onSaved(u);
      setMsg('Photo updated!');
    } catch (err) {
      setMsg(err.message);
    }
  }

  const joined = me.createdAt
    ? new Date(me.createdAt).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="profile">
      <div className="top">
        <a onClick={onClose}>‹</a>
        <span>Profile</span>
      </div>

      <label className="big" style={{ cursor: 'pointer' }}>
        {me.avatarUrl ? <img src={me.avatarUrl} alt="" /> : (me.name || '?')[0].toUpperCase()}
        <input type="file" accept="image/*" hidden onChange={pickPhoto} />
        <span className="cam">📷 Change</span>
      </label>

      <div className="field">
        <label>Your name</label>
        <input value={name} maxLength={50} onChange={e => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>About</label>
        <input value={about} maxLength={140} placeholder="Hey there! I am using Chat." onChange={e => setAbout(e.target.value)} />
      </div>
      <div className="field">
        <label>Email</label>
        <input value={me.email} disabled />
      </div>
      {joined && (
        <div className="field">
          <label>Member since</label>
          <input value={joined} disabled />
        </div>
      )}

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {msg && <small style={{ textAlign: 'center' }}>{msg}</small>}
        <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
        <button className="ghost" onClick={onLogout}>Log out</button>
      </div>
    </div>
  );
}