import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from './utils';
import { Home, Settings, Brain, Lock, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { cn } from "@/lib/utils";

/**
 * App shell.
 *
 * The desktop nav used to be a floating pill at `fixed top-4 right-4`, which
 * sat on top of whatever the page put in its own top-right corner — on Home
 * that is the Add homework / test / class row, so the two collided. A real
 * header bar that occupies space fixes the collision instead of dodging it,
 * and gives every page one consistent place for identity and navigation.
 */
export default function Layout({ children, currentPageName }) {
  const { user, logout } = useAuth();
  const navItems = [
    { name: 'Home', icon: Home, page: 'Home' },
    { name: 'Study', icon: Brain, page: 'Study' },
    { name: 'Settings', icon: Settings, page: 'Settings' }
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">

      {/* ── header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 dark:border-slate-800 bg-white/85 dark:bg-slate-900/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">

          <Link to={createPageUrl('Home')} className="flex items-center gap-2.5 min-w-0" aria-label="LOCK IN! home">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-gradient-to-br from-indigo-600 to-fuchsia-600">
              <Lock className="h-[18px] w-[18px] text-white" />
            </span>
            <span className="truncate text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
              LOCK IN<span className="text-fuchsia-600 dark:text-fuchsia-400">!</span>
            </span>
          </Link>

          <div className="flex items-center gap-2">
          {/* desktop nav — in the flow, so nothing can sit under it */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Main">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPageName === item.page;
              return (
                <Link
                  key={item.name}
                  to={createPageUrl(item.page)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Who is signed in, and a one-click way out. On a shared computer the
              next student should not have to find Settings to leave. */}
          {user && (
            <div className="flex items-center gap-1 md:ml-2 md:border-l md:border-slate-200 md:pl-3 dark:md:border-slate-700">
              <span
                title={`Signed in as ${user.username}`}
                className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs font-bold uppercase text-white"
              >
                {(user.full_name || user.username).slice(0, 1)}
              </span>
              <button
                type="button"
                onClick={logout}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          )}
          </div>
        </div>
      </header>

      {/* pb-20 on mobile keeps the bottom nav from covering the last card */}
      <main className="pb-20 md:pb-0">{children}</main>

      {/* ── mobile nav ─────────────────────────────────────────── */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur px-2 dark:border-slate-800 dark:bg-slate-900/95 md:hidden"
      >
        <div className="mx-auto flex max-w-md items-center justify-around">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPageName === item.page;
            return (
              <Link
                key={item.name}
                to={createPageUrl(item.page)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  "flex min-w-[64px] flex-col items-center gap-1 rounded-xl px-3 py-2.5 transition-colors",
                  isActive
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[11px] font-medium">{item.name}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
