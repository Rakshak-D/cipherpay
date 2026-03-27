import React, { useMemo } from 'react';
import { Activity, Database, Info, RotateCcw, Shield, X } from 'lucide-react';

const ExplainerModal = ({ overview, onClose }) => {
  const mysteryTransactions = useMemo(() => {
    if (!overview) return [];
    return overview.transactions.filter(
      (transaction) => transaction.status !== 'success' || transaction.reason
    );
  }, [overview]);

  if (!overview) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-auto mt-12 max-h-[84vh] w-full max-w-5xl overflow-y-auto px-4" onClick={(event) => event.stopPropagation()}>
        <div className="panel p-8 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-6">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-accent/20 p-3 text-accent">
                <Info size={20} />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-white">How the simulator works</h2>
                <p className="text-sm text-slate-400">
                  Why the chain breaks after tampering, why unknown transactions appear, and how to recover.
                </p>
              </div>
            </div>
            <button onClick={onClose} className="rounded-xl bg-white/5 p-2 text-slate-200 transition hover:bg-white/10">
              <X size={20} />
            </button>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <section className="rounded-[24px] border border-white/8 bg-slate-950/35 p-6">
              <h3 className="flex items-center gap-3 text-lg font-semibold text-white">
                <Database size={18} />
                What the ledger error means
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                “Chain integrity violated” means one of the older blocks was intentionally modified by the tamper
                simulator. That changes the stored block hash, so the chain is no longer trustworthy from that block onward.
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                In a real system you should stop accepting blockchain settlements until the ledger is restored. In this
                demo, use <span className="font-semibold text-white">Reset ledger</span> to clear the corrupted chain and
                start again from clean balances.
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                CipherPay also supports a <span className="font-semibold text-white">continuity branch</span>: the
                compromised chain is archived for forensics while the active branch continues from the last trusted block.
              </p>
            </section>

            <section className="rounded-[24px] border border-white/8 bg-slate-950/35 p-6">
              <h3 className="flex items-center gap-3 text-lg font-semibold text-white">
                <Shield size={18} />
                How centralized and blockchain modes differ
              </h3>
              <ul className="mt-3 space-y-3 text-sm leading-6 text-slate-300">
                <li>Centralized mode updates balances in the database directly and is best for fast internal clearing.</li>
                <li>Blockchain mode requires a signed transfer, verifies the signature, and stores accepted transfers in blocks.</li>
                <li>Balances in blockchain mode are derived from the chain, which is why direct DB edits no longer define the truth.</li>
              </ul>
            </section>

            <section className="rounded-[24px] border border-white/8 bg-slate-950/35 p-6">
              <h3 className="flex items-center gap-3 text-lg font-semibold text-white">
                <Activity size={18} />
                Why transactions appear that you did not send
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                This simulator records both normal transfers and attack outcomes. If replay, MITM, tampering, or rejected
                blockchain attempts happened earlier, you will see them in history so the demo shows what the system processed or blocked.
              </p>
              <div className="mt-4 rounded-2xl border border-white/8 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Current explained activity</p>
                <p className="mt-2 text-sm text-white">{mysteryTransactions.length} non-standard transaction records</p>
              </div>
            </section>

            <section className="rounded-[24px] border border-white/8 bg-slate-950/35 p-6">
              <h3 className="flex items-center gap-3 text-lg font-semibold text-white">
                <RotateCcw size={18} />
                How to demo cleanly
              </h3>
              <ul className="mt-3 space-y-3 text-sm leading-6 text-slate-300">
                <li>Use <span className="font-semibold text-white">Reset entire demo</span> before starting from scratch.</li>
                <li>Use <span className="font-semibold text-white">Reset ledger only</span> after tampering with the blockchain.</li>
                <li>Use <span className="font-semibold text-white">Change account balance</span> to set up example scenarios before showing the transfer flow.</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExplainerModal;
