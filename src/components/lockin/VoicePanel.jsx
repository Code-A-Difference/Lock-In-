import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Camera, ChevronUp, Film, Globe, LineChart, Loader2, Mic, MicOff, Paperclip, Radio, Send, Sigma, Square, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import RichText from '@/components/lockin/RichText';
import CameraCapture from '@/components/lockin/CameraCapture';
import SymbolPad from '@/components/lockin/SymbolPad';
import { openGraph } from '@/components/lockin/GraphPanel';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { useAssistant } from '@/lib/AssistantContext';
import { useLecture } from '@/lib/LectureContext';
import { useStudyData } from '@/lib/data';
import { listenOnce, HandsFree, canListen, canHandsFree } from '@/lib/listen';
import { isNativeApp, appNeedsUpdate, APK_URL } from '@/lib/native';
import { chime, unlockAudio } from '@/lib/soundscape';
import { stopSpeaking } from '@/lib/voice';
import { useAllowOutside } from '@/lib/aiPrefs';

const PREF = 'lockin.handsfree';
const readPref = () => { try { return localStorage.getItem(PREF); } catch (_) { return null; } };
const writePref = (v) => { try { localStorage.setItem(PREF, v); } catch (_) {} };

const IDEAS = [
  'What’s due this week?',
  'Start a 50 minute focus session',
  'Help me with my homework',
  'Plan my afternoon',
];
const LECTURE_IDEAS = ['Catch me up', 'Explain that last part simply', 'What will be on the test?', 'Quiz me on this'];
const NOTES_IDEAS = ['What did we cover in my last class?', 'Find where we talked about…', 'What should I review this week?'];

/**
 * The assistant: a bar at the bottom of every page that you type or talk to,
 * with "Hey Lock In" listening in the background once you've said yes to it.
 * It answers about whatever's in front of you: the lecture being recorded or
 * open on screen first, all your notes on the Notes page, and by default only
 * from your own material (outside knowledge is one switch away).
 */
export default function VoicePanel() {
  const a = useAssistant();
  const lecture = useLecture();
  const { lectures } = useStudyData();
  const [expanded, setExpanded] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [pref, setPref] = useState(readPref);          // 'on' | 'off' | null (never asked)
  const [handsFree, setHandsFree] = useState(false);
  const [armed, setArmed] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [note, setNote] = useState('');
  const [hearing, setHearing] = useState(false);       // words are actually coming in
  const [camera, setCamera] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const box = useRef(null);
  const wasOpen = useRef(false);
  const hf = useRef(null);
  const stopRef = useRef(null);
  const loopRef = useRef(false);
  const scroller = useRef(null);
  const fileRef = useRef(null);
  const mediaRef = useRef(null);
  const location = useLocation();
  const [outside, setOutside] = useAllowOutside();
  const onNotes = location.pathname.startsWith('/Notes');
  const pageLecture = onNotes ? new URLSearchParams(location.search).get('id') : null;
  const focusId = pageLecture || lecture.active?.id || '';
  const focusLec = focusId ? lectures.find(l => l.id === focusId) : null;
  const focusRef = useRef(focusId);
  focusRef.current = focusId;
  const sendRef = useRef(a.send);
  sendRef.current = (text, opts = {}) => a.send(text, { ...opts, focusId: focusRef.current });

  // Every time the assistant opens it's a new conversation.
  useEffect(() => {
    if (expanded && !wasOpen.current) { a.clear(); setShowSources(false); setSymbols(false); setError(''); }
    wasOpen.current = expanded;
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const open = () => { setExpanded(true); setCamera(true); };
    window.addEventListener('lockin:camera', open);
    return () => window.removeEventListener('lockin:camera', open);
  }, []);

  /* ---------------------------------------------------- sending, by voice */
  const sendVoice = useCallback(async (text) => {
    setHeard('');
    setArmed(false);
    const r = await sendRef.current(text, { via: 'voice' });
    await r.finished;
    hf.current?.extend(10000);          // a follow-up needs no "Hey Lock In"
    if (hf.current?.running) setArmed(true);
  }, []);
  const voiceRef = useRef(sendVoice);
  voiceRef.current = sendVoice;

  /* ------------------------------------------------------------ hands-free */
  const startHandsFree = useCallback(() => {
    if (!canHandsFree) return;
    unlockAudio();
    if (!hf.current) {
      hf.current = new HandsFree({
        onCommand: (text) => voiceRef.current(text),
        onWake: () => {
          setExpanded(true);
          setArmed(true);
          setError('');
          chime('wake', 0.3);                       // "I'm listening", like saying "Hey Google"
        },
        onHeard: setHeard,
        onNote: (s) => setNote(s?.state === 'downloading' ? `Getting the wake-word model… ${Math.round((s.progress || 0) * 100)}% (one time, about 40 MB)`
          : s?.state === 'unpacking' ? 'Unpacking the wake-word model…' : s?.state === 'loading' ? 'Starting up…' : ''),
        onState: setHandsFree,
        onError: (message) => { setError(message); setPref('off'); writePref('off'); },
      });
    }
    hf.current.start();
  }, []);
  const stopHandsFree = useCallback(() => { hf.current?.stop(); setArmed(false); }, []);

  // Asked once, remembered: after a yes it comes back on by itself every visit.
  useEffect(() => {
    if (pref === 'on') startHandsFree();
    return () => hf.current?.stop();
  }, [pref, startHandsFree]);

  // "Listening…" lapses with the recogniser's own window if nobody says anything.
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), 12000);
    return () => clearTimeout(id);
  }, [armed]);

  // The recogniser stays open while the assistant thinks and talks, but ignores what it hears.
  useEffect(() => { hf.current?.setMuted(a.busy || a.speaking); }, [a.busy, a.speaking]);

  const choose = (on) => {
    const v = on ? 'on' : 'off';
    setPref(v);
    writePref(v);
    if (!on) stopHandsFree();
  };

  /* --------------------------------------------------------- tap to talk */
  const talk = useCallback(async () => {
    unlockAudio();
    if (listening) { loopRef.current = false; stopRef.current?.(); return; }
    stopSpeaking();
    setError('');
    // On Android the wake-word model holds the mic, so it steps aside for a tapped conversation.
    const resume = isNativeApp && !!hf.current?.running;
    if (resume) hf.current.stop();
    if (hf.current?.running) {
      // the wake-word recogniser is already open; arm it rather than opening a second one
      hf.current.extend(15000);
      setArmed(true);
      chime('wake', 0.3);
      return;
    }
    loopRef.current = true;
    let silent = 0;
    while (loopRef.current) {
      setListening(true);
      setHearing(false);
      setHeard('');
      const { promise, stop } = listenOnce({ onInterim: (t) => { setHeard(t); if (t) setHearing(true); }, onSpeech: setHearing });
      stopRef.current = stop;
      let text = '';
      try { text = await promise; } catch (e) { setError(e.message); break; } finally { setListening(false); setHearing(false); }
      if (!loopRef.current) break;
      if (!text) { if (++silent >= 2) break; continue; }   // two quiet turns end the conversation
      silent = 0;
      setHeard('');
      const r = await sendRef.current(text, { via: 'voice' });
      await r.finished;
    }
    loopRef.current = false;
    setHeard('');
    if (resume) startHandsFree();
  }, [listening, startHandsFree]);

  useEffect(() => {
    const onTalk = () => { setExpanded(true); talk(); };
    // the desktop app's global shortcut: open it ready to type
    const onOpen = () => { setExpanded(true); setTimeout(() => box.current?.focus(), 150); };
    window.addEventListener('lockin:talk', onTalk);
    window.addEventListener('lockin:assistant', onOpen);
    return () => { window.removeEventListener('lockin:talk', onTalk); window.removeEventListener('lockin:assistant', onOpen); };
  }, [talk]);

  /* -------------------------------------------------------------- typing */
  const insert = (sym) => {
    const el = box.current;
    const at = el ? el.selectionStart : input.length;
    const end = el ? el.selectionEnd : input.length;
    const next = input.slice(0, at) + sym + input.slice(end);
    setInput(next);
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(at + sym.length, at + sym.length); } });
  };
  const submit = (text = input) => {
    const t = text.trim();
    if (!t) return;
    setInput('');
    setError('');
    unlockAudio();
    setExpanded(true);
    sendRef.current(t, { via: 'text' });
  };

  // Something else asks a question through the bar (the desktop app's "catch me up" shortcut)
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onAsk = (e) => { if (e.detail) submitRef.current(String(e.detail)); };
    window.addEventListener('lockin:ask', onAsk);
    return () => window.removeEventListener('lockin:ask', onAsk);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [a.messages.length, a.busy, expanded, heard]);

  const onFiles = async (e) => {
    const files = e.target.files;
    try { await a.addFiles(files); } catch (err) { setError(err.message); }
    e.target.value = '';
  };
  const onMedia = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const lec = await lecture.importMedia(f);
      if (lec) {
        a.togglePinned(lec.id);
        toast({ title: 'Video added', description: 'Its notes are being written. Ask me anything about it.' });
      }
    } catch (err) { setError(err.message); }
  };

  const status = !canListen ? '' : handsFree ? (armed ? 'Listening' : 'Say “Hey Lock In”') : '';
  const lecturesReady = lectures.filter(l => l.notes || l.my_notes || (l.segments || []).some(s => s.text));
  const ideas = focusLec ? LECTURE_IDEAS : onNotes ? NOTES_IDEAS : IDEAS;
  const placeholder = listening ? 'Listening…' : focusLec ? `Ask about ${focusLec.title}` : onNotes ? 'Search your notes' : 'Ask anything';

  return (
    <>
    {/* The moment "Hey Lock In" is heard: a glow around the screen and a pill up top, so it's
        obvious it's listening even with the assistant closed or the app in another tab. */}
    {(armed || (listening && hearing)) && !a.busy && !a.speaking && (
      <>
        <div className="lockin-listen-glow" aria-hidden="true" />
        <div className="lockin-listen-pill" role="status" aria-live="polite">
          <span className="lockin-listen-bars" aria-hidden="true"><i /><i /><i /><i /></span>
          {heard ? <span className="max-w-[60vw] truncate">{heard}</span> : 'Listening…'}
        </div>
      </>
    )}

    {/* The assistant is a bar at the bottom of every page: ask about the lecture you're
        recording or reading, search your notes, or have it do things. It opens upward. */}
    <div className="lockin-voice-dock pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 px-3 lg:bottom-4 lg:left-60 lg:px-6">
      <div className="pointer-events-auto mx-auto w-full max-w-2xl">
        {pref === null && canHandsFree && !expanded && (
          <div role="dialog" aria-label="Hands-free" className="lockin-handsfree-ask mb-2 rounded-2xl border bg-card p-4 shadow-2xl">
            <p className="text-sm font-semibold text-foreground">Say “Hey Lock In” to talk hands-free?</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => choose(true)} className="h-10 flex-1 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90">Turn on</button>
              <button type="button" onClick={() => choose(false)} className="h-10 flex-1 rounded-lg border text-sm font-medium text-foreground hover:bg-accent">Not now</button>
            </div>
          </div>
        )}

        {expanded && (
          <section className="mb-2 flex max-h-[min(34rem,calc(100dvh-11rem))] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2" aria-label="Lock In assistant">
            <header className="flex items-center gap-1 border-b px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                {focusLec ? <><BookOpen className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />{focusLec.title}{lecture.active?.id === focusLec.id ? ' (live)' : ''}</>
                  : onNotes ? 'All your notes' : 'Lock In'}
                {status && <span className={cn('ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', armed ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-secondary text-muted-foreground')}>
                  <Radio className={cn('h-3 w-3', armed && 'animate-pulse')} aria-hidden="true" />{status}
                </span>}
              </span>
              <button type="button" onClick={() => setOutside(!outside)} aria-pressed={outside}
                title={outside ? 'Using outside knowledge as well as your notes' : 'Only your lectures, notes and slides'}
                className={cn('inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium hover:bg-secondary', outside ? 'text-primary' : 'text-muted-foreground')}>
                <Globe className="h-3.5 w-3.5" aria-hidden="true" />{outside ? 'Outside knowledge on' : 'Notes only'}
              </button>
              <button type="button" onClick={() => a.setReadAloud(!a.readAloud)} aria-pressed={a.readAloud} aria-label={a.readAloud ? 'Stop reading typed answers aloud' : 'Read answers aloud'}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
                {a.readAloud ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
              <button type="button" onClick={a.clear} disabled={!a.messages.length} aria-label="Clear the conversation"
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
              <button type="button" onClick={() => setExpanded(false)} aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
            </header>

            <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
              {!a.messages.length && !listening && !heard && (
                <div className="flex flex-wrap gap-1.5 py-1">
                  {ideas.map(i => <button key={i} type="button" onClick={() => submit(i)}
                    className="rounded-full border bg-background px-3 py-1.5 text-xs text-foreground hover:border-primary/50 hover:bg-accent">{i}</button>)}
                </div>
              )}
              {a.messages.map(m => (
                <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                    m.role === 'user' ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-secondary text-foreground')}>
                    {m.role === 'user' ? <span className="whitespace-pre-wrap">{m.text}</span> : <RichText text={m.text} />}
                  </div>
                </div>
              ))}
              {(heard || listening) && (
                <div className="flex justify-end">
                  <div className="max-w-[88%] rounded-2xl rounded-br-md border border-dashed border-primary/40 px-3.5 py-2 text-sm text-muted-foreground">
                    {heard || (hearing ? 'Hearing you…' : 'Go ahead')}
                  </div>
                </div>
              )}
              {a.busy && <div className="flex justify-start"><div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-secondary px-3.5 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Thinking…</div></div>}
              {a.speaking && <div className="flex justify-start">
                <button type="button" onClick={a.stop} className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-accent"><Square className="h-3 w-3 fill-current" />Stop talking</button>
              </div>}
            </div>

            {(a.attachments.length > 0 || a.pinned.length > 0 || lecture.importing) && (
              <div className="flex flex-wrap gap-1.5 border-t px-3 pt-2">
                {lecture.importing && <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                  <Loader2 className="h-3 w-3 animate-spin" />Listening to “{lecture.importing.title}” {lecture.importing.done}/{lecture.importing.total}</span>}
                {a.pinned.map(id => { const l = lectures.find(x => x.id === id); return l && (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs text-accent-foreground">
                    <BookOpen className="h-3 w-3" />{l.title}
                    <button type="button" onClick={() => a.togglePinned(id)} aria-label={`Stop using ${l.title}`}><X className="h-3 w-3" /></button></span>); })}
                {a.attachments.map((f, i) => (
                  <span key={`${f.name}${i}`} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
                    <Paperclip className="h-3 w-3" />{f.name}
                    <button type="button" onClick={() => a.removeAttachment(i)} aria-label={`Remove ${f.name}`}><X className="h-3 w-3" /></button></span>
                ))}
              </div>
            )}

            {showSources && (
              <div className="max-h-40 space-y-1 overflow-y-auto border-t px-3 py-2">
                {lecturesReady.length === 0 && <p className="text-xs text-muted-foreground">No lectures yet.</p>}
                {lecturesReady.slice(0, 30).map(l => (
                  <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-secondary">
                    <input type="checkbox" checked={a.pinned.includes(l.id)} onChange={() => a.togglePinned(l.id)} />
                    <span className="min-w-0 flex-1 truncate text-foreground">{l.title}</span>
                    {l.class_name && <span className="text-muted-foreground">{l.class_name}</span>}
                  </label>
                ))}
              </div>
            )}

            {note && <p className="border-t px-4 py-2 text-xs text-muted-foreground">{note}</p>}
            {error && <p className="border-t px-4 py-2 text-xs text-red-700 dark:text-red-400" role="alert">{error}</p>}
            {symbols && <SymbolPad onInsert={insert} />}

            <div className="flex items-center gap-0.5 border-t px-2 py-1" role="toolbar" aria-label="Add to your message">
              {[
                [Camera, 'Take a photo', () => setCamera(true), false],
                [Paperclip, 'Attach a photo, PDF or text file', () => fileRef.current?.click(), false],
                [Film, 'Add a video or audio file', () => mediaRef.current?.click(), !!lecture.importing],
                [Sigma, 'Maths and science symbols', () => setSymbols(v => !v), false, symbols],
                [LineChart, 'Graphing calculator', () => openGraph([]), false],
                [BookOpen, 'Choose lectures to ask about', () => setShowSources(v => !v), false, showSources || a.pinned.length > 0],
              ].map(([Icon, label, onClick, disabled, on]) => (
                <button key={label} type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} aria-pressed={on === undefined ? undefined : !!on}
                  className={cn('grid h-9 w-9 place-items-center rounded-lg hover:bg-secondary hover:text-foreground disabled:opacity-40', on ? 'text-primary' : 'text-muted-foreground')}>
                  <Icon className="h-4 w-4" />
                </button>
              ))}
              {canHandsFree && (
                <label className="ml-auto flex items-center gap-2 px-2 text-xs text-muted-foreground" title="Listen for “Hey Lock In”">
                  <input type="checkbox" checked={pref === 'on'} onChange={e => choose(e.target.checked)} />Hey Lock In
                </label>
              )}
            </div>
            {appNeedsUpdate && (
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                “Hey Lock In” needs the newest app. <a href={APK_URL} className="font-semibold text-primary underline">Update</a>
              </p>
            )}
          </section>
        )}

        <input ref={fileRef} type="file" hidden multiple accept="image/*,application/pdf,text/plain" onChange={onFiles} />
        <input ref={mediaRef} type="file" hidden accept="video/*,audio/*" onChange={onMedia} />

        <form className="flex items-end gap-1.5 rounded-2xl border bg-card/95 p-1.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85"
          onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {canListen
            ? <button type="button" onClick={() => { setExpanded(true); talk(); }} aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Talk to Lock In'}
                className={cn('relative grid h-10 w-10 flex-none place-items-center rounded-xl',
                  listening ? 'bg-red-600 text-white hover:bg-red-700' : armed ? 'bg-mint text-[#16181d]' : 'bg-secondary text-foreground hover:bg-secondary/70')}>
                {listening ? <MicOff className="h-4 w-4" /> : armed ? <Radio className="h-4 w-4 animate-pulse" /> : <Mic className="h-4 w-4" />}
                {handsFree && !armed && !listening && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-400" title="Listening for Hey Lock In" />}
              </button>
            : null}
          <textarea ref={box} value={input} onChange={e => setInput(e.target.value)} rows={1} placeholder={placeholder}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === 'Escape') setExpanded(false); }}
            onFocus={() => unlockAudio()}
            aria-label={placeholder}
            className="max-h-28 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-sm" />
          {!expanded && (a.messages.length > 0 || a.busy) && (
            <button type="button" onClick={() => setExpanded(true)} aria-label="Show the conversation"
              className="grid h-10 w-10 flex-none place-items-center rounded-xl text-muted-foreground hover:bg-secondary"><ChevronUp className="h-4 w-4" /></button>
          )}
          <button type="submit" disabled={!input.trim()} aria-label="Send"
            className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"><Send className="h-4 w-4" /></button>
        </form>
      </div>
    </div>
    <CameraCapture open={camera} onClose={() => setCamera(false)} onPhoto={(url) => { a.addPhoto(url); setExpanded(true); }} />
    </>
  );
}
