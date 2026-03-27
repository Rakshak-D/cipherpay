import React, { useEffect, useMemo, useState } from 'react';
import { Fingerprint, History, ShieldAlert, ShieldCheck, Wallet } from 'lucide-react';
import ForensicDiffCard from '../components/ForensicDiffCard';
import TransactionCard from '../components/TransactionCard';
import { filterGroupedActivity, groupTransactionActivity } from '../lib/activity';
import { formatCurrency } from '../lib/formatting';
import { resolveSelectedWalletId } from '../lib/uiState';

const FILTERS = [
  { id: 'all', label: 'All activity' },
  { id: 'initiated', label: 'User initiated' },
  { id: 'outgoing', label: 'Outgoing only' },
  { id: 'incoming', label: 'Incoming only' },
  { id: 'failed', label: 'Failed or blocked' },
  { id: 'attack-generated', label: 'Security linked' },
];

function formatMaybeCurrency(value, config) {
  return value == null ? 'Unavailable' : formatCurrency(value, config);
}

const UserWallet = ({
  overview,
  usersById,
  navigateToTab,
  selectedWalletId,
  onSelectedWalletChange,
}) => {
  const wallets = useMemo(() => overview.users, [overview.users]);
  const [historyFilter, setHistoryFilter] = useState('all');
  const resolvedSelectedUserId = resolveSelectedWalletId(wallets, selectedWalletId);

  useEffect(() => {
    if (resolvedSelectedUserId && String(selectedWalletId || '') !== resolvedSelectedUserId) {
      onSelectedWalletChange?.(resolvedSelectedUserId);
    }
  }, [onSelectedWalletChange, resolvedSelectedUserId, selectedWalletId]);

  const selectedUserId = resolvedSelectedUserId;
  const activeUser = wallets.find((user) => String(user.id) === String(selectedUserId));

  const groupedActivity = useMemo(
    () => groupTransactionActivity(overview.transactions, selectedUserId),
    [overview.transactions, selectedUserId]
  );
  const filteredActivity = useMemo(
    () => filterGroupedActivity(groupedActivity, historyFilter, selectedUserId),
    [groupedActivity, historyFilter, selectedUserId]
  );

  const signedHistory = useMemo(() => {
    if (!activeUser) return [];
    return groupedActivity.filter(
      (group) =>
        group.payment.mode === 'blockchain' &&
        group.payment.status !== 'rejected' &&
        String(group.payment.sender_id) === String(activeUser.id)
    );
  }, [activeUser, groupedActivity]);

  const recentSecurityGroups = useMemo(
    () => filteredActivity.filter((group) => group.securityEvents.length > 0).slice(0, 3),
    [filteredActivity]
  );
  const recentAttackLogs = useMemo(() => overview.attack_logs.slice(0, 2), [overview.attack_logs]);

  const diagnostics = [
    {
      label: 'Database',
      value: formatCurrency(activeUser?.database_balance || 0, overview.config),
      helper: 'Operational balance used in centralized mode.',
      tone: 'text-white',
    },
    {
      label: 'Chain',
      value: formatMaybeCurrency(activeUser?.chain_balance, overview.config),
      helper: activeUser?.chain_balance_available
        ? 'Verified from the active or last trusted ledger state.'
        : 'Chain balance is unavailable until blockchain state is rebuilt.',
      tone: 'text-cyan-200',
    },
    {
      label: 'Difference',
      value: activeUser?.balance_difference == null
        ? 'Unavailable'
        : formatCurrency(activeUser.balance_difference || 0, overview.config),
      helper: activeUser?.balance_difference
        ? 'Mismatch detected between database and chain views.'
        : 'Database and chain are aligned.',
      tone: activeUser?.balance_difference ? 'text-amber-300' : 'text-emerald-300',
    },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="space-y-6">
        <div className="panel p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-2xl bg-accent/15 p-3 text-accent">
              <Wallet size={18} />
            </div>
            <div>
              <p className="eyebrow">Wallet selector</p>
              <h2 className="text-xl font-semibold text-white">Choose an account identity</h2>
            </div>
          </div>

          <label className="field">
            <span>Active wallet</span>
            <select
              className="glass-input"
              value={selectedUserId}
              onChange={(event) => onSelectedWalletChange?.(event.target.value)}
            >
              {wallets.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} {user.is_admin ? '· System wallet' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-5 rounded-[26px] bg-[linear-gradient(145deg,rgba(37,99,235,0.18),rgba(8,47,73,0.45))] p-6">
            <p className="eyebrow text-sky-100/70">Spendable balance</p>
            <p className="mt-4 text-4xl font-semibold text-white">
              {formatMaybeCurrency(activeUser?.spendable_balance, overview.config)}
            </p>
            <p className="mt-3 text-sm text-sky-50/80">
              Source: {activeUser?.spendable_balance_source || 'unavailable'}
            </p>
          </div>

          <div className="mt-5 rounded-[22px] border border-white/8 bg-slate-950/35 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Diagnostics</p>
                <h3 className="text-base font-semibold text-white">Balance provenance</h3>
              </div>
              <button
                type="button"
                onClick={() => navigateToTab?.('admin')}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/10"
              >
                Open operations
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              {diagnostics.map((card) => (
                <div key={card.label} className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{card.label}</p>
                    <p className={`text-sm font-semibold ${card.tone}`}>{card.value}</p>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{card.helper}</p>
                </div>
              ))}
            </div>
          </div>

          {overview.mode === 'blockchain' ? (
            <div className="mt-4 rounded-[22px] border border-white/8 bg-slate-950/35 p-4 text-sm leading-6 text-slate-300">
              <span className="font-semibold text-white">Chain balance source:</span>{' '}
              {activeUser?.chain_balance_source === 'last_trusted_block'
                ? 'Frozen at the last trusted block because the active chain has been tampered.'
                : activeUser?.chain_balance_source === 'continuity_epoch'
                  ? 'Derived from the active continuity epoch after an earlier compromised epoch was archived.'
                  : 'Derived from the current active blockchain.'}
            </div>
          ) : null}
        </div>

        <div className="panel p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-2xl bg-white/8 p-3 text-slate-200">
              <Fingerprint size={18} />
            </div>
            <div>
              <p className="eyebrow">Identity</p>
              <h3 className="text-lg font-semibold text-white">Registered public key</h3>
            </div>
          </div>

          <div className="rounded-[22px] border border-white/8 bg-slate-950/40 p-4">
            <pre className="custom-scrollbar max-h-[240px] overflow-y-auto whitespace-pre-wrap break-all text-[11px] leading-5 text-slate-300">
              {activeUser?.public_key || 'No public key registered.'}
            </pre>
          </div>
        </div>

        <div className="panel p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-2xl bg-danger/15 p-3 text-danger">
              <ShieldAlert size={18} />
            </div>
            <div>
              <p className="eyebrow">Security trace</p>
              <h3 className="text-lg font-semibold text-white">Linked protection and attack evidence</h3>
            </div>
          </div>

          {recentSecurityGroups.length > 0 ? (
            <div className="space-y-3">
              {recentSecurityGroups.map((group) => (
                <div key={group.payment.tx_uuid} className="rounded-[20px] border border-white/8 bg-white/5 p-4">
                  <div className="font-medium text-white">{group.payment.payment_label}</div>
                  <div className="mt-1 text-sm text-slate-300">{group.payment.display_status}</div>
                  <div className="mt-3 space-y-2">
                    {group.securityEvents.map((event) => (
                      <div key={event.id} className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                        <div className="font-medium">{event.payment_label}</div>
                        <div className="mt-1 text-amber-50/80">{event.explanation}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : recentAttackLogs.length > 0 ? (
            <div className="space-y-2">
              {recentAttackLogs.map((log, index) => (
                <ForensicDiffCard key={`${log.attack_type}-${log.timestamp}-${index}`} log={log} compact />
              ))}
            </div>
          ) : (
            <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500">
              No recent security events were linked to this wallet.
            </div>
          )}
        </div>

        <div className="panel p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-2xl bg-primary/15 p-3 text-primary">
              <ShieldCheck size={18} />
            </div>
            <div>
              <p className="eyebrow">Signed settlement history</p>
              <h3 className="text-lg font-semibold text-white">Outbound on-chain transfers</h3>
            </div>
          </div>

          {overview.mode !== 'blockchain' ? (
            <p className="rounded-[20px] border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
              Switch the network to blockchain mode to inspect signed settlement history.
            </p>
          ) : signedHistory.length === 0 ? (
            <p className="rounded-[20px] border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
              No successful blockchain transfers have been sent from this wallet yet.
            </p>
          ) : (
            <div className="space-y-3">
              {signedHistory.map((group) => (
                <div key={group.payment.tx_uuid} className="rounded-[20px] border border-white/8 bg-slate-950/40 p-4">
                  <p className="text-sm font-medium text-white">
                    Sent to {usersById[group.payment.recipient_id]?.name || `User ${group.payment.recipient_id}`}
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                    {formatCurrency(group.displayAmount, overview.config)} ·{' '}
                    {new Date(group.payment.timestamp * 1000).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel p-6">
        <div className="mb-5 flex items-center justify-between gap-3 border-b border-white/8 pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white/8 p-3 text-slate-200">
              <History size={18} />
            </div>
            <div>
              <p className="eyebrow">Transaction activity</p>
              <h2 className="text-xl font-semibold text-white">Wallet ledger</h2>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setHistoryFilter(filter.id)}
                className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                  historyFilter === filter.id
                    ? 'bg-white text-slate-950'
                    : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {filteredActivity.length === 0 ? (
          <div className="flex min-h-[220px] items-center justify-center rounded-[24px] border border-dashed border-white/10 text-sm text-slate-500">
            No transfers found for this wallet.
          </div>
        ) : (
          <div className="custom-scrollbar max-h-[720px] space-y-3 overflow-y-auto pr-1">
            {filteredActivity.map((group) => (
              <TransactionCard
                key={group.payment.tx_uuid}
                group={group}
                activeUserId={Number(selectedUserId)}
                usersById={usersById}
                config={overview.config}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default UserWallet;
