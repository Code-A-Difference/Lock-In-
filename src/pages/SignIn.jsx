import React, { useEffect, useRef, useState } from 'react';
import { accounts, backup, MIN_PASSWORD } from '@/api/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Eye, EyeOff, Lock, ShieldCheck, Upload, UserRound, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sign in / create account. Accounts live in this browser only, encrypted
 * with the password (api/vault.js), so this page has to be honest about two
 * things a normal login page never mentions: the data is on this device,
 * and a forgotten password cannot be reset.
 */
export default function SignIn() {
  const [mode, setMode] = useState('signin');          // 'signin' | 'signup'
  const [known, setKnown] = useState([]);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef(null);
  const pwRef = useRef(null);

  const refreshKnown = () => accounts.list().then(setKnown).catch(() => setKnown([]));

  useEffect(() => {
    refreshKnown();
  }, []);

  // First visit in this browser: nobody to sign in as yet, so start on sign-up.
  useEffect(() => {
    accounts.list().then(list => { if (!list.length) setMode('signup'); }).catch(() => {});
  }, []);

  const switchMode = (m) => {
    setMode(m); setError(''); setNotice(''); setPassword(''); setConfirm('');
  };

  const pick = (u) => {
    setUsername(u); setMode('signin'); setError(''); setNotice('');
    setTimeout(() => pwRef.current?.focus(), 0);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setNotice('');
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

  const restore = async (file) => {
    if (!file) return;
    setError(''); setNotice('');
    try {
      const text = await file.text();
      let u;
      try {
        u = await backup.import(text);
      } catch (err) {
        if (err.code !== 'exists') throw err;
        const ok = window.confirm(
          `There is already an account called "${err.username}" in this browser.\n\n` +
          'Replace it with the backup? Anything saved in it since the backup was made will be lost.'
        );
        if (!ok) return;
        u = await backup.import(text, { overwrite: true });
      }
      await refreshKnown();
      setMode('signin'); setUsername(u); setPassword('');
      setNotice(`Backup restored. Sign in with the password for "${u}".`);
      setTimeout(() => pwRef.current?.focus(), 0);
    } catch (err) {
      setError(err.message || 'That backup could not be restored.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const isSignup = mode === 'signup';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 lg:grid lg:grid-cols-[1.05fr_1fr]">

      {/* ── brand panel ─────────────────────────────────────────── */}
      <aside className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-10 text-white sm:px-10 lg:flex lg:flex-col lg:justify-between lg:py-14">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-fuchsia-300/20 blur-3xl" />

        <div className="relative flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <Lock className="h-5 w-5" />
          </span>
          <span className="text-lg font-black tracking-tight">LOCK IN<span className="text-amber-300">!</span></span>
        </div>

        <div className="relative mt-10 lg:mt-0">
          <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Homework, tests,<br />and a plan.<br />
            <span className="text-amber-300">Then lock in.</span>
          </h1>
          <p className="mt-5 max-w-md text-base text-white/80 sm:text-lg">
            Track every class, see what is due, and let the AI planner build your study time around it.
          </p>
        </div>

        <ul className="relative mt-10 hidden space-y-3 text-sm text-white/85 lg:block">
          <li className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 flex-none" />Your data stays in this browser, encrypted with your password.</li>
          <li className="flex gap-3"><UserRound className="mt-0.5 h-4 w-4 flex-none" />Shared computer? Every student gets their own locked account.</li>
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
            {isSignup ? 'It lives in this browser — no email needed.' : 'Pick up where you left off.'}
          </p>

          {!isSignup && known.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">On this device</p>
              <div className="flex flex-wrap gap-2">
                {known.map(a => (
                  <button
                    key={a.username}
                    type="button"
                    onClick={() => pick(a.username)}
                    className={cn(
                      'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                      username === a.username
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                    )}
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-[11px] font-bold uppercase text-white">
                      {(a.displayName || a.username).slice(0, 1)}
                    </span>
                    {a.displayName && a.displayName !== a.username ? `${a.displayName} · ${a.username}` : a.username}
                  </button>
                ))}
              </div>
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
                  Only on your own device. Anyone using this browser could open your account.
                </span>
              </span>
            </label>

            {isSignup && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                <strong>There is no password reset.</strong> Your password is the key that unlocks your data,
                so if you forget it, nobody can get it back. Make a backup from Settings once you have added some work.
              </p>
            )}

            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
                {notice}
              </p>
            )}

            <Button type="submit" disabled={busy}
                    className="h-11 w-full bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-base font-semibold hover:from-indigo-500 hover:to-fuchsia-500">
              {busy
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isSignup ? 'Creating…' : 'Unlocking…'}</>
                : (isSignup ? 'Create account' : 'Sign in')}
            </Button>
          </form>

          <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-800">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              New computer? Bring your account over with a backup file.
            </p>
            <input ref={fileRef} type="file" accept=".lockin,application/json" className="hidden"
                   onChange={e => restore(e.target.files?.[0])} />
            <Button type="button" variant="outline" className="mt-3 w-full" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Restore from a backup
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
