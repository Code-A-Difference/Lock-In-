import React, { useEffect, useState } from 'react';
import { Code2, Copy, Trash2, X } from 'lucide-react';
import { AI_ENDPOINT } from '@/api/db';
import { checkDevAvailable, devAvailable, devOn, setDevOn, devLog, devEntries, clearDevLog, onDevChange } from '@/lib/aiDev';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

/** Re-render on any developer-mode change (switched, new log entry, an answer arriving). */
export function useAiDev() {
  const [, setN] = useState(0);
  useEffect(() => {
    checkDevAvailable(AI_ENDPOINT);
    return onDevChange(() => setN(n => n + 1));
  }, []);
  return { available: devAvailable(), on: devOn(), log: devLog() };
}

/** Open the AI log, optionally showing only the requests between two points (one chat reply). */
export function openAiLog(range = null) { window.dispatchEvent(new CustomEvent('lockin:ailog', { detail: range })); }

const pre = 'mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-background p-2 font-mono text-[11px] leading-snug text-foreground';
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

function Block({ title, value, open = false }) {
  if (value === undefined || value === null || value === '') return null;
  const text = show(value);
  return (
    <details open={open} className="mt-2">
      <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">{title} <span className="font-normal text-muted-foreground">({kb(text.length)})</span></summary>
      <pre className={pre}>{text}</pre>
    </details>
  );
}

function Call({ c, i }) {
  const k = c.key || {};
  const good = c.status >= 200 && c.status < 300;
  return (
    <div className={cn('mt-2 rounded-lg border p-2', good ? 'border-emerald-500/50' : 'border-red-500/40')}>
      <p className="text-xs font-semibold text-foreground">
        {i + 1}. {k.provider || 'AI service'} {k.model ? <span className="font-mono font-normal">· {k.model}</span> : null}
        <span className={cn('ml-2 rounded px-1.5 py-0.5 font-mono text-[11px]', good ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/15 text-red-700 dark:text-red-300')}>{c.status || 'no answer'}</span>
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">{c.ms} ms, started at +{c.at} ms</span>
      </p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        key: {k.key || '(unknown)'} ({k.keyLength || 0} chars) · id {k.providerId || '?'} · {k.type || '?'}
      </p>
      <p className="font-mono text-[11px] text-muted-foreground">{c.method} {c.url}</p>
      {c.error && <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-300">{c.error}</p>}
      <Block title="Headers" value={c.headers} />
      <Block title="Sent to the provider (exact payload)" value={c.sent} />
      <Block title="Provider's raw reply" value={c.reply} open={!good} />
    </div>
  );
}

export function AiEntry({ e }) {
  const d = e.debug;
  const copy = () => navigator.clipboard?.writeText(JSON.stringify(e, null, 2)).then(() => toast({ title: 'Copied this request as JSON' })).catch(() => {});
  return (
    <li className="rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-bold text-primary">{e.feature}{e.lane ? ` · lane ${e.lane}` : ''}</span>
        <span className="font-mono text-xs text-foreground">{e.status ?? '…'}</span>
        <span className="font-mono text-xs text-muted-foreground">{e.ms == null ? 'waiting…' : `${e.ms} ms in all`}{d ? `, ${d.serverMs} ms on the server` : ''}</span>
        <span className="text-xs text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span>
        <button type="button" onClick={copy} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"><Copy className="h-3 w-3" />Copy</button>
      </div>
      {e.winner && (
        <p className="mt-1 text-xs text-foreground">Answered by <strong>{e.winner.provider?.label || e.winner.provider?.type}</strong>{e.winner.model ? <span className="font-mono"> · {e.winner.model}</span> : null}{e.winner.provider?.id ? <span className="font-mono text-muted-foreground"> · id {e.winner.provider.id}</span> : null}</p>
      )}
      {e.error && <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-300">{e.error}</p>}
      {!d && e.ms != null && <p className="mt-1 text-xs text-muted-foreground">No server trace on this one (the server didn’t send one back: signed out of /admin/, or the request never reached it).</p>}
      <Block title="What the app sent to the AI service" value={e.sent} />
      {d && d.calls && (
        <div className="mt-2">
          <p className="text-xs font-semibold text-foreground">Calls to AI providers: {d.calls.length}{d.curlMulti === false ? ' (this host runs them one at a time)' : ''}</p>
          {d.calls.map((c, i) => <Call key={i} c={c} i={i} />)}
        </div>
      )}
      <Block title="What the app got back (raw)" value={e.raw} />
      {d?.note && <p className="mt-2 text-[11px] text-muted-foreground">{d.note}</p>}
    </li>
  );
}

/** The floating "AI log" button and its panel, shown only with developer mode on. */
export default function AiDevPanel() {
  const dev = useAiDev();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(null);
  useEffect(() => {
    const onOpen = (ev) => { setRange(ev.detail || null); setOpen(true); };
    window.addEventListener('lockin:ailog', onOpen);
    return () => window.removeEventListener('lockin:ailog', onOpen);
  }, []);
  if (!dev.on) return null;
  const list = (range ? devEntries(range[0], range[1]) : dev.log).slice().reverse();
  return (
    <>
      <button type="button" onClick={() => { setRange(null); setOpen(true); }}
        className="fixed bottom-24 left-3 z-[80] inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-2 text-xs font-bold text-foreground shadow-lg hover:bg-accent sm:bottom-4"
        aria-label={`AI developer log, ${dev.log.length} requests`}>
        <Code2 className="h-4 w-4" aria-hidden="true" />AI log {dev.log.length}
      </button>
      {open && (
        <div className="fixed inset-0 z-[90] flex justify-end bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-label="AI developer log" className="flex h-full w-full max-w-2xl flex-col border-l bg-background shadow-2xl">
            <header className="flex items-center gap-2 border-b px-4 py-3">
              <Code2 className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="text-base font-bold text-foreground">AI developer log</h2>
              <span className="text-xs text-muted-foreground">{range ? 'this reply' : `last ${list.length} requests`}</span>
              {range && <button type="button" onClick={() => setRange(null)} className="rounded-md px-2 py-1 text-xs text-primary hover:bg-accent">Show all</button>}
              <button type="button" onClick={clearDevLog} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"><Trash2 className="h-3 w-3" />Clear</button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-accent"><X className="h-4 w-4" /></button>
            </header>
            <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {!list.length && <li className="text-sm text-muted-foreground">Nothing yet. Use any AI feature (the Companion, notes, flashcards…) and each request shows up here.</li>}
              {list.map(e => <AiEntry key={e.id} e={e} />)}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}

/** The switch in Settings (only shown to someone signed in to /admin/ in this browser). */
export function DeveloperSection({ Section, Row, Switch }) {
  const dev = useAiDev();
  return (
    <Section icon={Code2} title="Developer" description="See exactly what every AI feature sends and gets back.">
      <Row id="aidev" label="AI developer mode" hint="Adds an AI log button. Each request shows what the app sent, every call the server made to an AI provider (which key, masked, and which model), the exact payload, the raw replies and the timings. The Companion chat gets a link under each reply. Only you see this: it works because you are signed in to /admin/ in this browser.">
        <Switch id="aidev" checked={dev.on} onCheckedChange={(v) => setDevOn(v)} />
      </Row>
    </Section>
  );
}
