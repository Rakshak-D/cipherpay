export function resolveSelectedWalletId(wallets, selectedWalletId) {
  const defaultWalletId = wallets.find((user) => !user.is_admin)?.id || wallets[0]?.id || '';
  if (selectedWalletId && wallets.some((user) => String(user.id) === String(selectedWalletId))) {
    return String(selectedWalletId);
  }
  return String(defaultWalletId);
}

export function buildTransferFormDraft(currentDraft, participants, customerUsers, paymentTemplates) {
  if (
    currentDraft?.senderId &&
    currentDraft?.recipientId &&
    currentDraft?.paymentTemplateId
  ) {
    return currentDraft;
  }

  const defaultTemplate = paymentTemplates[0];
  return {
    senderId: String(defaultTemplate?.default_sender_id || participants[0]?.id || ''),
    recipientId: String(defaultTemplate?.default_recipient_id || customerUsers[0]?.id || ''),
    amount: String(defaultTemplate?.default_amount || 250),
    paymentTemplateId: defaultTemplate?.id || '',
  };
}
