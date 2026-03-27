import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Database, LayoutDashboard, LogOut, Shield, Wallet } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import LoginPage from './components/LoginPage';
import AdminDashboard from './pages/AdminDashboard';
import BlockchainExplorer from './pages/BlockchainExplorer';
import UserWallet from './pages/UserWallet';
import { fetchCurrentUser, fetchOverview, getAuthToken, logout, setNetworkMode, wsUrl } from './api';

const TABS = [
  { id: 'admin', label: 'Operations', icon: LayoutDashboard },
  { id: 'wallet', label: 'Wallets', icon: Wallet },
  { id: 'explorer', label: 'Ledger', icon: Database },
];

function App() {
  const [activeTab, setActiveTab] = useState('admin');
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);
  const [syncMode, setSyncMode] = useState('live');
  const [selectedWalletId, setSelectedWalletId] = useState('');
  const [adminWorkspace, setAdminWorkspace] = useState('payments');
  const [transferDraft, setTransferDraft] = useState({
    senderId: '',
    recipientId: '',
    amount: '250',
    paymentTemplateId: '',
  });
  const wsRef = useRef(null);

  const refreshOverview = useCallback(async () => {
    try {
      const data = await fetchOverview();
      setOverview(data);
      setCurrentUser((previous) => data.current_user || previous);
      setError('');
      setSyncMode((previous) => (previous === 'offline' ? 'polling' : previous));
      return data;
    } catch (err) {
      if (!getAuthToken()) {
        setCurrentUser(null);
        setOverview(null);
      }
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialize = async () => {
      if (!getAuthToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await fetchCurrentUser();
        setCurrentUser(me);
        await refreshOverview();
      } catch (err) {
        setError(err.message);
        setCurrentUser(null);
        setLoading(false);
      }
    };

    void initialize();
  }, [refreshOverview]);

  useEffect(() => {
    if (!currentUser) return undefined;

    const socket = new WebSocket(wsUrl());
    socket.onopen = () => {
      setSyncMode('live');
    };
    socket.onmessage = () => {
      void refreshOverview();
    };
    socket.onerror = () => {
      setSyncMode('polling');
    };
    socket.onclose = () => {
      setSyncMode((previous) => (previous === 'live' ? 'polling' : previous));
    };
    wsRef.current = socket;

    return () => socket.close();
  }, [currentUser, refreshOverview]);

  useEffect(() => {
    if (!currentUser || syncMode !== 'polling') return undefined;

    const intervalId = window.setInterval(() => {
      void refreshOverview();
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [currentUser, refreshOverview, syncMode]);

  const handleModeChange = async (nextMode) => {
    if (overview?.mode === nextMode) return;

    setIsSwitchingMode(true);
    try {
      await setNetworkMode(nextMode);
      await refreshOverview();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSwitchingMode(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setCurrentUser(null);
    setOverview(null);
    setActiveTab('admin');
    setError('');
    setSelectedWalletId('');
    setAdminWorkspace('payments');
  };

  const handleLogin = useCallback(async (user) => {
    setCurrentUser(user);
    setLoading(true);
    try {
      await refreshOverview();
    } catch {
      // refreshOverview already sets the visible error state
    }
  }, [refreshOverview]);

  const usersById = useMemo(() => {
    const entries = (overview?.users || []).map((user) => [user.id, user]);
    return Object.fromEntries(entries);
  }, [overview]);

  if (!currentUser && !loading) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const sharedPageProps = {
    overview,
    refreshOverview,
    usersById,
    currentUser,
    navigateToTab: setActiveTab,
  };

  return (
    <div className="min-h-screen bg-background text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.18),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.12),_transparent_26%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1480px] flex-col px-4 py-4 sm:px-6 lg:px-8">
        <nav className="mb-6 rounded-[28px] border border-white/10 bg-slate-950/70 px-4 py-4 backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="rounded-2xl bg-gradient-to-br from-primary to-accent p-3 shadow-lg shadow-primary/30">
                <Shield size={24} className="text-white" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
                  {overview?.config?.visible_copy?.platform_title || 'CipherPay Network'}
                </p>
                <h1 className="text-2xl font-semibold text-white">
                  {overview?.config?.visible_copy?.platform_subtitle || 'Trusted payment operations and settlement'}
                </h1>
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="flex flex-wrap gap-2 rounded-2xl border border-white/8 bg-white/5 p-1.5">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                      activeTab === tab.id
                        ? 'bg-white text-slate-950 shadow'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <tab.icon size={16} />
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/5 px-3 py-2.5">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Signed in as</p>
                  <p className="text-sm font-medium text-white">
                    {currentUser?.name || currentUser?.username} · {currentUser?.role}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/8"
                >
                  <LogOut size={14} />
                  Logout
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/5 px-3 py-2.5">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Settlement mode</p>
                  <p className="text-sm font-medium text-white">
                    {overview?.mode === 'blockchain' ? 'Signed on-chain settlement' : 'Instant centralized clearing'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isSwitchingMode || !['admin', 'operator'].includes(currentUser?.role || '')}
                  onClick={() =>
                    handleModeChange(overview?.mode === 'blockchain' ? 'centralized' : 'blockchain')
                  }
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold transition ${
                    overview?.mode === 'blockchain'
                      ? 'bg-primary text-white'
                      : 'bg-amber-500/20 text-amber-200'
                  } ${isSwitchingMode ? 'opacity-60' : 'hover:opacity-90'}`}
                >
                  <Activity size={14} className={isSwitchingMode ? 'animate-pulse' : ''} />
                  {isSwitchingMode
                    ? 'Switching'
                    : overview?.mode === 'blockchain'
                      ? 'Blockchain'
                      : 'Centralized'}
                </button>
              </div>
            </div>
          </div>
        </nav>

        {syncMode === 'polling' ? (
          <div className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            Realtime sync is unavailable, so the app switched to safe auto-refresh mode.
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <main className="flex-1 pb-4">
          {loading || !overview ? (
            <div className="panel flex min-h-[300px] items-center justify-center text-slate-400">
              Loading network overview...
            </div>
          ) : null}

          {!loading && overview && activeTab === 'admin' ? (
            <ErrorBoundary title="Operations workspace hit an error">
              <AdminDashboard
                {...sharedPageProps}
                onModeChange={handleModeChange}
                isSwitchingMode={isSwitchingMode}
                activeWorkspace={adminWorkspace}
                onWorkspaceChange={setAdminWorkspace}
                transferForm={transferDraft}
                onTransferFormChange={setTransferDraft}
              />
            </ErrorBoundary>
          ) : null}

          {!loading && overview && activeTab === 'wallet' ? (
            <ErrorBoundary title="Wallet workspace hit an error">
              <UserWallet
                {...sharedPageProps}
                selectedWalletId={selectedWalletId}
                onSelectedWalletChange={setSelectedWalletId}
              />
            </ErrorBoundary>
          ) : null}
          {!loading && overview && activeTab === 'explorer' ? (
            <ErrorBoundary title="Ledger workspace hit an error">
              <BlockchainExplorer {...sharedPageProps} />
            </ErrorBoundary>
          ) : null}
        </main>
      </div>
    </div>
  );
}

export default App;
