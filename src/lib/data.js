/**
 * The app's data, as React Query hooks. Every page used to declare its own
 * queries and eight near-identical mutations; they live here once, with
 * optimistic updates (ticking a box shouldn't wait for the vault to re-encrypt)
 * and an Undo on every delete instead of a confirm dialog.
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { breakdownRequest, stepsFromAi, stepsFromTemplate, detectTemplate } from './shredder.js';

export const KEYS = { classes: ['classes'], homework: ['homework'], tests: ['tests'], sessions: ['focus-sessions'] };

const strip = ({ id, created_date, updated_date, created_by, ...rest }) => rest;

export function useStudyData() {
  const { user } = useAuth();
  const c = useQuery({ queryKey: KEYS.classes, queryFn: () => db.entities.Class.list() });
  const h = useQuery({ queryKey: KEYS.homework, queryFn: () => db.entities.Homework.list('due_date') });
  const t = useQuery({ queryKey: KEYS.tests, queryFn: () => db.entities.Test.list('date') });
  const s = useQuery({ queryKey: KEYS.sessions, queryFn: () => db.entities.FocusSession.list('-ended_at', 500) });

  const allClasses = c.data || [];
  // A class you left keeps its record (so a re-import can find it) but drops
  // out of everything you see, homework and tests included.
  const classes = allClasses.filter(x => !Array.isArray(x.members) || x.members.includes(user?.email));
  const mine = new Set(classes.map(x => x.name));
  const visible = r => !r.class_name || mine.has(r.class_name);

  return {
    user,
    classes,
    allClasses,
    homework: (h.data || []).filter(visible),
    allHomework: h.data || [],
    tests: (t.data || []).filter(visible),
    allTests: t.data || [],
    sessions: s.data || [],
    isLoading: c.isLoading || h.isLoading || t.isLoading,
  };
}

function fail(title) {
  return (e) => {
    toast({ title, description: e?.message || String(e), variant: 'destructive' });
    throw e;
  };
}

export function useActions() {
  const qc = useQueryClient();
  const { user } = useAuth();

  // Patch the cache now, write to the vault, then reconcile.
  const optimistic = async (key, change, write) => {
    const before = qc.getQueryData(key);
    if (before) qc.setQueryData(key, change(before));
    try {
      return await write();
    } catch (e) {
      qc.setQueryData(key, before);
      throw e;
    } finally {
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const withUndo = (label, restore) => {
    toast({
      title: `Deleted "${label}"`,
      action: React.createElement(ToastAction, { altText: 'Undo delete', onClick: restore }, 'Undo'),
    });
  };

  const actions = {
    /* ---------------------------------------------------------- homework */
    addHomework: (data) =>
      db.entities.Homework.create({
        priority: 'medium',
        ...data,
        is_completed: false,
        author_name: user?.full_name || user?.username,
      }).then((rec) => { qc.invalidateQueries({ queryKey: KEYS.homework }); return rec; }, fail('Could not add that')),

    updateHomework: (id, patch) =>
      optimistic(KEYS.homework,
        list => list.map(x => (x.id === id ? { ...x, ...patch } : x)),
        () => db.entities.Homework.update(id, patch)).catch(fail('Could not save that')),

    toggleHomework: (hw) => actions.updateHomework(hw.id, {
      is_completed: !hw.is_completed,
      completed_at: hw.is_completed ? null : new Date().toISOString(),
    }),

    deleteHomework: async (hw) => {
      await optimistic(KEYS.homework, list => list.filter(x => x.id !== hw.id), () => db.entities.Homework.delete(hw.id))
        .catch(fail('Could not delete that'));
      withUndo(hw.title, () => db.entities.Homework.create(strip(hw)).then(() => qc.invalidateQueries({ queryKey: KEYS.homework })));
    },

    setSteps: (hw, steps) => actions.updateHomework(hw.id, { steps }),

    toggleStep: (hw, stepId) => actions.setSteps(hw, (hw.steps || []).map(s => (s.id === stepId ? { ...s, done: !s.done } : s))),

    /**
     * Task Shredder, built in: ask the AI for a checklist; if it can't (no key
     * yet, offline, rate limited), fall back to a template for that kind of
     * work so the button always does something useful.
     */
    breakDown: async (hw) => {
      let steps = null, source = 'ai', reason = '';
      try {
        const { prompt, response_json_schema } = breakdownRequest(hw);
        steps = stepsFromAi(await db.integrations.Core.InvokeLLM({ prompt, response_json_schema }));
        if (!steps) reason = 'The AI reply was not a usable checklist.';
      } catch (e) {
        reason = e?.message || 'The AI is unavailable.';
      }
      if (!steps) { steps = stepsFromTemplate(detectTemplate(hw.title, hw.class_name)); source = 'template'; }
      await actions.setSteps(hw, steps);
      return { steps, source, reason };
    },

    /* ------------------------------------------------------------- tests */
    addTest: (data) =>
      db.entities.Test.create(data)
        .then((rec) => { qc.invalidateQueries({ queryKey: KEYS.tests }); return rec; }, fail('Could not add that test')),

    updateTest: (id, patch) =>
      optimistic(KEYS.tests,
        list => list.map(x => (x.id === id ? { ...x, ...patch } : x)),
        () => db.entities.Test.update(id, patch)).catch(fail('Could not save that test')),

    deleteTest: async (t) => {
      await optimistic(KEYS.tests, list => list.filter(x => x.id !== t.id), () => db.entities.Test.delete(t.id))
        .catch(fail('Could not delete that test'));
      withUndo(t.title, () => db.entities.Test.create(strip(t)).then(() => qc.invalidateQueries({ queryKey: KEYS.tests })));
    },

    /* ------------------------------------------------------------- focus */
    logSession: async (rec) => {
      await db.entities.FocusSession.create(rec);
      qc.invalidateQueries({ queryKey: KEYS.sessions });
    },
  };
  return actions;
}
