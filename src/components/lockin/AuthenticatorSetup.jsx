import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, Loader2, Smartphone } from 'lucide-react';
import { accounts } from '@/api/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';

const copy = (text, title) => navigator.clipboard?.writeText(text).then(() => toast({ title })).catch(() => {});
const onPhone = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

/** The ten recovery codes, shown once: copy or download them. */
export function RecoveryCodes({ codes, username, onDone }) {
  const text = `LOCK IN! recovery codes for ${username}\nEach works once, if your phone is lost.\n\n${codes.join('\n')}\n`;
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `lockin-recovery-codes-${username}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-foreground"><strong>Save these recovery codes.</strong> If you lose your phone, one of them resets your password. Each works once, and they won’t be shown again.</p>
      <ul className="grid grid-cols-2 gap-1.5 rounded-xl border bg-muted/40 p-3 font-mono text-sm text-foreground">
        {codes.map(c => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => copy(text, 'Recovery codes copied')}><Copy className="mr-2 h-4 w-4" />Copy</Button>
        <Button type="button" variant="outline" onClick={download}><Download className="mr-2 h-4 w-4" />Download</Button>
        <Button type="button" onClick={onDone}><Check className="mr-2 h-4 w-4" />I’ve saved them</Button>
      </div>
    </div>
  );
}

/** Set up an authenticator app: scan the QR code (or type the key), then type a code from it. */
export default function AuthenticatorSetup({ username, onDone, autoStart = false, startLabel = 'Set up an authenticator app' }) {
  const [setup, setSetup] = useState(null);       // {secret, pretty, uri}
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setBusy(true); setError('');
    try {
      const s = await accounts.totpStart();
      setSetup(s);
      setQr(await QRCode.toDataURL(s.uri, { margin: 1, width: 220, errorCorrectionLevel: 'M' }));
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  useEffect(() => { if (autoStart) start(); }, []);  

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { setCodes(await accounts.totpConfirm(code)); }
    catch (err) { setError(err.message); }
    setBusy(false);
  };

  if (codes) return <RecoveryCodes codes={codes} username={username} onDone={onDone} />;

  if (!setup) {
    return (
      <div className="space-y-2">
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
        <Button type="button" onClick={start} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{startLabel}</Button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="space-y-4">
      <ol className="space-y-4 text-sm text-foreground">
        <li>
          <p><strong>1.</strong> In an authenticator app (Google Authenticator, Microsoft Authenticator or another), add an account and scan this code.</p>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            {qr && <img src={qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-lg border bg-white p-1.5" />}
            <div className="min-w-0 space-y-2">
              {onPhone && (
                <a href={setup.uri} className="inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-accent">
                  <Smartphone className="h-4 w-4" aria-hidden="true" />Open in my authenticator app
                </a>
              )}
              <p className="text-muted-foreground">Can’t scan? Choose “enter a setup key” and type:</p>
              <button type="button" onClick={() => copy(setup.secret, 'Setup key copied')} title="Copy"
                className="inline-flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm tracking-wider text-foreground hover:bg-accent">
                {setup.pretty}<Copy className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden="true" />
              </button>
            </div>
          </div>
        </li>
        <li>
          <p><strong>2.</strong> Type the 6-digit code the app shows for LOCK IN!.</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="totpCode" className="sr-only">Code from the app</Label>
              <Input id="totpCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456"
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="w-36 text-center tracking-[0.3em]" />
            </div>
            <Button type="submit" disabled={busy || code.length !== 6}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Turn on</Button>
          </div>
        </li>
      </ol>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </form>
  );
}
