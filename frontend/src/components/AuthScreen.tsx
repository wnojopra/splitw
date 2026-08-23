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
  const [hasPendingInvite, setHasPendingInvite] = useState(false);

  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // Check if user landed with a group invite link
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinId = params.get('join');
    if (joinId) {
      sessionStorage.setItem('splitw_pending_join', joinId);
      setHasPendingInvite(true);
    } else if (sessionStorage.getItem('splitw_pending_join')) {
      setHasPendingInvite(true);
    }
  }, []);

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

  const completeAuthFlow = async (id_token: string, email: string, displayName: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ access_token: string; token_type: string }>('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ id_token }),
      });

      const decoded = decodeToken(response.access_token);
      const userId = decoded?.sub || `dev-google-id-${email}`;

      const userObj: UserProfile = {
        id: userId,
        email: email,
        display_name: displayName.charAt(0).toUpperCase() + displayName.slice(1),
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

  const handleLogin = async (selectedEmail: string, selectedName?: string) => {
    const derivedEmail = selectedEmail.trim();
    const emailPart = derivedEmail.split('@')[0];
    const capitalizedPart = emailPart.charAt(0).toUpperCase() + emailPart.slice(1);
    const derivedName = selectedName || capitalizedPart || derivedEmail;
    const id_token = `dev-token-${derivedEmail}`;
    await completeAuthFlow(id_token, derivedEmail, derivedName);
  };

  // Register global callback and initialize Google Sign-In
  React.useEffect(() => {
    // 1. Define the callback
    (window as any).handleGoogleCredentialResponse = async (response: any) => {
      const id_token = response.credential;
      const googleDecoded = decodeToken(id_token);
      if (!googleDecoded) {
        setError('Failed to decode Google authentication response.');
        return;
      }
      const email = googleDecoded.email;
      const displayName = googleDecoded.name || email.split('@')[0];
      await completeAuthFlow(id_token, email, displayName);
    };

    // 2. Initialize and render button when Google SDK is available
    const initializeGoogle = () => {
      const google = (window as any).google;
      if (google && import.meta.env.VITE_GOOGLE_CLIENT_ID) {
        google.accounts.id.initialize({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          callback: (window as any).handleGoogleCredentialResponse,
        });
        const buttonDiv = document.getElementById('google-signin-button');
        if (buttonDiv) {
          google.accounts.id.renderButton(buttonDiv, {
            theme: 'outline',
            size: 'large',
            width: 320,
          });
        }
        return true; // Success
      }
      return false;
    };

    // Try immediately
    const success = initializeGoogle();
    
    // If not loaded yet, poll for it
    let interval: ReturnType<typeof setInterval> | undefined;
    if (!success) {
      interval = setInterval(() => {
        if (initializeGoogle()) {
          clearInterval(interval);
        }
      }, 100);
    }

    return () => {
      delete (window as any).handleGoogleCredentialResponse;
      if (interval) clearInterval(interval);
    };
  }, []);

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
          <p>Expense Sharing for my friends</p>
          <p>By Willy Nojopranoto</p>
        </div>

        {hasPendingInvite && (
          <div style={{
            padding: '0.85rem 1rem',
            background: 'var(--primary-light)',
            border: '1px solid var(--primary)',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.85rem',
            color: 'var(--text-primary)',
            textAlign: 'center',
            lineHeight: 1.4
          }}>
            🎉 <strong>You have a group invitation!</strong>
            <div style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Sign in or pick a demo account below to join the group.
            </div>
          </div>
        )}

        {error && <div className="split-row-error" style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--danger-light)', borderRadius: '8px', marginBottom: '1rem' }}>{error}</div>}

        {import.meta.env.VITE_GOOGLE_CLIENT_ID && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
            <div id="google-signin-button"></div>
            
            {isLocalhost && (
              <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '1rem', margin: '0.5rem 0' }}>
                <div style={{ flexGrow: 1, height: '1px', background: 'var(--border)' }}></div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>OR DEV SIGN IN</span>
                <div style={{ flexGrow: 1, height: '1px', background: 'var(--border)' }}></div>
              </div>
            )}
          </div>
        )}

        {isLocalhost ? (
          <>
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
          </>
        ) : (
          !import.meta.env.VITE_GOOGLE_CLIENT_ID && (
            <div style={{ padding: '1.5rem', background: 'var(--danger-light)', borderRadius: '8px', color: 'var(--danger)', fontSize: '0.85rem', textAlign: 'center', border: '1px solid var(--danger)' }}>
              Google Sign-In is not configured. Please contact the administrator.
            </div>
          )
        )}
      </div>
    </div>
  );
};
