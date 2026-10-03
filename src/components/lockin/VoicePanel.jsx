import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { BookOpen, Film, Loader2, Mic, MicOff, Paperclip, Radio, Send, Square, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { useAssistant } from '@/lib/AssistantContext';
import { useLecture } from '@/lib/LectureContext';
import { useStudyData } from '@/lib/data';
import { listenOnce, HandsFree, canListen, canHandsFree } from '@/lib/listen';
import { isNativeApp } from '@/lib/native';
import { chime, unlockAudio } from '@/lib/soundscape';
import { stopSpeaking } from '@/lib/voice';

const PREF = 'lockin.handsfree';
const readPref = () => { try { return localStorage.getItem(PREF); } catch (_) { return null; } };
const writePref = (v) => { try { localStorage.setItem(PREF, v); } catch (_) {} };

const IDEAS = [
  'Start a focus session for 50 minutes',
  'What’s due this week?',
  'Help me with my homework',
  'Quiz me on photosynthesis',
];

/**
 * The assistant, anywhere in the app: a chat you can type to or talk to, with
 * "Hey Lock In" listening in the background once you've said yes to it.
 * One conversation, whichever way each message arrives.
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
  const hf = useRef(null);
  const stopRef = useRef(null);
  const loopRef = useRef(false);
  const scroller = useRef(null);
  const fileRef = useRef(null);
  const mediaRef = useRef(null);
  const sendRef = useRef(a.send);
  sendRef.current = a.send;

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
      setHeard('');
      const { promise, stop } = listenOnce({ onInterim: setHeard });
      stopRef.current = stop;
      let text = '';
      try { text = await promise; } catch (e) { setError(e.message); break; } finally { setListening(false); }
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
    window.addEventListener('lockin:talk', onTalk);
    return () => window.removeEventListener('lockin:talk', onTalk);
  }, [talk]);

  /* -------------------------------------------------------------- typing */
  const submit = (text = input) => {
    const t = text.trim();
    if (!t) return;
    setInput('');
    setError('');
    unlockAudio();
    a.send(t, { via: 'text' });
  };

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

  const status = !canListen ? '' : handsFree ? (armed ? 'Listening…' : 'Say “Hey Lock In”') : '';
  const lecturesReady = lectures.filter(l => l.notes || (l.segments || []).some(s => s.text));

  return (
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 flex flex-col items-end gap-2 lg:bottom-5">
      {pref === null && canHandsFree && !expanded && (
        <div role="dialog" aria-label="Hands-free" className="w-[min(20rem,calc(100vw-2rem))] rounded-2xl border bg-card p-4 shadow-2xl">
          <p className="text-sm font-semibold text-foreground">Go hands-free?</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Just say “Hey Lock In” from anywhere in the app, like a phone assistant. {isNativeApp ? 'It listens on your phone while the app is open; the first time, it downloads a small speech model (about 40 MB).' : 'I’ll ask your browser for the microphone once and remember your answer.'}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => choose(true)} className="h-10 flex-1 rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700">Turn on</button>
            <button type="button" onClick={() => choose(false)} className="h-10 flex-1 rounded-lg border text-sm font-medium text-foreground hover:bg-accent">Not now</button>
          </div>
        </div>
      )}

      {expanded && (
        <section className="flex h-[min(36rem,calc(100dvh-9rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl" aria-labelledby="assistant-title">
          <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <div className="min-w-0">
              <h2 id="assistant-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
                Lock In
                {status && <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', armed ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-secondary text-muted-foreground')}>
                  <Radio className={cn('h-3 w-3', armed && 'animate-pulse')} />{status}
                </span>}
              </h2>
              <p className="truncate text-xs text-muted-foreground">Ask, talk, or have me do things</p>
            </div>
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={() => a.setReadAloud(!a.readAloud)} aria-pressed={a.readAloud} aria-label={a.readAloud ? 'Stop reading typed answers aloud' : 'Read answers aloud'}
                title={a.readAloud ? 'Reading answers aloud' : 'Answers stay silent unless you speak'}
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
                {a.readAloud ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
              <button type="button" onClick={a.clear} disabled={!a.messages.length} aria-label="Clear the conversation" title="Clear the conversation"
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
              <button type="button" onClick={() => setExpanded(false)} aria-label="Close assistant"
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
          </header>

          <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
            {!a.messages.length && (
              <div className="py-4 text-center">
                <p className="text-sm font-medium text-foreground">What are we working on?</p>
                <p className="mx-auto mt-1 max-w-[18rem] text-xs text-muted-foreground">Talk to me like a person — I’ll start timers, add homework, explain things, and answer questions about your lectures and files.</p>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {IDEAS.map(i => <button key={i} type="button" onClick={() => submit(i)}
                    className="rounded-full border bg-background px-3 py-1.5 text-xs text-foreground hover:border-indigo-300 hover:bg-accent">{i}</button>)}
                </div>
              </div>
            )}
            {a.messages.map(m => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                  m.role === 'user' ? 'rounded-br-md bg-indigo-600 text-white' : 'rounded-bl-md bg-secondary text-foreground')}>
                  {m.role === 'user'
                    ? <span className="whitespace-pre-wrap">{m.text}</span>
                    : <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-headings:my-2 prose-pre:text-xs [&_ol]:list-decimal [&_ul]:list-disc [&_ol]:pl-5 [&_ul]:pl-5"><ReactMarkdown>{m.text}</ReactMarkdown></div>}
                </div>
              </div>
            ))}
            {heard && <div className="flex justify-end"><div className="max-w-[88%] rounded-2xl rounded-br-md border border-dashed border-indigo-300 px-3.5 py-2 text-sm italic text-muted-foreground">{heard}…</div></div>}
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
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-1 text-xs text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200">
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
              <p className="text-xs font-medium text-muted-foreground">Ask about specific lectures (otherwise I look for the right one):</p>
              {lecturesReady.length === 0 && <p className="text-xs text-muted-foreground">No lecture notes yet. Record a class, or add a video.</p>}
              {lecturesReady.slice(0, 20).map(l => (
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

          <form className="flex items-end gap-1.5 border-t p-2.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <input ref={fileRef} type="file" hidden multiple accept="image/*,application/pdf,text/plain" onChange={onFiles} />
            <input ref={mediaRef} type="file" hidden accept="video/*,audio/*" onChange={onMedia} />
            <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach a photo, PDF or text file" title="Attach a photo, PDF or text file"
              className="grid h-9 w-9 flex-none place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><Paperclip className="h-4 w-4" /></button>
            <button type="button" onClick={() => mediaRef.current?.click()} disabled={!!lecture.importing} aria-label="Add a video or audio file" title="Add a video or audio file — I’ll transcribe it so you can ask about it"
              className="grid h-9 w-9 flex-none place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"><Film className="h-4 w-4" /></button>
            <button type="button" onClick={() => setShowSources(s => !s)} aria-pressed={showSources} aria-label="Choose lecture notes to ask about" title="Choose lecture notes to ask about"
              className={cn('grid h-9 w-9 flex-none place-items-center rounded-lg hover:bg-secondary hover:text-foreground', showSources || a.pinned.length ? 'text-indigo-600' : 'text-muted-foreground')}><BookOpen className="h-4 w-4" /></button>
            <textarea value={input} onChange={e => setInput(e.target.value)} rows={1} placeholder={listening ? 'Listening…' : 'Message Lock In'}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              aria-label="Message Lock In"
              className="max-h-28 min-h-9 min-w-0 flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-indigo-400" />
            {input.trim()
              ? <button type="submit" aria-label="Send" className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"><Send className="h-4 w-4" /></button>
              : canListen
                ? <button type="button" onClick={talk} aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Talk to Lock In'}
                    className={cn('grid h-9 w-9 flex-none place-items-center rounded-lg text-white', listening ? 'animate-pulse bg-red-600' : 'bg-indigo-600 hover:bg-indigo-700')}>
                    {listening ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-4 w-4" />}</button>
                : <span className="grid h-9 w-9 flex-none place-items-center text-muted-foreground" title="Voice needs Chrome, Edge or Safari"><MicOff className="h-4 w-4" /></span>}
          </form>

          {canHandsFree && (
            <label className="flex items-center justify-between gap-2 border-t bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
              <span>Hands-free “Hey Lock In” <span className="opacity-70">{isNativeApp ? '— listens on your phone while the app is open' : '— your browser may send speech to its recognition service'}</span></span>
              <input type="checkbox" checked={pref === 'on'} onChange={e => choose(e.target.checked)} aria-label="Listen for Hey Lock In" />
            </label>
          )}
        </section>
      )}

      <button type="button" onClick={() => { setExpanded(open => !open); unlockAudio(); }} aria-expanded={expanded} aria-label={expanded ? 'Close the Lock In assistant' : 'Open the Lock In assistant'}
        className={cn('relative grid h-14 w-14 place-items-center rounded-full text-white shadow-lg ring-4 ring-background transition-transform hover:scale-105 active:scale-95',
          armed || listening ? 'bg-emerald-600' : 'bg-gradient-to-br from-indigo-600 to-fuchsia-600')}>
        {armed || listening ? <Radio className="h-6 w-6 animate-pulse" /> : <Mic className="h-6 w-6" />}
        {handsFree && !armed && <span className="absolute right-1 top-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" title="Listening for Hey Lock In" />}
      </button>
    </div>
  );
}
