/** Pasted links -> something the players understand. Pure, so it is easy to test. */

/** A YouTube or YouTube Music link: { id, list } (a song, a playlist, or both), or null. */
export function parseYouTube(text) {
  const t = String(text || '').trim();
  if (!t || /\s/.test(t)) return null;
  let u;
  try { u = new URL(/^https?:/i.test(t) ? t : `https://${t}`); } catch (_) { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  const list = u.searchParams.get('list');
  if (host === 'youtu.be') id = u.pathname.slice(1, 12);
  else if (host === 'youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else if (/^\/(shorts|embed|live)\//.test(u.pathname)) id = u.pathname.split('/')[2];
  } else return null;
  if (id && !/^[A-Za-z0-9_-]{11}$/.test(id)) id = null;
  if (list && !/^[A-Za-z0-9_-]{10,60}$/.test(list)) return id ? { id, list: null } : null;
  return id || list ? { id, list } : null;
}

/** A Spotify link or URI: { uri, kind } for a track, album, playlist or artist, or null. */
export function parseSpotify(text) {
  const t = String(text || '').trim();
  let m = t.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]{10,30})$/);
  if (!m) m = t.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|artist)\/([A-Za-z0-9]{10,30})/);
  return m ? { uri: `spotify:${m[1]}:${m[2]}`, kind: m[1] } : null;
}

/** "3:07" for 187 */
export function mmss(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
