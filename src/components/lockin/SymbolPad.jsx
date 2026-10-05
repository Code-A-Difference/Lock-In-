import React, { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tap-to-insert symbols for maths, science and chemistry, so a question like
 * "is √(x²+1) ≥ x?" or "balance Fe + O₂ → Fe₂O₃" can be typed on a phone.
 * Each key inserts exactly what's shown, and the assistant reads them fine.
 */
const SETS = {
  Math: ['+', '−', '×', '÷', '=', '≠', '≈', '±', '<', '>', '≤', '≥', '√', '∛', '²', '³', 'ⁿ', '⁻¹', '½', '⅓', '¼', 'π', '∞', '°', '∠', '⊥', '∥', '△', '|x|', '( )', '[ ]', 'f(x)', 'sin', 'cos', 'tan', 'log', 'ln', '∑', '∫', '∂', 'dy/dx', 'lim', '→', '∈', '∪', '∩', '∅'],
  Greek: ['α', 'β', 'γ', 'δ', 'Δ', 'ε', 'θ', 'λ', 'μ', 'π', 'ρ', 'σ', 'Σ', 'τ', 'φ', 'ω', 'Ω', 'η'],
  Chem: ['→', '⇌', '↑', '↓', '₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉', '⁺', '⁻', '²⁺', '³⁺', '²⁻', '(s)', '(l)', '(g)', '(aq)', 'Δ', '°C', 'mol', 'M', 'pH', 'H₂O', 'CO₂', 'O₂', 'NaCl', 'H⁺', 'OH⁻'],
  Physics: ['Δ', 'v⃗', 'Σ', 'Ω', 'μ', 'λ', 'θ', 'ω', '°', 'm/s', 'm/s²', 'N', 'J', 'W', 'kg', 'Hz', 'V', 'A', '×10ⁿ', '≈', '∝'],
};

export default function SymbolPad({ onInsert }) {
  const [tab, setTab] = useState('Math');
  return (
    <div className="border-t bg-secondary/30 px-2.5 pb-2 pt-1.5">
      <div className="mb-1.5 flex gap-1" role="tablist" aria-label="Symbol sets">
        {Object.keys(SETS).map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn('h-7 rounded-md px-2.5 text-xs font-medium', tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{t}</button>
        ))}
      </div>
      <div className="grid max-h-28 grid-cols-8 gap-1 overflow-y-auto sm:grid-cols-10" role="tabpanel">
        {SETS[tab].map(s => (
          <button key={s} type="button" onMouseDown={e => e.preventDefault()} onClick={() => onInsert(s)} aria-label={`Insert ${s}`}
            className="h-9 rounded-md border bg-background text-sm text-foreground hover:border-indigo-300 hover:bg-accent">{s}</button>
        ))}
      </div>
    </div>
  );
}
