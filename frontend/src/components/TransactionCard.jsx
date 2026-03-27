import React from 'react';
import { ArrowRightCircle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { getDisplayAmount } from '../lib/activity';
import { formatCurrency, formatSource, formatStage } from '../lib/formatting';

const STATUS_STYLES = {
  success: 'border-emerald-400/25 bg-emerald-500/8 text-emerald-100',
  partial_protected: 'border-sky-400/25 bg-sky-500/10 text-sky-100',
  intercepted: 'border-amber-400/25 bg-amber-500/10 text-amber-100',
  rejected: 'border-danger/25 bg-danger/10 text-rose-100',
};

const TransactionCard = ({ group, activeUserId, usersById, config }) => {
  const tx = group.payment;
  const senderName = usersById[tx.sender_id]?.name || `User ${tx.sender_id}`;
  const recipientName = usersById[tx.recipient_id]?.name || `User ${tx.recipient_id}`;
  const intendedRecipientName =
    usersById[tx.intended_recipient_id]?.name || `User ${tx.intended_recipient_id}`;
  const isOutgoing = Number(tx.sender_id) === Number(activeUserId);
  const statusStyle = STATUS_STYLES[tx.status] || STATUS_STYLES.success;
  const displayAmount = getDisplayAmount(tx, activeUserId);

  return (
    <article className={`rounded-[24px] border p-4 ${statusStyle}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.22em] text-white">
              {tx.payment_label || 'Operational transfer'}
            </span>
            <span className="rounded-full bg-black/25 px-2.5 py-1 text-[11px] uppercase tracking-[0.22em] text-white/70">
              {isOutgoing ? 'Outgoing' : 'Incoming'}
            </span>
            <span className="rounded-full bg-black/25 px-2.5 py-1 text-[11px] uppercase tracking-[0.22em] text-white/70">
              {tx.display_status}
            </span>
            <span className="rounded-full bg-black/25 px-2.5 py-1 text-[11px] uppercase tracking-[0.22em] text-white/70">
              {formatSource(tx.source)}
            </span>
          </div>
          <p className="mt-3 text-lg font-semibold text-white">{formatCurrency(displayAmount || 0, config)}</p>
          <p className="mt-1 text-sm text-white/80">
            {senderName} <ArrowRightCircle className="mx-1 inline" size={14} /> {recipientName}
          </p>
          {Number(tx.intended_recipient_id) !== Number(tx.recipient_id) ? (
            <p className="mt-2 text-sm text-white/70">Requested recipient: {intendedRecipientName}</p>
          ) : null}
          {tx.business_context ? <p className="mt-2 text-sm leading-6 text-white/70">{tx.business_context}</p> : null}
        </div>

        <div className="text-left sm:text-right">
          <div className="flex items-center gap-2 text-sm text-white/80 sm:justify-end">
            {tx.mode === 'blockchain' ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
            <span>{tx.mode === 'blockchain' ? 'Blockchain settlement' : 'Centralized clearing'}</span>
          </div>
          <p className="mt-2 text-xs uppercase tracking-[0.22em] text-white/60">
            {new Date(tx.timestamp * 1000).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-[18px] bg-black/20 px-3 py-3 text-xs text-white/75">
        <p>Reference: {(tx.reference_label || tx.tx_uuid || 'unknown').slice(0, 24)}</p>
        <p className="mt-1">Stage: {formatStage(tx.stage)}</p>
        <p className="mt-1">Initiated by: {tx.initiated_by || 'unknown'}</p>
        <p className="mt-1">Balance source: {tx.balance_source || 'database'}</p>
        <p className="mt-1">Chain status: {tx.chain_status || 'healthy'}</p>
        {tx.reason ? <p className="mt-1">Reason: {tx.reason}</p> : null}
        {tx.explanation ? <p className="mt-2 text-white/90">What happened: {tx.explanation}</p> : null}
      </div>

      {group.securityEvents.length > 0 ? (
        <div className="mt-4 space-y-2">
          {group.securityEvents.map((event) => (
            <div
              key={event.id}
              className="rounded-[18px] border border-white/10 bg-black/20 px-3 py-3 text-sm text-white/80"
            >
              <div className="font-medium text-white">{event.payment_label}</div>
              <div className="mt-1">{event.explanation}</div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
};

export default TransactionCard;
