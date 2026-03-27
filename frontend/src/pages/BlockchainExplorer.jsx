import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Database,
  Gauge,
  HelpCircle,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
} from 'lucide-react';
import AlertBanner from '../components/AlertBanner';
import ForensicDiffCard from '../components/ForensicDiffCard';
import ThreeChainVisualizer from '../components/ThreeChainVisualizer';
import ExplainerModal from '../components/ExplainerModal';
import { continueLedger, recoverLedger, resetLedger, tamperLedger } from '../api';
import { getIntegrityStatusMeta } from '../lib/forensics';

const BlockchainExplorer = ({ overview, refreshOverview, navigateToTab }) => {
  const [tampering, setTampering] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showExplainer, setShowExplainer] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [expandedArchivedEpochId, setExpandedArchivedEpochId] = useState(null);
  const blockchain = overview.blockchain;

  const firstTamperTarget = useMemo(() => {
    const chain = blockchain?.chain || [];
    for (let i = 0; i < chain.length; i += 1) {
      const txs = chain[i]?.transactions || [];
      if (txs.length > 0) return { blockIndex: i, txIndex: 0 };
    }
    return null;
  }, [blockchain?.chain]);
  const recentAttackLogs = useMemo(() => overview.attack_logs.slice(0, 3), [overview.attack_logs]);
  const archivedEpochSnapshots = useMemo(
    () =>
      blockchain.archived_epochs.map((epoch) => {
        const tamperedBlock = epoch.chain.find((block) => block.integrity_status === 'tampered');
        const downstreamCount = epoch.chain.filter((block) => block.integrity_status === 'downstream_invalid').length;
        const trustedCount = epoch.chain.filter((block) => block.integrity_status === 'trusted').length;
        return {
          ...epoch,
          tamperedBlock,
          downstreamCount,
          trustedCount,
        };
      }),
    [blockchain.archived_epochs]
  );

  const handleTamper = async (blockIndex, txIndex) => {
    const currentAmount =
      blockchain?.chain?.[blockIndex]?.transactions?.[txIndex]?.tx_data?.amount;

    setActionMessage('');
    setTampering(true);
    try {
      await tamperLedger(
        blockIndex,
        txIndex,
        typeof currentAmount === 'number' ? currentAmount + Math.max(1, currentAmount * 0.25) : 999
      );
      await refreshOverview();
      setActionMessage('A historical block was tampered with. The chain is now in forensic/demo mode until you reset the ledger.');
    } catch (err) {
      setActionMessage(err.message);
    } finally {
      setTampering(false);
    }
  };

  const handleResetLedger = async () => {
    setActionMessage('');
    setResetting(true);
    try {
      const result = await resetLedger(true);
      await refreshOverview();
      setActionMessage(result.message || 'Ledger reset complete.');
    } catch (err) {
      setActionMessage(err.message);
    } finally {
      setResetting(false);
    }
  };

  const handleRecoverLedger = async () => {
    setActionMessage('');
    setResetting(true);
    try {
      const result = await recoverLedger(true);
      await refreshOverview();
      setActionMessage(result.message || 'Ledger recovered.');
    } catch (err) {
      setActionMessage(err.message);
    } finally {
      setResetting(false);
    }
  };

  const handleContinueLedger = async () => {
    setActionMessage('');
    setResetting(true);
    try {
      const result = await continueLedger();
      await refreshOverview();
      setActionMessage(result.message || 'Continuity branch started from the last trusted block.');
    } catch (err) {
      setActionMessage(err.message);
    } finally {
      setResetting(false);
    }
  };

  const chainSummary = [
    {
      label: 'Active epoch',
      value: blockchain.active_epoch_id,
      icon: Database,
      helper: blockchain.active_epoch_start_reason || 'Active signed settlement branch',
      actionLabel: 'Open 3D map',
      onAction: () => window.scrollTo({ top: document.body.scrollHeight * 0.35, behavior: 'smooth' }),
    },
    {
      label: 'Block height',
      value: blockchain.height,
      icon: Database,
      helper: `${blockchain.archived_epoch_count} archived epoch(s) preserved`,
      actionLabel: 'Review archives',
      onAction: () => setExpandedArchivedEpochId(blockchain.archived_epochs[0]?.epoch_id || null),
    },
    {
      label: 'Pending pool',
      value: blockchain.pending_transactions,
      icon: Gauge,
      helper: 'Waiting transfers ready for the next mined block.',
      actionLabel: 'Open payments',
      onAction: () => navigateToTab?.('admin'),
    },
    {
      label: 'Integrity',
      value: blockchain.is_valid ? 'Verified' : `Broken from block ${blockchain.invalid_from_index}`,
      icon: blockchain.is_valid ? ShieldCheck : ShieldAlert,
      helper: blockchain.is_valid
        ? 'All blocks still satisfy their stored hash chain.'
        : 'A historical block changed and every later block must now be treated as suspect.',
      actionLabel: blockchain.is_valid ? 'Open guide' : 'Start continuity',
      onAction: blockchain.is_valid ? () => setShowExplainer(true) : handleContinueLedger,
    },
  ];
  const operatorPlaybook = [
    {
      title: 'Inspect the evidence',
      description: 'Use the 3D map and archived epochs to find the first tampered block and see what stayed trusted.',
      actionLabel: 'Stay in ledger',
      onAction: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    },
    {
      title: 'Check user impact',
      description: 'Compare chain balances, wallet history, and attack traces to see who was affected.',
      actionLabel: 'Open wallets',
      onAction: () => navigateToTab?.('wallet'),
    },
    {
      title: 'Recover operations',
      description: 'Archive the compromised epoch or reset the ledger once the evidence is understood.',
      actionLabel: 'Open controls',
      onAction: () => navigateToTab?.('admin'),
    },
  ];

  return (
    <div className="space-y-6">
      <section className="panel p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="eyebrow">Ledger response console</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">Inspect, explain, and recover the settlement chain</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              This workspace is now focused on operator response: identify the first bad block, understand what field
              changed, and move the network forward without losing forensic evidence.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setShowExplainer(true)}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
            >
              <HelpCircle size={16} />
              How it works
            </button>
            <button
              type="button"
              onClick={handleResetLedger}
              disabled={resetting}
              className="inline-flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-semibold text-sky-100 transition hover:bg-primary/20 disabled:opacity-60"
            >
              <RotateCcw size={16} />
              {resetting ? 'Resetting...' : 'Reset ledger'}
            </button>
            <button
              type="button"
              onClick={handleContinueLedger}
              disabled={resetting || overview.blockchain.is_valid}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-60"
            >
              <RotateCcw size={16} />
              Start continuity epoch
            </button>
            <button
              type="button"
              onClick={handleRecoverLedger}
              disabled={resetting || overview.blockchain.is_valid}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
            >
              <RotateCcw size={16} />
              Recover from forensic mode
            </button>
            <button
              type="button"
              onClick={() => {
                if (firstTamperTarget) handleTamper(firstTamperTarget.blockIndex, firstTamperTarget.txIndex);
              }}
              disabled={tampering || !firstTamperTarget}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-semibold text-rose-100 transition hover:bg-danger/20 disabled:opacity-60"
            >
              <Shuffle size={16} />
              {tampering ? 'Tampering...' : 'Simulate historical tamper'}
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {chainSummary.map((item) => (
            <div
              key={item.label}
              className="group rounded-[22px] border border-white/8 bg-slate-950/35 p-4 transition hover:-translate-y-1 hover:border-white/15"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/8 text-slate-100">
                <item.icon size={18} />
              </div>
              <p className="text-sm text-slate-400">{item.label}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{item.value}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">{item.helper}</p>
              <button
                type="button"
                onClick={item.onAction}
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/10"
              >
                {item.actionLabel}
                <ArrowRight size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-[22px] border border-white/8 bg-slate-950/35 p-4 text-sm leading-6 text-slate-300">
          <span className="font-semibold text-white">Trusted balance source:</span>{' '}
          {blockchain.balance_source === 'last_trusted_block'
            ? 'Wallet balances are frozen at the last verified block while this epoch is under forensic review.'
            : blockchain.balance_source === 'continuity_epoch'
              ? 'Balances come from the current continuity branch while older compromised epochs remain archived.'
              : 'Balances come from the current active blockchain epoch.'}
        </div>
      </section>

      <AlertBanner
        message={
          blockchain.is_valid
            ? null
            : `A stored block no longer matches its cryptographic hash. Validation now fails from block ${blockchain.invalid_from_index}. You can reset the ledger or archive the compromised epoch and continue from the last trusted block on a continuity branch.`
        }
      />

      {actionMessage ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
          {actionMessage}
        </div>
      ) : null}

      {overview.recoverability?.note ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
          <span className="font-semibold text-white">Ledger note:</span> {overview.recoverability.note}
        </div>
      ) : null}

      {blockchain.archived_epoch_count > 0 ? (
        <section className="panel p-6">
          <div className="mb-4">
            <p className="eyebrow">Continuity recovery</p>
            <h3 className="text-xl font-semibold text-white">Archived compromised epochs</h3>
            <p className="mt-2 text-sm text-slate-300">
              Each archived epoch now marks the first tampered block so operators can separate the real evidence from the downstream fallout.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {archivedEpochSnapshots.map((epoch) => (
              <div key={epoch.epoch_id} className="rounded-[22px] border border-white/8 bg-slate-950/35 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-white">Epoch {epoch.epoch_id}</div>
                  <span className="rounded-full bg-danger/15 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-rose-200">
                    archived
                  </span>
                </div>
                <div className="mt-3 space-y-2 text-sm text-slate-300">
                  <div>Reason: {epoch.reason}</div>
                  <div>Broken from block: {epoch.invalid_from_index}</div>
                  <div>Continued into epoch: {epoch.continued_to_epoch}</div>
                  <div>Blocks preserved: {epoch.block_count}</div>
                  <div>Tampered block: {epoch.tamperedBlock?.index ?? 'Unknown'}</div>
                  <div>Trusted blocks: {epoch.trustedCount}</div>
                  <div>Downstream invalid blocks: {epoch.downstreamCount}</div>
                  <div>Archived at: {new Date(epoch.archived_at * 1000).toLocaleString()}</div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedArchivedEpochId((current) => (current === epoch.epoch_id ? null : epoch.epoch_id))
                  }
                  className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  {expandedArchivedEpochId === epoch.epoch_id ? 'Hide archived blocks' : 'View archived blocks'}
                </button>

                {expandedArchivedEpochId === epoch.epoch_id ? (
                  <div className="custom-scrollbar mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-1">
                    {epoch.chain.map((block) => (
                      <div key={`${epoch.epoch_id}-${block.index}`} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold text-white">Block {block.index}</div>
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                            {block.transactions.length} tx
                          </div>
                        </div>
                        <div className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] ${getIntegrityStatusMeta(block.integrity_status).tone}`}>
                          {getIntegrityStatusMeta(block.integrity_status).label}
                        </div>
                        <div className="mt-2 truncate font-mono text-xs text-amber-200">{block.hash}</div>
                        <div className="mt-3 space-y-2">
                          {block.transactions.length === 0 ? (
                            <div className="text-sm text-slate-500">Genesis block</div>
                          ) : (
                            block.transactions.map((wrapper, index) => (
                              <div key={`${epoch.epoch_id}-${block.index}-${index}`} className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5 text-sm text-slate-300">
                                {wrapper.tx_data?.payment_template_id || 'ad hoc flow'} · {wrapper.tx_data?.sender_id} to{' '}
                                {wrapper.tx_data?.recipient_id} · {wrapper.tx_data?.amount}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel p-6">
        <ThreeChainVisualizer
          activeChain={blockchain.chain || []}
          archivedEpochs={blockchain.archived_epochs || []}
          activeEpochId={blockchain.active_epoch_id}
          activeEpochParentId={blockchain.active_epoch_parent_id}
          activeEpochForkFromBlock={blockchain.active_epoch_fork_from_block}
          onTamper={handleTamper}
          isValid={blockchain.is_valid}
          brokenFromIndex={blockchain.invalid_from_index}
        />
      </section>

      <section className="panel p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-2xl bg-danger/15 p-3 text-danger">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="eyebrow">Tamper Evidence</p>
            <h3 className="text-xl font-semibold text-white">What fields were actually changed</h3>
          </div>
        </div>

        {recentAttackLogs.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-white/10 px-4 py-8 text-sm text-slate-500">
            No attack diff is available yet. Use the risk lab or simulate a tamper to create forensic evidence.
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-3">
            {recentAttackLogs.map((log, index) => (
              <ForensicDiffCard key={`${log.attack_type}-${log.timestamp}-${index}`} log={log} compact />
            ))}
          </div>
        )}
      </section>

      <section className="panel p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-white/8 p-3 text-slate-100">
            <BookOpen size={18} />
          </div>
          <div>
            <p className="eyebrow">Operator playbook</p>
            <h3 className="text-xl font-semibold text-white">Next actions after a ledger incident</h3>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {operatorPlaybook.map((step) => (
            <div
              key={step.title}
              className="group rounded-[22px] border border-white/8 bg-slate-950/35 p-4 transition hover:-translate-y-1 hover:border-white/15"
            >
              <div className="text-base font-semibold text-white">{step.title}</div>
              <div className="mt-2 text-sm leading-6 text-slate-300">{step.description}</div>
              <button
                type="button"
                onClick={step.onAction}
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/10"
              >
                {step.actionLabel}
                <ArrowRight size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {showExplainer ? (
        <ExplainerModal overview={overview} onClose={() => setShowExplainer(false)} />
      ) : null}
    </div>
  );
};

export default BlockchainExplorer;
