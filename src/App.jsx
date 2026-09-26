import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import React, { useEffect, useRef } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import SignIn from '@/pages/SignIn';
import { FocusProvider, useFocus } from '@/lib/FocusContext';
import Focus from '@/pages/Focus';
import VoicePanel from '@/components/lockin/VoicePanel';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

// Served from a sub-folder (e.g. /lockin/), the router has to know, or every
// link and refresh resolves against the site root instead.
const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || undefined;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

function LegacyFocusRoute() {
  const focus = useFocus();
  const navigate = useNavigate();
  useEffect(() => {
    focus.openFocus();
    navigate('/', { replace: true });
  }, [focus.openFocus, navigate]);
  return null;
}

function FocusSurface() {
  const focus = useFocus();
  const closeRef = useRef(null);
  useEffect(() => {
    if (!focus.overlayOpen) return undefined;
    const previous = document.activeElement;
    const onKey = e => { if (e.key === 'Escape') focus.closeFocus(); };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [focus.overlayOpen, focus.closeFocus]);
  if (!focus.overlayOpen) return null;
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-950/45 p-0 backdrop-blur-sm sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) focus.closeFocus(); }}>
      <section role="dialog" aria-modal="true" aria-label="Focus timer" className="relative mx-auto min-h-dvh max-w-7xl bg-background shadow-2xl sm:min-h-[calc(100dvh-2rem)] sm:rounded-2xl">
        <div className="sticky top-0 z-20 mx-auto flex max-w-6xl justify-end px-4 pt-3 sm:px-6">
          <button ref={closeRef} type="button" onClick={focus.closeFocus} className="inline-flex h-10 items-center gap-2 rounded-full border bg-card/95 px-4 text-sm font-semibold text-foreground shadow-sm backdrop-blur hover:bg-secondary">
            <span aria-hidden="true">×</span> Close focus
          </button>
        </div>
        <Focus />
      </section>
    </div>
  );
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated, authError, retryAuth } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" role="status" aria-label="Loading">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600"></div>
      </div>
    );
  }

  // The server couldn't be reached, so we don't know yet whether this browser
  // is signed in. Say so, rather than showing a sign-in form that can't work.
  if (!isAuthenticated && authError) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
        <div className="max-w-sm text-center" role="alert">
          <p className="text-lg font-bold text-slate-900 dark:text-white">LOCK IN! can't reach its server</p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{authError}</p>
          <button type="button" onClick={retryAuth}
            className="mt-5 inline-flex h-10 items-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500">
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Everything is stored per account, so nothing renders until someone signs in.
  if (!isAuthenticated) return <SignIn />;

  // The timer sits above the routes so it keeps running between pages, and
  // inside the sign-in gate so signing out stops it.
  return (
    <FocusProvider>
    <>
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).filter(([path]) => path !== 'Focus').map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="/Focus" element={<LegacyFocusRoute />} />
      <Route path="/Home" element={<Navigate to="/" replace />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    <FocusSurface />
    <VoicePanel />
    </>
    </FocusProvider>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router basename={basename}>
          <NavigationTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
