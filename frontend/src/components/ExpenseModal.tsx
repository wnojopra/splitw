import React, { useState, useEffect } from 'react';
import { db, type LocalGroup, type LocalExpense, type LocalExpenseSplit } from '../db';
import { syncAll } from '../services/sync';

import { SUPPORTED_CURRENCIES } from '../services/currency';

interface ExpenseModalProps {
  group: LocalGroup;
  currentUser: { id: string; email: string; display_name: string };
  prefilledSettlement?: { from_user_id: string; to_user_id: string; amount: string; currency: string };
  expenseToEdit?: LocalExpense;
  onClose: () => void;
  onExpenseCreated: () => void;
}

type SplitMode = 'equal' | 'unequal';

const PRESET_EMOJIS = ['🍔', '🛒', '🏠', '🚗', '🛍️', '🎮', '🍿', '💡', '📦', '✈️', '🍺', '☕', '🍕', '🥗', '🏋️', '🏥', '🎒', '🔌'];

export const ExpenseModal: React.FC<ExpenseModalProps> = ({
  group,
  currentUser,
  prefilledSettlement,
  expenseToEdit,
  onClose,
  onExpenseCreated
}) => {
  // Form inputs state - initialized on mount
  const [isSettlement, setIsSettlement] = useState(!!prefilledSettlement || expenseToEdit?.is_settlement || false);
  const [emoji, setEmoji] = useState(expenseToEdit?.emoji || '🍔');
  const [currency, setCurrency] = useState(() => {
    if (prefilledSettlement) return prefilledSettlement.currency;
    return expenseToEdit?.currency || group.default_currency || 'EUR';
  });
  
  const [description, setDescription] = useState(() => {
    if (prefilledSettlement) {
      return `Settle debt to ${group.members.find(m => m.id === prefilledSettlement.to_user_id)?.display_name || 'Friend'}`;
    }
    return expenseToEdit?.description || '';
  });

  const [amount, setAmount] = useState(() => {
    if (prefilledSettlement) return prefilledSettlement.amount;
    return expenseToEdit?.amount || '';
  });

  const [payerId, setPayerId] = useState(() => {
    if (prefilledSettlement) return prefilledSettlement.from_user_id;
    return expenseToEdit?.paid_by_id || currentUser.id;
  });

  const [date, setDate] = useState(() => {
    if (expenseToEdit?.date) {
      return new Date(expenseToEdit.date).toISOString().split('T')[0];
    }
    return new Date().toISOString().split('T')[0];
  });

  const [recipientId, setRecipientId] = useState(() => {
    if (prefilledSettlement) return prefilledSettlement.to_user_id;
    if (expenseToEdit && expenseToEdit.is_settlement && expenseToEdit.splits[0]) {
      return expenseToEdit.splits[0].user_id;
    }
    return group.members.find(m => m.id !== currentUser.id)?.id || '';
  });

  // Splits state
  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [participants, setParticipants] = useState<Record<string, boolean>>({});
  const [unequalAmounts, setUnequalAmounts] = useState<Record<string, string>>({});

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Initialize participants, unequal amounts, and detect split mode
  useEffect(() => {
    const initialParticipants: Record<string, boolean> = {};
    const initialUnequal: Record<string, string> = {};
    
    // Default: all members checked
    for (const member of group.members) {
      initialParticipants[member.id] = true;
      initialUnequal[member.id] = '';
    }

    if (expenseToEdit && !expenseToEdit.is_settlement) {
      const editSplits = expenseToEdit.splits || [];
      const splitUserIds = new Set(editSplits.map(s => s.user_id));
      
      // Checked if in splits
      for (const member of group.members) {
        initialParticipants[member.id] = splitUserIds.has(member.id);
      }

      // Load amounts
      for (const split of editSplits) {
        initialUnequal[split.user_id] = split.owed_amount;
      }

      // Detect split mode
      if (editSplits.length > 0) {
        const total = parseFloat(expenseToEdit.amount) || 0;
        const expectedShare = total / editSplits.length;
        let isAllEqual = true;
        for (const split of editSplits) {
          const amt = parseFloat(split.owed_amount) || 0;
          if (Math.abs(amt - expectedShare) > 0.015) {
            isAllEqual = false;
            break;
          }
        }
        setSplitMode(isAllEqual ? 'equal' : 'unequal');
      }
    }

    setParticipants(initialParticipants);
    setUnequalAmounts(initialUnequal);
  }, [group.members, expenseToEdit]);

  // Auto calculate equal shares or unequal totals
  const totalAmount = parseFloat(amount) || 0;
  const checkedCount = Object.values(participants).filter(Boolean).length;
  
  const currencySymbol = SUPPORTED_CURRENCIES.find(c => c.code === currency)?.symbol || '$';

  let allocationStatus = '';
  let isAllocationValid = true;
  let unequalSum = 0;

  if (isSettlement) {
    isAllocationValid = totalAmount > 0 && payerId !== recipientId;
    if (payerId === recipientId) {
      allocationStatus = 'Payer and recipient must be different users';
    }
  } else if (splitMode === 'equal') {
    isAllocationValid = totalAmount > 0 && checkedCount > 0;
    if (checkedCount === 0 && totalAmount > 0) {
      allocationStatus = 'Select at least one participant to split';
    }
  } else {
    // Custom unequal allocation sum verification
    unequalSum = Object.entries(unequalAmounts)
      .reduce((sum, [_, val]) => sum + (parseFloat(val) || 0), 0);
    const diff = totalAmount - unequalSum;
    
    if (totalAmount <= 0) {
      isAllocationValid = false;
      allocationStatus = 'Enter a valid total amount';
    } else if (Math.abs(diff) > 0.009) {
      isAllocationValid = false;
      allocationStatus = diff > 0 
        ? `${currencySymbol}${diff.toFixed(2)} left to allocate` 
        : `${currencySymbol}${Math.abs(diff).toFixed(2)} over-allocated!`;
    } else {
      isAllocationValid = true;
      allocationStatus = 'All amounts perfectly allocated!';
    }
  }

  const handleToggleParticipant = (id: string) => {
    setParticipants(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleUnequalAmountChange = (id: string, val: string) => {
    // Allow numbers and decimals
    if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
      setUnequalAmounts(prev => ({ ...prev, [id]: val }));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError('Description is required');
      return;
    }
    if (totalAmount <= 0) {
      setError('Amount must be greater than 0');
      return;
    }
    if (!isAllocationValid) {
      setError(isSettlement ? 'Invalid settlement configuration' : 'Splits allocation check failed');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const expenseId = expenseToEdit ? expenseToEdit.id : crypto.randomUUID();
      let calculatedSplits: LocalExpenseSplit[] = [];

      if (isSettlement) {
        // Settlement ledger configuration: recipient is the only one in splits holding owed_amount = totalAmount
        calculatedSplits = [{
          user_id: recipientId,
          owed_amount: totalAmount.toFixed(2)
        }];
      } else if (splitMode === 'equal') {
        // Precision division of total cents to prevent remainder drift
        const totalCents = Math.round(totalAmount * 100);
        const selectedIds = Object.entries(participants)
          .filter(([_, checked]) => checked)
          .map(([id]) => id);

        const baseCents = Math.floor(totalCents / selectedIds.length);
        let remainderCents = totalCents % selectedIds.length;

        calculatedSplits = selectedIds.map((userId) => {
          let cents = baseCents;
          if (remainderCents > 0) {
            cents += 1;
            remainderCents -= 1;
          }
          return {
            user_id: userId,
            owed_amount: (cents / 100).toFixed(2)
          };
        });
      } else {
        // Custom allocation splits
        calculatedSplits = Object.entries(unequalAmounts)
          .map(([userId, val]) => ({
            user_id: userId,
            owed_amount: (parseFloat(val) || 0).toFixed(2)
          }))
          .filter(s => parseFloat(s.owed_amount) > 0);
      }

      const newExpense: LocalExpense = {
        id: expenseId,
        group_id: group.id,
        paid_by_id: payerId,
        description: description.trim(),
        amount: totalAmount.toFixed(2),
        currency: currency,
        date: new Date(date).toISOString(),
        is_settlement: isSettlement,
        emoji: isSettlement ? '🤝' : emoji,
        splits: calculatedSplits,
        is_deleted: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        syncState: 'pending'
      };

      // Save locally instantly
      await db.expenses.put(newExpense);

      // Fire-and-forget background synchronization
      syncAll();

      onExpenseCreated();
      onClose();
    } catch (err: any) {
      console.error('Failed to save expense locally:', err);
      setError(err.message || 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="card modal-content">
        <div className="modal-header">
          <h3>{isSettlement ? 'Record a Settlement' : 'Add an Expense'}</h3>
          <button className="modal-close-btn" onClick={onClose} disabled={saving}>&times;</button>
        </div>

        {error && <div className="split-row-error" style={{ marginBottom: '1rem', padding: '0.5rem', background: 'var(--danger-light)', borderRadius: '8px' }}>{error}</div>}

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="form-group">
            <label className="form-label">Description</label>
            <input
              type="text"
              className="input-field"
              placeholder={isSettlement ? 'e.g. Cash Settlement' : 'e.g. Groceries, Dinner'}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              required
            />
          </div>

          {!isSettlement && (
            <div className="form-group">
              <label className="form-label">Icon / Emoji</label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem', padding: '0.25rem' }}>
                {PRESET_EMOJIS.map(e => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEmoji(e)}
                    style={{
                      fontSize: '1.3rem',
                      padding: '0.35rem',
                      borderRadius: '8px',
                      border: emoji === e ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: emoji === e ? 'rgba(0, 123, 255, 0.1)' : 'transparent',
                      cursor: 'pointer',
                      width: '38px',
                      height: '38px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.15s ease',
                    }}
                    title={`Select ${e}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="input-row">
            <div className="form-group" style={{ flex: '0 0 110px' }}>
              <label className="form-label">Currency</label>
              <select
                className="input-field"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={saving}
              >
                {SUPPORTED_CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ flex: '1' }}>
              <label className="form-label">Amount</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="input-field"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={saving}
                required
              />
            </div>

            <div className="form-group" style={{ flex: '1.2' }}>
              <label className="form-label">Date</label>
              <input
                type="date"
                className="input-field"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={saving}
                required
              />
            </div>
          </div>

          <div className="input-row">
            <div className="form-group">
              <label className="form-label">{isSettlement ? 'Who paid' : 'Paid By'}</label>
              <select
                className="input-field"
                value={payerId}
                onChange={(e) => setPayerId(e.target.value)}
                disabled={saving}
              >
                {group.members.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.id === currentUser.id ? 'You' : m.display_name}
                  </option>
                ))}
              </select>
            </div>

            {isSettlement ? (
              <div className="form-group">
                <label className="form-label">Paid To</label>
                <select
                  className="input-field"
                  value={recipientId}
                  onChange={(e) => setRecipientId(e.target.value)}
                  disabled={saving}
                >
                  {group.members.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.id === currentUser.id ? 'You' : m.display_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="form-group" style={{ justifyContent: 'center', alignItems: 'flex-start', paddingLeft: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={isSettlement}
                    onChange={(e) => setIsSettlement(e.target.checked)}
                    disabled={saving}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  This is a debt settlement
                </label>
              </div>
            )}
          </div>

          {/* Split Calculator Logic */}
          {!isSettlement && (
            <div className="splits-calculator">
              <div className="splits-cal-header">
                <span className="form-label" style={{ fontSize: '0.75rem' }}>Split Breakdown</span>
                <div className="tabs-bar" style={{ padding: '0.15rem' }}>
                  <button
                    type="button"
                    className={`tab-btn ${splitMode === 'equal' ? 'active' : ''}`}
                    onClick={() => setSplitMode('equal')}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                    disabled={saving}
                  >
                    Equally
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${splitMode === 'unequal' ? 'active' : ''}`}
                    onClick={() => setSplitMode('unequal')}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                    disabled={saving}
                  >
                    Unequally
                  </button>
                </div>
              </div>

              {splitMode === 'equal' ? (
                <div className="split-rows">
                  {group.members.map(m => {
                    const share = checkedCount > 0 ? (totalAmount / checkedCount).toFixed(2) : '0.00';
                    return (
                      <div key={m.id} className="split-row-item">
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                          <input
                            type="checkbox"
                            checked={!!participants[m.id]}
                            onChange={() => handleToggleParticipant(m.id)}
                            disabled={saving}
                            style={{ cursor: 'pointer' }}
                          />
                          <span>{m.id === currentUser.id ? 'You' : m.display_name}</span>
                        </label>
                        {participants[m.id] && (
                          <span className="split-input-pct" style={{ width: 'auto', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            {currencySymbol}{share}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="split-rows">
                  {group.members.map(m => (
                    <div key={m.id} className="split-row-item">
                      <span className="split-user-name">{m.id === currentUser.id ? 'You' : m.display_name}</span>
                      <div className="split-input-wrapper">
                        <span className="split-input-prefix">{currencySymbol}</span>
                        <input
                          type="text"
                          className="input-field"
                          style={{ padding: '0.375rem 0.5rem', fontSize: '0.875rem' }}
                          placeholder="0.00"
                          value={unequalAmounts[m.id] || ''}
                          onChange={(e) => handleUnequalAmountChange(m.id, e.target.value)}
                          disabled={saving}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {allocationStatus && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: isAllocationValid ? 'var(--success)' : 'var(--warning)',
                    textAlign: 'right'
                  }}
                >
                  {allocationStatus}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || !isAllocationValid}>
              {saving ? 'Saving...' : 'Save Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
