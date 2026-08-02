import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Without this, any throw during render unmounts the whole tree and leaves a
 * blank white page with the reason only in the console. The map is the most
 * likely source — it renders coordinates straight from the API into Leaflet —
 * and a blank page gives a user nothing to act on and nothing to report.
 *
 * Still a class: React has no hook equivalent of componentDidCatch.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled error in the MarketScope UI', error, info);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="shell">
        <header className="shell__header">
          <span className="shell__brand">MarketScope</span>
        </header>
        <main className="shell__main">
          <h1 className="shell__title">Something broke</h1>
          <p className="shell__subtitle">
            The page could not be rendered. This is a bug in the app, not
            something you did.
          </p>

          <div className="error-box" role="alert">
            <p className="error-box__message">{error.message}</p>
            <p className="error-box__hint">
              The full stack trace is in the browser console.
            </p>
          </div>

          <div className="actions">
            {/* A full load rather than a router navigation: the tree that
                threw is discarded along with whatever state caused it. */}
            <a className="button button--primary" href="/">
              Reload the dashboard
            </a>
          </div>
        </main>
      </div>
    );
  }
}
