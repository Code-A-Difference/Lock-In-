import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const GROUPS = [
  ['Anywhere', [
    ['N or /', 'Add something (homework, test)'],
    ['T', 'Today'],
    ['F', 'Open focus overlay'],
    ['M', 'Talk (push to talk)'],
    ['P', 'Practice / quizzes'],
    ['C', 'Classes'],
    ['?', 'This list'],
  ]],
  ['With the Focus overlay open', [
    ['Space', 'Start / pause'],
    ['+ / −', 'Five minutes more / less'],
  ]],
];

export default function ShortcutsDialog({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>They don't fire while you're typing in a box.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {GROUPS.map(([title, rows]) => (
            <section key={title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
              <dl className="divide-y rounded-lg border">
                {rows.map(([k, d]) => (
                  <div key={k} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                    <dt className="text-foreground">{d}</dt>
                    <dd><kbd className="rounded border bg-secondary px-2 py-0.5 text-xs font-semibold">{k}</kbd></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
