import { db, accounts } from '@/api/db';

import React, { useEffect, useState } from 'react';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/use-toast";
import { LogOut, User, Palette, Trash2, Loader2, KeyRound, Timer, AudioLines, Play, Square, Smartphone, Download, Monitor, Check, ShieldCheck, PictureInPicture2, MonitorSpeaker, Keyboard, PhoneCall } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from '@/lib/AuthContext';
import { useFocus } from '@/lib/FocusContext';
import { AI_VOICES, configureVoice, listBrowserVoices, onVoicesReady, speak, stopSpeaking, voiceStatus } from '@/lib/voice';
import { cn } from '@/lib/utils';
import { formatMinutes } from '@/lib/agenda';
import { isNativeApp } from '@/lib/native';
import { desktop, isDesktop, desktopNeedsUpdate, DESKTOP_DOWNLOADS, guessOS } from '@/lib/desktop';
import { phoneWhisper, forgetReady } from '@/lib/localEar';

const VOICE_DEFAULTS = { engine: 'auto', aiVoice: 'Aoede', browserVoice: '', rate: 1, readAloud: false };
const SAMPLE = "Hey! I'm your study buddy. Twenty-five minutes on your essay outline, let's lock in.";

// The newest Android build, from the app's GitHub Releases (the web host deletes large .apk files).
const APK_URL = 'https://github.com/Code-A-Difference/Lock-In-/releases/latest/download/LOCKIN-android.apk';

/** Get LOCK IN! as a phone app, only shown in a browser, never inside the app. */
function PhoneApp() {
  const apk = true;
  if (isNativeApp) return null;
  return (
    <Section icon={Smartphone} title="Get the phone app" description="Same account, same work, quicker to open, and the voice assistant works in it.">
      <div className="grid gap-3 sm:grid-cols-2">
        {apk && (
          <a href={APK_URL} download className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <Download className="h-4 w-4" aria-hidden="true" />Download for Android
          </a>
        )}
        <p className="text-sm text-muted-foreground">
          {apk && <>Open the file when it finishes; Android asks once to allow installs from your browser. </>}
          <strong className="font-semibold text-foreground">iPhone:</strong> in Safari tap Share, then Add to Home Screen.
        </p>
      </div>
    </Section>
  );
}

const LANGUAGES = [
  ['en', 'English'], ['auto', 'Detect automatically'], ['fr', 'French'], ['es', 'Spanish'], ['pa', 'Punjabi'], ['hi', 'Hindi'],
  ['zh', 'Chinese'], ['ar', 'Arabic'], ['tl', 'Tagalog'], ['ko', 'Korean'], ['ja', 'Japanese'], ['de', 'German'], ['vi', 'Vietnamese'],
];

export const DESKTOP_PERKS = [
  [ShieldCheck, 'Private, free transcription', 'Classes are transcribed on your computer, the audio never leaves it, and it works even when the AI service is busy.'],
  [PictureInPicture2, 'Floats over your other apps', 'A small window stays on top while you work: live transcript, “catch me up”, and quick answers.'],
  [MonitorSpeaker, 'Records online classes', 'Captures your computer’s sound, Zoom, Teams, Google Meet or a lecture video, with or without your mic.'],
  [PhoneCall, 'Notices when a call starts', 'Offers to record when Zoom, Teams or a browser call begins.'],
  [Keyboard, 'Shortcuts from any app', 'Ctrl+Shift+K catches you up, Ctrl+Shift+L opens the assistant, Ctrl+Shift+R starts recording.'],
];

/** In a browser: the pitch and the downloads. In the desktop app: its settings. In the Android app: its speech engine. */
function DesktopApp() {
  if (isNativeApp) return phoneWhisper ? <ThisPhone /> : null;
  return isDesktop ? <ThisComputer /> : <GetDesktop />;
}

const PHONE_MODEL_NOTE = {
  base: 'Quickest, least accurate',
  small: 'Recommended: accurate and quick on most phones',
  turbo: 'Most accurate, but slow on most phones, a few seconds per sentence',
};

/**
 * Android: whisper.cpp on the phone (android/.../WhisperPlugin.java). Commands to the
 * assistant, push-to-talk and class recordings are understood here instead of by
 * Android's recogniser, which beeps and sends the audio to Google.
 */
function ThisPhone() {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    phoneWhisper.status().then(setSt).catch(() => {});
    let h;
    phoneWhisper.addListener('status', setSt).then(x => { h = x; });
    return () => { h?.remove?.(); };
  }, []);
  if (!st) return null;
  const set = async (patch) => { forgetReady(); setSt(await phoneWhisper.set(patch)); };
  const get = async (id) => {
    setErr('');
    try { setSt(await phoneWhisper.download({ id })); forgetReady(); } catch (e) { setErr(e?.message || String(e)); }
  };
  const dl = st.downloading;
  return (
    <Section icon={Smartphone} title="This phone" description="Speech is understood on the phone itself, with Whisper.">
      {!st.available && <p className="text-sm text-amber-200">This phone’s processor can’t run the speech engine, so the phone’s own recogniser is used instead.</p>}
      <Row id="phone-stt" label="Understand speech on this phone" hint="What you say to the assistant and your class recordings stay on the phone and need no connection. Off: the online service is used.">
        <Switch id="phone-stt" checked={st.enabled} disabled={!st.available} onCheckedChange={(v) => set({ enabled: v })} />
      </Row>
      {st.available && st.enabled && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Quality</p>
          {Object.entries(st.models).map(([id, m]) => (
            <div key={id} className="flex items-center gap-3 rounded-xl border p-3">
              <input type="radio" name="phone-model" id={`pm-${id}`} checked={st.model === id} onChange={() => set({ model: id })} className="h-4 w-4 accent-[hsl(var(--primary))]" />
              <label htmlFor={`pm-${id}`} className="min-w-0 flex-1 text-sm">
                <span className="block font-semibold text-foreground">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{PHONE_MODEL_NOTE[id]} · {m.mb} MB</span>
              </label>
              {m.installed ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400"><Check className="h-3.5 w-3.5" />Ready</span>
                : dl?.id === id ? <span className="text-xs tabular-nums text-muted-foreground">{Math.round((dl.progress || 0) * 100)}%</span>
                : <Button size="sm" variant="outline" disabled={!!dl} onClick={() => get(id)}><Download className="mr-1.5 h-3.5 w-3.5" />Get</Button>}
            </div>
          ))}
          {err && <p className="text-sm text-red-300" role="alert">{err}</p>}
          {!st.models[st.model]?.installed && !dl && (
            <p className="text-xs text-amber-200">Download it to use it, best on Wi-Fi.{st.using ? ` Until then ${st.models[st.using].label.toLowerCase()} is used.` : ' Until then the phone’s own recogniser is used.'}</p>
          )}
          <p className="text-xs text-muted-foreground">“Hey Lock In” itself is still heard by a tiny always-on model: running Whisper all the time would drain the battery.</p>
        </div>
      )}
    </Section>
  );
}

function GetDesktop() {
  const os = guessOS();
  const btn = 'flex h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold';
  return (
    <Section icon={Monitor} title="Get the desktop app" description="LOCK IN! for Windows and Mac, same account, and a better experience in class.">
      <ul className="grid gap-3 sm:grid-cols-2">
        {DESKTOP_PERKS.map(([Icon, title, text]) => (
          <li key={title} className="flex gap-3">
            <Icon className="mt-0.5 h-5 w-5 flex-none text-primary" aria-hidden="true" />
            <span><span className="block text-sm font-semibold text-foreground">{title}</span><span className="block text-sm text-muted-foreground">{text}</span></span>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-3">
        <a href={DESKTOP_DOWNLOADS.windows} className={cn(btn, os === 'windows' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border text-foreground hover:bg-secondary')}>
          <Download className="h-4 w-4" aria-hidden="true" />Windows
        </a>
        <a href={DESKTOP_DOWNLOADS.macArm} className={cn(btn, os === 'mac' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border text-foreground hover:bg-secondary')}>
          <Download className="h-4 w-4" aria-hidden="true" />Mac (Apple chip)
        </a>
        <a href={DESKTOP_DOWNLOADS.macIntel} className={cn(btn, 'border text-foreground hover:bg-secondary')}>
          <Download className="h-4 w-4" aria-hidden="true" />Mac (Intel)
        </a>
      </div>
      <p className="text-xs text-muted-foreground">
        Windows may say it “protected your PC”, choose More info → Run anyway. On a Mac, open the app once from Finder with right-click → Open
        (or System Settings → Privacy &amp; Security → Open Anyway). The app isn’t signed by Apple or Microsoft yet.
      </p>
    </Section>
  );
}

function ThisComputer() {
  const [st, setSt] = useState(null);
  const [login, setLogin] = useState(false);
  const [prefs, setPrefs] = useState({ offerRecordCalls: true, shortcuts: [] });
  const [err, setErr] = useState('');
  useEffect(() => {
    desktop.whisper.status().then(setSt).catch(() => {});
    desktop.launchAtLogin.get().then(setLogin).catch(() => {});
    desktop.prefs.get().then(setPrefs).catch(() => {});
    return desktop.whisper.onStatus(setSt);
  }, []);
  if (!st) return null;
  const t = st.settings;
  const set = async (patch) => setSt(await desktop.whisper.set(patch));
  const get = async (id) => {
    setErr('');
    const r = await desktop.whisper.download(id);
    if (!r.ok) setErr(r.error);
    setSt(await desktop.whisper.status());
  };
  const dl = st.downloading;
  return (
    <Section icon={Monitor} title="This computer" description="Settings for the LOCK IN! desktop app on this computer.">
      {desktopNeedsUpdate && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          A newer desktop app is out. <a className="font-semibold underline" href={desktop.platform === 'darwin' ? DESKTOP_DOWNLOADS.macArm : DESKTOP_DOWNLOADS.windows}>Download it</a> and install over this one.
        </p>
      )}
      <Row id="local-stt" label="Listen and transcribe on this computer" hint="Classes, “Hey Lock In” and the assistant all use Whisper on this computer: private, free, nothing leaves it. Off: the online service is used.">
        <Switch id="local-stt" checked={t.enabled} onCheckedChange={(v) => set({ enabled: v })} />
      </Row>
      {t.enabled && (
        <>
          {!st.available && <p className="text-sm text-red-300">The transcription engine is missing from this install. Reinstall the desktop app.</p>}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Quality</p>
            {Object.entries(st.models).map(([id, m]) => (
              <div key={id} className="flex items-center gap-3 rounded-xl border p-3">
                <input type="radio" name="stt-model" id={`m-${id}`} checked={t.model === id} onChange={() => set({ model: id })} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                <label htmlFor={`m-${id}`} className="min-w-0 flex-1 text-sm">
                  <span className="block font-semibold text-foreground">{m.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {id === 'base' ? 'Quick on any computer' : id === 'small' ? 'Better with names and terms' : 'Most accurate, the default. Steps down by itself if this computer can’t keep up'} · {m.mb} MB
                  </span>
                </label>
                {m.installed ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400"><Check className="h-3.5 w-3.5" />Ready</span>
                  : dl?.id === id ? <span className="text-xs tabular-nums text-muted-foreground">{Math.round(dl.progress * 100)}%</span>
                  : <Button size="sm" variant="outline" disabled={!!dl} onClick={() => get(id)}><Download className="mr-1.5 h-3.5 w-3.5" />Get</Button>}
              </div>
            ))}
            {err && <p className="text-sm text-red-300" role="alert">{err}</p>}
            {!st.models[t.model]?.installed && !dl && <p className="text-xs text-amber-200">Download this one to use it, until then the online service transcribes.</p>}
          </div>
          <Row id="stt-lang" label="Language spoken in class">
            <select id="stt-lang" value={t.language} onChange={e => set({ language: e.target.value })}
              className="h-10 rounded-lg border bg-card px-2 text-sm text-foreground">
              {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Row>
        </>
      )}
      <Row id="login" label="Start with my computer" hint="Opens quietly in the tray, so shortcuts and call detection are ready.">
        <Switch id="login" checked={login} onCheckedChange={async (v) => setLogin(await desktop.launchAtLogin.set(v))} />
      </Row>
      <Row id="calls" label="Offer to record calls and online classes" hint="When Zoom, Teams or a browser call starts using the microphone.">
        <Switch id="calls" checked={prefs.offerRecordCalls} onCheckedChange={async (v) => setPrefs({ ...prefs, ...(await desktop.prefs.set({ offerRecordCalls: v })) })} />
      </Row>
      <div>
        <p className="text-sm font-medium text-foreground">Shortcuts that work from any app</p>
        <ul className="mt-2 space-y-1.5">
          {prefs.shortcuts.map(k => (
            <li key={k.type} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{k.label}</span>
              <kbd className="flex-none rounded border bg-background px-2 py-0.5 text-xs text-foreground">{k.keys}</kbd>
            </li>
          ))}
        </ul>
      </div>
      <Button variant="outline" onClick={() => desktop.mini.set(true)}><PictureInPicture2 className="mr-2 h-4 w-4" />Float on top of other apps</Button>
    </Section>
  );
}

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
 * Settings. Everything here is saved to the student's account on the
 * server, so it follows them to any computer they sign in on.
 */
export default function Settings() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const focus = useFocus();
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [savingName, setSavingName] = useState(false);

  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwBusy, setPwBusy] = useState(false);

  const [deletePw, setDeletePw] = useState('');
  const [deleting, setDeleting] = useState(false);

  const voice = { ...VOICE_DEFAULTS, ...(user?.voice || {}) };
  const [browserVoices, setBrowserVoices] = useState([]);
  const [playing, setPlaying] = useState(null);      // which sample is playing
  const [heardWith, setHeardWith] = useState('');

  useEffect(() => onVoicesReady(() => setBrowserVoices(listBrowserVoices())), []);

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
      toast({ title: 'Password changed', description: 'Any other computer signed in to your account has been signed out.' });
    } catch (err) {
      toast({ title: 'Password not changed', description: err.message, variant: 'destructive' });
    } finally { setPwBusy(false); }
  };

  const signOut = async () => { queryClient.clear(); await accounts.signOut(); };
  const deleteAccount = async (e) => {
    e.preventDefault();
    if (!deletePw) return;
    if (!window.confirm(`Delete "${user.username}" and everything in it? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await accounts.deleteCurrent(deletePw);
      queryClient.clear();
    } catch (err) {
      toast({ title: 'Account not deleted', description: err.message, variant: 'destructive' });
      setDeleting(false);
    }
  };

  const p = focus.prefs;
  const aiOk = voiceStatus().aiAvailable;
  const numberBox = 'h-9 w-20 rounded-lg border bg-background px-2 text-center text-sm tabular-nums text-foreground';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Settings</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Signed in as <strong className="font-semibold text-foreground">{user.username}</strong>. Everything here is saved to your account.
      </p>

      <div className="space-y-5">
        <Section icon={User} title="Profile" description="How LOCK IN! greets you.">
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Your name</Label>
            <div className="flex gap-2">
              <Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" />
              <Button onClick={saveName} disabled={savingName}>{savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
            </div>
            <p className="text-xs text-muted-foreground">Your username, <strong>{user.username}</strong>, is how you sign in, so it can't change.</p>
          </div>
        </Section>

        <DesktopApp />
        <PhoneApp />

        <Section icon={Palette} title="Appearance">
          <Row id="darkMode" label="Dark mode" hint="Easier on the eyes at night.">
            <Switch id="darkMode" checked={user.theme !== 'light'} onCheckedChange={(on) => db.auth.updateMe({ theme: on ? 'dark' : 'light' }).catch(() => {})} />
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
          <Row id="cues" label="Spoken cues" hint="“Nice work, take five.” Voice commands are always answered.">
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
              ['auto', 'Fast and natural (recommended)', 'Answers out loud instantly with this device\'s best natural voice; uses the AI voice only if the device has none.'],
              ['ai', 'AI voice', 'The most human-sounding, but each answer starts a second or two later.'],
              ['browser', "This device's voice only", 'Works offline and uses no AI requests. Quality depends on your device.'],
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

        <Section icon={KeyRound} title="Password" description="There's no email on your account, so there's no reset. Changing it signs out your other devices.">
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
          <form onSubmit={deleteAccount} className="rounded-xl border border-red-200 p-4 dark:border-red-900/50">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Delete this account</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Removes the account and all of its classes, homework, tests and study chats from the server. It can't be undone.
            </p>
            <Label htmlFor="deletePw" className="mt-3 block text-xs text-muted-foreground">
              Your password, to confirm
            </Label>
            <div className="mt-1.5 flex gap-2">
              <Input id="deletePw" type="password" value={deletePw} onChange={e => setDeletePw(e.target.value)}
                autoComplete="current-password" />
              <Button type="submit" variant="destructive" disabled={!deletePw || deleting}>
                {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />} Delete
              </Button>
            </div>
          </form>
        </Section>
      </div>
    </div>
  );
}
