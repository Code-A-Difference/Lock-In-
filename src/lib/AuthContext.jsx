import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { accounts, sync } from '@/api/db';
import { queryClientInstance } from '@/lib/query-client';

/**
 * Who is signed in. The account lives on the server (see api/db.js); a
 * reload asks it who this browser's sign-in cookie belongs to. "Loading" is
 * that one request.
 */
const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const lastUsername = useRef(null);

  const apply = useCallback((u) => {
    const name = u ? u.username : null;
    // Different person, or nobody: drop every cached query. React Query keeps
    // the last account's homework in memory, and on a shared computer the next
    // student would otherwise see it flash up before their own loads.
    if (name !== lastUsername.current) {
      queryClientInstance.clear();
      lastUsername.current = name;
    }
    if (!u) document.documentElement.classList.remove('dark');
    setUser(u);
  }, []);

  const resume = useCallback(() => {
    setIsLoadingAuth(true);
    setAuthError(null);
    accounts.resume()
      .then(apply)
      .catch(e => { apply(null); setAuthError(e.message || "Can't reach LOCK IN!'s server."); })
      .finally(() => setIsLoadingAuth(false));
  }, [apply]);

  useEffect(() => {
    const off = accounts.onChange(apply);
    // Another device changed something: every page reloads what it shows.
    const offData = sync.onData(() => queryClientInstance.invalidateQueries());
    resume();
    return () => { off(); offData(); };
  }, [apply, resume]);

  const logout = useCallback(() => accounts.signOut(), []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoadingAuth,
      authError,
      retryAuth: resume,
      // kept for pages written against the base44 context
      isLoadingPublicSettings: false,
      logout,
      navigateToLogin: logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
