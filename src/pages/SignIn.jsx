import React, { useEffect, useRef, useState } from 'react';
import { accounts, MIN_PASSWORD } from '@/api/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, Cloud, Eye, EyeOff, Lock, UserRound, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// The Code A Difference home page. LOCK IN! is served from /lockin/ inside it.
const SITE_URL = import.meta.env.VITE_SITE_URL || '/';

/**
 * Sign in / create account. The account and everything in it are kept on
 * the Code A Difference server, so any computer will do. There's no email,
 * so there's no password reset either, and the page says so.
 */
export default function SignIn() {
  const [mode, setMode] = useState('signin');          // 'signin' | 'signup'
  const [legacy, setLegacy] = useState([]);            // accounts from when LOCK IN! lived in the browser
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pwRef = useRef(null);

  // Work saved in this browser before accounts moved to the server: point
  // the way to bringing it across (sign up with the same name and password).
  useEffect(() => {
    accounts.legacyAccounts().then(list => {
      setLegacy(list);
      if (list.length) { setMode('signup'); setUsername(list[0].username); setDisplayName(list[0].displayName || ''); }
    });
  }, []);

  const switchMode = (m) => {
    setMode(m); setError(''); setPassword(''); setConfirm('');
  };

  const pick = (a) => {
    setUsername(a.username); setDisplayName(a.displayName || ''); setMode('signup'); setError('');
    setTimeout(() => pwRef.current?.focus(), 0);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'signup') {
      if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
      if (password !== confirm) return setError('Those two passwords are different. Type them again.');
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        await accounts.signUp({ username, displayName, password, rememberDevice });
      } else {
        await accounts.signIn({ username, password, rememberDevice });
      }
      // AuthContext hears the change and swaps this page for the app.
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setBusy(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 lg:grid lg:grid-cols-[1.05fr_1fr]">

      {/* ── brand panel ─────────────────────────────────────────── */}
      <aside className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-10 text-white sm:px-10 lg:flex lg:flex-col lg:justify-between lg:py-14">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-fuchsia-300/20 blur-3xl" />

        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <Lock className="h-5 w-5" />
            </span>
            <span className="text-lg font-black tracking-tight">LOCK IN<span className="text-amber-300">!</span></span>
          </div>
          <a href={SITE_URL} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />Code A Difference
          </a>
        </div>

        <div className="relative mt-10 lg:mt-0">
          <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Homework, tests,<br />and a plan.<br />
            <span className="text-amber-300">Then lock in.</span>
          </h1>
          <p className="mt-5 max-w-md text-base text-white/80 sm:text-lg">
            Type what is due and it sorts itself. One click starts a focus timer on the most urgent thing, with rain in your ears and the steps beside the clock.
          </p>
        </div>

        <ul className="relative mt-10 hidden space-y-3 text-sm text-white/85 lg:block">
          <li className="flex gap-3"><Cloud className="mt-0.5 h-4 w-4 flex-none" />Saved to your account. Sign in from any computer and it's all there.</li>
          <li className="flex gap-3"><UserRound className="mt-0.5 h-4 w-4 flex-none" />No email needed. Just a username and a password.</li>
        </ul>
      </aside>

      {/* ── form ───────────────────────────────────────────────── */}
      <main className="flex items-start justify-center px-5 py-10 sm:px-8 lg:items-center">
        <div className="w-full max-w-md">

          <div className="mb-7 grid grid-cols-2 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800" role="tablist">
            {[['signin', 'Sign in'], ['signup', 'Create account']].map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={cn(
                  'rounded-lg py-2 text-sm font-semibold transition-colors',
                  mode === m ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                             : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                )}
              >{label}</button>
            ))}
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {isSignup ? 'Make your account' : 'Welcome back'}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {isSignup ? 'No email needed. Sign in from any computer.' : 'Pick up where you left off, on any computer.'}
          </p>

          {legacy.length > 0 && (
            <div className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-100">
              <p className="font-semibold">Your work from this browser is still here.</p>
              <p className="mt-1 text-indigo-900/80 dark:text-indigo-200/80">
                LOCK IN! now saves to an account online. Create one with the <strong>same username and password</strong> you
                used here, and your classes and homework come across.
              </p>
              {legacy.length > 1 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {legacy.map(a => (
                    <button key={a.username} type="button" onClick={() => pick(a)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        username === a.username
                          ? 'border-indigo-500 bg-white text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200'
                          : 'border-indigo-200 bg-white/60 text-indigo-800 hover:bg-white dark:border-indigo-800 dark:bg-transparent dark:text-indigo-200'
                      )}>
                      {a.username}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {isSignup && (
              <div className="space-y-1.5">
                <Label htmlFor="displayName">Your name</Label>
                <Input id="displayName" autoComplete="nickname" placeholder="What should we call you?"
                       value={displayName} onChange={e => setDisplayName(e.target.value)} />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input id="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
                     placeholder={isSignup ? 'letters, numbers, . _ -' : ''} required
                     value={username} onChange={e => setUsername(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" ref={pwRef} required
                       type={showPw ? 'text' : 'password'}
                       autoComplete={isSignup ? 'new-password' : 'current-password'}
                       placeholder={isSignup ? `At least ${MIN_PASSWORD} characters` : ''}
                       className="pr-10"
                       value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPw(v => !v)}
                        aria-label={showPw ? 'Hide password' : 'Show password'}
                        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {isSignup && (
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Type it again</Label>
                <Input id="confirm" required type={showPw ? 'text' : 'password'} autoComplete="new-password"
                       value={confirm} onChange={e => setConfirm(e.target.value)} />
              </div>
            )}

            <label className="flex items-start gap-2.5 text-sm text-slate-600 dark:text-slate-400">
              <Checkbox checked={rememberDevice} onCheckedChange={v => setRememberDevice(!!v)} className="mt-0.5" />
              <span>
                Keep me signed in on this device
                <span className="block text-xs text-slate-400">
                  For 60 days. Only on your own device; on a shared computer, leave this off.
                </span>
              </span>
            </label>

            {isSignup && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                <strong>There is no password reset.</strong> With no email on the account there's nowhere to send one,
                so pick a password you'll remember.
              </p>
            )}

            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}
                    className="h-11 w-full bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-base font-semibold hover:from-indigo-500 hover:to-fuchsia-500">
              {busy
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isSignup ? 'Creating…' : 'Signing in…'}</>
                : (isSignup ? 'Create account' : 'Sign in')}
            </Button>
          </form>

        </div>
      </main>
    </div>
  );
}
