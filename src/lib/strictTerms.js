/**
 * The notice a student agrees to before "Lock my other device too" can be switched on.
 *
 * IMPORTANT: this is plain-language draft text written to be honest about what the feature does and
 * does not do. It is NOT legal advice. The school district or organisation that offers LOCK IN! must
 * have it reviewed (especially for students under 18) before the feature is relied on. Changing the
 * text means raising TERMS_VERSION, which asks every student to agree again.
 */
export const TERMS_VERSION = 1;

export const TERMS_TITLE = 'Locking your other device';

export const TERMS_INTRO = 'This is optional. Read it, then decide. You can turn it off any time in Settings → Strict focus.';

export const TERMS_SECTIONS = [
  {
    heading: 'What it does',
    body: [
      'When you start a strict focus block on one device, LOCK IN! can also lock your other signed-in device (your phone or your computer) until the block ends.',
      'On a computer, other websites are blocked and distracting programs are minimised. On an Android phone, with your permission, LOCK IN! brings its focus screen back when you open another app. On an iPhone or iPad the focus screen is shown, but other apps cannot be watched, so please also use Do Not Disturb or Focus.',
    ],
  },
  {
    heading: 'What is never blocked',
    body: [
      'Phone calls, text messages and emergency apps are never blocked. You can always end a lock early: start “End early”, wait the countdown (at least 15 seconds), and confirm. Ending it on either device ends it on both.',
    ],
  },
  {
    heading: 'What it cannot do, and what it does not promise',
    body: [
      'This is a commitment tool, not a guarantee. It cannot stop another device, another account, a VPN, turning the device off, or removing the app. It may stop working if the app is closed by the system, the battery runs out, or the internet is down.',
      'While a lock is on you may not see some messages, notifications or alerts from other apps, and you might not be able to reach something you need. You are responsible for deciding when to lock, for how long, and for ending a lock if you need to.',
    ],
  },
  {
    heading: 'Permissions it will ask for',
    body: [
      'On Android: Usage access (to see which app is in front), Display over other apps (to show the focus screen), notifications (to show that a lock is on), and optionally Do Not Disturb. You can turn any of these off in your phone’s settings; the lock then simply stops working.',
    ],
  },
  {
    heading: 'What is saved',
    body: [
      'The start and end time of each lock, which sites you approved, and a count of how many times a blocked link or program came up. LOCK IN! does not record which apps you opened or what you looked at.',
    ],
  },
  {
    heading: 'Liability',
    body: [
      'You use this feature by choice and at your own risk. LOCK IN!, Code A Difference and the people who make them are not responsible for missed messages, calls, alerts, lost work, battery use, or anything else that results from a lock being on, or from a lock not working as expected.',
    ],
  },
];

export const GUARDIAN_LINE = 'My parent or guardian has read this and agrees that I may use this feature.';

/** What the student has agreed to so far: 'none' (never), 'old' (an older version of the text), or 'ok'. */
export function termsStatus(record, version = TERMS_VERSION) {
  if (!record || typeof record !== 'object' || !record.at) return 'none';
  if (Number(record.v) !== version) return 'old';
  if (record.under18 && !record.guardianOk) return 'none';
  return 'ok';
}

/** May the "I agree" button be pressed? Under 18 also needs the guardian box. */
export function canAccept({ agree = false, under18 = false, guardianOk = false } = {}) {
  if (!agree) return { ok: false, why: 'Tick the box to say you have read and agree.' };
  if (under18 && !guardianOk) return { ok: false, why: 'Because you are under 18, a parent or guardian needs to agree too.' };
  return { ok: true, why: '' };
}

/** What is saved in the profile as `strictTerms`. Throws if the rules above are not met. */
export function makeTermsRecord({ agree, under18, guardianOk, device = 'web', now = Date.now() }) {
  const c = canAccept({ agree, under18, guardianOk });
  if (!c.ok) throw new Error(c.why);
  return { v: TERMS_VERSION, at: now, device: String(device).slice(0, 20), under18: !!under18, guardianOk: !!under18 && !!guardianOk };
}
