import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Share2, MoreHorizontal, Pencil, Trash2, User, Clock, BookOpen, Calculator, Atom, Landmark, Palette, Music, Code, Languages, Dumbbell, GraduationCap, ClipboardList } from 'lucide-react';
import { db, sharing } from '@/api/db';
import { cn } from '@/lib/utils';
import { useStudyData, KEYS } from '@/lib/data';
import { ymd } from '@/lib/dates';
import { toast } from '@/components/ui/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import AddClassDialog from '@/components/classes/AddClassDialog';
import JoinClassDialog from '@/components/classes/JoinClassDialog';
import ClassDetailsDialog from '@/components/classes/ClassDetailsDialog';
import EditClassDialog from '@/components/classes/EditClassDialog';

const ICONS = { Calculator, Atom, BookOpen, Landmark, Palette, Music, Code, Languages, Dumbbell };

/**
 * Classes, on their own page. On the old home page they were a collapsed
 * section below the planner, and sharing one took three clicks into a card.
 */
export default function Classes() {
  const qc = useQueryClient();
  const { user, classes, allClasses, allHomework, allTests, isLoading } = useStudyData();
  const [dialog, setDialog] = useState(null);     // 'add' | 'join' | 'share' | 'edit' | 'delete'
  const [target, setTarget] = useState(null);
  const [saving, setSaving] = useState(false);

  const refresh = () => ['classes', 'homework', 'tests'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  const open = (name, cls = null) => { setTarget(cls); setDialog(name); };
  const close = () => setDialog(null);

  const run = async (fn, errTitle) => {
    setSaving(true);
    try { await fn(); } catch (e) { toast({ title: errTitle, description: e.message, variant: 'destructive' }); } finally { setSaving(false); }
  };

  const add = (data) => run(async () => {
    const cls = await db.entities.Class.create({ ...data, members: [user.email] });
    qc.invalidateQueries({ queryKey: KEYS.classes });
    toast({ title: `Added ${cls.name}`, description: 'New homework mentioning it gets tagged automatically.' });
    close();
  }, 'Could not add that class');

  const join = (code) => run(async () => {
    const r = await sharing.importClass(code);
    refresh();
    close();
    toast({
      title: r.isNew ? `Added ${r.className}` : `Updated ${r.className}`,
      description: r.added ? `${r.added} new item${r.added === 1 ? '' : 's'}${r.from ? ` from ${r.from}` : ''}.` : 'You already had everything in that code.',
    });
  }, 'Could not add that class');

  // Renaming a class has to carry its homework and tests along — they're
  // linked by name.
  const edit = (data) => run(async () => {
    const old = target.name;
    await db.entities.Class.update(target.id, data);
    if (data.name && data.name !== old) {
      for (const h of allHomework.filter(x => x.class_name === old)) await db.entities.Homework.update(h.id, { class_name: data.name });
      for (const t of allTests.filter(x => x.class_name === old)) await db.entities.Test.update(t.id, { class_name: data.name });
    }
    refresh();
    close();
  }, 'Could not save that class');

  const remove = () => run(async () => {
    const cls = target;
    for (const h of allHomework.filter(x => x.class_name === cls.name)) await db.entities.Homework.delete(h.id);
    for (const t of allTests.filter(x => x.class_name === cls.name)) await db.entities.Test.delete(t.id);
    await db.entities.Class.delete(cls.id);
    refresh();
    close();
    toast({ title: `Deleted ${cls.name}` });
  }, 'Could not delete that class');

  const counts = (name) => ({
    hw: allHomework.filter(h => h.class_name === name && !h.is_completed).length,
    tests: allTests.filter(t => t.class_name === name && t.date >= ymd(new Date())).length,
  });
  const delCounts = target ? counts(target.name) : { hw: 0, tests: 0 };
  const delAll = target ? allHomework.filter(h => h.class_name === target.name).length + allTests.filter(t => t.class_name === target.name).length : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Classes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Share a class and a classmate gets its homework and tests in their own LOCK IN!.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => open('join')}
            className="inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold text-foreground hover:bg-secondary">
            <Share2 className="h-4 w-4" />Use a share code
          </button>
          <button type="button" onClick={() => open('add')}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" />Add class
          </button>
        </div>
      </header>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
      ) : classes.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
          <GraduationCap className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-2 text-base font-semibold text-foreground">No classes yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Add the classes you're taking. Then “essay eng fri” knows it means English.
          </p>
          <button type="button" onClick={() => open('add')} className="mt-4 h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Add your first class
          </button>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map(cls => {
            const Icon = ICONS[cls.icon] || BookOpen;
            const c = counts(cls.name);
            return (
              <li key={cls.id} className="flex flex-col rounded-2xl border bg-card p-4">
                <div className="flex items-start gap-3">
                  <span className={cn('grid h-10 w-10 flex-none place-items-center rounded-xl', cls.color || 'bg-indigo-500')}>
                    <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-semibold text-foreground">{cls.name}</h2>
                    {cls.teacher && <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground"><User className="h-3.5 w-3.5" aria-hidden="true" />{cls.teacher}</p>}
                    {cls.schedule && <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{cls.schedule}</p>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label={`More for ${cls.name}`} className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onSelect={() => open('edit', cls)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => open('share', cls)}><Share2 className="mr-2 h-4 w-4" />Share</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => open('delete', cls)} className="text-red-700 focus:text-red-700 dark:text-red-400">
                        <Trash2 className="mr-2 h-4 w-4" />Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><ClipboardList className="h-4 w-4" aria-hidden="true" />{c.hw} to do</span>
                  <span className="inline-flex items-center gap-1.5"><GraduationCap className="h-4 w-4" aria-hidden="true" />{c.tests} test{c.tests === 1 ? '' : 's'}</span>
                </div>
                <button type="button" onClick={() => open('share', cls)}
                  className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-lg border text-sm font-medium text-foreground hover:bg-secondary">
                  <Share2 className="h-4 w-4" />Share with a classmate
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {allClasses.length > classes.length && (
        <p className="mt-6 text-xs text-muted-foreground">{allClasses.length - classes.length} class{allClasses.length - classes.length === 1 ? '' : 'es'} you left earlier are hidden.</p>
      )}

      <AddClassDialog open={dialog === 'add'} onOpenChange={o => !o && close()} onSubmit={add} isLoading={saving}
        onUseShareCode={() => setDialog('join')} />
      <JoinClassDialog open={dialog === 'join'} onOpenChange={o => !o && close()} onSubmit={join} isLoading={saving} />
      <ClassDetailsDialog open={dialog === 'share'} onOpenChange={o => !o && close()} classItem={target} />
      <EditClassDialog open={dialog === 'edit'} onOpenChange={o => !o && close()} classItem={target} onSubmit={edit} isLoading={saving} />

      <AlertDialog open={dialog === 'delete'} onOpenChange={o => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {target?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {delAll
                ? `Its ${delAll} homework and test item${delAll === 1 ? '' : 's'} go with it (${delCounts.hw} still to do, ${delCounts.tests} upcoming test${delCounts.tests === 1 ? '' : 's'}). This can't be undone.`
                : 'It has no homework or tests. This can\'t be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-red-600 text-white hover:bg-red-700">Delete class</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
