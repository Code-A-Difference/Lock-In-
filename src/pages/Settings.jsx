import { db, accounts, backup } from '@/api/db';

import React, { useState, useEffect } from 'react';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { LogOut, User, Palette, Trash2, Loader2, KeyRound, Download, HardDrive, ShieldCheck, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Settings for a local account. Everything here acts on data in this
 * browser — there is no server copy — so the backup card is the important
 * one, and delete really does delete.
 *
 * Gone from the base44 version: Friends (it needs a shared database to find
 * other people in, which a browser-only app does not have — classes are
 * shared with share codes instead), and a Theme Color picker that saved a
 * value nothing ever read.
 */
export default function Settings() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [fullName, setFullName] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [savingName, setSavingName] = useState(false);

  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwBusy, setPwBusy] = useState(false);

  const [persisted, setPersisted] = useState(null);
  const [usage, setUsage] = useState(null);
  const [lastBackup, setLastBackup] = useState(() => {
    try { return localStorage.getItem('lockin.lastBackup.' + (accounts.current()?.username || '')); } catch (_) { return null; }
  });

  const [confirmDelete, setConfirmDelete] = useState('');

  useEffect(() => {
    db.auth.me().then(u => {
      setUser(u);
      setFullName(u.full_name || '');
      setDarkMode(!!u.dark_mode);
    }).catch(() => {});
    (async () => {
      try {
        if (navigator.storage?.persisted) setPersisted(await navigator.storage.persisted());
        if (navigator.storage?.estimate) {
          const e = await navigator.storage.estimate();
          setUsage(e.usage || 0);
        }
      } catch (_) {}
    })();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  const saveName = async () => {
    setSavingName(true);
    try {
      const u = await db.auth.updateMe({ full_name: fullName.trim() || user.username });
      setUser(u);
      toast({ title: 'Saved', description: 'Your name is updated.' });
    } catch (e) {
      toast({ title: 'Could not save', description: e.message, variant: 'destructive' });
    } finally { setSavingName(false); }
  };

  const toggleDark = async (on) => {
    setDarkMode(on);
    try { await db.auth.updateMe({ dark_mode: on }); } catch (_) {}
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.again) {
      toast({ title: 'Passwords differ', description: 'Type the new password the same way twice.', variant: 'destructive' });
      return;
    }
    setPwBusy(true);
    try {
      await accounts.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', again: '' });
      toast({
        title: 'Password changed',
        description: 'Backups made before now still open with the OLD password. Make a new one.',
      });
    } catch (err) {
      toast({ title: 'Password not changed', description: err.message, variant: 'destructive' });
    } finally { setPwBusy(false); }
  };

  const downloadBackup = async () => {
    try {
      const text = await backup.export();
      const stamp = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `lockin-${user.username}-${stamp}.lockin`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const now = new Date().toISOString();
      try { localStorage.setItem('lockin.lastBackup.' + user.username, now); } catch (_) {}
      setLastBackup(now);
    } catch (e) {
      toast({ title: 'Backup failed', description: e.message, variant: 'destructive' });
    }
  };

  const signOut = async () => {
    queryClient.clear();
    await accounts.signOut();
  };

  const deleteAccount = async () => {
    if (confirmDelete.trim().toLowerCase() !== user.username) return;
    queryClient.clear();
    await accounts.deleteCurrent();
  };

  const fmtBytes = n => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
  const backupAge = lastBackup ? Math.floor((Date.now() - new Date(lastBackup)) / 86400000) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-slate-800 px-4 pb-10 sm:px-6">
      <div className="mx-auto max-w-3xl pt-8">
        <h1 className="mb-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Settings</h1>
        <p className="mb-8 text-sm text-slate-500 dark:text-slate-400">
          Signed in as <strong className="text-slate-700 dark:text-slate-200">{user.username}</strong> on this browser.
        </p>

        <div className="space-y-6">

          {/* Profile */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" />Profile</CardTitle>
              <CardDescription>How LOCK IN! greets you.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input id="username" value={user.username} disabled className="bg-slate-50 dark:bg-slate-800" />
                <p className="text-xs text-slate-500">
                  Your username is part of how your data is locked, so it can't be changed.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fullName">Your name</Label>
                <Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" />
              </div>
              <Button onClick={saveName} disabled={savingName} className="bg-indigo-600 hover:bg-indigo-500">
                {savingName ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : 'Save'}
              </Button>
            </CardContent>
          </Card>

          {/* Appearance */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5" />Appearance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="darkMode" className="text-base">Dark mode</Label>
                  <p className="text-sm text-slate-500">Easier on the eyes at night.</p>
                </div>
                <Switch id="darkMode" checked={darkMode} onCheckedChange={toggleDark} />
              </div>
            </CardContent>
          </Card>

          {/* Backup — the one that matters */}
          <Card className="border-indigo-200 dark:border-indigo-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Download className="h-5 w-5" />Backup</CardTitle>
              <CardDescription>
                Your work is stored only in this browser. A backup is your copy — keep one somewhere safe.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <li className="flex gap-2.5"><ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                  The file is encrypted with your password. It's safe to email to yourself or keep in Google Drive.</li>
                <li className="flex gap-2.5"><HardDrive className="mt-0.5 h-4 w-4 flex-none text-indigo-600" />
                  On another computer, choose <em>Restore from a backup</em> on the sign-in page.</li>
              </ul>
              {backupAge === null
                ? <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" />You haven't made a backup from this browser yet.</p>
                : <p className="text-sm text-slate-500">Last backup: {backupAge === 0 ? 'today' : `${backupAge} day${backupAge === 1 ? '' : 's'} ago`}.</p>}
              <Button onClick={downloadBackup} className="bg-indigo-600 hover:bg-indigo-500">
                <Download className="mr-2 h-4 w-4" /> Download backup
              </Button>
              <p className="text-xs text-slate-500">
                {usage != null && <>Using {fmtBytes(usage)} in this browser. </>}
                {persisted === true && 'This browser has agreed not to clear it automatically.'}
                {persisted === false && 'This browser may clear it if the device runs low on space — another reason to keep a backup.'}
              </p>
            </CardContent>
          </Card>

          {/* Password */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Password</CardTitle>
              <CardDescription>There is no reset, so pick one you'll remember.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={changePassword} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pwCurrent">Current password</Label>
                  <Input id="pwCurrent" type="password" autoComplete="current-password" required
                         value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pwNext">New password</Label>
                    <Input id="pwNext" type="password" autoComplete="new-password" required
                           value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pwAgain">New password again</Label>
                    <Input id="pwAgain" type="password" autoComplete="new-password" required
                           value={pw.again} onChange={e => setPw({ ...pw, again: e.target.value })} />
                  </div>
                </div>
                <Button type="submit" variant="outline" disabled={pwBusy}>
                  {pwBusy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Changing…</> : 'Change password'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Account */}
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Button onClick={signOut} variant="outline" className="w-full justify-start">
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </Button>

              <div className="rounded-lg border border-red-200 p-4 dark:border-red-900/50">
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">Delete this account</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Removes the account and all of its classes, homework and tests from this browser.
                  It can't be undone — only a backup would bring it back.
                </p>
                <Label htmlFor="confirmDelete" className="mt-3 block text-xs text-slate-500">
                  Type <strong>{user.username}</strong> to confirm
                </Label>
                <div className="mt-1.5 flex gap-2">
                  <Input id="confirmDelete" value={confirmDelete} onChange={e => setConfirmDelete(e.target.value)}
                         autoComplete="off" autoCapitalize="none" spellCheck={false} />
                  <Button variant="destructive" onClick={deleteAccount}
                          disabled={confirmDelete.trim().toLowerCase() !== user.username}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
