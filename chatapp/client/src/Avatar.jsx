export default function Avatar({ name, url, size = 42, online }) {
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size / 2.5 }}>
      {url ? <img src={url} alt="" /> : (name || '?')[0].toUpperCase()}
      {online && <i />}
    </div>
  );
}