import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Mic, Pause, Play, Square, ChevronLeft, ChevronDown, Loader2, Sparkles, Trash2, Copy, Share2, Brain, Plus, Check,
  AlertTriangle, FileText, RefreshCw, Folder, Layers, Presentation, X, MoreHorizontal, NotebookPen,
} from 'lucide-react';
import { MathLine } from '@/components/lockin/RichText';
import NoteGraph from '@/components/lockin/NoteGraph';
import RichText from '@/components/lockin/RichText';
import Sheet from '@/components/lockin/Sheet';
import { SourcePicker, preferredSource } from '@/components/lockin/DesktopShell';
import { isDesktop } from '@/lib/desktop';
import { NOTE_TEMPLATES } from '@/lib/classChat';
import { cn } from '@/lib/utils';
import { useStudyData, useActions } from '@/lib/data';
import { useLecture } from '@/lib/LectureContext';
import { clock, notesMarkdown, transcriptText } from '@/lib/lectures';
import { relativeDay, parseDay } from '@/lib/dates';
import { parseQuickAdd } from '@/lib/quickadd';
import { toast } from '@/components/ui/use-toast';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Lectures and their notes, laid out like Granola: a list grouped by class (or
 * by day), and one page per lecture with no tabs. While a class records, the
 * page is a place to type your own notes, with the transcript a tap away;
 * afterwards the AI writes the notes (or enhances yours). Questions about the
 * lecture go in the assistant bar at the bottom, which knows which lecture
 * this is, and works from any page while it records.
 */
export default function Notes() {
  const location = useLocation();
  const id = new URLSearchParams(location.search).get('id');
  return id ? <LectureView id={id} /> : <LectureList />;
}

/* ===================================================================== list */

const GROUP_KEY = 'lockin.notes.group';
const FOLD_KEY = 'lockin.notes.folded';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* fine */ } };

function dayLabel(day) {
  const d = parseDay(day);
  if (!d) return 'Earlier';
  const r = relativeDay(day);
  if (r === 'Today' || r === 'Yesterday') return r;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function LectureList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { lectures, classes, isLoading } = useStudyData();
  const lec = useLecture();
  const [group, setGroup] = useState(() => read(GROUP_KEY, 'class'));
  const [folded, setFolded] = useState(() => read(FOLD_KEY, {}));
  const [picking, setPicking] = useState(false);
  const [source, setSource] = useState(preferredSource);
  const focusClass = location.state?.className || '';

  useEffect(() => write(GROUP_KEY, group), [group]);
  useEffect(() => write(FOLD_KEY, folded), [folded]);

  const groups = useMemo(() => {
    const byNew = [...lectures].sort((a, b) => String(b.started_at || b.date || '').localeCompare(String(a.started_at || a.date || '')));
    const out = new Map();
    for (const l of byNew) {
      const key = group === 'class' ? (l.class_name || '') : (l.date || '');
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(l);
    }
    return [...out.entries()].map(([key, items]) => ({ key, items }));
  }, [lectures, group]);

  const record = async (c) => {
    setPicking(false);
    try { await lec.start({ className: c?.name || '', classId: c?.id || '', source: isDesktop ? source : 'mic' }); } catch (e) {
      toast({ title: 'Could not start recording', description: e.message, variant: 'destructive' });
    }
  };
  const classOf = (name) => classes.find(c => c.name === name);

  return (
    <div className="mx-auto max-w-3xl px-4 pt-5 sm:px-6 lg:pt-8">
      <header className="mb-4 flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Notes</h1>
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label="Group notes">
          {[['class', 'By class'], ['date', 'By date']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setGroup(k)} aria-pressed={group === k}
              className={cn('h-8 rounded-md px-2.5 text-xs font-medium', group === k ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
          ))}
        </div>
      </header>

      {lec.active ? (
        <button type="button" onClick={() => navigate(`/Notes?id=${lec.active.id}`)}
          className="flex w-full items-center gap-3 rounded-2xl bg-red-600 p-3.5 text-left text-white shadow-lg shadow-red-600/20 active:scale-[0.99]">
          <span className="relative grid h-10 w-10 flex-none place-items-center rounded-full bg-white/15">
            <span className="absolute h-3 w-3 animate-ping rounded-full bg-white/70 motion-reduce:animate-none" />
            <Mic className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="flex-1 text-base font-bold">Recording · {clock(lec.active.elapsed)}</span>
        </button>
      ) : (
        <button type="button" onClick={() => (classes.length || isDesktop ? setPicking(true) : record(null))} disabled={!lec.canRecord}
          className="flex w-full items-center gap-3 rounded-2xl bg-primary p-3.5 text-left text-primary-foreground shadow-lg shadow-primary/20 active:scale-[0.99] disabled:opacity-50">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-white/15"><Mic className="h-5 w-5" aria-hidden="true" /></span>
          <span className="flex-1 text-base font-bold">{lec.canRecord ? 'Record a lecture' : 'This browser can’t record'}</span>
        </button>
      )}
      {lec.error && <p className="mt-2 text-sm text-red-700 dark:text-red-400" role="alert">{lec.error}</p>}

      <section className="mt-6 space-y-6" aria-label="Notes">
        {isLoading ? null : groups.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">No notes yet</p>
        ) : groups.map(({ key, items }) => {
          const c = group === 'class' ? classOf(key) : null;
          const open = group === 'date' || !folded[key] || key === focusClass;
          const label = group === 'class' ? (key || 'No class') : dayLabel(key);
          return (
            <div key={key || '-'}>
              <div className="mb-1.5 flex items-center gap-2">
                {group === 'class' ? (
                  <button type="button" onClick={() => setFolded(f => ({ ...f, [key]: open }))} aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold text-foreground">
                    <ChevronDown className={cn('h-4 w-4 flex-none text-muted-foreground transition-transform', !open && '-rotate-90')} aria-hidden="true" />
                    {c ? <span className={cn('h-2.5 w-2.5 flex-none rounded-full', c.color || 'bg-indigo-500')} aria-hidden="true" /> : <Folder className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />}
                    <span className="truncate">{label}</span>
                    <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
                  </button>
                ) : (
                  <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>
                )}
                {group === 'class' && key && (
                  <button type="button" onClick={() => navigate('/Study', { state: { tab: 'quiz', className: key } })}
                    className="inline-flex h-8 flex-none items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
                    <Brain className="h-3.5 w-3.5" aria-hidden="true" />Quiz
                  </button>
                )}
              </div>
              {open && (
                <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                  {items.map(l => <LectureRow key={l.id} lecture={l} showClass={group === 'date'} onOpen={() => navigate(`/Notes?id=${l.id}`)} />)}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      {picking && (
        <Sheet title={isDesktop ? 'What are you recording?' : 'Which class?'} onClose={() => setPicking(false)}>
          <SourcePicker value={source} onChange={setSource} className="mb-3" />
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
                <span className="h-3 w-3 flex-none rounded-full border" aria-hidden="true" />No class
              </button>
            </li>
          </ul>
        </Sheet>
      )}
    </div>
  );
}

const STATUS = {
  recording: ['Recording', 'text-red-700 dark:text-red-400'],
  transcribing: ['Finishing', 'text-amber-700 dark:text-amber-400'],
  writing: ['Writing notes', 'text-primary'],
};

function LectureRow({ lecture: l, onOpen, showClass }) {
  const [label, color] = STATUS[l.status] || ['', ''];
  const meta = [showClass ? l.class_name : relativeDay(l.date), l.duration ? `${Math.max(1, Math.round(l.duration / 60))} min` : null].filter(Boolean).join(' · ');
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-secondary/60 active:bg-secondary">
        <FileText className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-foreground">{l.title}</span>
        {label
          ? <span className={cn('flex-none text-xs font-semibold', color)}>{label}</span>
          : <span className="flex-none text-xs text-muted-foreground">{meta}</span>}
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
  const [view, setView] = useState('ai');            // 'ai' | 'mine', once there are AI notes
  const [showTranscript, setShowTranscript] = useState(false);
  const [slidesOpen, setSlidesOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Ctrl/Cmd+Shift+K in the desktop app ("catch me up") goes to the assistant bar.
  useEffect(() => {
    const on = () => window.dispatchEvent(new CustomEvent('lockin:ask', { detail: 'Catch me up on what was just said' }));
    window.addEventListener('lockin:quickask', on);
    return () => window.removeEventListener('lockin:quickask', on);
  }, []);

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
  const hasNotes = !!lecture.notes;
  const material = lecture.source === 'material';
  const mine = (lecture.my_notes || '').trim();
  const slides = lecture.slides || [];
  const canWrite = !!(transcript || mine || material || slides.length);

  const generate = async () => {
    try { await lec.writeNotes(lecture); setView('ai'); } catch (e) {
      toast({ title: 'Could not write the notes', description: e.message, variant: 'destructive' });
    }
  };

  const transcriptPanel = <TranscriptView lecture={lecture} live={live} failed={failed} lec={lec} />;

  return (
    <div className={cn('mx-auto px-4 pt-3 sm:px-6 lg:pt-6', showTranscript ? 'max-w-6xl' : 'max-w-3xl')}>
      <div className="mb-1 flex items-center gap-1">
        <button type="button" onClick={() => navigate('/Notes')} aria-label="All notes"
          className="-ml-2 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <div className="min-w-0 flex-1" />
        <button type="button" onClick={() => setSlidesOpen(true)}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
          <Presentation className="h-4 w-4" aria-hidden="true" />Slides{slides.length ? ` · ${slides.length}` : ''}
        </button>
        {!material && (
          <button type="button" onClick={() => setShowTranscript(v => !v)} aria-pressed={showTranscript}
            className={cn('inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium hover:bg-secondary', showTranscript ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            <FileText className="h-4 w-4" aria-hidden="true" />Transcript
          </button>
        )}
        {!live && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More" className="grid h-10 w-10 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"><MoreHorizontal className="h-5 w-5" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {hasNotes && <DropdownMenuItem onSelect={() => copyNotes(lecture)}><Copy className="mr-2 h-4 w-4" />Copy notes</DropdownMenuItem>}
              {hasNotes && <DropdownMenuItem onSelect={() => shareNotes(lecture)}><Share2 className="mr-2 h-4 w-4" />Share</DropdownMenuItem>}
              {hasNotes && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-red-700 focus:text-red-700 dark:text-red-400"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className={cn(showTranscript && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-6')}>
        <div className="min-w-0">
          <TitleEditor lecture={lecture} onSave={(title) => actions.updateLecture(id, { title, auto_title: false })} />
          <ClassPicker lecture={lecture} classes={classes} onPick={(c) => actions.updateLecture(id, { class_name: c?.name || '', class_id: c?.id || '' })} />

          {live && <RecorderBar live={live} lec={lec} lecture={lecture} />}

          {!live && (lecture.status === 'transcribing' || writing) && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl border bg-card p-3.5 text-sm text-foreground" role="status">
              <Loader2 className="h-5 w-5 flex-none animate-spin text-primary" />
              {writing || 'Finishing the transcript…'}
            </div>
          )}
          {!live && !writing && lecture.notes_error && !hasNotes && (
            <p className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-200" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />{lecture.notes_error}
            </p>
          )}

          {hasNotes && !live && (
            <div className="mt-4 inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label="Which notes">
              {[['ai', 'AI notes', Sparkles], ['mine', 'My notes', NotebookPen]].map(([k, label, Icon]) => (
                <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k}
                  className={cn('inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium', view === k ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  <Icon className="h-4 w-4" aria-hidden="true" />{label}
                </button>
              ))}
            </div>
          )}

          <div className="mt-4">
            {hasNotes && !live && view === 'ai'
              ? <NotesView lecture={lecture} onRegenerate={generate} busy={!!writing} onTemplate={(template) => actions.updateLecture(id, { template })} />
              : material && !hasNotes
                ? <div className="rounded-2xl border bg-card p-4"><RichText text={lecture.material_text || ''} /></div>
                : <MyNotes lecture={lecture} live={!!live} onSave={(my_notes) => actions.updateLecture(id, { my_notes })} />}
          </div>

          {!hasNotes && !live && !writing && canWrite && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={generate}
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90">
                <Sparkles className="h-4 w-4" aria-hidden="true" />{mine ? 'Enhance my notes' : 'Generate notes'}
              </button>
              <TemplatePicker value={lecture.template} onChange={(template) => actions.updateLecture(id, { template })} />
            </div>
          )}
        </div>

        {showTranscript && (
          <>
            <aside className="mt-6 hidden lg:block" aria-label="Transcript">
              <div className="sticky top-6 max-h-[calc(100dvh-9rem)] overflow-y-auto">{transcriptPanel}</div>
            </aside>
            <div className="lg:hidden">
              <Sheet title="Transcript" onClose={() => setShowTranscript(false)} wide>{transcriptPanel}</Sheet>
            </div>
          </>
        )}
      </div>

      {slidesOpen && <SlidesSheet lecture={lecture} lec={lec} onClose={() => setSlidesOpen(false)} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lecture?</AlertDialogTitle>
            <AlertDialogDescription>Its transcript and notes go too. You can undo for a few seconds.</AlertDialogDescription>
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

async function copyNotes(lecture) {
  const md = notesMarkdown(lecture.notes, { title: lecture.title, className: lecture.class_name, date: lecture.date });
  try { await navigator.clipboard.writeText(md); toast({ title: 'Notes copied' }); } catch (_) { toast({ title: 'Could not copy', variant: 'destructive' }); }
}
async function shareNotes(lecture) {
  const md = notesMarkdown(lecture.notes, { title: lecture.title, className: lecture.class_name, date: lecture.date });
  if (navigator.share) { try { await navigator.share({ title: lecture.title, text: md }); } catch (_) { /* cancelled */ } } else copyNotes(lecture);
}

function TitleEditor({ lecture, onSave }) {
  const [value, setValue] = useState(lecture.title);
  useEffect(() => setValue(lecture.title), [lecture.title]);
  return (
    <input value={value} onChange={e => setValue(e.target.value)} aria-label="Lecture title"
      onBlur={() => { const v = value.trim(); if (v && v !== lecture.title) onSave(v); else setValue(lecture.title); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className="w-full rounded-lg bg-transparent px-0 text-2xl font-bold tracking-tight text-foreground outline-none focus:bg-secondary/50 focus:px-2 sm:text-3xl" />
  );
}

function ClassPicker({ lecture, classes, onPick }) {
  return (
    <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
      <label className="sr-only" htmlFor="lec-class">Class</label>
      <select id="lec-class" value={lecture.class_name || ''} onChange={e => onPick(classes.find(c => c.name === e.target.value) || null)}
        className="h-8 min-w-0 rounded-lg border-0 bg-secondary px-2 text-sm text-foreground">
        <option value="">No class</option>
        {classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
      </select>
      <span className="truncate">{relativeDay(lecture.date)}{lecture.duration ? ` · ${clock(lecture.duration)}` : ''}</span>
    </div>
  );
}

/* ---------------------------------------------------------- live recording */

function RecorderBar({ live, lec, lecture }) {
  const bars = useLevelHistory(live.level, live.state === 'recording');
  const finishing = live.state === 'finishing';
  const lastError = [...(lecture.segments || [])].reverse().find(x => x.error)?.error;
  return (
    <section className="sticky top-14 z-10 mt-4 rounded-2xl border bg-card/95 p-2.5 backdrop-blur lg:top-2" aria-label="Recording">
      <div className="flex items-center gap-3">
        <span className={cn('ml-1 h-2.5 w-2.5 flex-none rounded-full', live.state === 'recording' ? 'animate-pulse bg-red-500 motion-reduce:animate-none' : 'bg-muted-foreground')} aria-hidden="true" />
        <span className="w-20 flex-none text-xl font-bold tabular-nums tracking-tight text-foreground" role="timer">{clock(live.elapsed)}</span>
        <div className="flex h-8 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden" aria-hidden="true">
          {bars.map((b, i) => <span key={i} className="w-1 flex-none rounded-full bg-primary/70" style={{ height: `${Math.max(8, b * 100)}%` }} />)}
        </div>
        <button type="button" disabled={finishing} onClick={live.state === 'paused' ? lec.resume : lec.pause}
          aria-label={live.state === 'paused' ? 'Resume recording' : 'Pause recording'}
          className="grid h-11 w-11 flex-none place-items-center rounded-full bg-secondary hover:bg-secondary/80 active:scale-95 disabled:opacity-40">
          {live.state === 'paused' ? <Play className="h-5 w-5 translate-x-0.5" /> : <Pause className="h-5 w-5" />}
        </button>
        <button type="button" disabled={finishing} onClick={lec.stop} aria-label="Stop recording"
          className="grid h-11 w-11 flex-none place-items-center rounded-full bg-red-600 text-white hover:bg-red-500 active:scale-95 disabled:opacity-40">
          {finishing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Square className="h-5 w-5 fill-current" />}
        </button>
      </div>
      {live.failed > 0 && (
        <p className="mt-2 px-1 text-xs text-amber-700 dark:text-amber-300" role="status">
          {live.failed} part{live.failed === 1 ? '' : 's'} not transcribed yet{lastError ? ` (${lastError})` : ''}. Retrying.
        </p>
      )}
    </section>
  );
}

function useLevelHistory(level, on) {
  const [bars, setBars] = useState(() => Array(28).fill(0));
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
    <>
      <label htmlFor="my-notes" className="sr-only">My notes</label>
      <textarea id="my-notes" value={value} onChange={e => change(e.target.value)} rows={14} autoFocus={live}
        placeholder={live ? 'Write notes…' : 'My notes'}
        className="min-h-[45dvh] w-full resize-y rounded-2xl border-0 bg-transparent p-1 text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70" />
    </>
  );
}

function TranscriptView({ lecture, live, failed, lec }) {
  const end = useRef(null);
  const segs = (lecture.segments || []).filter(s => s.text || s.error);
  const [pending, setPending] = useState(0);
  const retrying = lec.retrying[lecture.id];
  useEffect(() => { if (live) end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [segs.length, live]);
  useEffect(() => { let on = true; lec.pendingCount(lecture.id).then(n => on && setPending(n)); return () => { on = false; }; },
    [lecture.id, failed, retrying]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = async () => {
    const r = await lec.retryFailed(lecture.id);
    if (r.error) toast({ title: r.done ? `Got ${r.done} more, then it stopped` : 'Still can’t transcribe', description: r.error, variant: 'destructive' });
    else if (r.done) toast({ title: `Transcribed ${r.done} more part${r.done === 1 ? '' : 's'}` });
  };
  if (!segs.length) {
    return <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      {live ? (live.queued ? 'Transcribing…' : 'Lines appear here as you record') : 'No transcript'}
    </p>;
  }
  return (
    <div className="rounded-2xl border bg-card p-4">
      {failed > 0 && !live && pending > 0 && (
        <button type="button" onClick={retry} disabled={!!retrying}
          className="mb-3 inline-flex h-10 items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 text-sm font-semibold text-amber-900 disabled:opacity-60 dark:text-amber-200">
          <RefreshCw className={cn('h-4 w-4', retrying && 'animate-spin')} />
          {retrying ? `Transcribing ${retrying.done} of ${retrying.total}…` : `Retry ${pending} missing part${pending === 1 ? '' : 's'}`}
        </button>
      )}
      <ol className="space-y-3">
        {segs.map(s => (
          <li key={s.start} className="flex gap-3">
            <span className="w-10 flex-none pt-0.5 text-xs tabular-nums text-muted-foreground">{clock(s.start)}</span>
            <p className={cn('text-sm leading-relaxed', s.error ? 'italic text-muted-foreground' : 'text-foreground')}>{s.error ? 'Not transcribed yet' : s.text}</p>
          </li>
        ))}
      </ol>
      <div ref={end} />
    </div>
  );
}

function TemplatePicker({ value, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <span className="sr-only">Style</span>
      <select value={value || 'lecture'} onChange={e => onChange(e.target.value)}
        className="h-12 rounded-xl border bg-card px-3 text-sm text-foreground">
        {NOTE_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
    </label>
  );
}

function SlidesSheet({ lecture, lec, onClose }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const input = useRef(null);
  const slides = lecture.slides || [];
  const add = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setError('');
    try { await lec.addSlides(lecture, files, setBusy); } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const count = (d) => (d.text.match(/^Slide \d+/gm) || []).length;
  return (
    <Sheet title="Slides" onClose={busy ? () => {} : onClose}>
      <div className="space-y-3 px-3 pb-2">
        {slides.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {slides.map((d, i) => (
              <li key={`${d.name}${i}`} className="flex items-center gap-3 px-3 py-2.5">
                <Presentation className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{d.name || 'Slides'}</span>
                {count(d) > 0 && <span className="flex-none text-xs text-muted-foreground">{count(d)} slides</span>}
                <button type="button" onClick={() => lec.removeSlides(lecture, i)} aria-label={`Remove ${d.name}`}
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-red-700"><X className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <input ref={input} type="file" hidden multiple accept="application/pdf,image/*" onChange={add} />
        <button type="button" onClick={() => input.current?.click()} disabled={!!busy}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" />{busy}</> : <><Plus className="h-4 w-4" />Add slides</>}
        </button>
        {error && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
        <p className="text-xs text-muted-foreground">PDF or photos, up to 4 MB each.</p>
      </div>
    </Sheet>
  );
}

function NotesView({ lecture, onRegenerate, busy, onTemplate }) {
  const navigate = useNavigate();
  const { classes } = useStudyData();
  const actions = useActions();
  const n = lecture.notes;
  const [added, setAdded] = useState({});
  const md = notesMarkdown(n, { title: lecture.title, className: lecture.class_name, date: lecture.date });

  const addItem = async (a, i) => {
    // Only the date is taken from the parser; the title stays as the AI wrote it.
    const parsed = parseQuickAdd(`${a.kind === 'test' ? 'test ' : ''}x ${a.due || ''}`, { classes });
    const class_name = lecture.class_name || '';
    try {
      if (a.kind === 'test') await actions.addTest({ title: a.title, date: parsed.dueDate, class_name });
      else await actions.addHomework({ title: a.title, due_date: parsed.dueDate, class_name, priority: 'medium' });
      setAdded(x => ({ ...x, [i]: true }));
      toast({ title: 'Added to your agenda', description: a.title });
    } catch (_) { /* the action already showed why */ }
  };

  return (
    <article className="space-y-5">
      {n.warning && <p role="note" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">{n.warning}</p>}
      {n.summary && <p className="text-base leading-relaxed text-foreground"><MathLine text={n.summary} /></p>}

      {n.action_items?.length > 0 && (
        <section className="rounded-2xl border bg-card p-3.5">
          <ul className="divide-y">
            {n.action_items.map((a, i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{a.title}</span>
                  <span className="block text-xs capitalize text-muted-foreground">{a.kind}{a.due ? ` · ${a.due}` : ''}</span>
                </span>
                {a.kind !== 'reminder' && (
                  <button type="button" disabled={added[i]} onClick={() => addItem(a, i)} aria-label={`Add ${a.title} to your agenda`}
                    className="inline-flex h-9 flex-none items-center gap-1.5 rounded-lg border px-3 text-sm font-medium text-foreground hover:bg-secondary disabled:text-emerald-700">
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
          {s.heading && <h2 className="text-lg font-bold text-foreground"><MathLine text={s.heading} /></h2>}
          <ul className="mt-1.5 list-disc space-y-1.5 pl-5 text-base leading-relaxed text-foreground marker:text-primary">
            {s.points.map((p, j) => <li key={j} className={cn(/^\s*Beyond the lecture:/i.test(p) && 'text-muted-foreground')}><MathLine text={p} /></li>)}
          </ul>
          {s.graph && <NoteGraph graph={s.graph} />}
        </section>
      ))}

      {n.key_terms?.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-foreground">Key terms</h2>
          <dl className="mt-2 divide-y rounded-2xl border bg-card">
            {n.key_terms.map((k, i) => (
              <div key={i} className="p-3">
                <dt className="font-semibold text-foreground"><MathLine text={k.term} /></dt>
                <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground"><MathLine text={k.definition} /></dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {n.review_questions?.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-foreground">Check yourself</h2>
          <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-base leading-relaxed text-foreground">
            {n.review_questions.map((q, i) => <li key={i}><MathLine text={q} /></li>)}
          </ol>
        </section>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={() => navigate('/Study', { state: { tab: 'quiz', topic: lecture.title, notes: md } })}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          <Brain className="h-4 w-4" />Quiz me
        </button>
        <button type="button" onClick={() => navigate('/Study', { state: { tab: 'cards', topic: lecture.title, notes: md, lectureId: lecture.id } })}
          className="inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold text-foreground hover:bg-secondary">
          <Layers className="h-4 w-4" />Flashcards
        </button>
        <div className="ml-auto flex items-center gap-2">
          <TemplatePicker value={lecture.template} onChange={onTemplate} />
          <button type="button" onClick={onRegenerate} disabled={busy} aria-label="Rewrite the notes in this style" title="Rewrite"
            className="grid h-12 w-12 place-items-center rounded-xl border text-foreground hover:bg-secondary disabled:opacity-50">
            <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} />
          </button>
        </div>
      </div>
    </article>
  );
}
