import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { accounts } from '@/api/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Add or change the account's email: send a code, type it in. */
export default function RecoveryEmail({ current = '', onDone, autoFocus = false }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (e) => {
    e?.preventDefault();
    setBusy(true); setError('');
    try { await accounts.emailStart(email); setStep('code'); setCode(''); }
    catch (err) { setError(err.message); }
    setBusy(false);
  };
  const verify = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await accounts.emailVerify(code); onDone?.(); }
    catch (err) { setError(err.message); setBusy(false); }
  };

  if (step === 'code') {
    return (
      <form onSubmit={verify} className="space-y-3">
        <p className="text-sm text-muted-foreground">We sent a 6-digit code to <strong className="text-foreground">{email}</strong>.</p>
        <div className="space-y-1.5">
          <Label htmlFor="emailCode">Code</Label>
          <Input id="emailCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="tracking-[0.3em]" />
        </div>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || code.length !== 6}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save email</Button>
          <Button type="button" variant="ghost" onClick={send} disabled={busy}>Send again</Button>
          <Button type="button" variant="ghost" onClick={() => { setStep('email'); setError(''); }}>Different email</Button>
        </div>
      </form>
    );
  }
  return (
    <form onSubmit={send} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="recEmail">{current ? 'New email' : 'Email'}</Label>
        <Input id="recEmail" type="email" autoComplete="email" autoFocus={autoFocus} placeholder={current || 'you@example.com'}
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      <Button type="submit" disabled={busy || !email.includes('@')}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send code</Button>
    </form>
  );
}
