/**
 * The study planner, for the whole app: your free time and the plan made from
 * it. It used to live in a form at the bottom of the home page and forget
 * everything on reload. Now it's saved to your account (so the phone and the
 * laptop agree), opens as a sheet from anywhere, and the assistant can add
 * free time and make the plan by voice: "I'm free after school till six,
 * plan my day".
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useStudyData } from './data.js';
import { makeSlot, mergeSlots, upcoming, schedulePrompt, SCHEDULE_SCHEMA, cleanSchedule, blocksLeftToday, expandWeekly, makeBlock, editBlocks } from './planner.js';

const Ctx = createContext(null);
const EMPTY = { slots: [], weekly: [], notes: '', schedule: null, madeAt: null };

export function PlannerProvider({ children }) {
  const { user } = useAuth();
  const { homework, tests } = useStudyData();
  const [state, setState] = useState(() => ({ ...EMPTY, ...(user?.planner || {}) }));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(state);
  ref.current = state;
  const data = useRef({ homework, tests });
  data.current = { homework, tests };
  const saveTimer = useRef(null);

  // another device changed it
  useEffect(() => { if (user?.planner) setState(s => ({ ...s, ...user.planner })); }, [user?.planner]);

  const save = useCallback((next) => {
    ref.current = next;
    setState(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { db.auth.updateMe({ planner: ref.current }).catch(() => {}); }, 500);
  }, []);

  /** Returns the slot added, or { error }. With weekly, the same time every week on that weekday. */
  const addSlot = useCallback((input, { weekly = false } = {}) => {
    const slot = makeSlot(input);
    if (slot.error) return slot;
    if (weekly) {
      const dow = new Date(`${slot.date}T12:00:00`).getDay();
      const rest = (ref.current.weekly || []).filter(w => !(w.dow === dow && w.start === slot.start));
      save({ ...ref.current, weekly: [...rest, { dow, start: slot.start, end: slot.end }] });
      return slot;
    }
    save({ ...ref.current, slots: mergeSlots(upcoming([...ref.current.slots, slot])) });
    return slot;
  }, [save]);

  /** A weekly slot stops repeating altogether; a one-off one just goes. */
  const removeSlot = useCallback((slot) => {
    if (slot.weekly) {
      const dow = new Date(`${slot.date}T12:00:00`).getDay();
      save({ ...ref.current, weekly: (ref.current.weekly || []).filter(w => !(w.dow === dow && w.start === slot.start)) });
      return;
    }
    save({ ...ref.current, slots: ref.current.slots.filter(s => !(s.date === slot.date && s.start === slot.start)) });
  }, [save]);

  /** Change the plan by hand: index -1 adds, block null removes. Returns { error } if the block isn't valid. */
  const editBlock = useCallback((index, input) => {
    const sched = ref.current.schedule || { blocks: [], summary: '', notes: '' };
    let block = null;
    if (input !== null) {
      block = makeBlock(input);
      if (block.error) return block;
    }
    save({ ...ref.current, schedule: { ...sched, blocks: editBlocks(sched.blocks, index, block) }, madeAt: ref.current.madeAt || new Date().toISOString() });
    return block || {};
  }, [save]);

  /** All free time, or just one day's. */
  const clearSlots = useCallback((date) => {
    save({ ...ref.current, slots: date ? ref.current.slots.filter(s => s.date !== date) : [] });
  }, [save]);

  const setNotes = useCallback((notes) => save({ ...ref.current, notes }), [save]);
  const clearPlan = useCallback(() => save({ ...ref.current, schedule: null, madeAt: null }), [save]);

  /** Make the plan from the free time. Resolves with the schedule; throws with a readable reason. */
  const generate = useCallback(async (extraNotes) => {
    const slots = mergeSlots([...upcoming(ref.current.slots), ...expandWeekly(ref.current.weekly)]);
    const { homework: hw, tests: ts } = data.current;
    if (!slots.length) throw new Error('Add some free time first, when are you free to study?');
    if (!hw.some(h => !h.is_completed) && !ts.length) throw new Error('There’s no homework or tests to plan yet.');
    setBusy(true);
    setError('');
    try {
      const notes = [ref.current.notes, extraNotes].filter(Boolean).join('. ');
      const raw = await db.integrations.Core.InvokeLLM({ feature: 'assistant',
        prompt: schedulePrompt({ homework: hw, tests: ts, slots, notes }),
        response_json_schema: SCHEDULE_SCHEMA,
      });
      const schedule = cleanSchedule(raw);
      if (!schedule.blocks.length) throw new Error('The plan came back empty. Try adding more free time.');
      save({ ...ref.current, slots: upcoming(ref.current.slots), schedule, madeAt: new Date().toISOString() });
      return schedule;
    } catch (e) {
      setError(e.message || 'The plan could not be made.');
      throw e;
    } finally {
      setBusy(false);
    }
  }, [save]);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('lockin:planner', show);
    return () => window.removeEventListener('lockin:planner', show);
  }, []);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // one-off free time and the weekly kind together, each slot saying which it is
  const slots = useMemo(() => [...upcoming(state.slots), ...expandWeekly(state.weekly)]
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)), [state.slots, state.weekly]);
  const value = {
    slots, notes: state.notes, schedule: state.schedule, madeAt: state.madeAt,
    today: blocksLeftToday(state.schedule),
    open, setOpen, busy, error,
    weekly: state.weekly || [],
    addSlot, removeSlot, clearSlots, setNotes, generate, clearPlan, editBlock,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanner() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlanner must be used inside PlannerProvider');
  return v;
}
