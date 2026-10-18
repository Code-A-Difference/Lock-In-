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
const { SIGN_IN_HOSTS, SIGN_IN_LABEL, isSignInHost, hostMatches } = require('./strict');

/** Programs that pull attention away. Students add their own; this is only where the list starts. */
const DEFAULT_BLOCK = [
  // (browsers are not here on Windows: they are judged by the address they are showing, see BROWSERS)
  'safari', 'google chrome', 'microsoft edge', 'firefox', 'brave browser', 'arc',
  // chat
  'discord', 'whatsapp', 'telegram', 'signal', 'messenger', 'snapchat',
  // games and launchers
  'steam', 'steamwebhelper', 'epicgameslauncher', 'battle.net', 'riotclientservices', 'leagueclient', 'valorant',
  'minecraftlauncher', 'minecraft', 'robloxplayerbeta', 'roblox', 'fortniteclient-win64-shipping', 'origin', 'ealauncher',
  // video
  'vlc', 'netflix', 'disneyplus',
];

/**
 * Browsers, by Windows process name. They are not simply minimised: LOCK IN! reads the address of the page in
 * front (Chrome, Edge, Brave, Opera, Vivaldi and Firefox all show it in the address bar) and only minimises
 * the browser when that page is not on the approved list. Sign-in pages (Google, Microsoft, school single
 * sign-on) are always let through so a school account can log in.
 */
const BROWSERS = ['chrome', 'msedge', 'brave', 'opera', 'opera_gx', 'vivaldi', 'firefox', 'iexplore', 'arc', 'chromium'];

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
  if (BROWSERS.includes(n) && cfg.browserWatch !== false && Array.isArray(cfg.pages)) return false;   // judged by its address instead
  const allow = (cfg.allow || []).map(norm);
  if (allow.includes(n)) return false;
  if (cfg.mode === 'allowlist') return true;
  return DEFAULT_BLOCK.includes(n) || (cfg.list || []).map(norm).includes(n);
}

/**
 * The host in an address bar's text, or '' if it is not a web address to judge (a search being typed,
 * a blank new tab, the browser's own pages). Chrome and Edge show addresses without "https://".
 */
function hostFromAddress(text) {
  let t = String(text == null ? '' : text).trim().toLowerCase();
  if (!t) return '';
  if (/^(chrome|edge|about|brave|opera|vivaldi|chrome-extension|moz-extension|view-source|file|data|javascript|devtools):/.test(t)) return '';
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  if (/\s/.test(t)) return '';
  let h = t.split(/[/?#]/)[0];
  h = h.split('@').pop().split(':')[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : '';
}

/** 'allow' | 'block' | 'unknown' for the text a browser's address bar is showing. */
function browserVerdict(text, cfg) {
  if (text == null) return 'unknown';
  const host = hostFromAddress(text);
  if (!host) return 'allow';
  if (isSignInHost(host)) return 'allow';
  return (cfg.pages || []).some((e) => hostMatches(host, e)) ? 'allow' : 'block';
}

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
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
$browsers = @{}; foreach ($x in ($env:LK_BROWSERS -split ',')) { if ($x) { $browsers[$x] = $true } }
$pages = @(); foreach ($x in ($env:LK_PAGES -split ',')) { if ($x) { $pages += $x } }
$signin = @(); foreach ($x in ($env:LK_SIGNIN -split ',')) { if ($x) { $signin += $x } }
$loginRe = $env:LK_LOGIN_RE
$watch = ($env:LK_WATCH -eq '1')

function Match-Host($h, $list) { foreach ($e in $list) { if ($h -eq $e -or $h.EndsWith('.' + $e)) { return $true } } return $false }

# the text in a browser's address bar, or $null if it can't be read (Chrome/Edge/Brave/Opera/Vivaldi: OmniboxViewViews, Firefox: urlbar-input)
function Get-Address($hwnd) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    $c1 = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'OmniboxViewViews')
    $c2 = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'urlbar-input')
    $e = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.OrCondition($c1, $c2)))
    if (-not $e) { return $null }
    $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    return [string]$vp.Current.Value
  } catch { return $null }
}

# 'allow' | 'block' | 'unknown' + the host
function Judge($text) {
  if ($null -eq $text) { return @('unknown', '') }
  $t = $text.Trim().ToLower()
  if (-not $t) { return @('allow', '') }
  if ($t -match '^(chrome|edge|about|brave|opera|vivaldi|chrome-extension|moz-extension|view-source|file|data|javascript|devtools):') { return @('allow', '') }
  $t = $t -replace '^[a-z][a-z0-9+.-]*://', ''
  if ($t -match '\s') { return @('allow', '') }
  $h = ($t -split '[/?#]')[0]
  $h = ($h -split '@')[-1]
  $h = ($h -split ':')[0]
  if ($h -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+$') { return @('allow', '') }
  if ((Match-Host $h $signin) -or ($h -match $loginRe)) { return @('allow', $h) }
  if (Match-Host $h $pages) { return @('allow', $h) }
  return @('block', $h)
}

[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
$last = [IntPtr]::Zero
$lastName = ''
$strikes = 0; $strikeHost = ''; $unreadable = 0; $lastAddr = '#'
$n = 0
while ($true) {
  Start-Sleep -Milliseconds 400
  $n++
  if ($n % 5 -eq 0 -and -not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { exit }
  $h = [LKFG]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero) { continue }
  if ($h -ne $last) {
    $p = [uint32]0
    [void][LKFG]::GetWindowThreadProcessId($h, [ref]$p)
    if ($p -eq $own) { $last = $h; $lastName = ''; continue }
    try { $name = (Get-Process -Id $p -ErrorAction Stop).ProcessName.ToLower() } catch { continue }
    $last = $h; $lastName = $name; $strikes = 0; $strikeHost = ''; $unreadable = 0; $lastAddr = '#'
    if (-not $ok.ContainsKey($name) -and -not ($watch -and $browsers.ContainsKey($name))) {
      $hit = $false
      if ($mode -eq 'allowlist') { $hit = $true } elseif ($set.ContainsKey($name)) { $hit = $true }
      if ($hit) {
        [void][LKFG]::ShowWindowAsync($h, 6)
        [Console]::Out.WriteLine('BLOCK|' + $name); [Console]::Out.Flush()
        $last = [IntPtr]::Zero
      }
    }
    if (-not ($watch -and $browsers.ContainsKey($name))) { continue }
  }
  # a browser in front: judge the address it is showing (every tick, since a tab switch keeps the same window)
  if (-not ($watch -and $browsers.ContainsKey($lastName))) { continue }
  $addr = Get-Address $h
  if ($addr -eq $lastAddr) { continue }
  $lastAddr = $addr
  $v = Judge $addr
  if ($v[0] -eq 'allow') { $strikes = 0; $strikeHost = ''; $unreadable = 0; continue }
  if ($v[0] -eq 'unknown') {
    $unreadable++
    if ($unreadable -ge 4) { [void][LKFG]::ShowWindowAsync($h, 6); [Console]::Out.WriteLine('UNREAD|' + $lastName); [Console]::Out.Flush(); $last = [IntPtr]::Zero; $unreadable = 0 }
    else { $lastAddr = '#' }
    continue
  }
  # blocked: the same address twice in a row (so a half-typed one isn't judged), then minimise the browser
  if ($v[1] -eq $strikeHost) { $strikes++ } else { $strikeHost = $v[1]; $strikes = 1 }
  if ($strikes -ge 2) {
    [void][LKFG]::ShowWindowAsync($h, 6)
    [Console]::Out.WriteLine('BLOCKURL|' + $lastName + '|' + $v[1]); [Console]::Out.Flush()
    $last = [IntPtr]::Zero; $strikes = 0; $strikeHost = ''
  } else { $lastAddr = '#' }
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
  const hit = (name, info) => { try { bringForward(); } catch (_) { /* window gone */ } try { onBlocked(name, info); } catch (_) { /* ditto */ } };

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
        env: { ...process.env, LK_OWN: String(ownPid), LK_PARENT: String(ownPid), LK_MODE: c.mode === 'allowlist' ? 'allowlist' : 'blocklist', LK_SET: set.join(','), LK_OK: ok.join(','),
          LK_BROWSERS: BROWSERS.join(','), LK_PAGES: (c.pages || []).join(','), LK_SIGNIN: SIGN_IN_HOSTS.join(','), LK_LOGIN_RE: SIGN_IN_LABEL.source,
          LK_WATCH: (c.browserWatch !== false && Array.isArray(c.pages) && c.pages.length) ? '1' : '0' },
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
        else if (line.startsWith('BLOCKURL|')) { const [, name, host] = line.split('|'); hit(name, { kind: 'browser', host }); }
        else if (line.startsWith('UNREAD|')) hit(line.slice(7), { kind: 'browser-unreadable' });
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

module.exports = { createAppGuard, shouldMinimise, hostFromAddress, browserVerdict, BROWSERS, DEFAULT_BLOCK, ALWAYS_OK, PS_SCRIPT };
