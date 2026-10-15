/*
 * The floating bar. It only shows what the main window reports (a recording,
 * a focus block, music, or nothing running) and sends button presses back; the
 * recording, the timer and the music keep running in the main window, hidden behind it.
 * The window is only as big as the pill: it reports its width and the app sizes to it.
 */
const $ = (id) => document.getElementById(id);
let state = { recording: null, focus: null, music: null };

const clock = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

function paint() {
  const { recording: rec, focus: f, music } = state;
  const now = Date.now();
  let dot = '', label = 'LOCK IN!', time = '0:00', mainLabel = 'Start focus';
  if (rec) {
    const secs = rec.paused ? rec.elapsed : rec.elapsed + (now - rec.at) / 1000;
    dot = rec.paused ? 'paused' : 'rec';
    label = rec.paused ? 'Paused' : (rec.title || 'Recording');
    time = clock(secs);
    mainLabel = rec.paused ? 'Resume recording' : 'Pause recording';
  } else if (f && f.status !== 'idle') {
    const left = f.status === 'running' ? (f.endsAt - now) / 1000 : f.remaining;
    dot = f.status === 'paused' ? 'paused' : 'focus';
    label = `${f.phaseLabel}${f.status === 'paused' ? ', paused' : ''}`;
    time = clock(left);
    mainLabel = f.status === 'running' ? 'Pause' : 'Resume';
  } else if (f) {
    label = 'Focus';
    time = clock(f.remaining);
  }
  $('dot').className = `dot ${dot}`;
  $('label').textContent = label;
  $('time').textContent = time;
  $('seg-timer').title = `${label} ${time}`;
  const running = rec ? !rec.paused : f && f.status === 'running';
  // SVG elements have no .hidden property, so the attribute is what gets set
  $('ico-play').toggleAttribute('hidden', !!running);
  $('ico-pause').toggleAttribute('hidden', !running);
  $('toggle').setAttribute('aria-label', mainLabel);
  $('toggle').title = mainLabel;
  $('stop').hidden = !rec;

  // music: its own part of the pill, only while something is loaded
  $('seg-music').hidden = !music;
  if (music) {
    const t = music.title || (music.source === 'spotify' ? 'Spotify' : 'YouTube');
    $('song').textContent = music.artist ? `${t} · ${music.artist}` : t;
    $('seg-music').title = $('song').textContent;
    $('waves').classList.toggle('on', !!music.playing);
    $('m-play').toggleAttribute('hidden', !!music.playing);
    $('m-pause').toggleAttribute('hidden', !music.playing);
    const l = music.playing ? 'Pause music' : 'Play music';
    $('m-toggle').setAttribute('aria-label', l);
    $('m-toggle').title = l;
  }
  fit();
}

// tell the app how wide the pill is, so the window is never bigger than it
let sent = 0;
function fit() {
  const w = Math.ceil($('bar').getBoundingClientRect().width) + 8;
  if (w === sent) return;
  sent = w;
  window.floating.size(w, 36);
}
new ResizeObserver(fit).observe($('bar'));

window.floating.onState((s) => {
  state = { ...s, recording: s.recording ? { ...s.recording, at: Date.now() } : null };
  paint();
});

/* click the pill to open LOCK IN!; press and drag to move it. (The bar does its own dragging so that a plain click still gets through.) */
(function () {
  var bar = $('bar'), start = null, moved = false, last = null;
  bar.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || e.target.closest('button')) return;
    start = { x: e.screenX, y: e.screenY }; last = { x: e.screenX, y: e.screenY }; moved = false;
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener('pointermove', function (e) {
    if (!start) return;
    if (!moved && Math.abs(e.screenX - start.x) + Math.abs(e.screenY - start.y) < 5) return;
    moved = true;
    window.floating.move(e.screenX - last.x, e.screenY - last.y);
    last = { x: e.screenX, y: e.screenY };
  });
  function end(e) {
    if (!start) return;
    var wasDrag = moved; start = null; moved = false;
    try { bar.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
    if (wasDrag) window.floating.drop(); else window.floating.act('expand');
  }
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', function () { start = null; moved = false; });
})();

$('toggle').addEventListener('click', () => window.floating.act(state.recording ? (state.recording.paused ? 'record-resume' : 'record-pause') : 'focus-toggle'));
$('stop').addEventListener('click', () => window.floating.act('record-stop'));
$('ask').addEventListener('click', () => window.floating.act('assistant'));
$('expand').addEventListener('click', () => window.floating.act('expand'));
$('m-toggle').addEventListener('click', () => window.floating.act('music-toggle'));
$('m-next').addEventListener('click', () => window.floating.act('music-next'));

setInterval(paint, 500);
paint();
