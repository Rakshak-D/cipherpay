import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { getAttackDiffRows } from '../lib/forensics';

const ForensicDiffCard = ({ log, compact = false }) => {
  const rows = getAttackDiffRows(log);
  const changedCount = rows.filter((row) => row.changed).length;

  return (
    <article className="rounded-[22px] border border-danger/20 bg-danger/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-black/20 p-2 text-rose-100">
            <ShieldAlert size={compact ? 14 : 16} />
          </div>
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.22em] text-rose-200">
              {log.attack_type}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {changedCount} changed field{changedCount === 1 ? '' : 's'} ·{' '}
              {new Date(log.timestamp * 1000).toLocaleString()}
            </div>
          </div>
        </div>
        <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-300">
          field diff
        </span>
      </div>

      <div className={`mt-4 grid gap-3 ${compact ? '' : 'md:grid-cols-2'}`}>
        {rows.map((row) => (
          <div
            key={row.key}
            className={`rounded-2xl border px-3 py-3 ${
              row.changed
                ? 'border-amber-300/20 bg-amber-400/10'
                : 'border-white/8 bg-black/20'
            }`}
          >
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{row.key.replaceAll('_', ' ')}</div>
            <div className="mt-2 grid gap-2 text-sm">
              <div>
                <div className="text-xs text-slate-500">Before</div>
                <div className="mt-1 font-medium text-slate-100">{row.before}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">After</div>
                <div className={`mt-1 font-medium ${row.changed ? 'text-amber-100' : 'text-slate-300'}`}>
                  {row.after}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
};

export default ForensicDiffCard;
