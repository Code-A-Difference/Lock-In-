import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarCheck, Timer, Sparkles, GraduationCap, Settings, Lock, LogOut, Keyboard, ArrowLeft, CloudOff } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { sync } from '@/api/db';
import { cn } from '@/lib/utils';
import TimerPill from '@/components/lockin/TimerPill';
import ShortcutsDialog from '@/components/lockin/ShortcutsDialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * App shell. A sidebar from 1024px up, a five-tab bar at the bottom below
 * that (thumb reach), and the running timer visible from anywhere.
 */
export const NAV = [
  { name: 'Today', icon: CalendarCheck, page: 'Today', key: 't' },
  { name: 'Focus', icon: Timer, page: 'Focus', key: 'f' },
  { name: 'Study', icon: Sparkles, page: 'Study', key: 's' },
  { name: 'Classes', icon: GraduationCap, page: 'Classes', key: 'c' },
  { name: 'Settings', icon: Settings, page: 'Settings' },
];

function Brand({ compact = false }) {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-lg" aria-label="LOCK IN! — Today">
      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-gradient-to-br from-indigo-600 to-fuchsia-600">
        <Lock className="h-4 w-4 text-white" aria-hidden="true" />
      </span>
      {!compact && (
        <span className="truncate text-lg font-extrabold tracking-tight text-foreground">
          LOCK IN<span className="text-fuchsia-600 dark:text-fuchsia-400">!</span>
        </span>
      )}
    </Link>
  );
}

// The Code A Difference home page. LOCK IN! is served from /lockin/ inside it.
const SITE_URL = import.meta.env.VITE_SITE_URL || '/';

/**
 * Changes save to the server as they're made. This only speaks up when they
 * can't: the connection dropped, and they're queued until it's back.
 */
function SaveStatus() {
  const [st, setSt] = useState(sync.state());
  useEffect(() => sync.onChange(setSt), []);
  if (!st.offline || !st.pending) return null;
  return (
    <div role="status" className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-lg lg:bottom-4 lg:left-[calc(50%+7.5rem)]">
      <CloudOff className="h-4 w-4 text-amber-600" aria-hidden="true" />
      Not saved yet. Trying again…
    </div>
  );
}

function initial(user) {
  return (user?.full_name || user?.username || '?').slice(0, 1).toUpperCase();
}

// Single-key shortcuts shouldn't fire while someone is typing.
function typingIn(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function Layout({ children, currentPageName }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showKeys, setShowKeys] = useState(false);
  const active = currentPageName === 'Home' ? 'Today' : currentPageName;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', !!user?.dark_mode);
  }, [user?.dark_mode]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'n' || k === '/') {
        e.preventDefault();
        if (active === 'Today') window.dispatchEvent(new Event('lockin:quickadd'));
        else navigate('/', { state: { quickAdd: true } });
        return;
      }
      if (e.key === '?') { e.preventDefault(); setShowKeys(true); return; }
      const item = NAV.find(n => n.key === k);
      if (item) { e.preventDefault(); navigate(item.page === 'Today' ? '/' : `/${item.page}`); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, navigate]);

  return (
    <div className="min-h-dvh bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:shadow">
        Skip to content
      </a>

      {/* ── sidebar (lg+) ─────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-card px-3 py-4 lg:flex">
        <div className="px-2"><Brand /></div>
        <nav aria-label="Main" className="mt-6 flex flex-col gap-0.5">
          {NAV.map(({ name, icon: Icon, page, key }) => {
            const on = active === page;
            return (
              <Link
                key={page}
                to={page === 'Today' ? '/' : `/${page}`}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150',
                  on ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                <span className="flex-1">{name}</span>
                {key && (
                  <kbd className="hidden rounded border bg-background px-1.5 text-[10px] font-medium uppercase text-muted-foreground group-hover:inline">{key}</kbd>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <TimerPill wide />
          <a href={SITE_URL} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Code A Difference
          </a>
          <div className="flex items-center gap-2 rounded-lg border p-2">
            <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">{initial(user)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{user?.full_name}</p>
              <p className="truncate text-xs text-muted-foreground">@{user?.username}</p>
            </div>
            <button type="button" onClick={() => setShowKeys(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">
              <Keyboard className="h-4 w-4" />
            </button>
            <button type="button" onClick={logout} title="Sign out" aria-label="Sign out"
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── top bar (< lg) ────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card px-4 lg:hidden">
        <Brand compact />
        <div className="flex min-w-0 flex-1 justify-center"><TimerPill /></div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Account" className="grid h-9 w-9 flex-none place-items-center rounded-full bg-indigo-600 text-sm font-bold text-white">
              {initial(user)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="truncate">@{user?.username}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/Settings')}><Settings className="mr-2 h-4 w-4" />Settings</DropdownMenuItem>
            <DropdownMenuItem asChild><a href={SITE_URL}><ArrowLeft className="mr-2 h-4 w-4" />Code A Difference</a></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={logout}><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <main id="main" tabIndex={-1} className="pb-24 outline-none lg:pb-0 lg:pl-60">
        {children}
      </main>

      {/* ── bottom tabs (< lg) ───────────────────────────────────── */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {NAV.map(({ name, icon: Icon, page }) => {
            const on = active === page;
            return (
              <Link
                key={page}
                to={page === 'Today' ? '/' : `/${page}`}
                aria-current={on ? 'page' : undefined}
                className={cn('flex min-h-[56px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150',
                  on ? 'text-indigo-700 dark:text-indigo-300' : 'text-muted-foreground hover:text-foreground')}
              >
                <span className={cn('grid h-7 w-12 place-items-center rounded-full transition-colors duration-150', on && 'bg-accent')}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                {name}
              </Link>
            );
          })}
        </div>
      </nav>

      <SaveStatus />
      <ShortcutsDialog open={showKeys} onOpenChange={setShowKeys} />
    </div>
  );
}
