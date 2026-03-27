import React, { useState } from 'react';
import { Box, Fingerprint, Link2 } from 'lucide-react';

const BlockVisualizer = ({ chain, onTamper }) => {
  const [expandedIndex, setExpandedIndex] = useState(null);

  if (!chain.length) {
    return <div className="py-20 text-center text-sm text-slate-500">No blocks available yet.</div>;
  }

  return (
    <div className="custom-scrollbar overflow-x-auto pb-3">
      <div className="flex min-w-max items-start gap-4">
        {chain.map((block, index) => {
          const expanded = expandedIndex === block.index;
          const hasTransactions = block.transactions.length > 0;

          return (
            <React.Fragment key={block.index}>
              {index > 0 ? (
                <div className="mt-20 flex items-center text-slate-500">
                  <Link2 size={18} />
                </div>
              ) : null}

              <div className="w-[300px] flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setExpandedIndex(expanded ? null : block.index)}
                  className="w-full rounded-[26px] border border-white/8 bg-slate-950/45 p-5 text-left transition hover:-translate-y-1 hover:border-white/15"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-white/8 p-3 text-slate-100">
                        <Box size={18} />
                      </div>
                      <div>
                        <p className="eyebrow">Block {block.index}</p>
                        <p className="text-lg font-semibold text-white">
                          {hasTransactions ? `${block.transactions.length} transactions` : 'Genesis block'}
                        </p>
                      </div>
                    </div>
                    {!hasTransactions ? null : (
                      <div className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-300">
                        Active
                      </div>
                    )}
                  </div>

                  <div className="mt-5 space-y-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Hash</p>
                      <p className="mt-1 truncate font-mono text-sm text-accent">{block.hash}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Previous hash</p>
                      <p className="mt-1 truncate font-mono text-sm text-slate-300">{block.previous_hash}</p>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Nonce {block.nonce}</span>
                      <span>{new Date(block.timestamp * 1000).toLocaleTimeString()}</span>
                    </div>
                  </div>
                </button>

                {expanded ? (
                  <div className="mt-4 rounded-[24px] border border-white/8 bg-slate-900/85 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Fingerprint size={15} className="text-accent" />
                      <p className="text-sm font-semibold text-white">Transactions in block</p>
                    </div>

                    {!hasTransactions ? (
                      <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500">
                        The genesis block anchors the chain but contains no payment transfers.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {block.transactions.map((wrapper, txIndex) => {
                          const transaction = wrapper.tx_data;
                          return (
                            <div key={`${block.index}-${txIndex}`} className="rounded-[18px] border border-white/8 bg-white/5 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-white">
                                    {transaction.sender_id} to {transaction.recipient_id}
                                  </p>
                                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                                    {transaction.id}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => onTamper(block.index, txIndex)}
                                  className="rounded-full border border-danger/30 bg-danger/10 px-2.5 py-1 text-[11px] font-semibold text-rose-100 transition hover:bg-danger/20"
                                >
                                  Tamper
                                </button>
                              </div>
                              <p className="mt-3 text-lg font-semibold text-white">{transaction.amount}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default BlockVisualizer;
