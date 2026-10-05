import React, { useEffect, useRef, useState } from 'react';
import { LineChart, Loader2, X } from 'lucide-react';

/*
 * Desmos's graphing calculator, inside the app. The assistant opens it with
 * the equations it's talking about ("graph y = x^2 - 4"), and the student can
 * keep graphing from there.
 *
 * The Desmos API needs a key. The public demo key works but Desmos asks
 * production sites to request their own (free for education) at
 * desmos.com/api; set it as VITE_DESMOS_KEY when building.
 */
const KEY = import.meta.env.VITE_DESMOS_KEY || 'dcb31709b452b1cf9dc26972add0fda6';
const SRC = `https://www.desmos.com/api/v1.11/calculator.js?apiKey=${KEY}`;

let loading = null;
function loadDesmos() {
  if (window.Desmos) return Promise.resolve(window.Desmos);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.Desmos ? resolve(window.Desmos) : reject(new Error('Desmos did not load.')));
    s.onerror = () => { loading = null; reject(new Error('Couldn’t reach Desmos. Check the connection.')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Open the graph from anywhere: openGraph(['y=x^2', 'y=2x+1']) */
export function openGraph(expressions = []) {
  window.dispatchEvent(new CustomEvent('lockin:graph', { detail: { expressions } }));
}

export default function GraphPanel() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const host = useRef(null);
  const calc = useRef(null);
  const pending = useRef([]);

  const show = (list) => {
    const c = calc.current;
    if (!c || !list.length) return;
    c.setBlank();
    list.forEach((latex, i) => c.setExpression({ id: `e${i}`, latex: String(latex) }));
  };

  useEffect(() => {
    const onGraph = (e) => {
      pending.current = (e.detail?.expressions || []).filter(Boolean);
      setOpen(true);
      if (calc.current) show(pending.current);
    };
    window.addEventListener('lockin:graph', onGraph);
    return () => window.removeEventListener('lockin:graph', onGraph);
  }, []);

  useEffect(() => {
    if (!open || calc.current) return;
    setError('');
    loadDesmos().then((Desmos) => {
      if (!host.current) return;
      calc.current = Desmos.GraphingCalculator(host.current, { keypad: true, expressions: true, settingsMenu: false, border: false });
      setReady(true);
      show(pending.current);
    }).catch(e => setError(e.message));
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  // kept mounted (hidden) once made, so the graph survives closing and reopening
  return (
    <div className={open ? 'fixed inset-0 z-[60] flex flex-col bg-background' : 'hidden'} role={open ? 'dialog' : undefined} aria-modal={open || undefined} aria-label="Graphing calculator">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))]">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><LineChart className="h-4 w-4 text-indigo-600" />Graph <span className="font-normal text-muted-foreground">· Desmos</span></h2>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close the graph"
          className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-5 w-5" /></button>
      </header>
      <div className="relative min-h-0 flex-1">
        <div ref={host} className="absolute inset-0" />
        {!ready && !error && <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {error && <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-red-700 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
