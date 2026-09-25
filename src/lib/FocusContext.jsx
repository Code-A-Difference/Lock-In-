/**
 * The focus timer, for the whole app — Ambient Voice Study's engine, moved in.
 *
 * It lives above the pages, so it keeps running while you check your list or
 * ask the assistant something; the countdown shows in the nav and the tab
 * title. What it does better than the original:
 *   - it counts to a timestamp, not by decrementing every second, so a
 *     throttled background tab doesn't lose time;
 *   - a reload doesn't lose the block (sessionStorage snapshot);
 *   - every finished block is logged to the task you were on, which is where
 *     the streak and the minutes-per-day chart come from;
 *   - every fourth break is a long one;
 *   - it speaks in a natural voice (lib/voice.js), and understands ordinary
 *     phrasing (lib/voiceCommands.js).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { useStudyData, useActions, KEYS } from './data.js';
import { soundscape, chime, unlockAudio, SOUNDS } from './soundscape.js';
import { speak, configureVoice } from './voice.js';
import { parseCommand } from './voiceCommands.js';
import { clock, spokenTime } from './agenda.js';
import { ymd } from './dates.js';

export const DEFAULT_FOCUS = {
  focusMin: 25, breakMin: 5, longMin: 15, longEvery: 4,
  autoBreak: true, autoFocus: false,
  sound: 'off', lastSound: 'rain', volume: 0.5,
  cues: true, notify: false, dailyGoal: 120,
};

export const PHASE_LABEL = { focus: 'Focus', break: 'Short break', long: 'Long break' };

const Ctx = createContext(null);

const lengthOf = (phase, p) => 60 * (phase === 'focus' ? p.focusMin : phase === 'long' ? p.longMin : p.breakMin);
const leftOf = (t, now) => (t.status === 'running' ? Math.max(0, (t.endsAt - now) / 1000) : t.remaining);
const fresh = (p, phase = 'focus', blocks = 0, task = null) => {
  const secs = lengthOf(phase, p);
  return { phase, status: 'idle', endsAt: null, remaining: secs, total: secs, blocks, task, startedAt: null };
};
const clampMin = (m, lo = 1, hi = 180) => Math.max(lo, Math.min(hi, Math.round(Number(m) || 0)));

export function FocusProvider({ children }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { homework, tests } = useStudyData();
  const actions = useActions();
  const snapKey = `lockin.focus.${user?.username}`;

  /* ---------------------------------------------------------------- prefs */
  const [prefs, setPrefs] = useState(() => ({ ...DEFAULT_FOCUS, ...(user?.focus || {}) }));
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const saveTimer = useRef(null);
  const previewTimer = useRef(null);
  const updatePrefs = useCallback((patch) => {
    setPrefs(p => {
      const next = { ...p, ...patch };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { db.auth.updateMe({ focus: next }).catch(() => {}); }, 400);
      return next;
    });
  }, []);

  useEffect(() => { configureVoice(user?.voice || {}); }, [user?.voice]);

  /* ---------------------------------------------------------------- timer */
  const [t, setT] = useState(() => {
    try {
      const snap = JSON.parse(sessionStorage.getItem(snapKey) || 'null');
      if (snap && snap.phase) return snap;
    } catch (_) {}
    return fresh(prefs);
  });
  const tRef = useRef(t);
  const commit = useCallback((next) => {
    tRef.current = next;
    setT(next);
    try { sessionStorage.setItem(snapKey, JSON.stringify(next)); } catch (_) {}
  }, [snapKey]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (t.status !== 'running') return undefined;
    let last = -1;
    const id = setInterval(() => {
      const n = Date.now();
      const sec = Math.ceil((tRef.current.endsAt - n) / 1000);
      if (sec !== last) { last = sec; setNow(n); }
    }, 200);
    return () => clearInterval(id);
  }, [t.status, t.endsAt]);

  const remaining = leftOf(t, now);

  /* --------------------------------------------------------- task lookup */
  const taskItem = useMemo(() => {
    if (!t.task) return null;
    const list = t.task.type === 'test' ? tests : homework;
    return list.find(x => x.id === t.task.id) || null;
  }, [t.task, homework, tests]);
  const taskRef = useRef(taskItem);
  taskRef.current = taskItem;

  /* ---------------------------------------------------------------- sound */
  const applySound = useCallback((state = tRef.current, p = prefsRef.current) => {
    const shouldPlay = state.status === 'running' && state.phase === 'focus' && p.sound !== 'off';
    if (!shouldPlay) {
      if (p.sound === 'off') soundscape.stop(); else soundscape.pause();
      return;
    }
    if (soundscape.kind === p.sound && soundscape.parts.length) { soundscape.setVolume(p.volume); soundscape.resume(); }
    else soundscape.play(p.sound, p.volume);
  }, []);

  /* ------------------------------------------------------------- speaking */
  const say = useCallback((text, force = false) => {
    if (!force && !prefsRef.current.cues) return;
    speak(text);
  }, []);

  const notify = useCallback((title, body) => {
    if (!prefsRef.current.notify || typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted' || !document.hidden) return;
    try { new Notification(title, { body, icon: `${import.meta.env.BASE_URL}favicon.svg`, silent: true }); } catch (_) {}
  }, []);

  /* ------------------------------------------------------------ logging */
  // Reads the task straight from the vault, not from the query cache: a block
  // that ended while the tab was closed finishes on load, before the lists
  // have arrived, and the minutes still belong to that task.
  const logFocus = useCallback((seconds) => {
    const minutes = Math.round(seconds / 60);
    if (minutes < 1) return 0;
    const ref = tRef.current.task;
    const entity = ref?.type === 'test' ? db.entities.Test : db.entities.Homework;
    (async () => {
      const item = ref ? await entity.get(ref.id).catch(() => null) : null;
      await actions.logSession({
        minutes,
        day: ymd(new Date()),
        ended_at: new Date().toISOString(),
        task_type: item ? ref.type : null,
        task_id: item?.id || null,
        title: item?.title || null,
        class_name: item?.class_name || null,
      });
      if (item) {
        await entity.update(item.id, { focus_minutes: (item.focus_minutes || 0) + minutes });
        qc.invalidateQueries({ queryKey: ref.type === 'test' ? KEYS.tests : KEYS.homework });
      }
    })().catch(() => {});
    return minutes;
  }, [actions, qc]);

  /* ------------------------------------------------------ phase changes */
  const finishPhase = useCallback((early = false) => {
    const cur = tRef.current;
    const p = prefsRef.current;
    const elapsed = cur.total - leftOf(cur, Date.now());

    if (cur.phase === 'focus') {
      const minutes = logFocus(elapsed);
      const blocks = cur.blocks + (minutes ? 1 : 0);
      const phase = blocks > 0 && blocks % p.longEvery === 0 ? 'long' : 'break';
      const next = fresh(p, phase, blocks, cur.task);
      if (p.autoBreak) { next.status = 'running'; next.endsAt = Date.now() + next.total * 1000; next.startedAt = Date.now(); }
      commit(next);
      applySound(next);
      if (!early) {
        chime('focusEnd', 0.35);
        const brk = Math.round(next.total / 60);
        const line = phase === 'long'
          ? `That's ${blocks} blocks. Take a proper break — ${brk} minutes. Stand up, get some water.`
          : `Nice work${minutes ? ` — ${minutes} minutes done` : ''}. Take ${brk}.`;
        say(line);
        notify('Focus block done', `${minutes} minutes logged. ${PHASE_LABEL[phase]}: ${brk} min.`);
      }
    } else {
      const next = fresh(p, 'focus', cur.blocks, cur.task);
      if (p.autoFocus) { next.status = 'running'; next.endsAt = Date.now() + next.total * 1000; next.startedAt = Date.now(); }
      commit(next);
      applySound(next);
      if (!early) {
        chime('breakEnd', 0.35);
        const step = (taskRef.current?.steps || []).find(s => !s.done);
        say(`Break's over.${step ? ` Next up: ${step.text}.` : ''} ${p.autoFocus ? "Let's go." : 'Ready when you are.'}`);
        notify('Break over', step ? `Next: ${step.text}` : 'Time to lock back in.');
      }
    }
  }, [applySound, commit, logFocus, notify, say]);

  // Hitting zero. Checked on every tick, and once on load in case the block
  // ended while the tab was closed. It reads the live ref, not this render's
  // `t`: once a phase has finished, a second run of this effect (React runs
  // effects twice in development) must see the new phase, not end it too.
  useEffect(() => {
    const cur = tRef.current;
    if (cur.status === 'running' && cur.endsAt <= Date.now()) finishPhase(false);
  }, [now, t.status, t.endsAt, finishPhase]);

  /* ------------------------------------------------------------- actions */
  const start = useCallback(() => {
    unlockAudio();
    const cur = tRef.current;
    if (cur.status === 'running') return;
    const next = { ...cur, status: 'running', endsAt: Date.now() + cur.remaining * 1000, startedAt: cur.startedAt || Date.now() };
    commit(next);
    applySound(next);
    setNow(Date.now());
  }, [applySound, commit]);

  const pause = useCallback(() => {
    const cur = tRef.current;
    if (cur.status !== 'running') return;
    const next = { ...cur, status: 'paused', remaining: leftOf(cur, Date.now()), endsAt: null };
    commit(next);
    applySound(next);
  }, [applySound, commit]);

  const toggle = useCallback(() => (tRef.current.status === 'running' ? pause() : start()), [pause, start]);

  const reset = useCallback(() => {
    const cur = tRef.current;
    const next = fresh(prefsRef.current, 'focus', cur.blocks, cur.task);
    commit(next);
    applySound(next);
  }, [applySound, commit]);

  const skip = useCallback(() => finishPhase(true), [finishPhase]);

  const startBreak = useCallback(() => {
    unlockAudio();
    const cur = tRef.current;
    if (cur.phase === 'focus' && cur.status !== 'idle') logFocus(cur.total - leftOf(cur, Date.now()));
    const next = fresh(prefsRef.current, 'break', cur.blocks, cur.task);
    next.status = 'running'; next.endsAt = Date.now() + next.total * 1000; next.startedAt = Date.now();
    commit(next);
    applySound(next);
  }, [applySound, commit, logFocus]);

  const adjust = useCallback((minutes) => {
    const cur = tRef.current;
    const delta = minutes * 60;
    const left = leftOf(cur, Date.now());
    const newLeft = Math.max(60, left + delta);
    const real = newLeft - left;
    const next = cur.status === 'running'
      ? { ...cur, endsAt: cur.endsAt + real * 1000, total: cur.total + real }
      : { ...cur, remaining: newLeft, total: cur.total + real };
    commit(next);
    setNow(Date.now());
  }, [commit]);

  const setDurations = useCallback((patch) => {
    const clean = {};
    if (patch.focusMin != null) clean.focusMin = clampMin(patch.focusMin);
    if (patch.breakMin != null) clean.breakMin = clampMin(patch.breakMin, 1, 60);
    if (patch.longMin != null) clean.longMin = clampMin(patch.longMin, 1, 90);
    const p = { ...prefsRef.current, ...clean };
    prefsRef.current = p;
    updatePrefs(clean);
    const cur = tRef.current;
    if (cur.status === 'idle') commit({ ...cur, remaining: lengthOf(cur.phase, p), total: lengthOf(cur.phase, p) });
  }, [commit, updatePrefs]);

  const setTask = useCallback((task) => {
    commit({ ...tRef.current, task: task ? { type: task.type, id: task.id } : null });
  }, [commit]);

  /** The "Lock in" button: this task, focus, go. */
  const lockIn = useCallback((task) => {
    unlockAudio();
    const cur = tRef.current;
    const taskRefValue = task ? { type: task.type, id: task.id } : cur.task;
    if (cur.phase === 'focus' && cur.status === 'running') { commit({ ...cur, task: taskRefValue }); return; }
    const base = cur.phase === 'focus' ? cur : fresh(prefsRef.current, 'focus', cur.blocks);
    const next = { ...base, task: taskRefValue, status: 'running', endsAt: Date.now() + base.remaining * 1000, startedAt: Date.now() };
    commit(next);
    applySound(next);
    setNow(Date.now());
  }, [applySound, commit]);

  const setSound = useCallback((kind) => {
    unlockAudio();
    const patch = { sound: kind };
    if (kind !== 'off') patch.lastSound = kind;
    const p = { ...prefsRef.current, ...patch };
    prefsRef.current = p;
    updatePrefs(patch);
    // Picking a sound plays it, even before the timer starts, so you can hear
    // what you chose. It follows the timer from then on.
    if (kind === 'off') soundscape.stop();
    else soundscape.play(kind, p.volume);
    const cur = tRef.current;
    if (kind !== 'off' && !(cur.status === 'running' && cur.phase === 'focus')) {
      clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(() => applySound(), 4000);
    }
  }, [applySound, updatePrefs]);

  const setVolume = useCallback((v) => {
    const vol = Math.max(0, Math.min(1, v));
    prefsRef.current = { ...prefsRef.current, volume: vol };
    updatePrefs({ volume: vol });
    soundscape.setVolume(vol);
  }, [updatePrefs]);

  const completeStep = useCallback(async () => {
    const item = taskRef.current;
    const steps = item?.steps || [];
    const i = steps.findIndex(s => !s.done);
    if (!item || tRef.current.task?.type !== 'homework' || i < 0) return null;
    const nextSteps = steps.map((s, j) => (j === i ? { ...s, done: true } : s));
    await actions.setSteps(item, nextSteps);
    return { done: steps[i], next: nextSteps.find(s => !s.done) || null };
  }, [actions]);

  /* --------------------------------------------------------------- voice */
  /** Act on something said. Returns what was said back, for the UI too. */
  const handleVoice = useCallback(async (text) => {
    const cmd = parseCommand(text);
    const cur = tRef.current;
    const p = prefsRef.current;
    const item = taskRef.current;
    let reply;
    switch (cmd.action) {
      case 'start':
        if (cur.status === 'running') reply = `Already going — ${spokenTime(leftOf(cur, Date.now()))} left.`;
        else { start(); reply = cur.phase === 'focus' ? (item ? `Locked in on ${item.title}.` : 'Locked in. Go.') : 'Break timer running.'; }
        break;
      case 'pause': pause(); reply = 'Paused.'; break;
      case 'skip': reply = cur.phase === 'focus' ? 'Skipping to your break.' : 'Break skipped. Back to it.'; skip(); break;
      case 'reset': reset(); reply = 'Timer reset.'; break;
      case 'startBreak': startBreak(); reply = `Break time. ${p.breakMin} minutes.`; break;
      case 'setFocus': setDurations({ focusMin: cmd.minutes }); reply = `Focus blocks are now ${clampMin(cmd.minutes)} minutes.`; break;
      case 'setBreak': setDurations({ breakMin: cmd.minutes }); reply = `Breaks are now ${clampMin(cmd.minutes, 1, 60)} minutes.`; break;
      case 'adjust':
        adjust(cmd.minutes);
        reply = cmd.minutes > 0 ? `Added ${cmd.minutes} minutes.` : `Took off ${-cmd.minutes} minutes.`;
        break;
      case 'timeLeft':
        reply = cur.status === 'idle'
          ? 'The timer isn\'t running. Say "start" to lock in.'
          : `${spokenTime(leftOf(cur, Date.now()))} left in this ${cur.phase === 'focus' ? 'block' : 'break'}.`;
        break;
      case 'sound': {
        const kind = cmd.kind === 'last' ? (p.lastSound || 'rain') : cmd.kind;
        setSound(kind);
        reply = kind === 'off' ? 'Sound off.' : `${SOUNDS.find(s => s.id === kind)?.label || 'Sound'} on.`;
        break;
      }
      case 'volume': setVolume(p.volume + cmd.delta); reply = cmd.delta > 0 ? 'Louder.' : 'Quieter.'; break;
      case 'completeStep': {
        const r = await completeStep();
        if (!item) reply = 'Pick a task first, then I can tick off its steps.';
        else if (!r) reply = (item.steps || []).length ? 'Every step is already done. Nice.' : 'This task has no steps yet. Break it down first.';
        else reply = r.next ? `Done. Next: ${r.next.text}.` : 'That was the last step. Great work.';
        break;
      }
      case 'readStep': {
        const step = (item?.steps || []).find(s => !s.done);
        reply = !item ? 'No task picked yet.'
          : step ? `Next step: ${step.text}. About ${step.minutes} minutes.`
          : (item.steps || []).length ? 'All the steps are done.' : `You're on ${item.title}. It has no steps yet.`;
        break;
      }
      case 'help': reply = 'Try: pause, five more minutes, how long is left, what\'s next, done, or play rain.'; break;
      case 'none': return { reply: '', action: 'none' };
      default: reply = 'Sorry, I didn\'t get that. Say "help" to hear what I can do.';
    }
    reply = reply.charAt(0).toUpperCase() + reply.slice(1);   // "about 15 minutes…" opens a sentence
    say(reply, true);
    return { reply, action: cmd.action };
  }, [adjust, completeStep, pause, reset, say, setDurations, setSound, setVolume, skip, start, startBreak]);

  /* ------------------------------------------------------------- chrome */
  useEffect(() => {
    const base = 'LOCK IN!';
    document.title = t.status === 'running' ? `${clock(remaining)} · ${PHASE_LABEL[t.phase]} — ${base}` : base;
  }, [remaining, t.status, t.phase]);

  // Leaving (sign out): stop the sound and the voice, put the title back.
  useEffect(() => () => {
    soundscape.stop();
    document.title = 'LOCK IN!';
    clearTimeout(saveTimer.current);
    clearTimeout(previewTimer.current);
  }, []);

  const value = {
    ...t,
    remaining,
    progress: t.total ? 1 - remaining / t.total : 0,
    prefs,
    taskItem,
    start, pause, toggle, reset, skip, startBreak, adjust, setDurations, setTask, lockIn,
    setSound, setVolume, completeStep, handleVoice, updatePrefs,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFocus() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFocus must be used inside FocusProvider');
  return v;
}
