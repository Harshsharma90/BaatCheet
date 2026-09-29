import { useState } from 'react';

const SETS = {
  '😀': ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋','😎','🤩','🥳','😏','😢','😭','😡','🤔','🙄','😴','🤗','😱','🥺','😬'],
  '👍': ['👍','👎','👏','🙌','🙏','💪','👌','✌️','🤞','🤝','👋','🤙','👀','🧠','🫶','💯','🔥','✨','🎉','🎂'],
  '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕','💖','💗','💘','😻','💋','🌹','🌸','🌈','☀️','⭐'],
  '🍕': ['🍕','🍔','🍟','🌭','🍿','🍩','🍪','🍫','🍦','☕','🍺','🍷','🥗','🍎','🍌','🍉','🍓','🍜','🍣','🥤'],
  '⚽': ['⚽','🏏','🏀','🎮','🎧','🎬','📷','💻','📱','🚗','✈️','🏠','📚','💡','🎁','💰','⏰','🔒','📎','✅'],
};

export default function EmojiPicker({ onPick }) {
  const [tab, setTab] = useState('😀');
  return (
    <div className="emoji-pop">
      <div className="emoji-tabs">
        {Object.keys(SETS).map(k => (
          <button type="button" key={k} className={k === tab ? 'on' : ''} onClick={() => setTab(k)}>{k}</button>
        ))}
      </div>
      <div className="emoji-grid">
        {SETS[tab].map(e => (
          <button type="button" key={e} onClick={() => onPick(e)}>{e}</button>
        ))}
      </div>
    </div>
  );
}