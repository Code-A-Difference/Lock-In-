import { db, accounts, backup } from '@/api/db';

import React, { useEffect, useState } from 'react';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/use-toast";
import { LogOut, User, Palette, Trash2, Loader2, KeyRound, Download, HardDrive, ShieldCheck, AlertTriangle, Timer, AudioLines, Play, Square } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from '@/lib/AuthContext';
import { useFocus } from '@/lib/FocusContext';
import { AI_VOICES, configureVoice, listBrowserVoices, onVoicesReady, speak, stopSpeaking, voiceStatus } from '@/lib/voice';
import { cn } from '@/lib/utils';
import { formatMinutes } from '@/lib/agenda';

const VOICE_DEFAULTS = { engine: 'auto', aiVoice: 'Aoede', browserVoice: '', rate: 1, readAloud: false };
const SAMPLE = "Hey! I'm your study buddy. Twenty-five minutes on your essay outline — let's lock in.";

function Section({ icon: Icon, title, description, children, className }) {
  return (
    <section className={cn('rounded-2xl border bg-card', className)}>
      <header className="border-b px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground"><Icon className="h-[18px] w-[18px] text-muted-foreground" aria-hidden="true" />{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </header>
      <div className="space-y-5 px-5 py-4">{children}</div>
    </section>
  );
}

function Row({ id, label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium text-foreground">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * Settings for a local account. Everything here acts on data in this
 * browser — there is no server copy — so the backup section is the important
 * one, and delete really does delete.
 */
export default function Settings() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const focus = useFocus();
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [savingName, setSavingName] = useState(false);

  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwBusy, setPwBusy] = useState(false);

  const [persisted, setPersisted] = useState(null);
  const [usage, setUsage] = useState(null);
  const [lastBackup, setLastBackup] = useState(() => {
    try { return localStorage.getItem('lockin.lastBackup.' + (accounts.current()?.username || '')); } catch (_) { return null; }
  });
  const [confirmDelete, setConfirmDelete] = useState('');

  const voice = { ...VOICE_DEFAULTS, ...(user?.voice || {}) };
  const [browserVoices, setBrowserVoices] = useState([]);
  const [playing, setPlaying] = useState(null);      // which sample is playing
  const [heardWith, setHeardWith] = useState('');

  useEffect(() => {
    (async () => {
      try {
        if (navigator.storage?.persisted) setPersisted(await navigator.storage.persisted());
        if (navigator.storage?.estimate) setUsage((await navigator.storage.estimate()).usage || 0);
      } catch (_) {}
    })();
    return onVoicesReady(() => setBrowserVoices(listBrowserVoices()));
  }, []);

  useEffect(() => () => stopSpeaking(), []);

  if (!user) return null;

  const saveName = async () => {
    setSavingName(true);
    try {
      await db.auth.updateMe({ full_name: fullName.trim() || user.username });
      toast({ title: 'Saved', description: 'Your name is updated.' });
    } catch (e) {
      toast({ title: 'Could not save', description: e.message, variant: 'destructive' });
    } finally { setSavingName(false); }
  };

  const saveVoice = (patch) => {
    const next = { ...voice, ...patch };
    configureVoice(next);
    db.auth.updateMe({ voice: next }).catch(() => {});
  };

  const preview = (id, patch = {}) => {
    if (playing === id) { stopSpeaking(); setPlaying(null); return; }
    configureVoice({ ...voice, ...patch });
    setPlaying(id);
    setHeardWith('');
    speak(SAMPLE, {
      onStart: (engine, name) => setHeardWith(engine === 'ai' ? `Played with the AI voice “${name}”.` : `Played with this browser's voice${name ? ` “${name}”` : ''}.`),
      onEnd: () => { setPlaying(null); configureVoice(voice); },
    });
  };

  const setNotify = async (on) => {
    if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission().catch(() => 'denied');
      if (p !== 'granted') {
        toast({ title: 'Notifications are blocked', description: 'Allow them for this site in your browser, then try again.', variant: 'destructive' });
        return;
      }
    }
    focus.updatePrefs({ notify: on });
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
      toast({ title: 'Password changed', description: 'Backups made before now still open with the OLD password. Make a new one.' });
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

  const signOut = async () => { queryClient.clear(); await accounts.signOut(); };
  const deleteAccount = async () => {
    if (confirmDelete.trim().toLowerCase() !== user.username) return;
    queryClient.clear();
    await accounts.deleteCurrent();
  };

  const fmtBytes = n => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
  const backupAge = lastBackup ? Math.floor((Date.now() - new Date(lastBackup)) / 86400000) : null;
  const p = focus.prefs;
  const aiOk = voiceStatus().aiAvailable;
  const numberBox = 'h-9 w-20 rounded-lg border bg-background px-2 text-center text-sm tabular-nums text-foreground';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Settings</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Signed in as <strong className="font-semibold text-foreground">{user.username}</strong> on this browser.
      </p>

      <div className="space-y-5">
        <Section icon={User} title="Profile" description="How LOCK IN! greets you.">
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Your name</Label>
            <div className="flex gap-2">
              <Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" />
              <Button onClick={saveName} disabled={savingName}>{savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
            </div>
            <p className="text-xs text-muted-foreground">Your username, <strong>{user.username}</strong>, is part of how your data is locked, so it can't change.</p>
          </div>
        </Section>

        <Section icon={Palette} title="Appearance">
          <Row id="darkMode" label="Dark mode" hint="Easier on the eyes at night.">
            <Switch id="darkMode" checked={!!user.dark_mode} onCheckedChange={(on) => db.auth.updateMe({ dark_mode: on }).catch(() => {})} />
          </Row>
        </Section>

        <Section icon={Timer} title="Focus timer" description="Defaults for the Focus page. The presets there change the first two.">
          <div className="grid gap-4 sm:grid-cols-4">
            {[['focusMin', 'Focus', 180], ['breakMin', 'Break', 60], ['longMin', 'Long break', 90]].map(([k, label, max]) => (
              <label key={k} className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
                {label}
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="number" min={1} max={max} inputMode="numeric" defaultValue={p[k]} key={p[k]} className={numberBox}
                    onBlur={e => focus.setDurations({ [k]: e.target.value })} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />
                  min
                </span>
              </label>
            ))}
            <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
              Long break every
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="number" min={2} max={8} inputMode="numeric" defaultValue={p.longEvery} key={p.longEvery} className={numberBox}
                  onBlur={e => focus.updatePrefs({ longEvery: Math.max(2, Math.min(8, Math.round(Number(e.target.value) || 4))) })} />
                blocks
              </span>
            </label>
          </div>
          <Row id="goal" label="Daily focus goal" hint="Fills the bar on Today.">
            <select id="goal" value={p.dailyGoal} onChange={e => focus.updatePrefs({ dailyGoal: Number(e.target.value) })}
              className="h-9 rounded-lg border bg-background px-2 text-sm text-foreground">
              {[30, 60, 90, 120, 150, 180, 240, 300].map(m => <option key={m} value={m}>{formatMinutes(m)}</option>)}
            </select>
          </Row>
          <Row id="autoBreak" label="Start breaks automatically" hint="When a block ends, the break timer starts on its own.">
            <Switch id="autoBreak" checked={p.autoBreak} onCheckedChange={v => focus.updatePrefs({ autoBreak: v })} />
          </Row>
          <Row id="autoFocus" label="Start the next block automatically" hint="Off means you choose when to lock back in.">
            <Switch id="autoFocus" checked={p.autoFocus} onCheckedChange={v => focus.updatePrefs({ autoFocus: v })} />
          </Row>
          <Row id="cues" label="Spoken cues" hint="“Nice work — take five.” Voice commands are always answered.">
            <Switch id="cues" checked={p.cues} onCheckedChange={v => focus.updatePrefs({ cues: v })} />
          </Row>
          <Row id="notify" label="Desktop notification when a block ends" hint="Only while LOCK IN! is in a background tab.">
            <Switch id="notify" checked={p.notify} onCheckedChange={setNotify} />
          </Row>
        </Section>

        <Section icon={AudioLines} title="Voice" description="How the assistant and the timer sound.">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-foreground">Engine</legend>
            {[
              ['auto', 'Most natural available', 'A human-sounding AI voice through the shared key; this browser\'s best voice if that isn\'t available.'],
              ['browser', "This browser's voice only", 'Works offline and uses no AI requests. Quality depends on your device.'],
            ].map(([id, label, hint]) => (
              <label key={id} className={cn('flex cursor-pointer gap-3 rounded-xl border p-3', voice.engine === id ? 'border-indigo-300 bg-accent dark:border-indigo-700' : 'hover:bg-secondary')}>
                <input type="radio" name="engine" value={id} checked={voice.engine === id} onChange={() => saveVoice({ engine: id })} className="mt-1 accent-indigo-600" />
                <span>
                  <span className="block text-sm font-medium text-foreground">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {voice.engine !== 'browser' && (
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">AI voice</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {AI_VOICES.map(v => {
                  const on = voice.aiVoice === v.id;
                  return (
                    <div key={v.id} className={cn('flex items-center gap-2 rounded-xl border p-2 pl-3', on && 'border-indigo-300 bg-accent dark:border-indigo-700')}>
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                        <input type="radio" name="aiVoice" value={v.id} checked={on} onChange={() => saveVoice({ aiVoice: v.id })} className="accent-indigo-600" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">{v.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">{v.hint}</span>
                        </span>
                      </label>
                      <button type="button" onClick={() => preview(v.id, { engine: 'auto', aiVoice: v.id })} aria-label={`Hear ${v.label}`}
                        className="grid h-9 w-9 flex-none place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
                        {playing === v.id ? <Square className="h-3.5 w-3.5 fill-current" /> : <Play className="h-4 w-4" />}
                      </button>
                    </div>
                  );
                })}
              </div>
              {!aiOk && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  The AI voice didn't answer this session (no key saved yet, or the key can't do speech), so the browser voice is standing in.
                </p>
              )}
            </div>
          )}

          <Row id="bvoice" label={voice.engine === 'browser' ? 'Browser voice' : 'Fallback voice'} hint="Best-sounding first. “Natural” and “Google” voices are the good ones.">
            <select id="bvoice" value={voice.browserVoice} onChange={e => saveVoice({ browserVoice: e.target.value })}
              className="h-9 max-w-[14rem] rounded-lg border bg-background px-2 text-sm text-foreground">
              <option value="">Best available</option>
              {browserVoices.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </Row>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="rate" className="text-sm font-medium text-foreground">Speed</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{voice.rate.toFixed(2)}×</span>
            </div>
            <Slider id="rate" className="mt-2" min={0.8} max={1.3} step={0.05} value={[voice.rate]}
              onValueChange={([v]) => saveVoice({ rate: v })} aria-label="Speaking speed" />
          </div>

          <Row id="readAloud" label="Read assistant answers aloud" hint="In Study. You can also press Listen on any single answer.">
            <Switch id="readAloud" checked={!!voice.readAloud} onCheckedChange={v => saveVoice({ readAloud: v })} />
          </Row>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => preview('test')}>
              {playing === 'test' ? <><Square className="mr-2 h-3.5 w-3.5 fill-current" />Stop</> : <><Play className="mr-2 h-4 w-4" />Test the voice</>}
            </Button>
            {heardWith && <p className="text-xs text-muted-foreground" aria-live="polite">{heardWith}</p>}
          </div>
        </Section>

        <Section icon={Download} title="Backup" description="Your work is stored only in this browser. A backup is your copy — keep one somewhere safe."
          className="border-indigo-200 dark:border-indigo-900/60">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2.5"><ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
              The file is encrypted with your password. It's safe to email to yourself or keep in Google Drive.</li>
            <li className="flex gap-2.5"><HardDrive className="mt-0.5 h-4 w-4 flex-none text-indigo-600" />
              On another computer, choose <em>Restore from a backup</em> on the sign-in page.</li>
          </ul>
          {backupAge === null
            ? <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" />You haven't made a backup from this browser yet.</p>
            : <p className="text-sm text-muted-foreground">Last backup: {backupAge === 0 ? 'today' : `${backupAge} day${backupAge === 1 ? '' : 's'} ago`}.</p>}
          <Button onClick={downloadBackup}><Download className="mr-2 h-4 w-4" /> Download backup</Button>
          <p className="text-xs text-muted-foreground">
            {usage != null && <>Using {fmtBytes(usage)} in this browser. </>}
            {persisted === true && 'This browser has agreed not to clear it automatically.'}
            {persisted === false && 'This browser may clear it if the device runs low on space — another reason to keep a backup.'}
          </p>
        </Section>

        <Section icon={KeyRound} title="Password" description="There is no reset, so pick one you'll remember.">
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
        </Section>

        <Section icon={User} title="Account">
          <Button onClick={signOut} variant="outline" className="w-full justify-start">
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
          <div className="rounded-xl border border-red-200 p-4 dark:border-red-900/50">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Delete this account</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Removes the account and all of its classes, homework and tests from this browser.
              It can't be undone — only a backup would bring it back.
            </p>
            <Label htmlFor="confirmDelete" className="mt-3 block text-xs text-muted-foreground">
              Type <strong>{user.username}</strong> to confirm
            </Label>
            <div className="mt-1.5 flex gap-2">
              <Input id="confirmDelete" value={confirmDelete} onChange={e => setConfirmDelete(e.target.value)}
                autoComplete="off" autoCapitalize="none" spellCheck={false} />
              <Button variant="destructive" onClick={deleteAccount} disabled={confirmDelete.trim().toLowerCase() !== user.username}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
