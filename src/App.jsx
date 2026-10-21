import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import React, { Suspense, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { BrowserRouter as Router, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import SignIn from '@/pages/SignIn';
import { FocusProvider, useFocus } from '@/lib/FocusContext';
import { LectureProvider } from '@/lib/LectureContext';
import Focus from '@/pages/Focus';
import VoicePanel from '@/components/lockin/VoicePanel';
import UpdatePrompt from '@/components/lockin/UpdatePrompt';
import { AssistantProvider } from '@/lib/AssistantContext';
import { PlannerProvider } from '@/lib/PlannerContext';
import PlannerSheet from '@/components/lockin/PlannerSheet';
import GraphPanel from '@/components/lockin/GraphPanel';
import Reminders from '@/components/lockin/Reminders';
import StrictExitDialog from '@/components/lockin/StrictExitDialog';
import StrictGuard from '@/components/lockin/StrictGuard';
import CrossLock from '@/components/lockin/CrossLock';
import AiDevPanel from '@/components/lockin/AiDevPanel';
import EmailPrompt from '@/components/lockin/EmailPrompt';
import { MusicProvider } from '@/lib/MusicContext';
import NowPlaying from '@/components/lockin/NowPlaying';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

// Served from a sub-folder (e.g. /lockin/), the router has to know, or every
// link and refresh resolves against the site root instead.
const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || undefined;

// While a page's code loads, the menu stays and only the page area shows a quiet skeleton.
const PageSkeleton = () => (
  <div className="mx-auto max-w-5xl animate-pulse px-4 py-8 motion-reduce:animate-none sm:px-6" role="status" aria-label="Loading">
    <div className="h-8 w-56 rounded-lg bg-muted" />
    <div className="mt-6 h-14 rounded-2xl bg-muted/70" />
    <div className="mt-4 h-40 rounded-2xl bg-muted/50" />
  </div>
);

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}><Suspense fallback={<PageSkeleton />}>{children}</Suspense></Layout>
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
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('[role="alertdialog"]')) focus.closeFocus(); };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [focus.overlayOpen, focus.closeFocus]);
  if (!focus.overlayOpen) return null;
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-950/45 p-0 backdrop-blur-sm sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) focus.closeFocus(); }}>
      <section role="dialog" aria-modal="true" aria-label="Focus timer" className="relative mx-auto min-h-dvh max-w-7xl bg-background shadow-2xl sm:min-h-[calc(100dvh-2rem)] sm:rounded-2xl">
        <div className="sticky top-0 z-20 mx-auto flex max-w-6xl justify-end px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6">
          <button ref={closeRef} type="button" onClick={focus.closeFocus} className="inline-flex h-11 items-center gap-2 rounded-full border bg-card/95 px-4 text-sm font-semibold text-foreground shadow-sm backdrop-blur hover:bg-secondary">
            <X className="h-4 w-4" aria-hidden="true" /> Close focus
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
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"></div>
      </div>
    );
  }

  // The server couldn't be reached, so we don't know yet whether this browser
  // is signed in. Say so, rather than showing a sign-in form that can't work.
  if (!isAuthenticated && authError) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-background px-6">
        <div className="max-w-sm text-center" role="alert">
          <h1 className="text-lg font-bold text-foreground">LOCK IN! can't reach its server</h1>
          <p className="mt-2 text-sm text-muted-foreground">{authError}</p>
          <button type="button" onClick={retryAuth}
            className="mt-5 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Try again
          </button>
        </div>
      </main>
    );
  }

  // Everything is stored per account, so nothing renders until someone signs in.
  if (!isAuthenticated) return <SignIn />;

  // The timer sits above the routes so it keeps running between pages, and
  // inside the sign-in gate so signing out stops it.
  return (
    <FocusProvider>
    <LectureProvider>
    <PlannerProvider>
    <MusicProvider>
    <AssistantProvider>
    <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center" role="status" aria-label="Loading"><div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" /></div>}>
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
    </Suspense>
    <FocusSurface />
    <StrictGuard />
    <StrictExitDialog />
    <CrossLock />
    <VoicePanel />
    <PlannerSheet />
    <GraphPanel />
    <Reminders />
    <NowPlaying />
    <AiDevPanel />
    <EmailPrompt />
    </AssistantProvider>
    </MusicProvider>
    </PlannerProvider>
    </LectureProvider>
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
        <UpdatePrompt />{/* signed in or not: everyone with an old app hears about the update */}
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
