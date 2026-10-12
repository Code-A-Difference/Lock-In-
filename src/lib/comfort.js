/*
 * Reading comfort: text size, a more readable typeface, roomier spacing, calmer
 * motion and stronger contrast. These belong to the device, not the account, so
 * they are kept in localStorage and applied before the first paint.
 */
const KEY = 'lockin-comfort';
export const DEFAULTS = { size: 100, font: false, space: false, calm: false, contrast: false };
export const SIZES = [100, 115, 130];

export function readComfort() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

export function applyComfort(c = readComfort()) {
  const root = document.documentElement;
  root.style.fontSize = SIZES.includes(c.size) && c.size !== 100 ? c.size + '%' : '';
  root.classList.toggle('comfort-font', !!c.font);
  root.classList.toggle('comfort-space', !!c.space);
  root.classList.toggle('comfort-calm', !!c.calm);
  root.classList.toggle('comfort-contrast', !!c.contrast);
}

export function saveComfort(patch) {
  const next = { ...readComfort(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: it still applies for this visit */ }
  applyComfort(next);
  return next;
}
