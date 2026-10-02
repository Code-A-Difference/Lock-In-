import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Mic, Pause, Play, Square, ChevronLeft, Loader2, Sparkles, Trash2, Copy, Share2, Brain, Plus, Check,
  AlertTriangle, FileText, NotebookPen, ListChecks, RefreshCw, GraduationCap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStudyData, useActions } from '@/lib/data';
import { useLecture } from '@/lib/LectureContext';
import { clock, notesMarkdown, transcriptText } from '@/lib/lectures';
import { relativeDay } from '@/lib/dates';
import { parseQuickAdd } from '@/lib/quickadd';
import { toast } from '@/components/ui/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Lectures and their notes. One page, two views: the list (filterable by
 * class) and a single lecture (?id=…), which is also where a recording in
 * progress lives — big controls, a live transcript, and a box for your own
 * notes, which the AI then builds on when it writes them up.
 */
export default function Notes() {
  const location = useLocation();
  const id = new URLSearchParams(location.search).get('id');
  return id ? <LectureView id={id} /> : <LectureList />;
}

/* ===================================================================== list */

function LectureList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { lectures, classes, isLoading } = useStudyData();
  const lec = useLecture();
  const [cls, setCls] = useState(location.state?.className || '');
  const [picking, setPicking] = useState(false);

  const shown = useMemo(() => (cls ? lectures.filter(l => l.class_name === cls) : lectures), [lectures, cls]);
  const counts = useMemo(() => Object.fromEntries(classes.map(c => [c.name, lectures.filter(l => l.class_name === c.name).length])), [classes, lectures]);

  const record = async (c) => {
    setPicking(false);
    try { await lec.start({ className: c?.name || '', classId: c?.id || '' }); } catch (e) {
      toast({ title: 'Could not start recording', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-5 sm:px-6 lg:pb-10 lg:pt-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Notes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Record a class. LOCK IN! transcribes it and writes your notes — built on whatever you jot down yourself.</p>
      </header>

      {lec.active ? (
        <button type="button" onClick={() => navigate(`/Notes?id=${lec.active.id}`)}
          className="flex w-full items-center gap-3 rounded-2xl bg-red-600 p-4 text-left text-white shadow-lg shadow-red-600/20 active:scale-[0.99]">
          <span className="relative grid h-11 w-11 flex-none place-items-center rounded-full bg-white/15">
            <span className="absolute h-3 w-3 animate-ping rounded-full bg-white/70 motion-reduce:animate-none" />
            <Mic className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold">Recording · {clock(lec.active.elapsed)}</span>
            <span className="block text-sm text-white/80">Tap to see the live transcript</span>
          </span>
        </button>
      ) : (
        <button type="button" onClick={() => (classes.length ? setPicking(true) : record(null))} disabled={!lec.canRecord}
          className="flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 p-4 text-left text-white shadow-lg shadow-indigo-600/20 active:scale-[0.99] disabled:opacity-50">
          <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-white/15"><Mic className="h-5 w-5" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold">Record a lecture</span>
            <span className="block text-sm text-white/80">{lec.canRecord ? 'Transcribed as it goes, notes when you stop' : 'This browser can’t record audio'}</span>
          </span>
        </button>
      )}
      {lec.error && <p className="mt-2 text-sm text-red-700 dark:text-red-400" role="alert">{lec.error}</p>}

      {classes.length > 0 && (
        <div className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter by class">
          <Chip on={!cls} onClick={() => setCls('')}>All · {lectures.length}</Chip>
          {classes.map(c => <Chip key={c.id} on={cls === c.name} onClick={() => setCls(c.name)}>{c.name} · {counts[c.name] || 0}</Chip>)}
        </div>
      )}

      <section className="mt-4" aria-label="Lectures">
        {isLoading ? null : shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
            <NotebookPen className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-2 text-base font-semibold text-foreground">{cls ? `No ${cls} lectures yet` : 'No lectures yet'}</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Put your phone on the desk and tap Record when class starts. Type a few words whenever something matters — the notes are built around them.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {shown.map(l => <LectureRow key={l.id} lecture={l} onOpen={() => navigate(`/Notes?id=${l.id}`)} />)}
          </ul>
        )}
      </section>

      {picking && (
        <Sheet title="Which class is this?" onClose={() => setPicking(false)}>
          <ul className="space-y-1">
            {classes.map(c => (
              <li key={c.id}>
                <button type="button" onClick={() => record(c)} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-medium text-foreground hover:bg-secondary active:bg-secondary">
                  <span className={cn('h-3 w-3 flex-none rounded-full', c.color || 'bg-indigo-500')} aria-hidden="true" />{c.name}
                </button>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => record(null)} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base text-muted-foreground hover:bg-secondary">
                <span className="h-3 w-3 flex-none rounded-full border" aria-hidden="true" />Not for a class
              </button>
            </li>
          </ul>
        </Sheet>
      )}
    </div>
  );
}

function Chip({ on, onClick, children }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('h-9 flex-none whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors',
        on ? 'border-indigo-300 bg-accent text-accent-foreground dark:border-indigo-700' : 'bg-card text-muted-foreground hover:text-foreground')}>
      {children}
    </button>
  );
}

const STATUS = {
  recording: ['Recording', 'text-red-700 dark:text-red-400'],
  transcribing: ['Finishing transcript', 'text-amber-700 dark:text-amber-400'],
  writing: ['Writing notes', 'text-indigo-700 dark:text-indigo-300'],
  transcribed: ['Transcript only', 'text-muted-foreground'],
};

function LectureRow({ lecture: l, onOpen }) {
  const [label, color] = STATUS[l.status] || ['', ''];
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 rounded-2xl border bg-card p-3.5 text-left hover:border-indigo-300 active:bg-secondary">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-accent text-accent-foreground"><FileText className="h-5 w-5" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-foreground">{l.title}</span>
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            {[l.class_name, relativeDay(l.date), l.duration ? `${Math.max(1, Math.round(l.duration / 60))} min` : null].filter(Boolean).join(' · ')}
          </span>
          {l.notes?.summary && <span className="mt-1 line-clamp-2 block text-sm text-foreground/80">{l.notes.summary}</span>}
          {label && <span className={cn('mt-1 block text-xs font-semibold', color)}>{label}</span>}
        </span>
      </button>
    </li>
  );
}

/* ================================================================ one lecture */

function LectureView({ id }) {
  const navigate = useNavigate();
  const { lectures, classes, isLoading } = useStudyData();
  const actions = useActions();
  const lec = useLecture();
  const lecture = lectures.find(l => l.id === id);
  const live = lec.active?.id === id ? lec.active : null;
  const [tab, setTab] = useState(live ? 'mine' : 'notes');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { if (lecture && !live && !lecture.notes && tab === 'notes') setTab('transcript'); }, [lecture, live]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lecture) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-center">
        {isLoading ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /> : (
          <>
            <p className="text-sm text-muted-foreground">That lecture isn't here any more.</p>
            <button type="button" onClick={() => navigate('/Notes')} className="mt-3 h-11 rounded-xl border px-4 text-sm font-semibold">Back to notes</button>
          </>
        )}
      </div>
    );
  }

  const writing = lec.writing[id];
  const transcript = transcriptText(lecture.segments);
  const failed = (lecture.segments || []).filter(s => s.error).length;

  const regenerate = async () => {
    try { await lec.writeNotes(lecture); setTab('notes'); } catch (e) {
      toast({ title: 'Could not write the notes', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-32 pt-3 sm:px-6 lg:pb-12 lg:pt-6">
      <div className="mb-2 flex items-center gap-1">
        <button type="button" onClick={() => navigate('/Notes')} aria-label="All lectures"
          className="-ml-2 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <div className="min-w-0 flex-1" />
        {!live && (
          <button type="button" onClick={() => setConfirmDelete(true)} aria-label="Delete this lecture"
            className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-red-700">
            <Trash2 className="h-5 w-5" />
          </button>
        )}
      </div>

      <TitleEditor lecture={lecture} onSave={(title) => actions.updateLecture(id, { title, auto_title: false })} />
      <ClassPicker lecture={lecture} classes={classes} onPick={(c) => actions.updateLecture(id, { class_name: c?.name || '', class_id: c?.id || '' })} />

      {live && <RecorderPanel live={live} lec={lec} />}

      {!live && (lecture.status === 'transcribing' || writing) && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border bg-card p-4 text-sm text-foreground" role="status">
          <Loader2 className="h-5 w-5 flex-none animate-spin text-indigo-600" />
          {writing || 'Finishing the last part of the transcript…'}
        </div>
      )}
      {!live && !writing && lecture.notes_error && !lecture.notes && (
        <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-200" role="alert">
          <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />{lecture.notes_error}</p>
          {transcript && <button type="button" onClick={regenerate} className="mt-3 h-10 rounded-xl bg-amber-900 px-4 font-semibold text-white dark:bg-amber-200 dark:text-amber-950">Try writing the notes again</button>}
        </div>
      )}

      <div className="sticky top-14 z-10 -mx-4 mt-4 bg-background/95 px-4 py-2 backdrop-blur lg:top-0" role="tablist" aria-label="Lecture views">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1">
          {[['notes', 'Notes', Sparkles], ['mine', 'My notes', NotebookPen], ['transcript', 'Transcript', FileText]].map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn('flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors',
                tab === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>
              <Icon className="h-4 w-4" aria-hidden="true" />{label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        {tab === 'notes' && (
          lecture.notes
            ? <NotesView lecture={lecture} onRegenerate={regenerate} busy={!!writing} />
            : <p className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
                {live ? 'Your notes are written when you stop recording.' : writing ? 'Writing…' : transcript
                  ? <button type="button" onClick={regenerate} className="h-11 rounded-xl bg-primary px-4 font-semibold text-primary-foreground">Write notes from the transcript</button>
                  : 'No transcript to make notes from.'}
              </p>
        )}
        {tab === 'mine' && <MyNotes lecture={lecture} live={!!live} onSave={(my_notes) => actions.updateLecture(id, { my_notes })} />}
        {tab === 'transcript' && <TranscriptView lecture={lecture} live={live} failed={failed} onRetry={lec.retryFailed} canRetry={lec.hasFailed} />}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lecture?</AlertDialogTitle>
            <AlertDialogDescription>Its transcript and notes go too. You can undo for a few seconds afterwards.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => { actions.deleteLecture(lecture); navigate('/Notes'); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TitleEditor({ lecture, onSave }) {
  const [value, setValue] = useState(lecture.title);
  useEffect(() => setValue(lecture.title), [lecture.title]);
  return (
    <input value={value} onChange={e => setValue(e.target.value)} aria-label="Lecture title"
      onBlur={() => { const v = value.trim(); if (v && v !== lecture.title) onSave(v); else setValue(lecture.title); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className="w-full rounded-lg bg-transparent px-0 text-2xl font-bold tracking-tight text-foreground outline-none focus:bg-secondary/50 focus:px-2" />
  );
}

function ClassPicker({ lecture, classes, onPick }) {
  return (
    <label className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
      <GraduationCap className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">Class</span>
      <select value={lecture.class_name || ''} onChange={e => onPick(classes.find(c => c.name === e.target.value) || null)}
        className="h-9 min-w-0 rounded-lg border bg-card px-2 text-base text-foreground sm:text-sm">
        <option value="">No class</option>
        {classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
      </select>
      <span className="truncate">· {relativeDay(lecture.date)}{lecture.duration ? ` · ${clock(lecture.duration)}` : ''}</span>
    </label>
  );
}

/* ---------------------------------------------------------- live recording */

function RecorderPanel({ live, lec }) {
  const bars = useLevelHistory(live.level, live.state === 'recording');
  const finishing = live.state === 'finishing';
  return (
    <section className="mt-4 rounded-3xl bg-slate-950 p-5 text-white" aria-label="Recording">
      <div className="flex items-center justify-between">
        <span className={cn('inline-flex items-center gap-2 text-sm font-semibold', live.state === 'recording' ? 'text-red-400' : 'text-slate-300')}>
          <span className={cn('h-2.5 w-2.5 rounded-full', live.state === 'recording' ? 'animate-pulse bg-red-500 motion-reduce:animate-none' : 'bg-slate-500')} />
          {finishing ? 'Finishing…' : live.state === 'paused' ? 'Paused' : 'Recording'}
        </span>
        <span className="text-xs text-slate-400" aria-live="polite">
          {live.queued ? `Transcribing ${live.queued} part${live.queued === 1 ? '' : 's'}…` : 'Transcript up to date'}
        </span>
      </div>
      <p className="mt-3 text-center text-5xl font-bold tabular-nums tracking-tight" role="timer">{clock(live.elapsed)}</p>
      <div className="mt-4 flex h-12 items-center justify-center gap-[3px]" aria-hidden="true">
        {bars.map((b, i) => <span key={i} className="w-1 rounded-full bg-gradient-to-t from-indigo-400 to-fuchsia-400" style={{ height: `${Math.max(6, b * 100)}%` }} />)}
      </div>
      <div className="mt-5 flex items-center justify-center gap-5">
        <button type="button" disabled={finishing} onClick={live.state === 'paused' ? lec.resume : lec.pause}
          aria-label={live.state === 'paused' ? 'Resume recording' : 'Pause recording'}
          className="grid h-14 w-14 place-items-center rounded-full bg-white/10 hover:bg-white/15 active:scale-95 disabled:opacity-40">
          {live.state === 'paused' ? <Play className="h-6 w-6 translate-x-0.5" /> : <Pause className="h-6 w-6" />}
        </button>
        <button type="button" disabled={finishing} onClick={lec.stop} aria-label="Stop and write notes"
          className="grid h-[72px] w-[72px] place-items-center rounded-full bg-red-600 shadow-lg shadow-red-600/30 hover:bg-red-500 active:scale-95 disabled:opacity-40">
          {finishing ? <Loader2 className="h-7 w-7 animate-spin" /> : <Square className="h-7 w-7 fill-current" />}
        </button>
        <span className="h-14 w-14" aria-hidden="true" />
      </div>
      <p className="mt-4 text-center text-xs leading-relaxed text-slate-400">
        Keep LOCK IN! open with the screen on — phones stop recording in the background. Type in “My notes” whenever something matters.
      </p>
      {live.failed > 0 && <p className="mt-2 text-center text-xs text-amber-300">{live.failed} part{live.failed === 1 ? '' : 's'} couldn't be transcribed yet — they'll be retried.</p>}
    </section>
  );
}

function useLevelHistory(level, on) {
  const [bars, setBars] = useState(() => Array(32).fill(0));
  const last = useRef(level);
  last.current = level;
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setBars(b => [...b.slice(1), last.current || 0]), 120);
    return () => clearInterval(t);
  }, [on]);
  return bars;
}

/* ------------------------------------------------------------- the views */

function MyNotes({ lecture, live, onSave }) {
  const [value, setValue] = useState(lecture.my_notes || '');
  const saveTimer = useRef(null);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setValue(lecture.my_notes || ''); }, [lecture.my_notes]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  const change = (v) => {
    setValue(v);
    dirty.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { onSave(v); dirty.current = false; }, 800);
  };
  return (
    <div>
      <label htmlFor="my-notes" className="sr-only">My notes</label>
      <textarea id="my-notes" value={value} onChange={e => change(e.target.value)} rows={12}
        placeholder={live ? 'Jot anything that matters: “exam q!”, a heading, a word to look up…' : 'Your own notes for this lecture.'}
        className="min-h-[50dvh] w-full resize-y rounded-2xl border bg-card p-4 text-base leading-relaxed text-foreground outline-none focus:border-indigo-400" />
      <p className="mt-2 text-xs text-muted-foreground">Saved as you type. When the notes are written, these are the outline they're built on.</p>
    </div>
  );
}

function TranscriptView({ lecture, live, failed, onRetry, canRetry }) {
  const end = useRef(null);
  const segs = (lecture.segments || []).filter(s => s.text || s.error);
  useEffect(() => { if (live) end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [segs.length, live]);
  if (!segs.length) {
    return <p className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
      {live ? 'The first lines appear about 30 seconds after you start.' : 'Nothing was transcribed.'}
    </p>;
  }
  return (
    <div className="rounded-2xl border bg-card p-4">
      {failed > 0 && canRetry && !live && (
        <button type="button" onClick={onRetry} className="mb-3 inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold">
          <RefreshCw className="h-4 w-4" />Retry {failed} missing part{failed === 1 ? '' : 's'}
        </button>
      )}
      <ol className="space-y-3">
        {segs.map(s => (
          <li key={s.start} className="flex gap-3">
            <span className="w-12 flex-none pt-0.5 text-xs tabular-nums text-muted-foreground">{clock(s.start)}</span>
            <p className={cn('text-base leading-relaxed', s.error ? 'italic text-muted-foreground' : 'text-foreground')}>
              {s.error ? 'This part couldn’t be transcribed.' : s.text}
            </p>
          </li>
        ))}
      </ol>
      <div ref={end} />
    </div>
  );
}

function NotesView({ lecture, onRegenerate, busy }) {
  const navigate = useNavigate();
  const { classes } = useStudyData();
  const actions = useActions();
  const n = lecture.notes;
  const [added, setAdded] = useState({});
  const md = notesMarkdown(n, { title: lecture.title, className: lecture.class_name, date: lecture.date });

  const copy = async () => {
    try { await navigator.clipboard.writeText(md); toast({ title: 'Notes copied' }); } catch (_) {
      toast({ title: 'Could not copy', variant: 'destructive' });
    }
  };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: lecture.title, text: md }); } catch (_) {} } else copy();
  };

  const addItem = async (a, i) => {
    // Only the date is taken from the parser; the title stays as the AI wrote it.
    const parsed = parseQuickAdd(`${a.kind === 'test' ? 'test ' : ''}x ${a.due || ''}`, { classes });
    const class_name = lecture.class_name || '';
    try {
      if (a.kind === 'test') await actions.addTest({ title: a.title, date: parsed.dueDate, class_name });
      else await actions.addHomework({ title: a.title, due_date: parsed.dueDate, class_name, priority: 'medium' });
      setAdded(x => ({ ...x, [i]: true }));
      toast({ title: `Added to your agenda`, description: a.title });
    } catch (_) { /* the action already showed why */ }
  };

  return (
    <article className="space-y-4">
      {n.summary && (
        <section className="rounded-2xl bg-accent p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-accent-foreground/80">Summary</h2>
          <p className="mt-1 text-base leading-relaxed text-foreground">{n.summary}</p>
        </section>
      )}

      {n.action_items?.length > 0 && (
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><ListChecks className="h-4 w-4" />Mentioned in class</h2>
          <ul className="mt-2 divide-y">
            {n.action_items.map((a, i) => (
              <li key={i} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-base text-foreground">{a.title}</span>
                  <span className="block text-xs capitalize text-muted-foreground">{a.kind}{a.due ? ` · ${a.due}` : ''}</span>
                </span>
                {a.kind !== 'reminder' && (
                  <button type="button" disabled={added[i]} onClick={() => addItem(a, i)} aria-label={`Add ${a.title} to your agenda`}
                    className="inline-flex h-10 flex-none items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold text-foreground hover:bg-secondary disabled:text-emerald-700">
                    {added[i] ? <><Check className="h-4 w-4" />Added</> : <><Plus className="h-4 w-4" />Add</>}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {n.sections?.map((s, i) => (
        <section key={i}>
          {s.heading && <h2 className="text-lg font-bold text-foreground">{s.heading}</h2>}
          <ul className="mt-1.5 list-disc space-y-1.5 pl-5 text-base leading-relaxed text-foreground marker:text-indigo-500">
            {s.points.map((p, j) => <li key={j}>{p}</li>)}
          </ul>
        </section>
      ))}

      {n.key_terms?.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-foreground">Key terms</h2>
          <dl className="mt-2 space-y-2">
            {n.key_terms.map((k, i) => (
              <div key={i} className="rounded-xl border bg-card p-3">
                <dt className="font-semibold text-foreground">{k.term}</dt>
                <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{k.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {n.review_questions?.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-foreground">Check yourself</h2>
          <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-base leading-relaxed text-foreground">
            {n.review_questions.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
        </section>
      )}

      <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4">
        <button type="button" onClick={() => navigate('/Study', { state: { tab: 'quiz', topic: lecture.title, notes: md } })}
          className="col-span-2 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground sm:col-span-1">
          <Brain className="h-4 w-4" />Quiz me
        </button>
        <button type="button" onClick={share} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold">
          <Share2 className="h-4 w-4" />Share
        </button>
        <button type="button" onClick={copy} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold">
          <Copy className="h-4 w-4" />Copy
        </button>
        <button type="button" onClick={onRegenerate} disabled={busy}
          className="col-span-2 inline-flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold disabled:opacity-50 sm:col-span-1">
          <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} />Rewrite
        </button>
      </div>
    </article>
  );
}

/* --------------------------------------------------------------- the sheet */

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 sm:items-center" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="max-h-[80dvh] w-full overflow-y-auto rounded-t-3xl bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl animate-in slide-in-from-bottom duration-200 sm:max-w-md sm:rounded-3xl">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted sm:hidden" aria-hidden="true" />
        <h2 className="mb-2 px-3 text-base font-bold text-foreground">{title}</h2>
        {children}
      </div>
    </div>
  );
}
