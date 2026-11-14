import React from 'react';
import { Target, Upload, Trash2, Clock } from 'lucide-react';
import { format } from 'date-fns';

const ICON = { quiz: Target, grading: Upload };

/** Past quizzes and homework feedback: open one again, or delete it. A plain list in one card. */
export default function StudyHistorySidebar({ history = [], onSelectItem, onDeleteItem, activeType, isLoading }) {
  const items = activeType === 'all' ? history : history.filter(h => h.type === activeType);
  return (
    <section className="overflow-hidden rounded-2xl border bg-card xl:sticky xl:top-8" aria-labelledby="history-h">
      <h2 id="history-h" className="px-5 pb-1 pt-4 text-base font-semibold tracking-tight text-foreground">History</h2>
      {isLoading ? (
        <p className="px-5 pb-5 pt-2 text-sm text-muted-foreground" role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p className="px-5 pb-5 pt-2 text-sm text-muted-foreground">Nothing yet. Quizzes you take and feedback you get are kept here.</p>
      ) : (
        <ul className="max-h-[28rem] divide-y divide-border/60 overflow-y-auto">
          {items.map((item) => {
            const Icon = ICON[item.type] || Clock;
            return (
              <li key={item.id} className="group flex items-center hover:bg-accent/30">
                <button type="button" onClick={() => onSelectItem(item)} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-5 pr-1 text-left">
                  <Icon className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                      {format(new Date(item.created_date), 'MMM d, h:mm a')}{item.score ? ` · ${item.score}` : ''}
                    </span>
                  </span>
                </button>
                <button type="button" onClick={() => onDeleteItem(item.id)} aria-label={`Delete ${item.title}`}
                  className="mr-1 grid h-11 w-11 flex-none place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-red-700 focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
