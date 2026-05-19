import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { syncAll } from '../services/sync';
import { clearAuthToken } from '../services/api';
import { WalletIcon, PlusIcon, CloudSyncIcon, LogoutIcon, UsersIcon } from './Icons';
import { GroupModal } from './GroupModal';
import { GroupDetail } from './GroupDetail';

interface UserProfile {
  id: string;
  email: string;
  display_name: string;
}

interface DashboardProps {
  currentUser: UserProfile;
  onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ currentUser, onLogout }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);

  // Query groups locally using Dexie useLiveQuery hook
  const groups = useLiveQuery(() => db.groups.toArray());
  
  // Query pending sync states dynamically to show sync badges
  const pendingGroupsCount = useLiveQuery(() => db.groups.where('syncState').equals('pending').count());
  const pendingExpensesCount = useLiveQuery(() => db.expenses.where('syncState').equals('pending').count());
  const hasPendingChanges = (pendingGroupsCount || 0) > 0 || (pendingExpensesCount || 0) > 0;

  // Track online status in real-time
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Automatically sync when back online
      handleSync();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Perform initial background sync on mount
    handleSync();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleSync = async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    try {
      await syncAll();
    } catch (e) {
      console.error('Dashboard sync trigger error:', e);
    } finally {
      setSyncing(false);
    }
  };

  const handleSignOut = () => {
    if (confirm('Are you sure you want to sign out?')) {
      clearAuthToken();
      localStorage.removeItem('splitw_user');
      onLogout();
    }
  };

  // Find selected group details
  const activeGroup = groups?.find(g => g.id === activeGroupId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Offline Banner Alert */}
      {!isOnline && (
        <div className="sync-banner sync-banner-offline">
          <span>⚠️ You are currently operating offline. All additions/settlements will be saved locally and synced when you reconnect.</span>
          <span className="badge badge-offline"><span className="badge-dot"></span>Offline</span>
        </div>
      )}

      {/* Pending Changes Alert Banner */}
      {isOnline && hasPendingChanges && (
        <div className="sync-banner" style={{ background: 'linear-gradient(135deg, var(--warning) 0%, var(--warning-hover) 100%)' }}>
          <span>📝 You have local edits pending synchronization with the cloud server.</span>
          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem', color: 'black', background: 'white' }} onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      )}

      {/* Navigation Bar Header */}
      <header className="app-header">
        <div className="container header-content">
          <div className="brand" onClick={() => setActiveGroupId(null)}>
            <WalletIcon size={28} style={{ color: 'var(--primary)', marginRight: '0.5rem' }} />
            splitw<span>.</span>
          </div>

          <div className="header-actions">
            {isOnline && (
              <button
                className={`btn ${syncing ? 'btn-secondary' : 'btn-secondary'}`}
                style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', gap: '0.375rem' }}
                onClick={handleSync}
                disabled={syncing}
              >
                <CloudSyncIcon size={14} className={syncing ? 'skeleton' : ''} />
                {syncing ? 'Syncing...' : 'Sync'}
              </button>
            )}

            <div className="user-profile-btn" onClick={handleSignOut} title="Click to Sign Out">
              <div className="group-members-avatar-item" style={{ width: '32px', height: '32px', marginLeft: 0, fontSize: '12px', background: 'var(--primary)' }}>
                {currentUser.display_name.charAt(0)}
              </div>
              <span className="user-name" style={{ marginLeft: '0.5rem' }}>{currentUser.display_name}</span>
              <LogoutIcon size={14} style={{ marginLeft: '0.5rem', color: 'var(--text-muted)' }} />
            </div>
          </div>
        </div>
      </header>

      {/* Dashboard Main Body */}
      <main className="container flex-grow" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="dashboard-grid" style={{ flexGrow: 1 }}>
          {/* Sidebar: Groups list */}
          <aside className="sidebar">
            <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem' }}>
                  <UsersIcon /> Your Groups
                </h3>
                <button className="btn btn-primary" style={{ padding: '0.375rem 0.625rem', borderRadius: '8px' }} onClick={() => setIsGroupModalOpen(true)}>
                  <PlusIcon size={14} />
                </button>
              </div>

              {/* Groups card listing */}
              <div className="group-list">
                {!groups || groups.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem 1rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    No groups created yet. Tap '+' to create a group.
                  </div>
                ) : (
                  groups.map((g) => {
                    const isActive = g.id === activeGroupId;
                    return (
                      <div
                        key={g.id}
                        className={`group-card ${isActive ? 'active' : ''}`}
                        onClick={() => setActiveGroupId(g.id)}
                      >
                        <div className="group-card-header">
                          <span className="group-name">{g.name}</span>
                          {g.syncState === 'pending' && (
                            <span className="badge badge-pending" style={{ fontSize: '0.6rem', padding: '0.125rem 0.375rem' }}>
                              Pending
                            </span>
                          )}
                        </div>
                        {g.description && <p className="group-card-desc">{g.description}</p>}
                        
                        <div className="group-card-footer">
                          <div className="group-members-avatars">
                            {g.members.slice(0, 4).map((m) => (
                              <div key={m.id} className="group-members-avatar-item" title={m.display_name}>
                                {m.display_name.charAt(0)}
                              </div>
                            ))}
                            {g.members.length > 4 && (
                              <div className="group-members-avatar-item" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}>
                                +{g.members.length - 4}
                              </div>
                            )}
                          </div>
                          <span>{g.members.length} member(s)</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </aside>

          {/* Main Content View */}
          <section className="main-view-container" style={{ display: 'flex', flexDirection: 'column' }}>
            {activeGroup ? (
              <GroupDetail
                key={activeGroup.id}
                group={activeGroup}
                currentUser={currentUser}
              />
            ) : (
              /* Elegant Landing state */
              <div className="card empty-state" style={{ flexGrow: 1, padding: '5rem 2rem', alignSelf: 'stretch', justifyContent: 'center' }}>
                <div className="empty-state-icon" style={{ fontSize: '4.5rem', animation: 'logo-spin infinite 25s linear' }}>🎒</div>
                <h2 style={{ fontSize: '2rem', fontWeight: 800 }}>Settle expenses with splitw.</h2>
                <p style={{ maxWidth: '460px', margin: '0 auto', fontSize: '1.05rem' }}>
                  Create a group for trips, household shares, or casual outings. Keep track of who paid what, divide custom shares, and settle debt instantly with state-of-the-art offline-first support.
                </p>
                <button className="btn btn-primary" onClick={() => setIsGroupModalOpen(true)} style={{ marginTop: '1rem' }}>
                  <PlusIcon /> Create a Group
                </button>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Create Group Modal Popup */}
      {isGroupModalOpen && (
        <GroupModal
          currentUser={currentUser}
          onClose={() => setIsGroupModalOpen(false)}
          onGroupCreated={(groupId) => {
            setActiveGroupId(groupId);
            setIsGroupModalOpen(false);
          }}
        />
      )}
    </div>
  );
};
