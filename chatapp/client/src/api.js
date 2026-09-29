import { io } from 'socket.io-client';
export async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('token') },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
export const connectSocket = () => io({ auth: { token: localStorage.getItem('token') } });
export async function upload(path, file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api' + path, {
    method: 'POST', body: fd,
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Upload failed');
  return d;
}
