/**
 * Noticing that an online class or call has started, so LOCK IN! can offer to
 * record it (as Granola does for meetings).
 *
 * Windows keeps a record of which apps are using the microphone right now —
 * it's what lights the mic icon in the taskbar. An app whose LastUsedTimeStop
 * is 0 is using it at this moment. On a Mac there's no such list, so Zoom's
 * in-meeting helper process (CptHost) is looked for instead.
 *
 * `parseMicUsers` is pure; test/meetings.test.mjs runs it.
 */
const { execFile } = require('child_process');

const NAMES = [
  [/zoom|cpthost/i, 'Zoom'],
  [/teams/i, 'Microsoft Teams'],
  [/webex|atmgr|ciscocollab/i, 'Webex'],
  [/discord/i, 'Discord'],
  [/slack/i, 'Slack'],
  [/skype/i, 'Skype'],
  [/chrome|msedge|firefox|brave|opera|vivaldi|arc\b/i, 'your browser (Google Meet or another call)'],
];
const IGNORE = /lock ?in|electron|nvidia|realtek|soundrec|voicerecorder|obs64|sound ?recorder/i;

/** `reg query … /s` output -> the names of apps using the microphone right now. */
function parseMicUsers(text) {
  const inUse = new Set();
  let key = '';
  for (const line of String(text).split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) { key = line.trim(); continue; }
    const m = line.match(/LastUsedTimeStop\s+REG_QWORD\s+(0x[0-9a-f]+)/i);
    if (!m || !key || parseInt(m[1], 16) !== 0) continue;
    const app = key.split('\\').pop().replace(/#/g, '\\');
    if (IGNORE.test(app)) continue;
    const named = NAMES.find(([re]) => re.test(app));
    if (named) inUse.add(named[1]);
  }
  return [...inUse];
}

function run(cmd, args) {
  return new Promise(resolve => execFile(cmd, args, { windowsHide: true, timeout: 8000, maxBuffer: 4 << 20 }, (e, out) => resolve(e ? '' : out)));
}

async function current() {
  if (process.platform === 'win32') {
    const base = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
    return parseMicUsers(await run('reg', ['query', base, '/s', '/v', 'LastUsedTimeStop']));
  }
  if (process.platform === 'darwin') {
    return (await run('pgrep', ['-x', 'CptHost'])).trim() ? ['Zoom'] : [];
  }
  return [];
}

/** Calls `onStart(name)` when an app starts a call, `onEnd(name)` when it ends. */
function watch({ onStart, onEnd, everyMs = 15000 }) {
  let seen = null;          // the first look is only a baseline: a call already going when LOCK IN! opens isn't news
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const now = new Set(await current());
    if (seen) {
      for (const n of now) if (!seen.has(n)) onStart?.(n);
      for (const n of seen) if (!now.has(n)) onEnd?.(n);
    }
    seen = now;
  };
  tick();
  const t = setInterval(tick, everyMs);
  return () => { stopped = true; clearInterval(t); };
}

module.exports = { parseMicUsers, current, watch };
