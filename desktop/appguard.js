'use strict';
/**
 * Keeps other programs from pulling a student away during a strict block: when one that is on the list
 * comes to the front it is minimised (Windows) and LOCK IN! is brought forward with a short notice.
 * Nothing is ever closed or killed, so no one loses unsaved work. Task Manager and the system's own
 * windows are never touched. If the watcher can't run (PowerShell blocked by the school, say) this says
 * so once and everything else about strict focus carries on.
 *
 * Windows: one hidden, long-lived PowerShell looks at the front window about twice a second and
 * minimises it itself when it is on the list, then reports it. It stops when LOCK IN! does.
 * macOS: polls `lsappinfo` (no permission needed). It can bring LOCK IN! back but not hide the app.
 */
const { spawn } = require('child_process');

/** Programs that pull attention away. Students add their own; this is only where the list starts. */
const DEFAULT_BLOCK = [
  // browsers (the approved-sites window is the way to use the web during a block)
  'chrome', 'msedge', 'firefox', 'brave', 'opera', 'opera_gx', 'vivaldi', 'iexplore', 'arc', 'tor',
  'google chrome', 'safari', 'microsoft edge',
  // chat
  'discord', 'whatsapp', 'telegram', 'signal', 'messenger', 'snapchat',
  // games and launchers
  'steam', 'steamwebhelper', 'epicgameslauncher', 'battle.net', 'riotclientservices', 'leagueclient', 'valorant',
  'minecraftlauncher', 'minecraft', 'robloxplayerbeta', 'roblox', 'fortniteclient-win64-shipping', 'origin', 'ealauncher',
  // video
  'vlc', 'netflix', 'disneyplus',
];

/** Never minimised, whatever the list says: the system itself and LOCK IN!. */
const ALWAYS_OK = [
  'explorer', 'taskmgr', 'lockin', 'lock in!', 'electron', 'searchhost', 'searchapp', 'shellexperiencehost',
  'startmenuexperiencehost', 'lockapp', 'dwm', 'textinputhost', 'systemsettings', 'applicationframehost',
  'snippingtool', 'screenclippinghost', 'finder', 'dock', 'systemuiserver', 'loginwindow',
];

const norm = (n) => String(n || '').toLowerCase().trim().replace(/\.exe$/, '');

/**
 * Should this program be minimised? `cfg` is { mode: 'blocklist'|'allowlist', list, allow }.
 * Blocklist: only what is listed (plus the built-in list). Allowlist: everything except what is allowed.
 */
function shouldMinimise(name, cfg) {
  const n = norm(name);
  if (!n || ALWAYS_OK.includes(n)) return false;
  const allow = (cfg.allow || []).map(norm);
  if (allow.includes(n)) return false;
  if (cfg.mode === 'allowlist') return true;
  return DEFAULT_BLOCK.includes(n) || (cfg.list || []).map(norm).includes(n);
}

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System; using System.Runtime.InteropServices;
public class LKFG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int cmd);
}
"@
$own = [uint32]$env:LK_OWN
$parent = [int]$env:LK_PARENT
$mode = $env:LK_MODE
$set = @{}; foreach ($x in ($env:LK_SET -split ',')) { if ($x) { $set[$x] = $true } }
$ok = @{}; foreach ($x in ($env:LK_OK -split ',')) { if ($x) { $ok[$x] = $true } }
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
$last = [IntPtr]::Zero
$n = 0
while ($true) {
  Start-Sleep -Milliseconds 400
  $n++
  if ($n % 5 -eq 0 -and -not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { exit }
  $h = [LKFG]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero -or $h -eq $last) { continue }
  $p = [uint32]0
  [void][LKFG]::GetWindowThreadProcessId($h, [ref]$p)
  if ($p -eq $own) { $last = $h; continue }
  try { $name = (Get-Process -Id $p -ErrorAction Stop).ProcessName.ToLower() } catch { continue }
  $hit = $false
  if (-not $ok.ContainsKey($name)) { if ($mode -eq 'allowlist') { $hit = $true } elseif ($set.ContainsKey($name)) { $hit = $true } }
  if ($hit) {
    [void][LKFG]::ShowWindowAsync($h, 6)
    [Console]::Out.WriteLine('BLOCK|' + $name); [Console]::Out.Flush()
  } else { $last = $h }
}
`;

function createAppGuard({ onBlocked = () => {}, onUnavailable = () => {}, bringForward = () => {}, platform = process.platform, spawnFn = spawn, ownPid = process.pid } = {}) {
  let child = null;
  let timer = null;
  let ready = false;
  let told = false;
  let cfg = null;

  const unavailable = (why) => {
    if (told) return;
    told = true;
    try { onUnavailable(why); } catch (_) { /* a listener's problem */ }
  };
  const hit = (name) => { try { bringForward(); } catch (_) { /* window gone */ } try { onBlocked(name); } catch (_) { /* ditto */ } };

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (child) { try { child.kill(); } catch (_) { /* already gone */ } child = null; }
    ready = false; cfg = null;
  }

  function startWindows(c) {
    // the final set the watcher compares against: built-in + the student's, minus anything they said never to touch
    const set = c.mode === 'allowlist' ? [] : [...DEFAULT_BLOCK, ...(c.list || [])].map(norm);
    const ok = [...ALWAYS_OK, ...(c.allow || [])].map(norm);
    const enc = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    let p;
    try {
      p = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, LK_OWN: String(ownPid), LK_PARENT: String(ownPid), LK_MODE: c.mode === 'allowlist' ? 'allowlist' : 'blocklist', LK_SET: set.join(','), LK_OK: ok.join(',') },
      });
    } catch (e) { unavailable(String(e && e.message || e)); return; }
    child = p;
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line === 'READY') ready = true;
        else if (line.startsWith('BLOCK|')) hit(line.slice(6));
      }
    });
    p.on('error', (e) => unavailable(String(e && e.message || e)));
    p.on('exit', () => { if (child === p) { child = null; if (!ready) unavailable('The program-watcher could not start.'); } });
    // PowerShell that never says READY (blocked by policy, Constrained Language Mode) is the same as unavailable
    setTimeout(() => { if (child === p && !ready) { unavailable('The program-watcher did not start.'); try { p.kill(); } catch (_) { /* gone */ } } }, 8000).unref?.();
  }

  function startMac(c) {
    const run = (args) => new Promise((resolve) => {
      let out = '';
      let p;
      try { p = spawnFn('lsappinfo', args, { stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { resolve(null); return; }
      p.stdout.on('data', (d) => { out += d; });
      p.on('error', () => resolve(null));
      p.on('close', () => resolve(out));
    });
    let last = '';
    ready = true;
    timer = setInterval(async () => {
      const asn = ((await run(['front'])) || '').trim();
      if (!asn || asn === last) return;
      last = asn;
      const info = (await run(['info', '-only', 'name', asn])) || '';
      const m = /"LSDisplayName"="([^"]+)"/.exec(info);
      if (m && shouldMinimise(m[1], c)) hit(norm(m[1]));
    }, 1000);
    if (timer.unref) timer.unref();
  }

  function start(c) {
    stop();
    told = false;
    cfg = c;
    if (!c || c.blockApps === false) return;
    if (platform === 'win32') startWindows(c);
    else if (platform === 'darwin') startMac(c);
    else unavailable('Minimising other programs is not available on this system.');
  }

  return { start, stop, running: () => !!child || !!timer, config: () => cfg };
}

module.exports = { createAppGuard, shouldMinimise, DEFAULT_BLOCK, ALWAYS_OK, PS_SCRIPT };
