import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Loader2, RotateCcw, Sparkles, Check, X, Trash2, ChevronLeft } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import { MathLine } from '@/components/lockin/RichText';
import { useStudyData } from '@/lib/data';
import { classSources, gatherMaterial } from '@/lib/classQuiz';
import { CARDS_SCHEMA, cardsPrompt, normaliseCards, cardsFromNotes, startRound, gotIt, again } from '@/lib/flashcards';
import { allowOutside } from '@/lib/aiPrefs';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

/**
 * Flashcards in Practice. Make a deck from a class (its lectures' notes and
 * material), from the lecture you came from, or from pasted text; or get one
 * instantly from the key terms your notes already have. Decks save to your
 * account. Study: tap or Space to flip, then "Again" (it comes back soon) or
 * "Got it".
 */
export default function Flashcards({ initial }) {
  const { lectures, classes } = useStudyData();
  const qc = useQueryClient();
  const [decks, setDecks] = useState([]);
  const [studying, setStudying] = useState(null);       // a deck
  const [from, setFrom] = useState(initial?.notes ? 'lecture' : (classes[0]?.name ? 'class' : 'text'));
  const [cls, setCls] = useState(initial?.className || classes[0]?.name || '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await db.entities.StudyHistory.list('-created_date');
      setDecks(all.filter(h => h.type === 'flashcards' && Array.isArray(h.cards)));
    } catch (_) { setDecks([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const material = () => {
    if (from === 'lecture') return initial?.notes || '';
    if (from === 'text') return text.trim();
    return gatherMaterial(classSources(lectures, cls), 24000).text;
  };
  const title = from === 'lecture' ? (initial?.topic || 'Lecture') : from === 'class' ? cls : 'My cards';

  const save = async (cards, name) => {
    const rec = await db.entities.StudyHistory.create({ type: 'flashcards', title: name, cards, created_date: new Date().toISOString() });
    qc.invalidateQueries();
    const deck = { ...rec, type: 'flashcards', title: name, cards };
    setDecks(d => [deck, ...d]);
    return deck;
  };

  const make = async () => {
    const m = material();
    if (m.trim().length < 80) { toast({ title: 'Not enough to make cards from', description: 'Pick a class with notes, or paste more text.', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      const raw = await db.integrations.Core.InvokeLLM({ prompt: cardsPrompt(m, { outside: allowOutside() }), response_json_schema: CARDS_SCHEMA, maxTokens: 3000 });
      const cards = normaliseCards(raw);
      if (!cards.length) throw new Error('No cards came back. Try again.');
      setStudying(await save(cards, title));
    } catch (e) {
      toast({ title: 'Could not make the cards', description: e.message, variant: 'destructive' });
    } finally { setBusy(false); }
  };

  const instant = useMemo(() => cardsFromNotes(from === 'class' ? lectures.filter(l => l.class_name === cls) : from === 'lecture' && initial?.lectureId ? lectures.filter(l => l.id === initial.lectureId) : []),
    [from, cls, lectures, initial]);

  const remove = async (deck) => {
    setDecks(d => d.filter(x => x.id !== deck.id));
    try { await db.entities.StudyHistory.delete(deck.id); } catch (_) { load(); }
  };

  if (studying) return <Study deck={studying} onClose={() => setStudying(null)} />;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border bg-card p-4">
        <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Make cards from">
          {[['class', 'A class'], ...(initial?.notes ? [['lecture', 'This lecture']] : []), ['text', 'Paste text']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFrom(k)} aria-pressed={from === k}
              className={cn('h-9 rounded-md px-3 text-sm font-medium', from === k ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
          ))}
        </div>
        {from === 'class' && (
          <select value={cls} onChange={e => setCls(e.target.value)} aria-label="Class" className="mt-3 h-11 w-full rounded-xl border bg-background px-3 text-base text-foreground sm:text-sm">
            {classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        )}
        {from === 'lecture' && <p className="mt-3 truncate text-sm text-foreground">{initial?.topic}</p>}
        {from === 'text' && (
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5} aria-label="Text to make cards from"
            className="mt-3 w-full rounded-xl border bg-background p-3 text-base text-foreground outline-none focus:border-primary/60" />
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={make} disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{busy ? 'Making cards…' : 'Make cards'}
          </button>
          {instant.length > 0 && (
            <button type="button" onClick={async () => setStudying(await save(instant, `${title} key terms`))}
              className="inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold text-foreground hover:bg-secondary">
              <Layers className="h-4 w-4" />{instant.length} key term{instant.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </section>

      {decks.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Your decks</h2>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {decks.map(d => (
              <li key={d.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <button type="button" onClick={() => setStudying(d)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <Layers className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-foreground">{d.title}</span>
                  <span className="flex-none text-xs text-muted-foreground">{d.cards.length} cards</span>
                </button>
                <button type="button" onClick={() => remove(d)} aria-label={`Delete ${d.title}`}
                  className="grid h-9 w-9 flex-none place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Study({ deck, onClose }) {
  const [round, setRound] = useState(() => startRound(deck.cards.length));
  const [flipped, setFlipped] = useState(false);
  const cur = round.queue[0];
  const done = cur === undefined;
  const card = done ? null : deck.cards[cur];

  const answer = useCallback((knew) => {
    setFlipped(false);
    setRound(r => (knew ? gotIt(r) : again(r)));
  }, []);

  useEffect(() => {
    const k = (e) => {
      if (done || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
      if (e.key === ' ') { e.preventDefault(); setFlipped(f => !f); }
      else if (flipped && (e.key === '1' || e.key === 'ArrowLeft')) answer(false);
      else if (flipped && (e.key === '2' || e.key === 'ArrowRight')) answer(true);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [done, flipped, answer]);

  const total = deck.cards.length;
  const knownCount = round.known.length;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={onClose} aria-label="Back to decks" className="-ml-2 grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary"><ChevronLeft className="h-5 w-5" /></button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{deck.title}</h2>
        <span className="text-sm tabular-nums text-muted-foreground">{knownCount}/{total}</span>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(knownCount / total) * 100}%` }} />
      </div>

      {done ? (
        <div className="rounded-2xl border bg-card p-8 text-center">
          <p className="text-2xl font-bold text-foreground">Done</p>
          <p className="mt-1 text-sm text-muted-foreground">{round.missed.length ? `${round.missed.length} needed another go` : 'Every card first try'}</p>
          <div className="mt-5 flex justify-center gap-2">
            {round.missed.length > 0 && (
              <button type="button" onClick={() => { setRound({ queue: round.missed, known: [], missed: [] }); setFlipped(false); }}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"><RotateCcw className="h-4 w-4" />Practise those</button>
            )}
            <button type="button" onClick={() => { setRound(startRound(total)); setFlipped(false); }}
              className="inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold text-foreground hover:bg-secondary">Start over</button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => setFlipped(f => !f)} aria-label={flipped ? 'Show the front' : 'Show the answer'}
            className="lockin-card group relative block h-64 w-full sm:h-72" data-flipped={flipped ? '1' : '0'}>
            <span className="lockin-card__face lockin-card__front">
              <span className="text-xl font-semibold leading-snug text-foreground sm:text-2xl"><MathLine text={card.front} /></span>
            </span>
            <span className="lockin-card__face lockin-card__back" aria-hidden={!flipped}>
              <span className="text-lg leading-relaxed text-foreground"><MathLine text={card.back} /></span>
            </span>
          </button>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => answer(false)} disabled={!flipped}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-40"><X className="h-4 w-4" />Again</button>
            <button type="button" onClick={() => answer(true)} disabled={!flipped}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"><Check className="h-4 w-4" />Got it</button>
          </div>
          <p className="mt-3 hidden text-center text-xs text-muted-foreground sm:block">Space flips · 1 again · 2 got it</p>
        </>
      )}
    </div>
  );
}
