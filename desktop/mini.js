/*
 * The floating bar. It only shows what the main window reports (a recording,
 * a focus block, or nothing running) and sends button presses back; the
 * recording and the timer keep running in the main window, hidden behind it.
 */
const $ = (id) => document.getElementById(id);
let state = { recording: null, focus: null };

const clock = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

function paint() {
  const { recording: rec, focus: f } = state;
  const now = Date.now();
  let dot = '', label = 'LOCK IN!', time = 'Ready', mainLabel = 'Start focus';
  if (rec) {
    const secs = rec.paused ? rec.elapsed : rec.elapsed + (now - rec.at) / 1000;
    dot = rec.paused ? 'paused' : 'rec';
    label = rec.paused ? 'Recording paused' : (rec.title || 'Recording');
    time = clock(secs);
    mainLabel = rec.paused ? 'Resume recording' : 'Pause recording';
  } else if (f && f.status !== 'idle') {
    const left = f.status === 'running' ? (f.endsAt - now) / 1000 : f.remaining;
    dot = f.status === 'paused' ? 'paused' : 'focus';
    label = `${f.phaseLabel}${f.status === 'paused' ? ', paused' : ''}${f.task ? ` · ${f.task}` : ''}`;
    time = clock(left);
    mainLabel = f.status === 'running' ? 'Pause' : 'Resume';
  } else if (f) {
    label = 'Focus';
    time = clock(f.remaining);
  }
  $('dot').className = `dot ${dot}`;
  $('label').textContent = label;
  $('time').textContent = time;
  const running = rec ? !rec.paused : f && f.status === 'running';
  // SVG elements have no .hidden property, so the attribute is what gets set
  $('ico-play').toggleAttribute('hidden', !!running);
  $('ico-pause').toggleAttribute('hidden', !running);
  $('toggle').setAttribute('aria-label', mainLabel);
  $('toggle').title = mainLabel;
  $('stop').hidden = !rec;
}

window.floating.onState((s) => {
  state = { ...s, recording: s.recording ? { ...s.recording, at: Date.now() } : null };
  paint();
});

$('toggle').addEventListener('click', () => window.floating.act(state.recording ? (state.recording.paused ? 'record-resume' : 'record-pause') : 'focus-toggle'));
$('stop').addEventListener('click', () => window.floating.act('record-stop'));
$('ask').addEventListener('click', () => window.floating.act('assistant'));
$('expand').addEventListener('click', () => window.floating.act('expand'));

setInterval(paint, 500);
paint();
