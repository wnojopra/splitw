import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type LocalGroup } from '../db';
import { calculateLocalBalances } from '../services/balances';
import { syncAll } from '../services/sync';
import { PlusIcon, TrashIcon, UsersIcon, ArrowRightIcon, InfoIcon } from './Icons';
import { ExpenseModal } from './ExpenseModal';

interface GroupDetailProps {
  group: LocalGroup;
  currentUser: { id: string; email: string; display_name: string };
}

type ViewTab = 'expenses' | 'balances';

export const GroupDetail: React.FC<GroupDetailProps> = ({ group, currentUser }) => {
  const [activeTab, setActiveTab] = useState<ViewTab>('expenses');
  const [inviteEmail, setInviteEmail] = useState('');
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  // Expense Modal triggers
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [settlementPrefill, setSettlementPrefill] = useState<{ from_user_id: string; to_user_id: string; amount: string } | undefined>(undefined);

  // Query expenses for this group using Dexie.js live tracker
  const expenses = useLiveQuery(
    () => db.expenses.where('group_id').equals(group.id).toArray(),
    [group.id]
  );

  // Filter out deleted expenses for calculation and display
  const activeExpenses = (expenses || []).filter(e => e.is_deleted !== 1);

  // Compute local balances and simplified debts instantly from active expenses
  const { balances, simplified_debts } = calculateLocalBalances(group, activeExpenses);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;

    // Simple regex validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMemberError('Invalid email format');
      return;
    }

    // Check if already a member
    if (group.members.some(m => m.email.toLowerCase() === email)) {
      setMemberError('User is already in the group');
      return;
    }

    setIsAddingMember(true);
    setMemberError(null);

    try {
      const newMember = {
        id: `dev-google-id-${email}`,
        email,
        display_name: email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1)
      };

      const updatedGroup = {
        ...group,
        members: [...group.members, newMember],
        updated_at: new Date().toISOString(),
        syncState: 'pending' as const
      };

      // Write to IndexedDB
      await db.groups.put(updatedGroup);
      
      // Sync instantly
      syncAll();

      setInviteEmail('');
      setMemberError('Member invited successfully!');
      setTimeout(() => setMemberError(null), 3000);
    } catch (err: any) {
      setMemberError(err.message || 'Failed to invite member');
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!confirm('Are you sure you want to delete this expense?')) return;

    try {
      const expense = await db.expenses.get(expenseId);
      if (!expense) return;

      // Soft-delete locally
      await db.expenses.put({
        ...expense,
        is_deleted: 1,
        syncState: 'pending',
        updated_at: new Date().toISOString()
      });

      // Trigger background synchronization
      syncAll();
    } catch (err) {
      console.error('Failed to delete expense:', err);
    }
  };

  const openSettlement = (fromId: string, toId: string, amount: string) => {
    setSettlementPrefill({ from_user_id: fromId, to_user_id: toId, amount });
    setIsExpenseModalOpen(true);
  };

  const closeExpenseModal = () => {
    setIsExpenseModalOpen(false);
    setSettlementPrefill(undefined);
  };

  // Helper: Find display name of a member
  const getMemberName = (id: string) => {
    if (id === currentUser.id) return 'You';
    const member = group.members.find(m => m.id === id);
    return member ? member.display_name : 'Unknown Member';
  };

  return (
    <div className="main-view">
      {/* Header panel */}
      <div className="card" style={{ padding: '1.5rem 1.75rem' }}>
        <div className="view-header">
          <div className="view-title-block">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <h2>{group.name}</h2>
              <span className={`badge badge-${group.syncState}`}>
                <span className="badge-dot"></span>
                {group.syncState === 'synced' ? 'Synced' : 'Pending Sync'}
              </span>
            </div>
            {group.description && <span className="view-subtitle">{group.description}</span>}
          </div>

          <button className="btn btn-primary" onClick={() => setIsExpenseModalOpen(true)}>
            <PlusIcon /> Add Expense
          </button>
        </div>
      </div>

      {/* Grid: Left Content / Right Group Details */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem', alignItems: 'start' }} className="group-detail-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Navigation Tabs */}
          <div className="tabs-bar">
            <button
              className={`tab-btn ${activeTab === 'expenses' ? 'active' : ''}`}
              onClick={() => setActiveTab('expenses')}
            >
              Expenses
            </button>
            <button
              className={`tab-btn ${activeTab === 'balances' ? 'active' : ''}`}
              onClick={() => setActiveTab('balances')}
            >
              Balances & Debts
            </button>
          </div>

          {/* Tabs Content */}
          {activeTab === 'expenses' ? (
            <div className="expenses-list">
              {activeExpenses.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">🧾</div>
                  <h3>No active expenses yet</h3>
                  <p>Add your first expense to split bills with friends.</p>
                  <button className="btn btn-secondary" onClick={() => setIsExpenseModalOpen(true)}>
                    Add Expense Now
                  </button>
                </div>
              ) : (
                activeExpenses
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map((expense) => (
                    <div key={expense.id} className="expense-item">
                      <div className="expense-item-left">
                        <div className={`expense-icon ${expense.is_settlement ? 'expense-icon-settlement' : ''}`}>
                          {expense.is_settlement ? '🤝' : '🍔'}
                        </div>
                        <div className="expense-details">
                          <span className="expense-desc">{expense.description}</span>
                          <span className="expense-meta">
                            <span>{new Date(expense.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            <span>&bull;</span>
                            <span>Paid by <strong>{getMemberName(expense.paid_by_id)}</strong></span>
                            {expense.syncState === 'pending' && (
                              <>
                                <span>&bull;</span>
                                <span style={{ color: 'var(--warning)', fontWeight: 'bold' }}>Syncing...</span>
                              </>
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="expense-item-right">
                        <span className="expense-amount">${parseFloat(expense.amount).toFixed(2)}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className="expense-payer-label">
                            {expense.is_settlement ? 'Settlement payment' : `${expense.splits.length} split participant(s)`}
                          </span>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem', borderRadius: '6px', border: 'none', color: 'var(--danger)' }}
                            onClick={() => handleDeleteExpense(expense.id)}
                            title="Delete Expense"
                          >
                            <TrashIcon size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
              )}
            </div>
          ) : (
            /* Balances and Settlements tab */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Net Balances Summary Cards */}
              <div className="card">
                <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <UsersIcon size={18} /> Net Group Balances
                </h4>
                <div className="balances-list">
                  {group.members.map((member) => {
                    const balAmount = parseFloat(balances[member.id] || '0.00');
                    const isPositive = balAmount > 0.009;
                    const isNegative = balAmount < -0.009;
                    
                    return (
                      <div key={member.id} className="balance-member-card">
                        <div className="balance-member-left">
                          <div className="group-members-avatar-item" style={{ width: '32px', height: '32px', fontSize: '12px' }}>
                            {member.display_name.charAt(0)}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 600 }}>{member.id === currentUser.id ? 'You' : member.display_name}</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{member.email}</span>
                          </div>
                        </div>

                        <span className={`balance-member-amount ${isPositive ? 'positive' : isNegative ? 'negative' : ''}`}>
                          {isPositive ? `+ $${balAmount.toFixed(2)}` : isNegative ? `- $${Math.abs(balAmount).toFixed(2)}` : '$0.00'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Simplified Debt Settlement visual recommendations */}
              <div className="card">
                <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <InfoIcon size={18} /> Suggested Debt Settlements
                </h4>
                
                {simplified_debts.length === 0 ? (
                  <div className="empty-state" style={{ padding: '2rem 1.5rem' }}>
                    <h3>Everyone is fully settled up! 🎉</h3>
                    <p>No pending balances exist inside this group.</p>
                  </div>
                ) : (
                  <div className="debts-list">
                    {simplified_debts.map((debt, idx) => (
                      <div key={idx} className="debt-row">
                        <div className="debt-users">
                          <span style={{ fontWeight: 600 }}>{getMemberName(debt.from_user_id)}</span>
                          <span className="debt-arrow"><ArrowRightIcon size={16} /></span>
                          <span style={{ fontWeight: 600 }}>{getMemberName(debt.to_user_id)}</span>
                        </div>

                        <div className="debt-action-block">
                          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent)' }}>
                            ${parseFloat(debt.amount).toFixed(2)}
                          </span>
                          <button
                            className="btn btn-success"
                            style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                            onClick={() => openSettlement(debt.from_user_id, debt.to_user_id, debt.amount)}
                          >
                            Settle Up
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: Members sidebar list */}
        <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
          <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <UsersIcon /> Members ({group.members.length})
          </h4>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {group.members.map((member) => (
              <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                <div className="group-members-avatar-item" style={{ width: '24px', height: '24px', fontSize: '9px' }}>
                  {member.display_name.charAt(0)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 500 }}>{member.id === currentUser.id ? 'You' : member.display_name}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{member.email}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Invite form */}
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
            <form onSubmit={handleAddMember} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span className="form-label" style={{ fontSize: '0.7rem' }}>Invite New Member</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="email"
                  className="input-field"
                  style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}
                  placeholder="friend@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={isAddingMember}
                  required
                />
                <button type="submit" className="btn btn-secondary" style={{ padding: '0.5rem' }} disabled={isAddingMember}>
                  Invite
                </button>
              </div>
              {memberError && (
                <div
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: memberError.includes('successfully') ? 'var(--success)' : 'var(--danger)',
                    marginTop: '0.25rem'
                  }}
                >
                  {memberError}
                </div>
              )}
            </form>
          </div>
        </div>
      </div>

      {/* Add/Settle Expense Modal Popup */}
      {isExpenseModalOpen && (
        <ExpenseModal
          group={group}
          currentUser={currentUser}
          prefilledSettlement={settlementPrefill}
          onClose={closeExpenseModal}
          onExpenseCreated={() => {
            // Clear prefills and refresh local queries via Dexie hook triggers
            closeExpenseModal();
          }}
        />
      )}
    </div>
  );
};
