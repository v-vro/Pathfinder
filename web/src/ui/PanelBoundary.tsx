import { Component, type ReactNode } from 'react';

/** Contains a crash inside a panel so it can't take the whole app down. */
export class PanelBoundary extends Component<{ children: ReactNode; onClose: () => void }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(e: unknown) {
    return { error: String(e) };
  }

  componentDidCatch(e: unknown) {
    console.error('panel error', e);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="drawer">
        <div className="drawer-head">
          <h2>This panel hit an error</h2>
          <button className="icon-btn" onClick={this.props.onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="drawer-body">
          <p className="fine">Close it and open it again.</p>
        </div>
      </div>
    );
  }
}
