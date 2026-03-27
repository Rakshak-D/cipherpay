import assert from 'node:assert/strict';

import { filterGroupedActivity, getDisplayAmount, groupTransactionActivity } from '../src/lib/activity.js';
import { buildTransferFormDraft, resolveSelectedWalletId } from '../src/lib/uiState.js';

function run(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

run('groupTransactionActivity attaches security events to primary payments', () => {
  const groups = groupTransactionActivity(
    [
      {
        kind: 'payment',
        tx_uuid: 'tx-1',
        sender_id: 2,
        recipient_id: 3,
        amount: 100,
        sender_impact_amount: 100,
        recipient_impact_amount: 100,
        timestamp: 10,
      },
      {
        kind: 'security_event',
        id: 'security-1',
        parent_tx_uuid: 'tx-1',
        payment_label: 'Replay blocked',
        timestamp: 11,
      },
    ],
    2
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].securityEvents.length, 1);
});

run('getDisplayAmount uses sender impact for outgoing and recipient impact for incoming', () => {
  const tx = {
    sender_id: 2,
    recipient_id: 3,
    amount: 100,
    sender_impact_amount: 200,
    recipient_impact_amount: 160,
  };

  assert.equal(getDisplayAmount(tx, 2), 200);
  assert.equal(getDisplayAmount(tx, 3), 160);
});

run('filterGroupedActivity keeps security-linked entries for attack filter', () => {
  const groups = [
    {
      payment: { sender_id: 2, recipient_id: 3, source: 'user', status: 'success' },
      securityEvents: [],
    },
    {
      payment: { sender_id: 2, recipient_id: 3, source: 'attack', status: 'partial_protected' },
      securityEvents: [{ id: 'security-1' }],
    },
  ];

  const filtered = filterGroupedActivity(groups, 'attack-generated', 2);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].securityEvents.length, 1);
});

run('resolveSelectedWalletId preserves valid wallet selections', () => {
  const wallets = [
    { id: 1, is_admin: true },
    { id: 2, is_admin: false },
    { id: 3, is_admin: false },
  ];

  assert.equal(resolveSelectedWalletId(wallets, '3'), '3');
  assert.equal(resolveSelectedWalletId(wallets, ''), '2');
});

run('buildTransferFormDraft preserves an existing complete draft and derives defaults when needed', () => {
  const draft = {
    senderId: '2',
    recipientId: '3',
    amount: '999',
    paymentTemplateId: 'merchant',
  };
  assert.deepEqual(buildTransferFormDraft(draft, [], [], []), draft);

  const defaulted = buildTransferFormDraft(
    { senderId: '', recipientId: '', amount: '', paymentTemplateId: '' },
    [{ id: 1 }],
    [{ id: 2 }],
    [{ id: 'merchant', default_sender_id: 9, default_recipient_id: 5, default_amount: 250 }]
  );
  assert.equal(defaulted.senderId, '9');
  assert.equal(defaulted.recipientId, '5');
  assert.equal(defaulted.amount, '250');
  assert.equal(defaulted.paymentTemplateId, 'merchant');
});
