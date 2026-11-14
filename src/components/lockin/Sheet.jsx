import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A bottom sheet on phones, a centred dialog on bigger screens. Escape, the
 * Close button or a tap outside closes it. Keyboard focus moves into it when it
 * opens, stays inside while it is open, and goes back to where it was after,
 * so someone using a keyboard or a screen reader is never left behind it.
 */
export default function Sheet({ title, onClose, children, wide = false }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement;
    const el = panel.current;
    // the first field or button inside, else the sheet itself (its title is then read out)
    const first = el?.querySelector('[data-autofocus]') || [...(el?.querySelectorAll(FOCUSABLE) || [])].find(x => !x.hasAttribute('data-sheet-close'));
    (first || el)?.focus({ preventScroll: true });
    const k = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === a || !el.contains(document.activeElement))) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && (document.activeElement === z || !el.contains(document.activeElement))) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); before?.focus?.({ preventScroll: true }); };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 sm:items-center" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        className={`max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl outline-none animate-in slide-in-from-bottom duration-200 sm:rounded-3xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted sm:hidden" aria-hidden="true" />
        <div className="mb-2 flex items-center gap-2 pl-3">
          <h2 className="flex-1 text-base font-bold text-foreground">{title}</h2>
          <button type="button" data-sheet-close onClick={onClose} aria-label={`Close ${title}`}
            className="grid h-11 w-11 flex-none place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
