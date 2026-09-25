import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Plus, CalendarDays, Flag, GraduationCap, ClipboardList, CornerDownLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseQuickAdd } from '@/lib/quickadd';
import { shortDate, relativeDay } from '@/lib/dates';
import { useActions } from '@/lib/data';
import { toast } from '@/components/ui/use-toast';

const PRIORITIES = ['low', 'medium', 'high', 'asap'];
const PRIORITY_LABEL = { low: 'Low', medium: 'Normal', high: 'High', asap: 'ASAP' };

function Chip({ as: As = 'button', className, children, ...rest }) {
  return (
    <As
      {...(As === 'button' ? { type: 'button' } : {})}
      className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-secondary', className)}
      {...rest}
    >
      {children}
    </As>
  );
}

/**
 * One box for adding anything. Type the way you'd say it — "essay outline eng
 * fri !" — and the chips underneath show how it was read; click a chip to
 * change it. Enter saves and keeps the box focused for the next one.
 */
const QuickAdd = forwardRef(function QuickAdd({ classes = [] }, ref) {
  const act = useActions();
  const input = useRef(null);
  const dateInput = useRef(null);
  const [text, setText] = useState('');
  const [over, setOver] = useState({});      // what the user changed by hand
  const [saving, setSaving] = useState(false);

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));
  useEffect(() => { if (!text) setOver({}); }, [text]);

  const parsed = useMemo(() => parseQuickAdd(text, { classes }), [text, classes]);
  const kind = over.kind || parsed.kind;
  const classItem = over.className !== undefined
    ? classes.find(c => c.name === over.className) || null
    : parsed.classItem;
  const due = over.due || parsed.dueDate;
  const priority = over.priority || parsed.priority;
  let title = parsed.title;
  if (kind === 'test' && (!title || /^test$/i.test(title))) title = classItem ? `${classItem.name} test` : 'Test';
  const ambiguous = over.className === undefined && !parsed.classItem ? parsed.ambiguousClasses : [];
  // "math test" with Math 10 and Math 12: ask, don't guess.
  const ready = !!title.trim() && ambiguous.length === 0;

  const submit = async (e) => {
    e?.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    try {
      if (kind === 'test') {
        await act.addTest({ title, class_name: classItem?.name || '', date: due, notes: '' });
      } else {
        await act.addHomework({ title, class_name: classItem?.name || '', due_date: due, priority, description: '' });
      }
      toast({
        title: kind === 'test' ? `Added test "${title}"` : `Added "${title}"`,
        description: [classItem?.name, `${kind === 'test' ? 'on' : 'due'} ${relativeDay(due)}`].filter(Boolean).join(' · '),
      });
      setText('');
      input.current?.focus();
    } catch (_) { /* useActions showed the error */ } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border bg-card p-2 shadow-sm focus-within:border-indigo-300 dark:focus-within:border-indigo-700">
      <div className="flex items-center gap-2">
        <label htmlFor="quick-add" className="sr-only">Add homework or a test</label>
        <Plus className="ml-2 h-5 w-5 flex-none text-muted-foreground" aria-hidden="true" />
        <input
          id="quick-add"
          ref={input}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { setText(''); e.currentTarget.blur(); } }}
          autoComplete="off"
          placeholder='Add anything — "essay outline eng fri !" or "chem test oct 3"'
          className="h-11 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button type="submit" disabled={!ready || saving}
          className="inline-flex h-10 flex-none items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
          Add <CornerDownLeft className="hidden h-3.5 w-3.5 sm:block" aria-hidden="true" />
        </button>
      </div>

      {text.trim() ? (
        <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1 pt-2" aria-live="polite">
          <Chip onClick={() => setOver(o => ({ ...o, kind: kind === 'test' ? 'homework' : 'test' }))}
            title="Switch between homework and test"
            className={kind === 'test' ? 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-500/10 dark:text-rose-300' : ''}>
            {kind === 'test' ? <GraduationCap className="h-3.5 w-3.5" /> : <ClipboardList className="h-3.5 w-3.5" />}
            {kind === 'test' ? 'Test' : 'Homework'}
          </Chip>

          {classes.length > 0 && (
            <label className="relative inline-flex">
              <span className="sr-only">Class</span>
              <select
                value={classItem?.name || ''}
                onChange={e => setOver(o => ({ ...o, className: e.target.value }))}
                className={cn('h-8 appearance-none rounded-full border bg-background pl-7 pr-3 text-xs font-medium text-foreground hover:bg-secondary',
                  ambiguous.length && 'border-amber-400 dark:border-amber-600')}
              >
                <option value="">{ambiguous.length ? 'Which class?' : 'No class'}</option>
                {classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <span className={cn('pointer-events-none absolute left-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full', classItem?.color || 'bg-slate-300 dark:bg-slate-600')} />
            </label>
          )}
          {ambiguous.map(c => (
            <Chip key={c.id || c.name} onClick={() => setOver(o => ({ ...o, className: c.name }))}
              className="border-dashed border-amber-400 text-amber-800 dark:border-amber-600 dark:text-amber-300">
              {c.name}?
            </Chip>
          ))}

          <Chip onClick={() => (dateInput.current?.showPicker ? dateInput.current.showPicker() : dateInput.current?.focus())}
            title="Change the date" className="relative">
            <CalendarDays className="h-3.5 w-3.5" />
            {kind === 'test' ? '' : 'Due '}{relativeDay(due)}
            <span className="text-muted-foreground">· {shortDate(due)}</span>
            <input ref={dateInput} type="date" value={due} tabIndex={-1} aria-hidden="true"
              onChange={e => e.target.value && setOver(o => ({ ...o, due: e.target.value }))}
              className="pointer-events-none absolute inset-0 opacity-0" />
          </Chip>

          {kind === 'homework' && (
            <Chip onClick={() => setOver(o => ({ ...o, priority: PRIORITIES[(PRIORITIES.indexOf(priority) + 1) % PRIORITIES.length] }))}
              title="Change priority"
              className={cn(priority === 'asap' && 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-400',
                priority === 'high' && 'border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-400')}>
              <Flag className="h-3.5 w-3.5" />{PRIORITY_LABEL[priority]}
            </Chip>
          )}
          <span className="ml-auto hidden pr-1 text-xs text-muted-foreground sm:inline">
            {ready ? <>Saving as <strong className="font-semibold text-foreground">{title}</strong></> : ambiguous.length ? 'Which class did you mean?' : 'Type a title too'}
          </span>
        </div>
      ) : (
        <p className="px-3 pb-1 pt-1.5 text-xs text-muted-foreground">
          Dates like <em>fri</em>, <em>tmr</em>, <em>sep 30</em> · <em>!</em> for high priority, <em>!!!</em> for ASAP · the word <em>test</em> makes it a test · press <kbd className="rounded border px-1">N</kbd> from anywhere
        </p>
      )}
    </form>
  );
});

export default QuickAdd;
