import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Database, KeyRound, RotateCcw, ServerCrash, ShieldAlert } from 'lucide-react';
import ForensicDiffCard from './ForensicDiffCard';
import { resetAttackEngine, toggleAttack, triggerInsiderAttack } from '../api';

const ATTACKS = [
  {
    id: 'mitm',
    name: 'MITM interception',
    icon: Activity,
    description: 'Modifies the payment payload during transport to demonstrate signature protection.',
  },
  {
    id: 'replay',
    name: 'Replay attempt',
    icon: ServerCrash,
    description: 'Re-submits an existing transfer ID to test duplicate prevention in the settlement layer.',
  },
  {
    id: 'tamper',
    name: 'Recipient tamper',
    icon: KeyRound,
    description: 'Changes the recipient wallet in transit to show how signed payloads preserve intent.',
  },
  {
    id: 'insider',
    name: 'Database edit',
    icon: Database,
    description: 'Directly edits stored balances to validate whether the chain remains authoritative.',
  },
];

const AttackPanel = ({ overview, refreshOverview, currentUser }) => {
  const [loadingAttack, setLoadingAttack] = useState('');
  const [insiderTargetUserId, setInsiderTargetUserId] = useState(
    String(overview.users.find((user) => !user.is_admin)?.id || '')
  );
  const [message, setMessage] = useState('');

  const customerUsers = useMemo(
    () => overview.users.filter((user) => !user.is_admin),
    [overview.users]
  );
  const canAdmin = currentUser?.role === 'admin';

  useEffect(() => {
    if (!customerUsers.length) return;
    if (!customerUsers.some((user) => String(user.id) === insiderTargetUserId)) {
      setInsiderTargetUserId(String(customerUsers[0].id));
    }
  }, [customerUsers, insiderTargetUserId]);

  const handleToggle = async (attackId, nextState) => {
    setMessage('');
    setLoadingAttack(attackId);
    try {
      await toggleAttack(attackId, nextState);
      await refreshOverview();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoadingAttack('');
    }
  };

  const handleInsiderTrigger = async () => {
    if (!insiderTargetUserId) return;
    setMessage('');
    setLoadingAttack('insider-trigger');
    try {
      await triggerInsiderAttack(Number(insiderTargetUserId));
      await refreshOverview();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoadingAttack('');
    }
  };

  const handleResetAttackEngine = async () => {
    setMessage('');
    setLoadingAttack('reset-attacks');
    try {
      const result = await resetAttackEngine(true, true);
      await refreshOverview();
      setMessage(result.message);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoadingAttack('');
    }
  };

  return (
    <section className="panel p-5">
      <div className="mb-6 flex items-center gap-3 border-b border-white/8 pb-4">
        <div className="rounded-2xl bg-danger/15 p-3 text-danger">
          <ShieldAlert size={18} />
        </div>
        <div>
          <p className="eyebrow">Security controls</p>
          <h3 className="text-xl font-semibold text-white">Threat simulator</h3>
        </div>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-[22px] border border-white/8 bg-slate-950/35 p-4 text-sm leading-6 text-slate-300">
          Use this lab for guided demos, resilience drills, and operator training. Every enabled attack leaves a
          before/after trail so users can see exactly which transaction field or balance value changed.
        </div>
        <div className="rounded-[22px] border border-white/8 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Risk posture</p>
          <p className="mt-2 text-xl font-semibold text-white">
            {overview.metrics.active_attack_count > 0 ? 'Simulation active' : 'Protected baseline'}
          </p>
          <p className="mt-2 text-sm text-slate-300">
            {overview.metrics.active_attack_count > 0
              ? `${overview.metrics.active_attack_count} attack path(s) are enabled right now.`
              : 'No attacks are enabled. Transfers represent the normal operating flow.'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {ATTACKS.map((attack) => {
          const enabled = !!overview.attack_state[attack.id];
          return (
            <div key={attack.id} className="rounded-[22px] border border-white/8 bg-slate-950/35 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <div className="mt-1 rounded-2xl bg-white/6 p-2 text-slate-200">
                    <attack.icon size={16} />
                  </div>
                  <div>
                    <p className="font-medium text-white">{attack.name}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{attack.description}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggle(attack.id, !enabled)}
                  disabled={loadingAttack === attack.id || !canAdmin}
                  className={`min-w-[88px] rounded-full px-3 py-2 text-xs font-semibold transition ${
                    enabled ? 'bg-danger text-white' : 'bg-white/8 text-slate-300'
                  } ${loadingAttack === attack.id || !canAdmin ? 'opacity-60' : 'hover:opacity-90'}`}
                >
                  {loadingAttack === attack.id ? 'Saving' : enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              {attack.id === 'insider' && enabled ? (
                <div className="mt-4 border-t border-white/8 pt-4">
                  <label className="field">
                    <span>Target wallet</span>
                    <select
                      className="glass-input"
                      value={insiderTargetUserId}
                      onChange={(event) => setInsiderTargetUserId(event.target.value)}
                    >
                      {customerUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={handleInsiderTrigger}
                    disabled={!insiderTargetUserId || loadingAttack === 'insider-trigger' || !canAdmin}
                    className="mt-3 w-full rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-semibold text-sky-100 transition hover:bg-primary/20 disabled:opacity-60"
                  >
                    {loadingAttack === 'insider-trigger' ? 'Applying edit...' : 'Execute DB drift'}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={handleResetAttackEngine}
          disabled={loadingAttack === 'reset-attacks' || !canAdmin}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10 disabled:opacity-60"
        >
          <RotateCcw size={16} />
          {loadingAttack === 'reset-attacks' ? 'Resetting...' : 'Disable attacks and clear logs'}
        </button>
      </div>

      {message ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
          {message}
        </div>
      ) : null}

      {!canAdmin ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
          Attack controls are limited to the <span className="font-semibold text-white">admin</span> role.
        </div>
      ) : null}

      <div className="mt-6 rounded-[24px] border border-white/8 bg-slate-950/55 p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <p className="eyebrow">Tamper Evidence</p>
            <h4 className="text-sm font-semibold text-white">Recent attack events</h4>
          </div>
          <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-400">
            {overview.attack_logs.length} logs
          </span>
        </div>

        <div className="custom-scrollbar max-h-[360px] space-y-3 overflow-y-auto pr-1">
          {overview.attack_logs.length === 0 ? (
            <div className="flex min-h-[180px] items-center justify-center rounded-[20px] border border-dashed border-white/10 text-sm text-slate-500">
              No attack events recorded yet.
            </div>
          ) : (
            overview.attack_logs.map((log, index) => (
              <ForensicDiffCard key={`${log.attack_type}-${log.timestamp}-${index}`} log={log} compact />
            ))
          )}
        </div>
      </div>
    </section>
  );
};

export default AttackPanel;
