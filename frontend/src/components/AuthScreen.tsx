import React, { useState } from 'react';
import { apiRequest, setAuthToken } from '../services/api';
import { WalletIcon } from './Icons';

interface UserProfile {
  id: string;
  email: string;
  display_name: string;
}

interface AuthScreenProps {
  onAuthSuccess: (user: UserProfile, token: string) => void;
}

const DEMO_ACCOUNTS = [
  { name: 'Alice Smith', email: 'alice@example.com' },
  { name: 'Bob Jones', email: 'bob@example.com' },
  { name: 'Charlie Miller', email: 'charlie@example.com' }
];

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess }) => {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Decodes JWT standard format without extra libraries
  const decodeToken = (token: string): any => {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        window.atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      console.error('Failed to decode access token:', e);
      return null;
    }
  };

  const handleLogin = async (selectedEmail: string, selectedName?: string) => {
    setLoading(true);
    setError(null);
    const derivedEmail = selectedEmail.trim();
    const emailPart = derivedEmail.split('@')[0];
    const capitalizedPart = emailPart.charAt(0).toUpperCase() + emailPart.slice(1);
    const derivedName = selectedName || capitalizedPart || derivedEmail;

    try {
      // ID token is prefix + email for developer bypass mode
      const id_token = `dev-token-${derivedEmail}`;

      const response = await apiRequest<{ access_token: string; token_type: string }>('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ id_token }),
      });

      const decoded = decodeToken(response.access_token);
      const userId = decoded?.sub || `dev-google-id-${derivedEmail}`;

      const userObj: UserProfile = {
        id: userId,
        email: derivedEmail,
        display_name: derivedName.charAt(0).toUpperCase() + derivedName.slice(1),
      };

      // Persist auth credentials locally
      setAuthToken(response.access_token);
      localStorage.setItem('splitw_user', JSON.stringify(userObj));

      onAuthSuccess(userObj, response.access_token);
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Make sure backend server is running.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError('Please enter an email address');
      return;
    }
    handleLogin(email, displayName);
  };

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <div className="auth-logo-container">
          <div className="auth-logo-icon">
            <WalletIcon size={36} style={{ color: '#ffffff' }} />
          </div>
          <h2>splitw<span>.</span></h2>
          <p>Premium Offline-First Expense Sharing</p>
          <p>By Willy Nojopranoto</p>
        </div>

        {error && <div className="split-row-error" style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--danger-light)', borderRadius: '8px' }}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              className="input-field"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Display Name (Optional)</label>
            <input
              type="text"
              className="input-field"
              placeholder="e.g. Jane Doe"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Authenticating...' : 'Sign In / Register'}
          </button>
        </form>

        <div style={{ margin: '0.5rem 0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ flexGrow: 1, height: '1px', background: 'var(--border)' }}></div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>OR CHOOSE A DEMO ACCOUNT</span>
          <div style={{ flexGrow: 1, height: '1px', background: 'var(--border)' }}></div>
        </div>

        <div className="demo-accounts-grid">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              className="btn btn-secondary"
              onClick={() => handleLogin(account.email, account.name)}
              disabled={loading}
              style={{ fontSize: '0.825rem', padding: '0.5rem 0.75rem' }}
            >
              {account.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
