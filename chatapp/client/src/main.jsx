import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

class Boundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err)
      return <pre style={{ padding: 20, color: 'crimson', whiteSpace: 'pre-wrap' }}>{String(this.state.err.stack || this.state.err)}</pre>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<Boundary><App /></Boundary>);