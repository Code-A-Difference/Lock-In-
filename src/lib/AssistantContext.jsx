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
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useFocus } from './FocusContext.jsx';
import { useLecture } from './LectureContext.jsx';
import { useStudyData } from './data.js';
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
  const { homework, tests, classes, lectures } = useStudyData();
  const navigate = useNavigate();
  const key = `lockin.chat.${user?.username || 'guest'}`;

  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key) || '[]').filter(m => m && m.text); } catch (_) { return []; }
  });
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [attachments, setAttachments] = useState([]);     // [{ name, mime, dataUrl }]
  const [pinned, setPinned] = useState([]);               // lecture ids the student chose as sources
  const [readAloud, setReadAloud] = useState(() => { try { return localStorage.getItem('lockin.readaloud') !== 'off'; } catch (_) { return true; } });

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(messages.slice(-MAX_KEPT))); } catch (_) {}
  }, [messages, key]);
  useEffect(() => { try { localStorage.setItem('lockin.readaloud', readAloud ? 'on' : 'off'); } catch (_) {} }, [readAloud]);

  // everything the turn needs, read at the moment it's sent
  const live = useRef({});
  live.current = { focus, lecture, homework, tests, classes, lectures, attachments, pinned, readAloud };

  const push = useCallback((m) => setMessages(list => [...list, { id: mid(), at: Date.now(), ...m }].slice(-MAX_KEPT)), []);

  /** Carry out one command. Navigation and lectures live here; the timer and agenda in FocusContext. */
  const execute = useCallback(async (cmd) => {
    const { focus: f, lecture: lec, classes: cls } = live.current;
    switch (cmd.action) {
      case 'openFocus': f.openFocus(); return 'Focus is open.';
      case 'openPlanner':
        navigate('/', { state: { openPlanner: true } });
        setTimeout(() => window.dispatchEvent(new Event('lockin:planner')), 120);
        return 'Opening your AI Study Planner on the home page.';
      case 'navigate': navigate(cmd.path); return cmd.path === '/' ? 'Going to today.' : `Opening ${cmd.path.slice(1)}.`;
      case 'recordLecture': {
        if (lec.active) return 'Already recording.';
        const want = String(cmd.className || '').toLowerCase();
        const c = want ? cls.find(x => x.name.toLowerCase().includes(want) || want.includes(x.name.toLowerCase())) : null;
        try {
          await lec.start({ className: c?.name || '', classId: c?.id || '' });
          return `Recording${c ? ` ${c.name}` : ''}. I'll write the notes when you say stop.`;
        } catch (e) { return e.message || 'I couldn’t start recording.'; }
      }
      case 'stopRecording':
        if (!lec.active) return 'Nothing is recording.';
        lec.stop();
        return 'Stopped. Writing your notes now.';
      default: return (await f.perform(cmd)).reply;
    }
  }, [navigate]);

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
            }),
            prompt: buildPrompt({ text: said, history, material, attachments: L.attachments }),
            file_urls: L.attachments.map(a => a.dataUrl),
            response_json_schema: PLAN_SCHEMA,
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

  const clear = useCallback(() => { stopSpeaking(); setMessages([]); setAttachments([]); setPinned([]); }, []);
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
    messages, busy, speaking, send, clear, stop, attachments, addFiles, removeAttachment,
    pinned, togglePinned, readAloud, setReadAloud,
  }), [messages, busy, speaking, send, clear, stop, attachments, addFiles, removeAttachment, pinned, togglePinned, readAloud]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAssistant must be used inside AssistantProvider');
  return v;
}
