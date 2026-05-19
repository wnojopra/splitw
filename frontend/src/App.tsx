import { useState, useEffect } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { Dashboard } from './components/Dashboard';

interface UserProfile {
  id: string;
  email: string;
  display_name: string;
}

function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  // Check persistence login on startup
  useEffect(() => {
    const savedToken = localStorage.getItem('splitw_token');
    const savedUser = localStorage.getItem('splitw_user');

    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setCurrentUser(JSON.parse(savedUser));
      } catch (e) {
        console.error('Failed to parse saved user credentials:', e);
        localStorage.removeItem('splitw_token');
        localStorage.removeItem('splitw_user');
      }
    }
    setInitializing(false);

    // Global interceptor listener for 401 unauthorized API responses
    const handleUnauthorized = () => {
      setCurrentUser(null);
      setToken(null);
    };

    window.addEventListener('auth-unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth-unauthorized', handleUnauthorized);
    };
  }, []);

  const handleAuthSuccess = (user: UserProfile, accessToken: string) => {
    setCurrentUser(user);
    setToken(accessToken);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setToken(null);
  };

  if (initializing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#090d16' }}>
        <div className="skeleton" style={{ width: '80px', height: '80px', borderRadius: '16px' }}></div>
      </div>
    );
  }

  return (
    <>
      {currentUser && token ? (
        <Dashboard currentUser={currentUser} onLogout={handleLogout} />
      ) : (
        <AuthScreen onAuthSuccess={handleAuthSuccess} />
      )}
    </>
  );
}

export default App;
