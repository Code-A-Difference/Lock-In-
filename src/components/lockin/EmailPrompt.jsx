import React, { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Mail, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import RecoveryEmail from '@/components/lockin/RecoveryEmail';
import { toast } from '@/components/ui/use-toast';

const LATER = 'lockin.emailPrompt.later';

/** Accounts without an email are asked to add one (so a forgotten password can be reset). "Later" waits 3 days. */
export default function EmailPrompt() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!user || user.recoveryEmail) { setOpen(false); return undefined; }
    let later = 0;
    try { later = Number(localStorage.getItem(`${LATER}.${user.username}`)) || 0; } catch (_) { /* private mode */ }
    if (Date.now() - later < 3 * 86400000) return undefined;
    const t = setTimeout(() => setOpen(true), 2500);
    return () => clearTimeout(t);
  }, [user?.username, user?.recoveryEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  const snooze = () => {
    try { localStorage.setItem(`${LATER}.${user.username}`, String(Date.now())); } catch (_) { /* private mode */ }
    setOpen(false);
  };
  if (!user) return null;
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) snooze(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[85] bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[86] w-[calc(100vw-1.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-5 shadow-2xl">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-primary/10 text-primary"><Mail className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-bold text-foreground">Add an email</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-muted-foreground">So you can reset your password if you forget it.</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Later" className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></Dialog.Close>
          </div>
          <div className="mt-4">
            <RecoveryEmail autoFocus onDone={() => { setOpen(false); toast({ title: 'Email added' }); }} />
          </div>
          <button type="button" onClick={snooze} className="mt-3 text-sm text-muted-foreground underline-offset-2 hover:underline">Later</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
