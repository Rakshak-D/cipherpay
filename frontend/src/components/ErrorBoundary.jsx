import React from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unknown rendering error',
    };
  }

  componentDidCatch() {
    // Rendering failures are surfaced to the user instead of blanking the whole app.
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <section className="panel p-6">
          <div className="rounded-[26px] border border-danger/25 bg-danger/10 p-6">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-black/20 p-3 text-rose-100">
                <AlertTriangle size={18} />
              </div>
              <div className="flex-1">
                <p className="eyebrow text-rose-200/70">Rendering safeguard</p>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  {this.props.title || 'This section hit a UI error'}
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-200">
                  The rest of the app is still available. Retry this panel after the latest data refresh instead of
                  losing the whole screen.
                </p>
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                  {this.state.errorMessage}
                </div>
                <button
                  type="button"
                  onClick={this.handleRetry}
                  className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  <RefreshCcw size={16} />
                  Retry section
                </button>
              </div>
            </div>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
