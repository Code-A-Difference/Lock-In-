import React, { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-alert-dialog';
import { ShieldCheck } from 'lucide-react';
import { TERMS_TITLE, TERMS_INTRO, TERMS_SECTIONS, GUARDIAN_LINE, canAccept, makeTermsRecord } from '@/lib/strictTerms';

/**
 * The agreement a student must accept before "Lock my other device too" can be switched on.
 * Nothing is saved unless they tick the box (and, if under 18, the guardian box).
 */
export default function StrictTermsDialog({ open, onOpenChange, onAccept, device = 'web' }) {
  const [agree, setAgree] = useState(false);
  const [under18, setUnder18] = useState(false);
  const [guardianOk, setGuardianOk] = useState(false);
  const check = canAccept({ agree, under18, guardianOk });
  useEffect(() => { if (open) { setAgree(false); setUnder18(false); setGuardianOk(false); } }, [open]);

  const box = 'mt-0.5 h-5 w-5 flex-none rounded border-2 accent-[hsl(var(--primary))]';
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[95] bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[96] flex max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-2xl border bg-background p-5 shadow-2xl sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold text-foreground">{TERMS_TITLE}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">{TERMS_INTRO}</Dialog.Description>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-xl border bg-card px-4 py-3" tabIndex={0} aria-label="Terms and liability notice">
            {TERMS_SECTIONS.map(s => (
              <section key={s.heading}>
                <h3 className="text-sm font-bold text-foreground">{s.heading}</h3>
                {s.body.map((p, i) => <p key={i} className="mt-1 text-sm leading-relaxed text-muted-foreground">{p}</p>)}
              </section>
            ))}
          </div>

          <div className="space-y-2.5">
            <label className="flex cursor-pointer items-start gap-3 text-sm text-foreground">
              <input type="checkbox" className={box} checked={agree} onChange={e => setAgree(e.target.checked)} />
              <span>I have read this and I agree. I understand it is my choice and my risk.</span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-foreground">
              <input type="checkbox" className={box} checked={under18} onChange={e => { setUnder18(e.target.checked); if (!e.target.checked) setGuardianOk(false); }} />
              <span>I am under 18.</span>
            </label>
            {under18 && (
              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-primary/10 px-3 py-2 text-sm text-foreground">
                <input type="checkbox" className={box} checked={guardianOk} onChange={e => setGuardianOk(e.target.checked)} />
                <span>{GUARDIAN_LINE}</span>
              </label>
            )}
            {!check.ok && (agree || under18) && <p role="status" className="text-sm text-muted-foreground">{check.why}</p>}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => onOpenChange(false)}
              className="inline-flex h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold text-foreground hover:bg-secondary">Not now</button>
            <button type="button" disabled={!check.ok}
              onClick={() => { if (check.ok) onAccept(makeTermsRecord({ agree, under18, guardianOk, device })); }}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40">
              I agree, turn it on
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
