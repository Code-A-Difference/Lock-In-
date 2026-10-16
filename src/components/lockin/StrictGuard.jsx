import { useEffect, useRef } from 'react';
import { useFocus } from '@/lib/FocusContext';
import { classifyLink } from '@/lib/strictFocus';
import { toast } from '@/components/ui/use-toast';
import { desktop, isDesktop } from '@/lib/desktop';

/**
 * While a strict block runs, a link to a site that isn't approved can't take the student out of
 * LOCK IN!. One listener on the whole page covers every link: the app's own, the ones in notes and
 * markdown, and whatever the assistant writes. Approved sites open in the desktop app's approved-sites
 * window (or a new tab on the web). On the web this can't stop someone typing an address or opening a
 * new tab by hand; it removes the easy way out, and the app says so.
 */
export default function StrictGuard() {
  const f = useFocus();
  const ref = useRef(f);
  ref.current = f;

  useEffect(() => {
    const onLink = (e) => {
      const F = ref.current;
      if (!F.strictOn || e.defaultPrevented) return;
      const a = e.target?.closest?.('a[href]');
      if (!a) return;
      const kind = classifyLink(a.getAttribute('href'), { pageHost: location.host, allow: F.strictAllow });
      if (kind === 'internal') return;
      if (kind === 'allowed') {
        e.preventDefault();
        if (isDesktop && desktop?.strict?.openSite) desktop.strict.openSite(a.href).catch(() => {});
        else window.open(a.href, '_blank', 'noopener,noreferrer');
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      F.noteBlocked();
      let host = '';
      try { host = new URL(a.href).hostname.replace(/^www\./, ''); } catch (_) { /* not a web address */ }
      toast({ title: 'That site isn’t on your approved list', description: `${host ? `${host} is locked` : 'That link is locked'} until your strict block ends.` });
    };
    document.addEventListener('click', onLink, true);
    document.addEventListener('auxclick', onLink, true);
    return () => { document.removeEventListener('click', onLink, true); document.removeEventListener('auxclick', onLink, true); };
  }, []);

  // note it on the page, so a stray style or script can tell (and the browser tab says so)
  useEffect(() => {
    document.documentElement.toggleAttribute('data-strict', f.strictOn);
    return () => document.documentElement.removeAttribute('data-strict');
  }, [f.strictOn]);

  return null;
}
