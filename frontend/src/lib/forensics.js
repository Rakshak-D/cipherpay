function normalizeValue(value) {
  if (value === undefined) return 'Not present';
  if (value === null) return 'None';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function getIntegrityStatusMeta(status) {
  switch (status) {
    case 'tampered':
      return {
        label: 'Tampered block',
        description: 'This is the first block whose stored contents no longer match its cryptographic hash.',
        tone: 'border-rose-400/30 bg-rose-500/10 text-rose-100',
      };
    case 'downstream_invalid':
      return {
        label: 'Downstream invalid',
        description: 'This block inherits a broken lineage because an earlier block was tampered with.',
        tone: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
      };
    case 'trusted':
    default:
      return {
        label: 'Trusted block',
        description: 'This block is still part of the verified chain state.',
        tone: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100',
      };
  }
}

export function getAttackDiffRows(log) {
  const original = log?.original_values || {};
  const altered = log?.altered_values || {};
  const keys = Array.from(new Set([...Object.keys(original), ...Object.keys(altered)]));

  return keys.map((key) => {
    const before = normalizeValue(original[key]);
    const after = normalizeValue(altered[key]);
    return {
      key,
      before,
      after,
      changed: before !== after,
    };
  });
}
