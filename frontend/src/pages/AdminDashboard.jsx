import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  ArrowRight,
  BookOpen,
  Landmark,
  RotateCcw,
  Send,
  Settings2,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  TrendingUp,
  Users,
} from 'lucide-react';
import AttackPanel from '../components/AttackPanel';
import { applyScenario, clearHistory, resetLedger, resetSystem, submitTransfer, updateBalance } from '../api';
import { formatCurrency } from '../lib/formatting';
import { buildTransferFormDraft } from '../lib/uiState';

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const WORKSPACES = [
  { id: 'payments', label: 'Payments Desk' },
  { id: 'operations', label: 'Operations' },
  { id: 'training', label: 'Training Mode' },
];

const USE_CASES = [
  {
    title: 'Merchant payouts',
    description:
      'Settle sellers or delivery partners with fast routing in normal mode and signed settlement when auditability matters.',
  },
  {
    title: 'Payroll and stipends',
    description:
      'Run salary or stipend disbursements with replay protection, explainable failures, and ledger-backed verification.',
  },
  {
    title: 'Vendor reimbursements',
    description:
      'Give treasury teams balance provenance, forensic recovery, and controlled admin overrides for exceptional operations.',
  },
];

const RAIL_DETAILS = {
  centralized: {
    title: 'Centralized clearing rail',
    summary: 'Best for fast internal movement of money where a trusted operator controls the database and payout process.',
    points: [
      'Balances update immediately in the operational database.',
      'Useful for batch payouts, refunds, and internal treasury movements.',
      'Admin controls can reset, reseed, and edit balances quickly for demos or recovery.',
    ],
  },
  blockchain: {
    title: 'Blockchain settlement rail',
    summary: 'Best when you need signed authorization, replay resistance, tamper detection, and an auditable settlement trail.',
    points: [
      'Transfers are signed and verified before they are accepted.',
      'Replay protection prevents the same transaction reference from executing twice.',
      'Continuity mode preserves compromised history while trusted settlement continues.',
    ],
  },
};

const AdminDashboard = ({
  overview,
  refreshOverview,
  onModeChange,
  isSwitchingMode,
  currentUser,
  navigateToTab,
  activeWorkspace,
  onWorkspaceChange,
  transferForm,
  onTransferFormChange,
}) => {
  const [selectedKpiLabel, setSelectedKpiLabel] = useState('Settlement rail');
  const [selectedRail, setSelectedRail] = useState('centralized');
  const [balanceForm, setBalanceForm] = useState({ userId: '', balance: '', resetLedger: true });
  const [submitting, setSubmitting] = useState(false);
  const [adminBusy, setAdminBusy] = useState('');
  const [feedback, setFeedback] = useState(null);

  const participants = useMemo(
    () => (overview?.users || []).filter((user) => !user.is_attacker),
    [overview?.users]
  );
  const paymentTemplates = useMemo(
    () => overview?.config?.payment_templates || [],
    [overview?.config?.payment_templates]
  );
  const customerUsers = useMemo(
    () => participants.filter((user) => !user.is_admin),
    [participants]
  );
  const canOperate = ['admin', 'operator'].includes(currentUser?.role || '');
  const canAdmin = currentUser?.role === 'admin';

  useEffect(() => {
    if (
      (!transferForm.senderId || !transferForm.recipientId || !transferForm.paymentTemplateId) &&
      participants.length &&
      customerUsers.length
    ) {
      onTransferFormChange(buildTransferFormDraft(transferForm, participants, customerUsers, paymentTemplates));
    }

    if (!balanceForm.userId && overview?.users?.length) {
      const firstEditable = overview.users.find((user) => !user.is_admin) || overview.users[0];
      setBalanceForm({
        userId: String(firstEditable.id),
        balance: String(firstEditable.balance ?? 0),
        resetLedger: true,
      });
    }
  }, [
    balanceForm.userId,
    customerUsers,
    overview?.users,
    participants,
    paymentTemplates,
    transferForm,
    onTransferFormChange,
  ]);

  useEffect(() => {
    if (!balanceForm.userId) return;
    const selectedUser = overview.users.find((user) => String(user.id) === String(balanceForm.userId));
    if (!selectedUser) return;
    setBalanceForm((current) => ({
      ...current,
      balance: String(selectedUser.balance ?? 0),
    }));
  }, [balanceForm.userId, overview.users]);

  const recipientOptions = useMemo(
    () => participants.filter((user) => String(user.id) !== String(transferForm.senderId)),
    [participants, transferForm.senderId]
  );
  const selectedPaymentTemplate = paymentTemplates.find(
    (template) => template.id === transferForm.paymentTemplateId
  );

  const kpis = [
    {
      label: 'Participants',
      value: overview.users.length,
      hint: 'All registered payment identities',
      icon: Users,
      detail: 'This counts every registered operational identity, including treasury/admin accounts that fund or supervise flows.',
      actionLabel: 'Open wallets',
      onAction: () => navigateToTab?.('wallet'),
    },
    {
      label: 'Processed transfers',
      value: overview.metrics.transaction_count,
      hint: 'Historical settlement requests',
      icon: ArrowRightLeft,
      detail: 'Includes successful, rejected, and attack-generated requests so operators can inspect the full operational history.',
      actionLabel: 'View ledger',
      onAction: () => navigateToTab?.('wallet'),
    },
    {
      label: 'Transferred volume',
      value: formatCurrency(overview.metrics.total_volume || 0, overview.config),
      hint: 'Across current ledger history',
      icon: TrendingUp,
      detail: 'Shows total request volume across the current history window and helps compare payout activity across scenarios.',
      actionLabel: 'Open payments',
      onAction: () => onWorkspaceChange('payments'),
    },
    {
      label: 'Settlement rail',
      value: overview.mode === 'blockchain' ? 'Signed ledger' : 'Central processor',
      hint: overview.mode === 'blockchain' ? 'Immutable audit trail enabled' : 'Fast internal routing',
      icon: Shield,
      detail:
        overview.mode === 'blockchain'
          ? 'Blockchain mode is active, so transfers are signed and ledger-derived balances become the trusted source.'
          : 'Centralized mode is active, so payouts clear directly against the payments database for maximum speed.',
      actionLabel: overview.mode === 'blockchain' ? 'Use centralized' : 'Use blockchain',
      onAction: () => onModeChange(overview.mode === 'blockchain' ? 'centralized' : 'blockchain'),
    },
  ];
  const selectedKpi = kpis.find((item) => item.label === selectedKpiLabel) || kpis[0];
  const operatorPlaybook = [
    {
      title: 'Prepare a transfer',
      description: 'Pick a real payment flow, set sender and recipient wallets, and run the settlement request.',
      actionLabel: 'Go to payments',
      onAction: () => onWorkspaceChange('payments'),
    },
    {
      title: 'Watch user impact',
      description: 'Open wallet history to see spendable balance, provenance, and any suspicious activity.',
      actionLabel: 'Open wallets',
      onAction: () => navigateToTab?.('wallet'),
    },
    {
      title: 'Inspect ledger evidence',
      description: 'Use the ledger view to trace continuity epochs, tampered blocks, and archived history.',
      actionLabel: 'Open ledger',
      onAction: () => navigateToTab?.('explorer'),
    },
  ];

  const handleTransfer = async (event) => {
    event.preventDefault();
    setFeedback(null);

    const payload = {
      id: generateId(),
      sender_id: Number(transferForm.senderId),
      recipient_id: Number(transferForm.recipientId),
      amount: Number(transferForm.amount),
      mode: overview.mode,
      payment_template_id: transferForm.paymentTemplateId || null,
    };

    if (!payload.sender_id || !payload.recipient_id || !payload.amount) {
      setFeedback({ type: 'error', text: 'Please choose valid wallets and an amount.' });
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitTransfer(payload);
      await refreshOverview();
      setFeedback({
        type: result.status === 'rejected' ? 'error' : result.status === 'intercepted' ? 'warning' : 'success',
        text: result.message || `${selectedPaymentTemplate?.label || 'Transfer'} processed.`,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const runAdminAction = async (actionKey, action) => {
    setFeedback(null);
    setAdminBusy(actionKey);
    try {
      const result = await action();
      await refreshOverview();
      setFeedback({ type: 'success', text: result.message || 'Admin action completed.' });
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setAdminBusy('');
    }
  };

  const selectedBalanceUser = overview.users.find((user) => String(user.id) === String(balanceForm.userId));
  const applyPaymentTemplate = (template) => {
    onTransferFormChange({
      senderId: String(template.default_sender_id),
      recipientId: String(template.default_recipient_id),
      amount: String(template.default_amount),
      paymentTemplateId: template.id,
    });
  };

  useEffect(() => {
    setSelectedRail(overview.mode === 'blockchain' ? 'blockchain' : 'centralized');
  }, [overview.mode]);

  return (
    <div className="space-y-6">
      <section className="panel overflow-hidden">
        <div className="grid gap-5 border-b border-white/8 px-6 py-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div>
            <p className="eyebrow">Operations command center</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">A treasury and payout app, not just a blockchain demo</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              CipherPay is most useful for merchant payouts, payroll-style disbursements, and vendor reimbursements
              where operators need fast clearing, clear failure reasons, and a signed settlement rail when trust or
              auditability matters.
            </p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
            <p className="eyebrow">Recommended operating posture</p>
            <div className="mt-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-xl font-semibold text-white">
                  {overview.insights?.recommended_mode === 'blockchain'
                    ? 'Use blockchain verification'
                    : 'Use centralized clearing'}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{overview.insights?.next_action}</p>
              </div>
              <button
                type="button"
                onClick={() => onModeChange(overview.mode === 'blockchain' ? 'centralized' : 'blockchain')}
                disabled={isSwitchingMode || !canOperate}
                className="rounded-full border border-white/10 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {isSwitchingMode
                  ? 'Updating...'
                  : overview.mode === 'blockchain'
                    ? 'Use centralized'
                    : 'Use blockchain'}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-6 py-6 md:grid-cols-2 xl:grid-cols-4">
          {kpis.map((item) => (
            <div
              key={item.label}
              onClick={() => setSelectedKpiLabel(item.label)}
              className={`group rounded-[22px] border bg-slate-950/45 p-4 text-left transition ${
                selectedKpiLabel === item.label
                  ? 'border-primary/35'
                  : 'border-white/8 hover:-translate-y-1 hover:border-white/15'
              }`}
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/8 text-accent">
                <item.icon size={18} />
              </div>
              <p className="text-sm text-slate-400">{item.label}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{item.value}</p>
              <p className="mt-2 text-xs uppercase tracking-[0.25em] text-slate-500">{item.hint}</p>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  item.onAction();
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/10"
              >
                {item.actionLabel}
                <ArrowRight size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-white/8 px-6 py-5">
          <div className="rounded-[22px] border border-white/8 bg-slate-950/35 p-4 text-sm leading-6 text-slate-300">
            <span className="font-semibold text-white">{selectedKpi.label}:</span> {selectedKpi.detail}
          </div>
        </div>
      </section>

      <section className="flex flex-wrap gap-2">
        {WORKSPACES.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            onClick={() => onWorkspaceChange(workspace.id)}
            className={`rounded-full px-4 py-2.5 text-sm font-semibold transition ${
              activeWorkspace === workspace.id
                ? 'bg-white text-slate-950 shadow'
                : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            {workspace.label}
          </button>
        ))}
      </section>

      {feedback ? (
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
              : feedback.type === 'warning'
                ? 'border border-amber-400/30 bg-amber-500/10 text-amber-100'
              : 'border border-danger/30 bg-danger/10 text-rose-100'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {activeWorkspace === 'operations' ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_380px]">
          <section className="space-y-6">
            <div className="panel p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl bg-accent/15 p-3 text-accent">
                  <Landmark size={20} />
                </div>
                <div>
                  <p className="eyebrow">Why a user would choose this</p>
                  <h3 className="text-xl font-semibold text-white">Real operating stories</h3>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                {USE_CASES.map((item) => (
                  <div key={item.title} className="rounded-[24px] border border-white/8 bg-slate-950/35 p-5">
                    <div className="text-lg font-semibold text-white">{item.title}</div>
                    <div className="mt-3 text-sm leading-6 text-slate-300">{item.description}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl bg-white/8 p-3 text-slate-100">
                  <BookOpen size={18} />
                </div>
                <div>
                  <p className="eyebrow">Operator playbook</p>
                  <h3 className="text-xl font-semibold text-white">Use the product like a real ops desk</h3>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                {operatorPlaybook.map((step) => (
                  <div
                    key={step.title}
                    className="group rounded-[22px] border border-white/8 bg-white/5 p-4 text-sm leading-6 text-slate-300 transition hover:-translate-y-1 hover:border-white/15"
                  >
                    <div className="text-base font-semibold text-white">{step.title}</div>
                    <div className="mt-2">{step.description}</div>
                    <button
                      type="button"
                      onClick={step.onAction}
                      className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/50 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
                    >
                      {step.actionLabel}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <div className="panel p-6">
              <p className="eyebrow">System focus</p>
              <h3 className="mt-2 text-xl font-semibold text-white">Recommended next step</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">{overview.insights?.operational_focus}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onWorkspaceChange('payments')}
                  className="rounded-2xl bg-gradient-to-r from-primary to-accent px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110"
                >
                  Open payments desk
                </button>
                <button
                  type="button"
                  onClick={() => onWorkspaceChange('training')}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  Open training mode
                </button>
                <button
                  type="button"
                  onClick={() => navigateToTab?.('explorer')}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  Open ledger explorer
                </button>
              </div>
            </div>

            <div className="panel p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-2xl bg-danger/15 p-3 text-danger">
                  <ShieldAlert size={18} />
                </div>
                <div>
                  <p className="eyebrow">Live alerts</p>
                  <h3 className="text-xl font-semibold text-white">Operator attention</h3>
                </div>
              </div>

              <div className="space-y-3">
                {(overview.insights?.active_alerts || []).length === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-white/10 px-4 py-8 text-sm text-slate-500">
                    No active alerts. The system is operating in a clean baseline state.
                  </div>
                ) : (
                  overview.insights.active_alerts.map((alert) => (
                    <div key={alert.id} className="rounded-[22px] border border-white/8 bg-white/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-white">{alert.title}</div>
                        <span className="rounded-full bg-danger/15 px-2.5 py-1 text-[11px] uppercase tracking-[0.22em] text-rose-200">
                          {alert.severity}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-slate-300">{alert.message}</div>
                      <div className="mt-3 text-sm text-slate-400">{alert.recommended_action}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {activeWorkspace === 'payments' ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <section className="panel p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-2xl bg-accent/15 p-3 text-accent">
                <Landmark size={20} />
              </div>
              <div>
                <p className="eyebrow">Settlement request</p>
                <h3 className="text-xl font-semibold text-white">Create a live payment instruction</h3>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleTransfer}>
              <div>
                <span className="mb-3 block text-sm font-medium text-slate-200">Payment scenario</span>
                <div className="grid gap-3 md:grid-cols-2">
                  {paymentTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => applyPaymentTemplate(template)}
                      className={`rounded-[22px] border p-4 text-left transition ${
                        transferForm.paymentTemplateId === template.id
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-white/8 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div className="text-sm font-semibold text-white">{template.label}</div>
                      <div className="mt-2 text-sm leading-6 text-slate-300">{template.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="field">
                  <span>Sender wallet</span>
                  <select
                    className="glass-input"
                    value={transferForm.senderId}
                    onChange={(event) => {
                      const nextSenderId = event.target.value;
                      const fallbackRecipient =
                        participants.find((user) => String(user.id) !== nextSenderId)?.id ?? '';
                      onTransferFormChange((current) => ({
                        ...current,
                        senderId: nextSenderId,
                        recipientId:
                          String(current.recipientId) === nextSenderId
                            ? String(fallbackRecipient)
                            : current.recipientId,
                      }));
                    }}
                  >
                    {participants.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} · {formatCurrency(user.spendable_balance ?? user.database_balance ?? 0, overview.config)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Recipient wallet</span>
                  <select
                    className="glass-input"
                    value={transferForm.recipientId}
                    onChange={(event) => onTransferFormChange((current) => ({ ...current, recipientId: event.target.value }))}
                  >
                    {recipientOptions.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="field">
                <span>Amount</span>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  className="glass-input text-2xl font-semibold text-white"
                  value={transferForm.amount}
                  onChange={(event) => onTransferFormChange((current) => ({ ...current, amount: event.target.value }))}
                />
              </label>

              {selectedPaymentTemplate ? (
                <div className="rounded-[22px] border border-white/8 bg-slate-950/35 p-4 text-sm text-slate-300">
                  <p className="font-medium text-white">{selectedPaymentTemplate.label}</p>
                  <p className="mt-2 leading-6">{selectedPaymentTemplate.business_context}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">
                    Flow: {participants.find((user) => String(user.id) === String(transferForm.senderId))?.name || 'Sender'} to{' '}
                    {participants.find((user) => String(user.id) === String(transferForm.recipientId))?.name || 'Recipient'}
                  </p>
                </div>
              ) : null}

              <div className="rounded-[22px] border border-white/8 bg-white/5 p-4 text-sm text-slate-300">
                <p className="font-medium text-white">Why blockchain helps here</p>
                <p className="mt-2 leading-6">
                  Blockchain settlement does not magically stop every attack. It makes specific things measurable:
                  signatures prove sender intent, replay IDs prevent duplicates, and chain-derived balances reveal
                  database drift or historical tampering.
                </p>
              </div>

              {!canOperate ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                  Your current role is <span className="font-semibold text-white">{currentUser?.role}</span>. Sign in as
                  admin or operator to create transfers.
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitting || !canOperate}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-accent px-4 py-4 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition hover:brightness-110 disabled:opacity-60"
              >
                <Send size={16} />
                {submitting ? 'Submitting transfer...' : 'Submit transfer'}
              </button>
            </form>
          </section>

          <div className="space-y-6">
            <section className="panel p-6">
              <div className="mb-5">
              <p className="eyebrow">Rail workbench</p>
              <h3 className="text-xl font-semibold text-white">Choose what each settlement method is good at</h3>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {Object.entries(RAIL_DETAILS).map(([railKey, rail]) => (
                  <button
                    key={railKey}
                    type="button"
                    onClick={() => setSelectedRail(railKey)}
                    className={`rounded-[22px] border p-4 text-left transition ${
                      selectedRail === railKey
                        ? 'border-primary/35 bg-primary/10'
                        : 'border-white/8 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="text-base font-semibold text-white">{rail.title}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-300">{rail.summary}</div>
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-[22px] border border-white/8 bg-slate-950/35 p-4">
                <div className="text-sm font-semibold text-white">{RAIL_DETAILS[selectedRail].title}</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">{RAIL_DETAILS[selectedRail].summary}</div>
                <div className="mt-4 space-y-2">
                  {RAIL_DETAILS[selectedRail].points.map((point) => (
                    <div key={point} className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5 text-sm text-slate-300">
                      {point}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="panel p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Live wallet state</p>
                  <h3 className="text-xl font-semibold text-white">Spendable balances and diagnostics</h3>
                </div>
                <button
                  type="button"
                  onClick={() => refreshOverview()}
                  className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/8"
                >
                  Refresh
                </button>
              </div>

              <div className="custom-scrollbar max-h-[620px] space-y-3 overflow-y-auto pr-1">
                {overview.users.map((user) => (
                  <div key={user.id} className="rounded-[22px] border border-white/8 bg-slate-950/35 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{user.name}</p>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-500">
                          <span>{user.role}</span>
                          {user.is_attacker ? <span>Risk wallet</span> : null}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Spendable</p>
                        <p className="text-lg font-semibold text-white">
                          {user.spendable_balance == null
                            ? 'Unavailable'
                            : formatCurrency(user.spendable_balance || 0, overview.config)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Source</p>
                        <p className="mt-1 text-sm font-semibold text-white">
                          {user.spendable_balance_source}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Chain balance</p>
                        <p className="mt-1 text-sm font-semibold text-white">
                          {user.chain_balance == null ? 'Unavailable' : formatCurrency(user.chain_balance || 0, overview.config)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Difference</p>
                        <p className={`mt-1 text-sm font-semibold ${user.balance_difference ? 'text-amber-300' : 'text-emerald-300'}`}>
                          {user.balance_difference == null ? 'Unavailable' : formatCurrency(user.balance_difference || 0, overview.config)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {activeWorkspace === 'operations' ? (
        <section className="panel p-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl bg-white/8 p-3 text-slate-100">
                  <RotateCcw size={18} />
                </div>
                <div>
                  <p className="eyebrow">Recovery controls</p>
                  <h3 className="text-xl font-semibold text-white">Reset blockchain and history</h3>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => runAdminAction('reset-ledger', () => resetLedger(true))}
                  disabled={!!adminBusy || !canOperate}
                  className="flex w-full items-center justify-between rounded-[22px] border border-primary/20 bg-primary/10 px-4 py-4 text-left text-sm text-sky-50 transition hover:bg-primary/20 disabled:opacity-60"
                >
                  <span>
                    <span className="block font-semibold">Reset ledger only</span>
                    <span className="mt-1 block text-slate-300">
                      Clears transaction history, rebuilds the blockchain from current balances, and fixes tamper state.
                    </span>
                  </span>
                  <RotateCcw size={16} />
                </button>

                <button
                  type="button"
                  onClick={() => runAdminAction('reset-system', () => resetSystem())}
                  disabled={!!adminBusy || !canAdmin}
                  className="flex w-full items-center justify-between rounded-[22px] border border-danger/20 bg-danger/10 px-4 py-4 text-left text-sm text-rose-50 transition hover:bg-danger/20 disabled:opacity-60"
                >
                  <span>
                    <span className="block font-semibold">Reset entire demo</span>
                    <span className="mt-1 block text-slate-300">
                      Restores seeded users, balances, attack state, database history, and blockchain to a clean demo state.
                    </span>
                  </span>
                  <Settings2 size={16} />
                </button>

                <button
                  type="button"
                  onClick={() => runAdminAction('clear-history', () => clearHistory())}
                  disabled={!!adminBusy || !canOperate}
                  className="flex w-full items-center justify-between rounded-[22px] border border-white/10 bg-white/5 px-4 py-4 text-left text-sm text-slate-100 transition hover:bg-white/10 disabled:opacity-60"
                >
                  <span>
                    <span className="block font-semibold">Clear transaction history</span>
                    <span className="mt-1 block text-slate-300">
                      Removes stored transaction records while keeping users and balances intact.
                    </span>
                  </span>
                  <BookOpen size={16} />
                </button>
              </div>
            </div>

            <div>
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl bg-accent/15 p-3 text-accent">
                  <SlidersHorizontal size={18} />
                </div>
                <div>
                  <p className="eyebrow">Balance setup</p>
                  <h3 className="text-xl font-semibold text-white">Change account balance</h3>
                </div>
              </div>

              <div className="space-y-4 rounded-[24px] border border-white/8 bg-slate-950/35 p-4">
                <label className="field">
                  <span>Wallet</span>
                  <select
                    className="glass-input"
                    value={balanceForm.userId}
                    onChange={(event) => setBalanceForm((current) => ({ ...current, userId: event.target.value }))}
                  >
                    {overview.users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>New balance</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="glass-input"
                    value={balanceForm.balance}
                    onChange={(event) => setBalanceForm((current) => ({ ...current, balance: event.target.value }))}
                  />
                </label>

                <label className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={balanceForm.resetLedger}
                    onChange={(event) =>
                      setBalanceForm((current) => ({ ...current, resetLedger: event.target.checked }))
                    }
                  />
                  <span>
                    Re-anchor blockchain after balance change
                    <span className="mt-1 block text-xs text-slate-500">
                      Recommended for demos so blockchain balances match the edited starting balances.
                    </span>
                  </span>
                </label>

                {selectedBalanceUser ? (
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    Current spendable balance: {selectedBalanceUser.spendable_balance == null ? 'Unavailable' : formatCurrency(selectedBalanceUser.spendable_balance || 0, overview.config)}
                  </p>
                ) : null}

                <button
                  type="button"
                  disabled={!balanceForm.userId || balanceForm.balance === '' || !!adminBusy || !canOperate}
                  onClick={() =>
                    runAdminAction('update-balance', () =>
                      updateBalance(
                        Number(balanceForm.userId),
                        Number(balanceForm.balance),
                        balanceForm.resetLedger
                      )
                    )
                  }
                  className="w-full rounded-2xl bg-gradient-to-r from-slate-100 to-slate-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:opacity-60"
                >
                  {adminBusy === 'update-balance' ? 'Updating...' : 'Apply balance change'}
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeWorkspace === 'training' ? (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="panel p-4">
              <div className="mb-4">
                <p className="eyebrow">Training scenarios</p>
                <h3 className="text-xl font-semibold text-white">Apply guided simulation states</h3>
              </div>
              <div className="space-y-3">
                {overview.scenarios.map((scenario) => (
                  <button
                    key={scenario.id}
                    type="button"
                    onClick={() => runAdminAction(`scenario-${scenario.id}`, () => applyScenario(scenario.id))}
                    disabled={!!adminBusy || !canOperate}
                    className="w-full rounded-[22px] border border-white/8 bg-white/5 px-4 py-4 text-left transition hover:bg-white/10 disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">{scenario.name}</div>
                        <div className="mt-1 text-sm text-slate-300">{scenario.description}</div>
                      </div>
                      <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-300">
                        {scenario.mode}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel p-4">
              <div className="mb-4">
                <p className="eyebrow">Recent audit trail</p>
                <h3 className="text-xl font-semibold text-white">Protected operational changes</h3>
              </div>
              <div className="space-y-3">
                {overview.recent_audit_items.length === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-white/10 px-4 py-8 text-sm text-slate-500">
                    No audited admin actions yet.
                  </div>
                ) : (
                  overview.recent_audit_items.map((item) => (
                    <div key={item.id} className="rounded-[22px] border border-white/8 bg-white/5 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-white">{item.action.replaceAll('_', ' ')}</div>
                          <div className="mt-1 text-sm text-slate-300">{item.details}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{item.actor_username}</div>
                          <div className="mt-1 text-xs text-slate-400">
                            {new Date(item.timestamp * 1000).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-amber-400/20 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
            Training mode changes payment behavior on purpose. Keep it separate from normal payment operations when you want clean user-facing settlement flows.
          </div>

          <AttackPanel overview={overview} refreshOverview={refreshOverview} currentUser={currentUser} />
        </div>
      ) : null}
    </div>
  );
};

export default AdminDashboard;
