import React from "react";
import { Button } from "./ui/Button";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort crash containment for the renderer: an uncaught render error
 * shows a branded recovery screen instead of a blank window. Vault data lives
 * in SQLite on disk and is never affected by a renderer crash.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Kairo render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-surface px-6 text-center text-ink">
        <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted">
          An unexpected error stopped this view from rendering. Your data is safe —
          it lives in the local database and was not affected.
        </p>
        <pre className="max-w-xl overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-card p-3 text-left text-xs text-muted">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload Kairo
          </Button>
        </div>
      </div>
    );
  }
}
