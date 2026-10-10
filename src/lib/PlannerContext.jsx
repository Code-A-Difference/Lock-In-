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
import { makeSlot, mergeSlots, upcoming, schedulePrompt, SCHEDULE_SCHEMA, cleanSchedule, blocksLeftToday } from './planner.js';

const Ctx = createContext(null);
const EMPTY = { slots: [], notes: '', schedule: null, madeAt: null };

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

  /** Returns the slot added, or { error }. */
  const addSlot = useCallback((input) => {
    const slot = makeSlot(input);
    if (slot.error) return slot;
    save({ ...ref.current, slots: mergeSlots(upcoming([...ref.current.slots, slot])) });
    return slot;
  }, [save]);

  const removeSlot = useCallback((slot) => {
    save({ ...ref.current, slots: ref.current.slots.filter(s => !(s.date === slot.date && s.start === slot.start)) });
  }, [save]);

  /** All free time, or just one day's. */
  const clearSlots = useCallback((date) => {
    save({ ...ref.current, slots: date ? ref.current.slots.filter(s => s.date !== date) : [] });
  }, [save]);

  const setNotes = useCallback((notes) => save({ ...ref.current, notes }), [save]);
  const clearPlan = useCallback(() => save({ ...ref.current, schedule: null, madeAt: null }), [save]);

  /** Make the plan from the free time. Resolves with the schedule; throws with a readable reason. */
  const generate = useCallback(async (extraNotes) => {
    const slots = upcoming(ref.current.slots);
    const { homework: hw, tests: ts } = data.current;
    if (!slots.length) throw new Error('Add some free time first, when are you free to study?');
    if (!hw.some(h => !h.is_completed) && !ts.length) throw new Error('There’s no homework or tests to plan yet.');
    setBusy(true);
    setError('');
    try {
      const notes = [ref.current.notes, extraNotes].filter(Boolean).join('. ');
      const raw = await db.integrations.Core.InvokeLLM({
        prompt: schedulePrompt({ homework: hw, tests: ts, slots, notes }),
        response_json_schema: SCHEDULE_SCHEMA,
      });
      const schedule = cleanSchedule(raw);
      if (!schedule.blocks.length) throw new Error('The plan came back empty. Try adding more free time.');
      save({ ...ref.current, slots, schedule, madeAt: new Date().toISOString() });
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

  const slots = useMemo(() => upcoming(state.slots), [state.slots]);
  const value = {
    slots, notes: state.notes, schedule: state.schedule, madeAt: state.madeAt,
    today: blocksLeftToday(state.schedule),
    open, setOpen, busy, error,
    addSlot, removeSlot, clearSlots, setNotes, generate, clearPlan,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanner() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlanner must be used inside PlannerProvider');
  return v;
}
