import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Mic, Flame, Timer, CheckCircle2, Target, Layers, Presentation, Crown, Sparkles, Lock } from 'lucide-react';
import { db } from '@/api/db';
import { useStudyData } from '@/lib/data';
import { badges, claimable, nextUp } from '@/lib/badges';
import Sheet from '@/components/lockin/Sheet';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

const ICONS = { Mic, Flame, Timer, CheckCircle2, Target, Layers, Presentation, Crown, Sparkles };

/** Every badge for the signed-in student, worked out from their data plus the server's "firsts". */
export function useBadges() {
  const data = useStudyData();
  const history = useQuery({ queryKey: ['badge-history'], queryFn: () => db.entities.StudyHistory.list(), staleTime: 60_000 });
  const input = { lectures: data.lectures, sessions: data.sessions, homework: data.allHomework, history: history.data || [] };
  const claim = claimable(input).join(',');
  const firsts = useQuery({
    queryKey: ['firsts', data.user?.username, claim],
    queryFn: () => db.badges.firsts(),
    enabled: !!data.user,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const list = useMemo(() => badges(input, firsts.data || {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.lectures, data.sessions, data.allHomework, history.data, firsts.data]);
  return { list, earned: list.filter(b => b.earned), ready: !data.isLoading && history.isSuccess, user: data.user };
}

/** Says "New badge" when one is earned, anywhere in the app. Mounted once, in the layout. */
export function BadgeWatcher() {
  const { earned, ready, user } = useBadges();
  useEffect(() => {
    if (!ready || !user) return;
    const key = `lockin.badges.seen.${user.username || user.email || ''}`;
    let seen = null;
    try { seen = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_e) { seen = null; }
    const ids = earned.map(b => b.id);
    const fresh = Array.isArray(seen) ? earned.filter(b => !seen.includes(b.id)) : [];
    try { localStorage.setItem(key, JSON.stringify(ids)); } catch (_e) { /* private window */ }
    if (!Array.isArray(seen)) return;           // first time on this device: no fanfare for old ones
    if (fresh.length === 1) toast({ title: `New badge: ${fresh[0].title}`, description: fresh[0].desc });
    else if (fresh.length > 1) toast({ title: `${fresh.length} new badges`, description: fresh.map(b => b.title).join(', ') });
  }, [earned, ready, user]);
  return null;
}

/** A small "N badges" button that opens them all. */
export function BadgesButton({ className }) {
  const { list, earned } = useBadges();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={cn('inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium text-foreground hover:bg-secondary', className)}>
        <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        {earned.length} {earned.length === 1 ? 'badge' : 'badges'}
      </button>
      {open && <BadgesSheet list={list} onClose={() => setOpen(false)} />}
    </>
  );
}

function BadgesSheet({ list, onClose }) {
  const next = nextUp(list);
  const earned = list.filter(b => b.earned);
  const locked = list.filter(b => !b.earned);
  return (
    <Sheet title="Badges" onClose={onClose} wide>
      <div className="px-3 pb-3">
        {next && (
          <div className="mb-4 rounded-xl bg-secondary p-3">
            <p className="text-xs font-medium text-muted-foreground">Next up</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">{next.title}</p>
            <p className="text-sm text-muted-foreground">{next.desc}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background" role="progressbar" aria-label={`${next.title} progress`} aria-valuenow={next.have} aria-valuemin={0} aria-valuemax={next.need}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${(next.have / next.need) * 100}%` }} />
            </div>
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">{next.have} of {next.need}</p>
          </div>
        )}
        {earned.length > 0 && <Grid items={earned} />}
        {locked.length > 0 && (
          <>
            <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Still to earn</h3>
            <Grid items={locked} />
          </>
        )}
        <p className="mt-5 text-xs text-muted-foreground">Gold badges go to the first student on LOCK IN! to get there.</p>
      </div>
    </Sheet>
  );
}

function Grid({ items }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map(b => {
        const Icon = ICONS[b.icon] || Trophy;
        return (
          <li key={b.id} className={cn('flex items-start gap-2.5 rounded-xl border p-2.5', !b.earned && 'opacity-60')}>
            <span className={cn('grid h-9 w-9 flex-none place-items-center rounded-full',
              b.first ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
                : b.earned ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground')}>
              {b.earned ? <Icon className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight text-foreground">{b.title}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{b.earned ? b.desc : `${b.desc} · ${b.have}/${b.need}`}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
