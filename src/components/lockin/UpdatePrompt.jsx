/**
 * "An update is available" — shown in the Android and desktop apps when the
 * installed app is older than the newest release (lib/releases.js), with what's
 * new and a download button. "Later" hides it until the next release; it comes
 * back once a day so an important fix isn't missed for good.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Download, Sparkles, X } from 'lucide-react';
import { RELEASES, newer, installedApp, desktopDownload } from '@/lib/releases';

const KEY = 'lockin.update.later';

export default function UpdatePrompt() {
  const [offer, setOffer] = useState(null);   // { kind, from, to, notes, url }
  const btn = useRef(null);

  useEffect(() => {
    let off = false;
    installedApp().then((app) => {
      if (off || !app) return;
      const rel = RELEASES[app.kind];
      if (!rel || !newer(rel.version, app.version)) return;
      try {
        const later = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (later && later.version === rel.version && Date.now() - later.at < 24 * 3600 * 1000) return;
      } catch (_) { /* show it */ }
      const d = window.lockinDesktop;
      setOffer({
        kind: app.kind, from: app.version, to: rel.version, notes: rel.notes,
        url: app.kind === 'android' ? rel.url : desktopDownload(d?.platform, d?.arch),
      });
    });
    return () => { off = true; };
  }, []);

  useEffect(() => { if (offer) setTimeout(() => btn.current?.focus(), 50); }, [offer]);

  if (!offer) return null;
  const later = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ version: offer.to, at: Date.now() })); } catch (_) { /* fine */ }
    setOffer(null);
  };
  const how = offer.kind === 'android'
    ? 'It downloads the new app; open it and tap Install. It installs over this one and keeps your account.'
    : 'Run the download and it installs over this version. Your account and settings stay as they are.';

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="presentation"
      onKeyDown={(e) => { if (e.key === 'Escape') later(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="updTitle"
        className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-primary/15 text-primary"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="updTitle" className="text-lg font-bold text-foreground">An update is available</h2>
            <p className="text-sm text-muted-foreground">LOCK IN! {offer.to} — you have {offer.from}.</p>
          </div>
          <button type="button" onClick={later} aria-label="Remind me later" className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <h3 className="mt-4 text-sm font-semibold text-foreground">What’s new</h3>
        <ul className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
          {offer.notes.map((n) => <li key={n} className="flex gap-2"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-primary" />{n}</li>)}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{how}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={later} className="h-11 rounded-xl border text-sm font-medium text-foreground hover:bg-accent">Later</button>
          <a ref={btn} href={offer.url} target="_blank" rel="noopener" onClick={() => setTimeout(later, 500)}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <Download className="h-4 w-4" aria-hidden="true" />Download {offer.to}
          </a>
        </div>
      </section>
    </div>
  );
}
