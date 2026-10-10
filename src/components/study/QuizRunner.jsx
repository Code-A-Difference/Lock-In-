import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, Clock, Loader2, MessageCircle, RefreshCw, X, Minus, Sparkles } from 'lucide-react';
import { db } from '@/api/db';
import RichText, { MathLine } from '@/components/lockin/RichText';
import { cn } from '@/lib/utils';
import { gradePrompt, GRADE_SCHEMA, normaliseGrade, scoreQuiz, askPrompt, mmss } from '@/lib/quizKit';

/**
 * Taking a practice quiz, then going over it.
 *
 * - An optional time limit counts down and hands the quiz in when it runs out.
 * - Written answers are graded together (each retried once); one that still
 *   can't be graded says so, with a button to try again, never a silent gap.
 * - Every question has a step-by-step worked solution, with maths rendered.
 * - "Ask about this question" opens a tutor chat that already knows the
 *   question, the student's answer, the solution and the grade.
 */
export default function QuizRunner({ quiz, timeLimit = 0, saved = null, onSubmitted, onNew, onRetake, onRegenerate }) {
  const questions = quiz.questions;
  const [answers, setAnswers] = useState(saved?.answers || {});
  const [grades, setGrades] = useState(saved?.grades || {});
  const [phase, setPhase] = useState(saved ? 'review' : 'taking');   // taking | grading | review
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  const [tookMs, setTookMs] = useState(saved?.tookMs || 0);
  const [onlyMissed, setOnlyMissed] = useState(false);
  const submitting = useRef(false);

  const endsAt = timeLimit ? startedAt + timeLimit * 60000 : 0;
  const left = endsAt ? Math.max(0, (endsAt - now) / 1000) : null;

  useEffect(() => {
    if (phase !== 'taking' || !endsAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase, endsAt]);
  useEffect(() => { if (phase === 'taking' && left === 0) submit(true); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  const answeredCount = questions.filter((q, i) => (q.type === 'written' ? String(answers[`w${i}`] || '').trim() : answers[i] != null)).length;
  const score = useMemo(() => scoreQuiz(questions, answers, grades), [questions, answers, grades]);

  const gradeOne = async (i) => {
    const q = questions[i];
    const answer = String(answers[`w${i}`] || '').trim();
    if (!answer) return { score: 0, verdict: 'incorrect', what_was_right: '', what_was_missing: 'No answer was given.', missing_points: q.key_points || [] };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const g = await db.integrations.Core.InvokeLLM({ prompt: gradePrompt(q, answer), response_json_schema: GRADE_SCHEMA, maxTokens: 700 });
        return normaliseGrade(g);
      } catch (e) {
        if (attempt === 1) return { error: e.message || 'Couldn’t grade this one.' };
      }
    }
    return { error: 'Couldn’t grade this one.' };
  };

  const submit = async (timeUp = false) => {
    if (submitting.current) return;
    if (!timeUp && answeredCount < questions.length
        && !window.confirm(`${questions.length - answeredCount} question${questions.length - answeredCount === 1 ? ' isn’t' : 's aren’t'} answered. Hand in anyway?`)) return;
    submitting.current = true;
    const took = Date.now() - startedAt;
    setTookMs(took);
    setPhase('grading');
    const written = questions.map((q, i) => (q.type === 'written' ? i : -1)).filter(i => i >= 0);
    const results = await Promise.all(written.map(async i => [i, await gradeOne(i)]));
    const g = Object.fromEntries(results);
    setGrades(g);
    setPhase('review');
    submitting.current = false;
    onSubmitted?.({ answers, grades: g, score: scoreQuiz(questions, answers, g), tookMs: took, timeUp });
  };

  const gradesRef = useRef(grades);
  gradesRef.current = grades;
  const regrade = async (i) => {
    setGrades(g => ({ ...g, [i]: { grading: true } }));
    const r = await gradeOne(i);
    const next = { ...gradesRef.current, [i]: r };
    setGrades(next);
    onSubmitted?.({ answers, grades: next, score: scoreQuiz(questions, answers, next), tookMs, regraded: true });
  };

  /* ---------------------------------------------------------- taking it */
  if (phase === 'taking') {
    return (
      <div className="space-y-4">
        <div className="sticky top-14 z-10 -mx-1 flex items-center gap-3 rounded-xl border bg-background/95 px-3 py-2 backdrop-blur lg:top-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{quiz.title || 'Practice quiz'}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{answeredCount}/{questions.length} answered</span>
          {left != null && (
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums',
              left <= 60 ? 'bg-red-500/15 text-red-300' : 'bg-secondary text-foreground')} role="timer" aria-label={`${mmss(left)} left`}>
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />{mmss(left)}
            </span>
          )}
        </div>
        {questions.map((q, i) => (
          <section key={i} className="rounded-2xl border bg-card p-4" aria-labelledby={`q${i}`}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Question {i + 1} · {q.type === 'written' ? 'Written' : 'Multiple choice'}
            </p>
            <div id={`q${i}`} className="text-base font-medium text-foreground"><RichText text={q.question} /></div>
            {q.source && <p className="mt-1 text-xs text-muted-foreground">From: {q.source}</p>}
            {q.type === 'written' ? (
              <textarea value={answers[`w${i}`] || ''} onChange={e => setAnswers(a => ({ ...a, [`w${i}`]: e.target.value }))} rows={5}
                placeholder="Show your working…" aria-label={`Your answer to question ${i + 1}`}
                className="mt-3 w-full rounded-xl border bg-background p-3 text-base text-foreground outline-none focus:border-primary/60" />
            ) : (
              <div className="mt-3 space-y-2" role="radiogroup" aria-labelledby={`q${i}`}>
                {q.options.map((opt, o) => (
                  <label key={o} className={cn('flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm',
                    answers[i] === o ? 'border-primary/60 bg-primary/10' : 'hover:bg-secondary')}>
                    <input type="radio" name={`q-${i}`} className="h-4 w-4 flex-none" checked={answers[i] === o} onChange={() => setAnswers(a => ({ ...a, [i]: o }))} />
                    <span className="text-foreground"><MathLine text={opt} /></span>
                  </label>
                ))}
              </div>
            )}
          </section>
        ))}
        <button type="button" onClick={() => submit(false)} className="h-12 w-full rounded-xl bg-primary font-semibold text-primary-foreground">
          Hand in{answeredCount < questions.length ? ` (${answeredCount}/${questions.length} answered)` : ''}
        </button>
      </div>
    );
  }

  if (phase === 'grading') {
    return (
      <div className="py-12 text-center" role="status">
        <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Marking your answers…</p>
      </div>
    );
  }

  /* ----------------------------------------------------------- the review */
  const missed = (i) => {
    const p = score.per[i];
    return p.points == null || p.points < 1;
  };
  const shown = questions.map((q, i) => i).filter(i => !onlyMissed || missed(i));
  const pct = score.percent;
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border bg-card p-5 text-center">
        <p className="text-4xl font-bold tabular-nums text-foreground">{score.points}<span className="text-2xl text-muted-foreground">/{score.total}</span></p>
        <p className="mt-1 text-sm text-muted-foreground">
          {pct}%{tookMs ? ` · ${mmss(tookMs / 1000)}` : ''}{score.pending ? ` · ${score.pending} still to mark` : ''}
          {' · '}{pct >= 90 ? 'Excellent.' : pct >= 70 ? 'Good work.' : pct >= 50 ? 'Getting there.' : 'Worth another go.'}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => setOnlyMissed(v => !v)} aria-pressed={onlyMissed}
            className={cn('h-10 rounded-xl border px-3 text-sm font-semibold', onlyMissed ? 'border-primary/60 bg-primary/10 text-foreground' : 'text-foreground hover:bg-secondary')}>
            {onlyMissed ? 'Show all questions' : 'Only what I missed'}
          </button>
        </div>
      </section>

      {shown.map(i => (
        <ReviewCard key={i} q={questions[i]} i={i} answer={questions[i].type === 'written' ? answers[`w${i}`] : answers[i]}
          grade={grades[i]} per={score.per[i]} onRegrade={() => regrade(i)} />
      ))}
      {onlyMissed && !shown.length && <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing missed, every question was right.</p>}

      <div className="grid gap-2 sm:grid-cols-3">
        <button type="button" onClick={onRetake} className="h-12 rounded-xl border text-sm font-semibold text-foreground hover:bg-secondary">Retake these questions</button>
        <button type="button" onClick={onRegenerate} className="h-12 rounded-xl border text-sm font-semibold text-foreground hover:bg-secondary">
          <Sparkles className="mr-1.5 inline h-4 w-4" />New questions, same settings
        </button>
        <button type="button" onClick={onNew} className="h-12 rounded-xl bg-primary text-sm font-semibold text-primary-foreground">New quiz</button>
      </div>
    </div>
  );
}

function ReviewCard({ q, i, answer, grade, per, onRegrade }) {
  const written = q.type === 'written';
  const ok = written ? grade?.verdict === 'correct' : per.correct;
  const partly = written && grade?.verdict === 'partly correct';
  const [showSteps, setShowSteps] = useState(!ok);
  const [asking, setAsking] = useState(false);
  const tone = grade?.error || grade?.grading ? 'border-border' : ok ? 'border-emerald-500/40' : partly ? 'border-amber-500/40' : 'border-red-500/40';
  return (
    <section className={cn('rounded-2xl border-2 bg-card p-4', tone)} aria-labelledby={`r${i}`}>
      <div className="flex items-start gap-2">
        <span className={cn('mt-0.5 grid h-7 min-w-[1.75rem] flex-none place-items-center rounded-full px-1.5 text-xs font-bold',
          ok ? 'bg-emerald-500/15 text-emerald-300' : partly ? 'bg-amber-500/15 text-amber-300' : grade?.error || grade?.grading ? 'bg-secondary text-muted-foreground' : 'bg-red-500/15 text-red-300')}>
          {ok ? <Check className="h-4 w-4" aria-label="Correct" /> : partly ? <Minus className="h-4 w-4" aria-label="Partly correct" /> : grade?.error || grade?.grading ? '?' : <X className="h-4 w-4" aria-label="Incorrect" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Question {i + 1}{written && typeof grade?.score === 'number' ? ` · ${grade.score}/10` : ''}{q.source ? ` · ${q.source}` : ''}
          </p>
          <div id={`r${i}`} className="mt-1 text-base font-medium text-foreground"><RichText text={q.question} /></div>
        </div>
      </div>

      {written ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-xl bg-secondary/60 p-3">
            <p className="text-xs font-semibold text-muted-foreground">Your answer</p>
            <div className="mt-1 text-sm text-foreground">{String(answer || '').trim() ? <RichText text={answer} /> : <em>Left blank</em>}</div>
          </div>
          {grade?.grading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Marking…</p>}
          {grade?.error && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              Couldn’t mark this one ({grade.error}).
              <button type="button" onClick={onRegrade} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-200 px-3 font-semibold text-amber-950"><RefreshCw className="h-3.5 w-3.5" />Mark it again</button>
            </div>
          )}
          {typeof grade?.score === 'number' && (
            <div className="space-y-2 text-sm">
              {grade.what_was_right && <p className="text-foreground"><span className="font-semibold text-emerald-300">What you got right: </span><MathLine text={grade.what_was_right} /></p>}
              {grade.what_was_missing && <p className="text-foreground"><span className="font-semibold text-amber-300">What to fix: </span><MathLine text={grade.what_was_missing} /></p>}
              {grade.missing_points?.length > 0 && (
                <div><p className="font-semibold text-foreground">A full answer also mentions:</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-foreground">{grade.missing_points.map((m, k) => <li key={k}><MathLine text={m} /></li>)}</ul>
                </div>
              )}
            </div>
          )}
          {q.ideal_answer && <p className="text-sm text-foreground"><span className="font-semibold">Answer: </span><MathLine text={q.ideal_answer} /></p>}
        </div>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {q.options.map((opt, o) => {
            const right = o === q.correct;
            const chosen = o === answer;
            return (
              <li key={o} className={cn('rounded-xl border px-3 py-2 text-sm',
                right ? 'border-emerald-500/50 bg-emerald-500/10' : chosen ? 'border-red-500/50 bg-red-500/10' : 'border-border')}>
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-foreground"><MathLine text={opt} /></span>
                  {right && <span className="flex-none text-xs font-semibold text-emerald-300">Correct</span>}
                  {chosen && !right && <span className="flex-none text-xs font-semibold text-red-300">Your answer</span>}
                </div>
                {chosen && !right && q.wrong_explanations?.[o] && <p className="mt-1 text-xs text-muted-foreground"><MathLine text={q.wrong_explanations[o]} /></p>}
              </li>
            );
          })}
          {answer == null && <li className="text-sm italic text-muted-foreground">Not answered</li>}
        </ul>
      )}

      {q.steps?.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowSteps(v => !v)} aria-expanded={showSteps}
            className="inline-flex h-9 items-center gap-1.5 text-sm font-semibold text-foreground">
            <ChevronDown className={cn('h-4 w-4 transition-transform', showSteps && 'rotate-180')} />Worked solution, step by step
          </button>
          {showSteps && (
            <ol className="mt-2 space-y-2">
              {q.steps.map((s, k) => (
                <li key={k} className="flex gap-3 rounded-xl bg-secondary/50 p-3 text-sm text-foreground">
                  <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-primary/20 text-xs font-bold text-foreground">{k + 1}</span>
                  <div className="min-w-0 flex-1 overflow-x-auto"><RichText text={s} /></div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <div className="mt-3">
        {!asking ? (
          <button type="button" onClick={() => setAsking(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold text-foreground hover:bg-secondary">
            <MessageCircle className="h-4 w-4" />Ask about this question
          </button>
        ) : (
          <QuestionChat q={q} number={i + 1} answer={answer} grade={grade} />
        )}
      </div>
    </section>
  );
}

const STARTERS = ['Why is my answer wrong?', 'Explain the steps more simply', 'Give me a similar question to try'];

function QuestionChat({ q, number, answer, grade }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [msgs.length, busy]);
  const ask = async (message) => {
    const m = message.trim();
    if (!m || busy) return;
    const history = msgs;
    setMsgs([...history, { role: 'user', text: m }]);
    setText('');
    setBusy(true);
    try {
      const { system, prompt } = askPrompt({ q, number, answer, grade: typeof grade?.score === 'number' ? grade : null, history, message: m });
      const reply = await db.integrations.Core.InvokeLLM({ prompt, system, maxTokens: 1200 });
      setMsgs(list => [...list, { role: 'ai', text: String(reply || '').trim() }]);
    } catch (e) {
      setMsgs(list => [...list, { role: 'ai', text: `Couldn’t answer that: ${e.message}`, error: true }]);
    } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border bg-background p-3">
      {msgs.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {STARTERS.map(s => (
            <button key={s} type="button" onClick={() => ask(s)} className="h-9 rounded-full border bg-card px-3 text-sm text-foreground hover:border-primary/50">{s}</button>
          ))}
        </div>
      )}
      {msgs.length > 0 && (
        <ol className="space-y-2" aria-live="polite">
          {msgs.map((m, k) => (
            <li key={k} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[92%] rounded-2xl px-3 py-2 text-sm', m.role === 'user' ? 'bg-primary/15 text-foreground' : m.error ? 'border border-red-400/40 text-red-300' : 'border bg-card text-foreground')}>
                {m.role === 'user' ? m.text : <RichText text={m.text} />}
              </div>
            </li>
          ))}
        </ol>
      )}
      {busy && <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Thinking…</p>}
      <div ref={end} />
      <form className="mt-2 flex items-end gap-2" onSubmit={e => { e.preventDefault(); ask(text); }}>
        <label htmlFor={`ask-${number}`} className="sr-only">Ask about question {number}</label>
        <textarea id={`ask-${number}`} rows={1} value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text); } }}
          placeholder="Ask anything about this question…" className="max-h-28 min-h-[44px] flex-1 resize-none rounded-xl border bg-card px-3 py-2.5 text-base text-foreground outline-none focus:border-primary/60" />
        <button type="submit" disabled={!text.trim() || busy} aria-label="Ask" className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40">
          <ArrowUp className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}
