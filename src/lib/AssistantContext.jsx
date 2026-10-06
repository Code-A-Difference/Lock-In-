/**
 * The assistant, for the whole app: one conversation shared by the chat and
 * the voice. Typing "why?" and then asking it out loud is the same thread.
 *
 * Each turn: a plain one-to-four word command ("pause", "volume up") is done
 * at once; anything else goes to the model with the recent conversation, the
 * timer, the agenda and whichever lecture notes or attached files are
 * relevant, and the model answers and lists the actions to take. If the model
 * can't be reached, the old phrase matching still handles what it can.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import { openGraph } from '@/components/lockin/GraphPanel';
import { useAuth } from '@/lib/AuthContext';
import { useFocus } from './FocusContext.jsx';
import { useLecture } from './LectureContext.jsx';
import { useStudyData, useActions, KEYS } from './data.js';
import { usePlanner } from './PlannerContext.jsx';
import { niceTime } from './planner.js';
import { parseCommand } from './voiceCommands.js';
import { speak, stopSpeaking } from './voice.js';
import {
  PLAN_SCHEMA, actionToCommand, parsePlan, spokenVersion, fastCommand,
  lectureContext, buildSystem, buildPrompt,
} from './assistant.js';

const Ctx = createContext(null);

const MAX_KEPT = 80;
const FILE_TYPES = /^(image\/(png|jpe?g|webp|gif)|application\/pdf|text\/plain)$/;
const MAX_ATTACH_BYTES = 4 * 1024 * 1024;
const PROBLEM = /^(i don'?t see|a few match|what (day|topic)|i could not|i couldn'?t|pick a task|there is no|nothing is|already )/i;

let nextId = 1;
const mid = () => `m${Date.now().toString(36)}${nextId++}`;

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    r.readAsDataURL(file);
  });
}

/** The model being briefly overloaded is worth one more try; anything else isn't. */
async function ask(request) {
  try {
    return await db.integrations.Core.InvokeLLM(request);
  } catch (e) {
    if (!/demand|busy|overload|try again|temporar|unavailable|\b50[234]\b|429/i.test(e?.message || '')) throw e;
    await new Promise(r => setTimeout(r, 1500));
    return db.integrations.Core.InvokeLLM(request);
  }
}

export function AssistantProvider({ children }) {
  const { user } = useAuth();
  const focus = useFocus();
  const lecture = useLecture();
  const planner = usePlanner();
  const actions = useActions();
  const qc = useQueryClient();
  const { homework, tests, classes, lectures } = useStudyData();
  const navigate = useNavigate();

  // Each time the assistant is opened is a new conversation (see clear), so
  // nothing is kept between visits.
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [attachments, setAttachments] = useState([]);     // [{ name, mime, dataUrl }]
  const [pinned, setPinned] = useState([]);               // lecture ids the student chose as sources
  const [readAloud, setReadAloud] = useState(() => { try { return localStorage.getItem('lockin.readaloud') !== 'off'; } catch (_) { return true; } });

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  useEffect(() => { try { localStorage.setItem('lockin.readaloud', readAloud ? 'on' : 'off'); } catch (_) {} }, [readAloud]);

  // everything the turn needs, read at the moment it's sent
  const live = useRef({});
  live.current = { focus, lecture, planner, actions, user, homework, tests, classes, lectures, attachments, pinned, readAloud };

  const push = useCallback((m) => setMessages(list => [...list, { id: mid(), at: Date.now(), ...m }].slice(-MAX_KEPT)), []);

  /** The item whose title best matches what was said, or a reply explaining why there isn't one. */
  const pick = (list, title, what) => {
    const q = String(title || '').toLowerCase().trim();
    const norm = (x) => String(x.title || x.name || '').toLowerCase();
    const exact = list.filter(x => norm(x) === q);
    const m = exact.length ? exact : list.filter(x => norm(x) && (norm(x).includes(q) || q.includes(norm(x))));
    if (!m.length) return { reply: `I don't see a ${what} called "${title}".` };
    if (m.length > 1) return { reply: `A few ${what}s match "${title}": ${m.slice(0, 3).map(x => x.title || x.name).join(', ')}. Which one?` };
    return { item: m[0] };
  };

  /** Carry out one command. The timer and agenda basics are in FocusContext; everything else is here. */
  const execute = useCallback(async (cmd) => {
    const L = live.current;
    const { focus: f, lecture: lec, classes: cls, planner: pl, actions: act } = L;
    const want = (name) => String(name || '').toLowerCase().trim();
    const klass = (name) => cls.find(c => c.name.toLowerCase() === want(name))
      || cls.find(c => want(name) && (c.name.toLowerCase().includes(want(name)) || want(name).includes(c.name.toLowerCase())));
    const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
    switch (cmd.action) {
      case 'openFocus': f.openFocus(); return 'Focus is open.';
      case 'openPlanner': pl.setOpen(true); return 'Here’s your planner.';
      case 'navigate': navigate(cmd.path); return cmd.path === '/' ? 'Going to today.' : `Opening ${cmd.path.slice(1)}.`;
      case 'openPractice': navigate('/Study', { state: { tab: cmd.tab, topic: cmd.topic } }); return cmd.topic ? `Opening practice on ${cmd.topic}.` : 'Opening practice.';
      case 'openCamera': window.dispatchEvent(new Event('lockin:camera')); return 'Camera’s open — snap your homework.';
      case 'graph': openGraph(cmd.expressions); return cmd.expressions.length ? 'Here’s the graph.' : 'Here’s the graphing calculator.';

      case 'recordLecture': {
        if (lec.active) return 'Already recording.';
        const c = klass(cmd.className);
        try {
          await lec.start({ className: c?.name || '', classId: c?.id || '' });
          return `Recording${c ? ` ${c.name}` : ''}. I'll write the notes when you say stop.`;
        } catch (e) { return e.message || 'I couldn’t start recording.'; }
      }
      case 'stopRecording':
        if (!lec.active) return 'Nothing is recording.';
        lec.stop();
        return 'Stopped. Writing your notes now.';
      case 'pauseRecording': if (!lec.active) return 'Nothing is recording.'; lec.pause(); return 'Recording paused.';
      case 'resumeRecording': if (!lec.active) return 'Nothing is recording.'; lec.resume(); return 'Recording again.';

      case 'addFreeTime': {
        const r = pl.addSlot({ date: cmd.date, start: cmd.start, end: cmd.end });
        return r.error ? `I couldn't add that: ${r.error}` : `Added free time ${niceTime(r.start)} to ${niceTime(r.end)}.`;
      }
      case 'removeFreeTime': {
        const hit = pl.slots.find(x => (!cmd.date || x.date === cmd.date) && (!cmd.start || x.start === cmd.start));
        if (!hit) return 'I don’t see that free time.';
        pl.removeSlot(hit);
        return 'Removed that free time.';
      }
      case 'clearFreeTime': pl.clearSlots(cmd.date || undefined); return 'Cleared your free time.';
      case 'clearPlan': pl.clearPlan(); return 'Plan cleared.';
      case 'makePlan': {
        try {
          const sch = await pl.generate(cmd.notes);
          pl.setOpen(true);
          const first = sch.blocks[0];
          return `Your plan is ready — ${sch.blocks.length} block${sch.blocks.length === 1 ? '' : 's'}, starting ${niceTime(first.start)} with ${first.title}.`;
        } catch (e) { return `I couldn't make the plan: ${e.message}`; }
      }

      case 'updateHomework': {
        const r = pick(L.homework, cmd.title, 'homework item');
        if (!r.item) return r.reply;
        const patch = {};
        if (cmd.newTitle) patch.title = cmd.newTitle;
        if (isDay(cmd.date)) patch.due_date = cmd.date;
        if (['low', 'medium', 'high', 'asap'].includes(cmd.priority)) patch.priority = cmd.priority;
        if (cmd.className) { const c = klass(cmd.className); if (c) patch.class_name = c.name; }
        if (!Object.keys(patch).length) return 'What should I change about it?';
        await act.updateHomework(r.item.id, patch);
        return `Updated "${patch.title || r.item.title}".`;
      }
      case 'updateTest': {
        const r = pick(L.tests, cmd.title, 'test');
        if (!r.item) return r.reply;
        const patch = {};
        if (cmd.newTitle) patch.title = cmd.newTitle;
        if (isDay(cmd.date)) patch.date = cmd.date;
        if (cmd.className) { const c = klass(cmd.className); if (c) patch.class_name = c.name; }
        if (!Object.keys(patch).length) return 'What should I change about it?';
        await act.updateTest(r.item.id, patch);
        return `Updated "${patch.title || r.item.title}".`;
      }
      case 'breakDown': {
        const r = pick(L.homework.filter(h => !h.is_completed), cmd.title, 'homework item');
        if (!r.item) return r.reply;
        await act.breakDown(r.item);
        return `Broke "${r.item.title}" into steps.`;
      }
      case 'addClass': {
        if (cls.some(c => c.name.toLowerCase() === want(cmd.name))) return `You already have ${cmd.name}.`;
        await db.entities.Class.create({ name: cmd.name, members: [L.user?.email].filter(Boolean) });
        qc.invalidateQueries({ queryKey: KEYS.classes });
        return `Added the class ${cmd.name}.`;
      }
      case 'renameClass': {
        const c = klass(cmd.name);
        if (!c) return `I don't see a class called ${cmd.name}.`;
        await db.entities.Class.update(c.id, { name: cmd.newName });
        for (const h of L.homework.filter(x => x.class_name === c.name)) await act.updateHomework(h.id, { class_name: cmd.newName });
        for (const t of L.tests.filter(x => x.class_name === c.name)) await act.updateTest(t.id, { class_name: cmd.newName });
        qc.invalidateQueries({ queryKey: KEYS.classes });
        return `Renamed ${c.name} to ${cmd.newName}.`;
      }
      case 'deleteClass': {
        const c = klass(cmd.name);
        if (!c) return `I don't see a class called ${cmd.name}.`;
        // Deleting a class takes its homework and tests with it: that's a decision for
        // the Classes page, not something to do on one possibly-misheard sentence.
        if (L.homework.some(h => h.class_name === c.name) || L.tests.some(t => t.class_name === c.name)) {
          navigate('/Classes');
          return `${c.name} still has homework or tests, so I won't delete it by voice. It's on the Classes page if you want to.`;
        }
        await db.entities.Class.delete(c.id);
        qc.invalidateQueries({ queryKey: KEYS.classes });
        return `Deleted the class ${c.name}.`;
      }
      case 'setGoal': {
        const m = Math.max(10, Math.min(720, Math.round(cmd.minutes)));
        f.updatePrefs({ dailyGoal: m });
        return `Daily focus goal set to ${m} minutes.`;
      }
      case 'setAutoBreak': f.updatePrefs({ autoBreak: !!cmd.on }); return cmd.on ? 'Breaks will start by themselves.' : 'Breaks will wait for you.';
      case 'setDarkMode': await db.auth.updateMe({ theme: cmd.on ? 'dark' : 'light' }).catch(() => {}); return cmd.on ? 'Dark mode on.' : 'Dark mode off.';
      default: return (await f.perform(cmd)).reply;
    }
  }, [navigate, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = useCallback((text) => {
    setSpeaking(true);
    return speak(text).finally(() => setSpeaking(false));
  }, []);

  /**
   * One turn. `via` is 'voice' or 'text'. Resolves with { reply, finished }:
   * `finished` settles once the answer has been spoken (or at once if it
   * isn't being).
   */
  const send = useCallback(async (text, { via = 'text' } = {}) => {
    const said = String(text || '').trim();
    if (!said) return { reply: '', finished: Promise.resolve() };
    const L = live.current;
    stopSpeaking();
    const history = messagesRef.current;
    push({ role: 'user', text: said, via });
    setBusy(true);
    let reply = '';
    let spoken = '';
    try {
      const quiz = L.focus.voiceQuiz;
      const quick = fastCommand(said, parseCommand, { quizActive: !!quiz });
      if (quick) {
        reply = await execute(quick);
        spoken = reply;
      } else {
        let plan = null;
        try {
          const material = lectureContext(said, L.lectures, L.pinned);
          const raw = await ask({
            system: buildSystem({
              now: new Date(), via,
              timer: { status: L.focus.status, phase: L.focus.phase, remaining: L.focus.remaining, total: L.focus.total, taskTitle: L.focus.taskItem?.title },
              prefs: L.focus.prefs, homework: L.homework, tests: L.tests, classes: L.classes, lectures: L.lectures,
              quiz: quiz ? { topic: quiz.topic, index: quiz.index, total: quiz.questions.length } : null,
              recording: !!L.lecture.active,
              dark: L.user?.theme !== 'light',
              plan: {
                slots: L.planner.slots.map(x => `${x.date} ${x.start}-${x.end}`).join(', '),
                today: L.planner.today.map(b => `${b.start}-${b.end} ${b.title}`).join('; '),
              },
            }),
            prompt: buildPrompt({ text: said, history, material, attachments: L.attachments }),
            file_urls: L.attachments.map(a => a.dataUrl),
            response_json_schema: PLAN_SCHEMA,
            maxTokens: via === 'voice' ? 1200 : 3000,   // a spoken answer is short; shorter comes back sooner
          });
          plan = parsePlan(raw);
        } catch (e) {
          // The model is out of reach. Phrase matching can still run the obvious things.
          const cmd = parseCommand(said);
          if (cmd.action !== 'unknown' && cmd.action !== 'none') {
            reply = await execute(cmd);
            spoken = reply;
          } else {
            reply = `I couldn’t reach my brain just now — ${e?.message || 'try again in a moment'}.`;
            spoken = 'I couldn’t reach my brain just now. Try again in a moment.';
          }
        }
        if (plan) {
          const notes = [];
          for (const a of plan.actions) {
            const cmd = actionToCommand(a);
            if (!cmd) continue;
            const r = await execute(cmd);
            if (PROBLEM.test(r || '')) notes.push(r);
          }
          reply = [plan.reply, ...notes].filter(Boolean).join('\n\n') || (plan.actions.length ? 'Done.' : 'Sorry, I didn’t get that.');
          spoken = notes.length ? [spokenVersion(plan), ...notes].join(' ') : spokenVersion({ ...plan, reply: plan.reply || reply });
        }
      }
    } catch (e) {
      reply = e?.message || 'Something went wrong.';
      spoken = reply;
    } finally {
      setBusy(false);
    }
    push({ role: 'assistant', text: reply });
    const talk = (via === 'voice' || L.readAloud) && spoken;
    return { reply, finished: talk ? say(spoken) : Promise.resolve() };
  }, [execute, push, say]);

  /** A fresh conversation: every opening of the assistant starts one. */
  const clear = useCallback(() => { stopSpeaking(); setMessages([]); setAttachments([]); setPinned([]); }, []);

  /** A photo from the in-app camera (a data URL). */
  const addPhoto = useCallback((dataUrl) => {
    const size = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
    setAttachments(list => [...list, { name: `photo-${list.length + 1}.jpg`, mime: 'image/jpeg', size, dataUrl }].slice(-5));
  }, []);
  const stop = useCallback(() => { stopSpeaking(); setSpeaking(false); }, []);

  const addFiles = useCallback(async (fileList) => {
    const files = [...(fileList || [])];
    const have = live.current.attachments;
    const added = [];
    let bytes = have.reduce((n, a) => n + a.size, 0);
    for (const f of files) {
      if (!FILE_TYPES.test(f.type)) throw new Error(`${f.name}: I can read photos, PDFs and text files. For a video, use “Add a video”.`);
      bytes += f.size;
      if (bytes > MAX_ATTACH_BYTES) throw new Error('Those files are over 4 MB together. Try fewer or smaller ones.');
      added.push({ name: f.name, mime: f.type, size: f.size, dataUrl: await readDataUrl(f) });
    }
    setAttachments(list => [...list, ...added].slice(0, 5));
  }, []);
  const removeAttachment = useCallback((i) => setAttachments(list => list.filter((_, j) => j !== i)), []);
  const togglePinned = useCallback((id) => setPinned(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id].slice(-3))), []);

  const value = useMemo(() => ({
    messages, busy, speaking, send, clear, stop, attachments, addFiles, addPhoto, removeAttachment,
    pinned, togglePinned, readAloud, setReadAloud,
  }), [messages, busy, speaking, send, clear, stop, attachments, addFiles, addPhoto, removeAttachment, pinned, togglePinned, readAloud]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAssistant must be used inside AssistantProvider');
  return v;
}
