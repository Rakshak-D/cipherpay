export function getDisplayAmount(entry, activeUserId) {
  if (!entry) return 0;
  if (Number(entry.sender_id) === Number(activeUserId)) {
    return Number(entry.sender_impact_amount ?? entry.amount ?? 0);
  }
  return Number(entry.recipient_impact_amount ?? entry.amount ?? 0);
}

export function groupTransactionActivity(entries, activeUserId) {
  const payments = [];
  const securityByParent = new Map();

  for (const entry of entries || []) {
    if (entry.kind === 'security_event') {
      const key = entry.parent_tx_uuid || entry.tx_uuid;
      const current = securityByParent.get(key) || [];
      current.push(entry);
      securityByParent.set(key, current);
      continue;
    }
    payments.push(entry);
  }

  return payments
    .filter(
      (entry) =>
        Number(entry.sender_id) === Number(activeUserId) ||
        Number(entry.recipient_id) === Number(activeUserId)
    )
    .map((payment) => {
      const securityEvents = securityByParent.get(payment.tx_uuid) || [];
      return {
        payment,
        securityEvents,
        displayAmount: getDisplayAmount(payment, activeUserId),
        hasSecurityEvents: securityEvents.length > 0,
      };
    })
    .sort((a, b) => (b.payment.timestamp || 0) - (a.payment.timestamp || 0));
}

export function filterGroupedActivity(groups, filterId, activeUserId) {
  switch (filterId) {
    case 'initiated':
      return groups.filter(
        (group) =>
          Number(group.payment.sender_id) === Number(activeUserId) &&
          group.payment.source === 'user'
      );
    case 'outgoing':
      return groups.filter((group) => Number(group.payment.sender_id) === Number(activeUserId));
    case 'incoming':
      return groups.filter((group) => Number(group.payment.recipient_id) === Number(activeUserId));
    case 'failed':
      return groups.filter((group) => group.payment.status === 'rejected');
    case 'attack-generated':
      return groups.filter(
        (group) =>
          group.payment.source === 'attack' ||
          group.securityEvents.length > 0
      );
    case 'all':
    default:
      return groups;
  }
}
