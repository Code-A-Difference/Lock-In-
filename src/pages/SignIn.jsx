import React, { useEffect, useRef, useState } from 'react';
import { accounts, MIN_PASSWORD } from '@/api/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, Eye, EyeOff, Lock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isNativeApp } from '@/lib/native';

// The Code A Difference home page. LOCK IN! is served from /lockin/ inside it.
const SITE_URL = import.meta.env.VITE_SITE_URL || '/';

/** Sign in, create an account, or reset a forgotten password with a code from the account's authenticator app. */
export default function SignIn() {
  const [mode, setMode] = useState('signin');          // 'signin' | 'signup' | 'forgot'
  const [legacy, setLegacy] = useState([]);            // accounts from when LOCK IN! lived in the browser
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const pwRef = useRef(null);

  // Work saved in this browser before accounts moved to the server: sign up with the same name and password to bring it across.
  useEffect(() => {
    accounts.legacyAccounts().then(list => {
      setLegacy(list);
      if (list.length) { setMode('signup'); setUsername(list[0].username); setDisplayName(list[0].displayName || ''); }
    });
  }, []);

  const switchMode = (m) => { setMode(m); setError(''); setPassword(''); setConfirm(''); setCode(''); };

  const pick = (a) => {
    setUsername(a.username); setDisplayName(a.displayName || ''); setMode('signup'); setError('');
    setTimeout(() => pwRef.current?.focus(), 0);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'signup' || mode === 'forgot') {
      if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
      if (password !== confirm) return setError('The two passwords don’t match.');
    }
    setBusy(true);
    try {
      if (mode === 'signup') await accounts.signUp({ username, displayName, password, rememberDevice });
      else if (mode === 'signin') await accounts.signIn({ username, password, rememberDevice });
      else await accounts.forgotReset({ username, code, password, rememberDevice });
      // AuthContext hears the change and swaps this page for the app.
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setBusy(false);
    }
  };

  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';
  const newPassword = isSignup || isForgot;
  const title = isSignup ? 'Make your account' : isForgot ? 'Reset your password' : 'Welcome back';
  const button = isSignup ? 'Create account' : isForgot ? 'Set new password' : 'Sign in';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 lg:grid lg:grid-cols-[1.05fr_1fr]">

      {/* ── brand panel ─────────────────────────────────────────── */}
      <aside className="relative overflow-hidden bg-[#16181d] px-6 py-10 text-[#f3efe7] sm:px-10 lg:flex lg:flex-col lg:justify-between lg:py-14">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <Lock className="h-5 w-5" />
            </span>
            <span className="text-lg font-black tracking-tight">LOCK IN<span className="text-amber-300">!</span></span>
          </div>
          {!isNativeApp && (
            <a href={SITE_URL} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />Code A Difference
            </a>
          )}
        </div>

        <div className="relative mt-10 lg:mt-0">
          <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Homework, tests,<br />and a plan.<br />
            <span className="text-amber-300">Then lock in.</span>
          </h1>
          <p className="mt-5 max-w-md text-base text-white/80 sm:text-lg">Plan your work, then focus on it.</p>
        </div>
        <div />
      </aside>

      {/* ── form ───────────────────────────────────────────────── */}
      <main className="flex items-start justify-center px-5 py-10 sm:px-8 lg:items-center">
        <div className="w-full max-w-md">

          {!isForgot && (
            <div className="mb-7 grid grid-cols-2 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800" role="tablist">
              {[['signin', 'Sign in'], ['signup', 'Create account']].map(([m, label]) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)}
                  className={cn('rounded-lg py-2 text-sm font-semibold transition-colors',
                    mode === m ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                               : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200')}>
                  {label}
                </button>
              ))}
            </div>
          )}

          <h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2>
          {isForgot && <p className="mt-1 text-sm text-muted-foreground">Use the code from the authenticator app you set up for LOCK IN!.</p>}

          {legacy.length > 0 && !isForgot && (
            <div className="mt-6 rounded-xl border border-primary/40 bg-accent p-4 text-sm text-primary">
              <p className="font-semibold">Your work from this browser is still here.</p>
              <p className="mt-1 text-primary/80">Create an account with the <strong>same username and password</strong> to bring it across.</p>
              {legacy.length > 1 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {legacy.map(a => (
                    <button key={a.username} type="button" onClick={() => pick(a)}
                      className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        username === a.username ? 'border-primary/40 bg-white text-primary' : 'border-primary/40 bg-white/60 text-primary hover:bg-white dark:bg-transparent')}>
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
                <Input id="displayName" autoComplete="nickname" value={displayName} onChange={e => setDisplayName(e.target.value)} />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input id="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
                     placeholder={isSignup ? 'letters, numbers, . _ -' : ''} required
                     value={username} onChange={e => setUsername(e.target.value)} />
            </div>

            {isForgot && (
              <div className="space-y-1.5">
                <Label htmlFor="code">Code from your authenticator app</Label>
                <Input id="code" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} maxLength={11}
                       inputMode={/[a-z]/i.test(code) ? 'text' : 'numeric'} placeholder="123456"
                       className="tracking-[0.2em]" value={code} onChange={e => setCode(e.target.value.replace(/[^0-9a-z-]/gi, ''))} />
                <p className="text-xs text-muted-foreground">Lost your phone? Type one of your recovery codes instead.</p>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="password">{isForgot ? 'New password' : 'Password'}</Label>
                {mode === 'signin' && (
                  <button type="button" onClick={() => switchMode('forgot')} className="text-sm font-medium text-primary hover:underline">Forgot password?</button>
                )}
              </div>
              <div className="relative">
                <Input id="password" ref={pwRef} required type={showPw ? 'text' : 'password'}
                       autoComplete={newPassword ? 'new-password' : 'current-password'}
                       placeholder={newPassword ? `At least ${MIN_PASSWORD} characters` : ''}
                       className="pr-10" value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}
                        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {newPassword && (
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Type it again</Label>
                <Input id="confirm" required type={showPw ? 'text' : 'password'} autoComplete="new-password"
                       value={confirm} onChange={e => setConfirm(e.target.value)} />
              </div>
            )}

            <label className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <Checkbox checked={rememberDevice} onCheckedChange={v => setRememberDevice(!!v)} />
              <span>Keep me signed in (not on a shared computer)</span>
            </label>

            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{error}</p>
            )}
            <Button type="submit" disabled={busy} className="h-11 w-full text-base font-semibold">
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />One moment…</> : button}
            </Button>
            {isForgot && (
              <div className="flex justify-between text-sm">
                <button type="button" onClick={() => switchMode('signin')} className="font-medium text-primary hover:underline">Back to sign in</button>
              </div>
            )}
          </form>

        </div>
      </main>
    </div>
  );
}
