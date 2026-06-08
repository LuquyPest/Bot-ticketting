import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center min-h-64 p-12 gap-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20
                        flex items-center justify-center">
          <AlertTriangle size={24} className="text-red-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-ink-1 mb-1">Une erreur est survenue</p>
          <p className="text-xs text-ink-4 max-w-xs">
            {this.state.error?.message || 'Erreur inattendue'}
          </p>
        </div>
        <button
          onClick={() => this.setState({ hasError: false, error: null })}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-white/[0.08]
                     text-ink-2 text-sm hover:bg-surface-hover transition-colors"
        >
          <RefreshCw size={14} /> Réessayer
        </button>
      </div>
    );
  }
}
