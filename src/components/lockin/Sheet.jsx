import React, { useEffect } from 'react';

/** A bottom sheet on phones, a centred dialog on bigger screens. Escape or a tap outside closes it. */
export default function Sheet({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 sm:items-center" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl animate-in slide-in-from-bottom duration-200 sm:rounded-3xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted sm:hidden" aria-hidden="true" />
        <h2 className="mb-2 px-3 text-base font-bold text-foreground">{title}</h2>
        {children}
      </div>
    </div>
  );
}
