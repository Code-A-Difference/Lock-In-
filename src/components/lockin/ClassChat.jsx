import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, Sparkles, Trash2 } from 'lucide-react';
import RichText from '@/components/lockin/RichText';
import { db } from '@/api/db';
import { cn } from '@/lib/utils';
import { RECIPES, classChatPrompt } from '@/lib/classChat';
import { notesMarkdown } from '@/lib/lectures';

/**
 * "Ask about this class" — Granola's chat, for a lecture. While recording,
 * each question first sends the audio heard so far, so "catch me up" and
 * "I got asked a question" see the last few seconds, not the last piece.
 * The conversation is kept with the lecture.
 */
export default function ClassChat({ lecture, live, lec, onSaveChat, autoAsk, onAutoAsked }) {
  const [msgs, setMsgs] = useState(() => lecture.chat || []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const end = useRef(null);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;
  const lectureRef = useRef(lecture);
  lectureRef.current = lecture;

  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [msgs.length, busy]);

  const ask = async (question, label = question) => {
    const q = question.trim();
    if (!q || busy) return;
    const history = msgsRef.current;
    const withQ = [...history, { role: 'user', text: label, at: Date.now() }];
    setMsgs(withQ);
    setText('');
    try {
      if (live) { setBusy('Listening to the last few seconds…'); await lec.flushNow(); }
      setBusy('Thinking…');
      const l = lectureRef.current;
      const { system, prompt } = classChatPrompt({
        question: q, segments: l.segments || [], myNotes: l.my_notes || '',
        notes: l.notes ? notesMarkdown(l.notes, { title: l.title }) : '',
        className: l.class_name, title: l.title, live: !!live, elapsed: live?.elapsed || l.duration || 0, history,
      });
      const reply = await db.integrations.Core.InvokeLLM({ prompt, system, maxTokens: 700 });
      const next = [...withQ, { role: 'ai', text: String(reply || '').trim(), at: Date.now() }].slice(-40);
      setMsgs(next);
      onSaveChat(next);
    } catch (e) {
      setMsgs([...withQ, { role: 'ai', text: `Couldn’t answer that: ${e.message}`, error: true, at: Date.now() }]);
    } finally {
      setBusy('');
    }
  };

  // a recipe tapped elsewhere (the recorder panel) lands here
  useEffect(() => {
    if (!autoAsk) return;
    ask(autoAsk.ask, autoAsk.label);
    onAutoAsked?.();
  }, [autoAsk]); // eslint-disable-line react-hooks/exhaustive-deps

  const recipes = RECIPES.filter(r => live || !r.live);
  const clear = () => { setMsgs([]); onSaveChat([]); };

  return (
    <div className="flex flex-col gap-3">
      {msgs.length === 0 && !busy && (
        <div className="rounded-2xl border border-dashed bg-card p-5 text-center">
          <Sparkles className="mx-auto h-6 w-6 text-primary" aria-hidden="true" />
          <p className="mt-2 text-base font-semibold text-foreground">{live ? 'Ask about the class, right now' : 'Ask about this class'}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {live ? 'Lost focus for a second, or got put on the spot? Tap a quick ask — it reads what was just said.'
              : 'Anything from the transcript and your notes: what a term meant, what’s due, a worked example again.'}
          </p>
        </div>
      )}

      {msgs.length > 0 && (
        <ol className="space-y-3" aria-live="polite">
          {msgs.map((m, i) => (
            <li key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[88%] rounded-2xl px-4 py-2.5 text-base leading-relaxed',
                m.role === 'user' ? 'bg-primary/15 text-foreground' : m.error ? 'border border-red-400/40 bg-card text-red-300' : 'border bg-card text-foreground')}>
                {m.role === 'user' ? m.text : <RichText text={m.text} />}
              </div>
            </li>
          ))}
        </ol>
      )}
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{busy}
        </p>
      )}
      <div ref={end} />

      <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 -mx-1 rounded-2xl border bg-background/95 p-2 shadow-lg backdrop-blur lg:bottom-4">
        <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]" role="group" aria-label="Quick asks">
          {recipes.map(r => (
            <button key={r.id} type="button" disabled={!!busy} onClick={() => ask(r.ask, r.label)}
              className="h-9 flex-none whitespace-nowrap rounded-full border bg-card px-3.5 text-sm font-medium text-foreground hover:border-primary/50 disabled:opacity-50">
              {r.label}
            </button>
          ))}
          {msgs.length > 0 && (
            <button type="button" onClick={clear} aria-label="Clear this conversation"
              className="grid h-9 w-9 flex-none place-items-center rounded-full border bg-card text-muted-foreground hover:text-foreground">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); ask(text); }}>
          <label htmlFor="class-ask" className="sr-only">Ask about this class</label>
          <textarea id="class-ask" rows={1} value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text); } }}
            placeholder={live ? 'What did they just say about…?' : 'Ask about this class…'}
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border bg-card px-3 py-2.5 text-base text-foreground outline-none focus:border-primary/60" />
          <button type="submit" disabled={!text.trim() || !!busy} aria-label="Ask"
            className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </form>
      </div>
    </div>
  );
}
