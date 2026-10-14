/**
 * Spotify, as a remote control. LOCK IN! signs the student in (PKCE, so there is
 * no secret in the app), searches, and tells the Spotify app, which is the thing
 * that actually plays, what to do. That is why it works in the desktop app and on
 * a phone, where Spotify's in-browser player can't. Playing needs Spotify Premium,
 * and the Spotify app open on some device.
 */
const AUTH = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
const KEY = 'lockin.spotify';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
const write = (v) => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (_) { /* private mode */ } };

export const redirectUri = () => `${location.origin}${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/Music`;
export const isConnected = () => !!read()?.refresh;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** Send the student to Spotify to say yes. */
export async function connect(clientId) {
  const verifier = rand(48);
  const state = rand(12);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem('lockin.spotify.pkce', JSON.stringify({ verifier, state, clientId }));
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: SCOPES, redirect_uri: redirectUri(), code_challenge_method: 'S256', code_challenge: challenge, state });
  location.assign(`${AUTH}/authorize?${q}`);
}

async function token(params) {
  const r = await fetch(`${AUTH}/api/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || 'Spotify said no.');
  return j;
}

/** Back from Spotify with ?code=...&state=...: finish signing in. Returns true if it was a sign-in. */
export async function finishConnect(search) {
  const p = new URLSearchParams(search);
  if (!p.get('code') && !p.get('error')) return false;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('lockin.spotify.pkce') || 'null'); } catch (_) { /* none */ }
  sessionStorage.removeItem('lockin.spotify.pkce');
  if (p.get('error')) throw new Error('Spotify wasn’t connected.');
  if (!saved || saved.state !== p.get('state')) throw new Error('That Spotify sign-in didn’t match this one. Try connecting again.');
  const j = await token({ grant_type: 'authorization_code', code: p.get('code'), redirect_uri: redirectUri(), client_id: saved.clientId, code_verifier: saved.verifier });
  write({ clientId: saved.clientId, access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
  return true;
}

export const disconnect = () => write(null);

async function access() {
  const s = read();
  if (!s) throw Object.assign(new Error('Connect Spotify first.'), { code: 'auth' });
  if (Date.now() < s.expires) return s.access;
  try {
    const j = await token({ grant_type: 'refresh_token', refresh_token: s.refresh, client_id: s.clientId });
    write({ ...s, access: j.access_token, refresh: j.refresh_token || s.refresh, expires: Date.now() + (j.expires_in - 60) * 1000 });
    return j.access_token;
  } catch (e) { write(null); throw Object.assign(new Error('Spotify signed you out. Connect it again.'), { code: 'auth' }); }
}

async function api(path, opts = {}) {
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${await access()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => null);
  if (r.ok) return j;
  const msg = j?.error?.message || `Spotify had a problem (${r.status}).`;
  throw Object.assign(new Error(
    r.status === 404 ? 'Open the Spotify app on this computer or your phone, play anything for a second, then try again.'
      : r.status === 403 ? 'Spotify only lets Premium accounts be controlled from other apps.'
      : r.status === 429 ? 'Spotify asked us to slow down. Try again in a few seconds.' : msg), { status: r.status });
}

const trackOf = (t) => t && {
  uri: t.uri, id: t.id, title: t.name, artist: (t.artists || []).map((a) => a.name).join(', '),
  art: t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '', duration: Math.round((t.duration_ms || 0) / 1000),
};

export async function search(q) {
  const j = await api(`/search?${new URLSearchParams({ q, type: 'track', limit: '12' })}`);
  return (j?.tracks?.items || []).map(trackOf);
}

/** What Spotify is playing right now: { track, playing, device } or null if nothing is. */
export async function nowPlaying() {
  const j = await api('/me/player');
  if (!j || !j.item) return null;
  return { track: trackOf(j.item), playing: !!j.is_playing, device: j.device?.name || '', progress: Math.round((j.progress_ms || 0) / 1000) };
}

/** Play a track (or an album/playlist context) on whatever device is active. */
export async function play({ uri, kind = 'track' }) {
  const body = kind === 'track' ? { uris: [uri] } : { context_uri: uri };
  await api('/me/player/play', { method: 'PUT', body: JSON.stringify(body) });
}
export const resume = () => api('/me/player/play', { method: 'PUT' });
export const pause = () => api('/me/player/pause', { method: 'PUT' });
export const next = () => api('/me/player/next', { method: 'POST' });
export const previous = () => api('/me/player/previous', { method: 'POST' });
