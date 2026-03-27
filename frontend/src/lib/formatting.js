export function getCurrencyCode(config) {
  return config?.currency_code || 'INR';
}

export function getCurrencyFormatter(config) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: getCurrencyCode(config),
    maximumFractionDigits: 2,
  });
}

export function formatCurrency(value, config) {
  return getCurrencyFormatter(config).format(Number(value || 0));
}

export function formatStage(stage) {
  if (!stage) return 'Unknown stage';
  return stage.replaceAll('_', ' ');
}

export function formatSource(source) {
  if (!source) return 'user';
  return source.replaceAll('_', ' ');
}
