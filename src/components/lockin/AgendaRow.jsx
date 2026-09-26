import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, GraduationCap, MoreHorizontal, Play, Wand2, Loader2, Flag, Pencil, Trash2, CalendarPlus, ListChecks, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { relativeDay, daysUntil, parseDay, ymd, addDays } from '@/lib/dates';
import { stepProgress } from '@/lib/shredder';
import { formatMinutes } from '@/lib/agenda';
import { useActions } from '@/lib/data';
import { useFocus } from '@/lib/FocusContext';
import { toast } from '@/components/ui/use-toast';
import StepList from './StepList';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const PRIORITY = {
  asap: { label: 'ASAP', cls: 'text-red-700 dark:text-red-400' },
  high: { label: 'High', cls: 'text-amber-700 dark:text-amber-400' },
};

export function breakDownToast(r) {
  toast({
    title: `${r.steps.length} steps`,
    description: r.source === 'ai'
      ? 'Broken down by the AI. Edit anything that doesn\'t fit.'
      : `Used a ready-made checklist — ${r.reason || 'the AI was unavailable.'}`,
  });
}

/**
 * One homework item or test. Everything you'd do to it is on the row:
 * tick it off, focus on it, break it into steps, or the ⋯ menu for the rest.
 * The old app needed an edit dialog for all of it.
 */
export default function AgendaRow({ entry, classes = [], onEdit, showDay = true }) {
  const { kind, item } = entry;
  const isTest = kind === 'test';
  const act = useActions();
  const focus = useFocus();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const cls = classes.find(c => c.name === item.class_name);
  const day = isTest ? item.date : item.due_date;
  const d = parseDay(day);
  const n = d ? daysUntil(d) : null;
  const overdue = !isTest && !item.is_completed && n != null && n < 0;
  const steps = item.steps || [];
  const prog = stepProgress(steps);
  const pr = PRIORITY[item.priority];
  const isCurrent = focus.task?.id === item.id && focus.status !== 'idle';

  const lockIn = () => {
    focus.lockIn({ type: kind, id: item.id });
    focus.openFocus();
  };

  const breakDown = async () => {
    setBusy(true);
    try {
      const r = await act.breakDown(item);
      setOpen(true);
      breakDownToast(r);
    } catch (_) { /* toast already shown */ } finally { setBusy(false); }
  };

  return (
    <li className={cn('rounded-xl border bg-card transition-shadow duration-150 hover:shadow-sm',
      isCurrent && 'border-indigo-300 ring-1 ring-indigo-300 dark:border-indigo-700 dark:ring-indigo-700')}>
      <div className="flex items-start gap-3 p-3 sm:p-3.5">
        {isTest ? (
          <span className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-md bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" title="Test">
            <GraduationCap className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : (
          <button
            type="button"
            role="checkbox"
            aria-checked={!!item.is_completed}
            aria-label={item.is_completed ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
            onClick={() => act.toggleHomework(item)}
            className="-m-2.5 grid h-11 w-11 flex-none place-items-center rounded-lg"
          >
            <span className={cn('grid h-6 w-6 place-items-center rounded-md border-2 transition-colors duration-150',
              item.is_completed ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 hover:border-indigo-500 dark:border-slate-600')}>
              {item.is_completed && <Check className="h-4 w-4" strokeWidth={3} />}
            </span>
          </button>
        )}

        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => (isTest ? onEdit?.(entry) : setOpen(o => !o))}
            className={cn('block max-w-full text-left text-[15px] font-medium leading-6',
              item.is_completed ? 'text-muted-foreground line-through' : 'text-foreground')}
            aria-expanded={isTest ? undefined : open}>
            {isTest && !/\b(test|exam|quiz|midterm|final)s?\b/i.test(item.title) && (
              <span className="mr-1.5 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">Test</span>
            )}
            {item.title}
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {item.class_name && (
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', cls?.color || 'bg-slate-400')} aria-hidden="true" />
                {item.class_name}
              </span>
            )}
            {showDay && day && (
              <span className={cn(overdue && 'font-semibold text-red-700 dark:text-red-400')}>
                {overdue ? `Overdue · ${relativeDay(day)}` : `${isTest ? '' : 'Due '}${relativeDay(day)}`}
              </span>
            )}
            {pr && !item.is_completed && (
              <span className={cn('inline-flex items-center gap-1 font-semibold', pr.cls)}>
                <Flag className="h-3 w-3" aria-hidden="true" />{pr.label}
              </span>
            )}
            {prog.total > 0 && (
              <button type="button" onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1 hover:text-foreground">
                <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />{prog.done}/{prog.total} steps
                <ChevronDown className={cn('h-3 w-3 transition-transform duration-150', open && 'rotate-180')} aria-hidden="true" />
              </button>
            )}
            {item.focus_minutes > 0 && <span>{formatMinutes(item.focus_minutes)} focused</span>}
          </div>
        </div>

        <div className="flex flex-none items-center gap-1">
          {!item.is_completed && (
            <button type="button" onClick={lockIn}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium text-foreground hover:border-indigo-300 hover:bg-accent hover:text-accent-foreground"
              aria-label={`${isTest ? 'Study for' : 'Focus on'} "${item.title}"`}>
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{isTest ? 'Study' : 'Focus'}</span>
            </button>
          )}
          {!isTest && !item.is_completed && prog.total === 0 && (
            <button type="button" onClick={breakDown} disabled={busy} title="Break it into steps"
              className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60"
              aria-label={`Break "${item.title}" into steps`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label={`More for "${item.title}"`}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => onEdit?.(entry)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
              {!isTest && !item.is_completed && (
                <DropdownMenuItem onSelect={() => act.updateHomework(item.id, { due_date: ymd(addDays(new Date(), 1)) })}>
                  <CalendarPlus className="mr-2 h-4 w-4" />Move to tomorrow
                </DropdownMenuItem>
              )}
              {!isTest && (
                <DropdownMenuItem onSelect={breakDown}><Wand2 className="mr-2 h-4 w-4" />{prog.total ? 'Redo steps' : 'Break it down'}</DropdownMenuItem>
              )}
              {isTest && (
                <DropdownMenuItem onSelect={() => navigate('/Study', { state: { tab: 'quiz', testId: item.id } })}>
                  <Brain className="mr-2 h-4 w-4" />Quiz me on this
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => (isTest ? act.deleteTest(item) : act.deleteHomework(item))}
                className="text-red-700 focus:text-red-700 dark:text-red-400">
                <Trash2 className="mr-2 h-4 w-4" />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!isTest && open && (
        <div className="border-t px-3 pb-3 pt-2 sm:px-3.5">
          {item.description && <p className="mb-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.description}</p>}
          <StepList steps={steps} onChange={s => act.setSteps(item, s)} onRedo={breakDown} redoing={busy} />
        </div>
      )}
    </li>
  );
}
