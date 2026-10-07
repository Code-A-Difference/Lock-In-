import React, { useEffect, useRef, useState } from 'react';
import { LineChart, Loader2, Maximize2 } from 'lucide-react';
import { loadDesmos, openGraph } from '@/components/lockin/GraphPanel';
import { MathLine } from '@/components/lockin/RichText';

/**
 * A Desmos graph inside lecture notes: the curve the teacher drew, plotted
 * properly. Loads only when scrolled near (a long set of notes may have
 * several), follows the dark/light theme, and opens in the full graphing
 * calculator to play with.
 */
export default function NoteGraph({ graph }) {
  const host = useRef(null);
  const calc = useRef(null);
  const [near, setNear] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return undefined; }
    const io = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return undefined;
    let dead = false;
    loadDesmos().then((Desmos) => {
      if (dead || !host.current) return;
      const dark = document.documentElement.classList.contains('dark');
      const c = Desmos.GraphingCalculator(host.current, {
        expressions: false, keypad: false, settingsMenu: false, zoomButtons: true, border: false,
        lockViewport: false, invertedColors: dark, fontSize: 14,
      });
      graph.expressions.forEach((latex, i) => c.setExpression({ id: `g${i}`, latex }));
      if ('xmin' in graph || 'ymin' in graph) {
        const b = c.graphpaperBounds.mathCoordinates;
        c.setMathBounds({
          left: graph.xmin ?? b.left, right: graph.xmax ?? b.right,
          bottom: graph.ymin ?? b.bottom, top: graph.ymax ?? b.top,
        });
      }
      calc.current = c;
      setReady(true);
    }).catch(e => !dead && setError(e.message));
    return () => { dead = true; calc.current?.destroy?.(); calc.current = null; };
  }, [near, graph]);

  return (
    <figure className="mt-3 overflow-hidden rounded-2xl border bg-card">
      <figcaption className="flex items-center gap-2 border-b px-3 py-2">
        <LineChart className="h-4 w-4 flex-none text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{graph.title || 'Graph'}</span>
        <button type="button" onClick={() => openGraph(graph.expressions)} aria-label="Open in the graphing calculator"
          className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
          <Maximize2 className="h-4 w-4" />
        </button>
      </figcaption>
      <div className="relative h-64 sm:h-72">
        <div ref={host} className="absolute inset-0" role="img" aria-label={`Graph of ${graph.expressions.join(', ')}`} />
        {!ready && !error && (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        )}
        {error && <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted-foreground">{error}</p>}
      </div>
      {(graph.caption || graph.expressions.length) && (
        <div className="space-y-1 border-t px-3 py-2 text-sm text-muted-foreground">
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-foreground">
            {graph.expressions.map((e, i) => <span key={i}><MathLine text={`$${e}$`} /></span>)}
          </p>
          {graph.caption && <p><MathLine text={graph.caption} /></p>}
        </div>
      )}
    </figure>
  );
}
