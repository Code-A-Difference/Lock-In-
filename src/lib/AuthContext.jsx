import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { accounts } from '@/api/db';
import { queryClientInstance } from '@/lib/query-client';

/**
 * Who is signed in. Accounts are local to this browser (see api/db.js), so
 * there is no server round trip here — "loading" is just the moment it takes
 * to reopen a signed-in tab's vault after a reload.
 */
const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
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

  useEffect(() => {
    const off = accounts.onChange(apply);
    accounts.resume()
      .then(apply)
      .catch(() => apply(null))
      .finally(() => setIsLoadingAuth(false));
    return off;
  }, [apply]);

  const logout = useCallback(() => accounts.signOut(), []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoadingAuth,
      // kept for pages written against the base44 context
      isLoadingPublicSettings: false,
      authError: null,
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
