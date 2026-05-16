import React, { useState } from 'react';
import { db, type LocalGroup } from '../db';
import { syncAll } from '../services/sync';

interface GroupModalProps {
  currentUser: { id: string; email: string; display_name: string };
  onClose: () => void;
  onGroupCreated: (groupId: string) => void;
}

export const GroupModal: React.FC<GroupModalProps> = ({ currentUser, onClose, onGroupCreated }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [emails, setEmails] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleAddEmail = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed) return;

    // Validate email format basically
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Invalid email address format');
      return;
    }

    if (trimmed === currentUser.email.toLowerCase()) {
      setError('You are automatically included in this group');
      return;
    }

    if (emails.includes(trimmed)) {
      setError('Email already added to invitations');
      return;
    }

    setEmails([...emails, trimmed]);
    setEmailInput('');
    setError(null);
  };

  const handleRemoveEmail = (idxToRemove: number) => {
    setEmails(emails.filter((_, idx) => idx !== idxToRemove));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Group name is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const groupId = crypto.randomUUID();

      // Create mock user structures for all invited members
      // The server will resolve them to true users during synchronization
      const resolvedMembers = [
        {
          id: currentUser.id,
          email: currentUser.email,
          display_name: currentUser.display_name
        },
        ...emails.map(email => ({
          id: `dev-google-id-${email}`,
          email,
          display_name: email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1)
        }))
      ];

      const newGroup: LocalGroup = {
        id: groupId,
        name: name.trim(),
        description: description.trim() || undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        members: resolvedMembers,
        syncState: 'pending'
      };

      // Save locally instantly to IndexedDB
      await db.groups.put(newGroup);

      // Trigger background synchronization to backend
      syncAll();

      onGroupCreated(groupId);
      onClose();
    } catch (err: any) {
      console.error('Failed to create group locally:', err);
      setError(err.message || 'Failed to create group');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="card modal-content" style={{ overflowY: 'visible' }}>
        <div className="modal-header">
          <h3>Create a New Group</h3>
          <button className="modal-close-btn" onClick={onClose} disabled={saving}>&times;</button>
        </div>

        {error && <div className="split-row-error" style={{ marginBottom: '1rem', padding: '0.5rem', background: 'var(--danger-light)', borderRadius: '8px' }}>{error}</div>}

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="form-group">
            <label className="form-label">Group Name</label>
            <input
              type="text"
              className="input-field"
              placeholder="e.g., Roommates, Trip to Japan"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Description</label>
            <input
              type="text"
              className="input-field"
              placeholder="e.g., Shared apartment expenses"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Invite Group Members</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="email"
                className="input-field"
                placeholder="friend@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddEmail(e);
                  }
                }}
                disabled={saving}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleAddEmail}
                disabled={saving}
                style={{ padding: '0.75rem 1rem' }}
              >
                Add
              </button>
            </div>
          </div>

          {/* Added emails display list */}
          {emails.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '-0.5rem' }}>
              {emails.map((email, idx) => (
                <div
                  key={email}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--border)',
                    padding: '0.25rem 0.625rem',
                    borderRadius: '20px',
                    fontSize: '0.8rem'
                  }}
                >
                  <span>{email}</span>
                  <button
                    type="button"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--danger)',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      padding: 0,
                      fontWeight: 'bold'
                    }}
                    onClick={() => handleRemoveEmail(idx)}
                    disabled={saving}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
