import React, { useState } from 'react';
import { Lock, Shield } from 'lucide-react';
import { login } from '../api';

const DEMO_ACCOUNTS = [
  { username: 'admin', password: 'admin123', role: 'Admin' },
  { username: 'alice', password: 'operator123', role: 'Operator' },
  { username: 'bob', password: 'viewer123', role: 'Viewer' },
];

const LoginPage = ({ onLogin }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await login(username, password);
      onLogin(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.18),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.12),_transparent_26%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-[1320px] items-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1.1fr)_420px]">
          <section className="panel p-8">
            <div className="flex items-center gap-4">
              <div className="rounded-2xl bg-gradient-to-br from-primary to-accent p-3 shadow-lg shadow-primary/30">
                <Shield size={28} className="text-white" />
              </div>
              <div>
                <p className="eyebrow">CipherPay v2</p>
                <h1 className="text-4xl font-semibold text-white">Payment operations with cryptographic settlement</h1>
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-[24px] border border-white/8 bg-slate-950/35 p-5 text-sm text-slate-300">
                Operational dashboard with centralized clearing and blockchain settlement.
              </div>
              <div className="rounded-[24px] border border-white/8 bg-slate-950/35 p-5 text-sm text-slate-300">
                Forensic ledger simulator that pauses settlement when chain history is tampered.
              </div>
              <div className="rounded-[24px] border border-white/8 bg-slate-950/35 p-5 text-sm text-slate-300">
                Role-based demo controls for balances, scenarios, attack simulation, and recovery.
              </div>
            </div>

            <div className="mt-8 rounded-[28px] border border-white/8 bg-slate-950/35 p-6">
              <p className="eyebrow">Demo accounts</p>
              <div className="mt-4 space-y-3">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.username}
                    type="button"
                    onClick={() => {
                      setUsername(account.username);
                      setPassword(account.password);
                    }}
                    className="flex w-full items-center justify-between rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10"
                  >
                    <div>
                      <div className="font-medium text-white">{account.role}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                        {account.username} / {account.password}
                      </div>
                    </div>
                    <Lock size={16} className="text-slate-300" />
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="panel p-8">
            <p className="eyebrow">Secure sign in</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Enter the operations console</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Local auth protects mutating actions such as ledger reset, balance override, attack toggles, and scenario application.
            </p>

            <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
              <label className="field">
                <span>Username</span>
                <input className="glass-input" value={username} onChange={(event) => setUsername(event.target.value)} />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  className="glass-input"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-2xl bg-gradient-to-r from-primary to-accent px-4 py-3.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {submitting ? 'Signing in...' : 'Sign in'}
              </button>

              {error ? (
                <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-rose-100">
                  {error}
                </div>
              ) : null}
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
