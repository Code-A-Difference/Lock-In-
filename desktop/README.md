# LOCK IN! for Windows and Mac

An Electron shell around the live LOCK IN! site (like the phone apps, it
loads `https://codeadifference.ct.ws/lockin/`, so the app itself is always
current). What it adds, exposed to the page as `window.lockinDesktop`
(`preload.js`, read by `src/lib/desktop.js`):

- **On-device transcription** — `whisper.js` runs whisper.cpp's
  `whisper-server` with the model kept loaded; pieces of a class go to it
  over localhost. Models download on first use into the app's data folder
  (base 57 MB automatically; small / large-v3-turbo from Settings). Silero
  VAD skips silence, so nothing is "heard" in a quiet room.
- **Floating mini window** — the same window, shrunk and kept on top
  (`setMini` in `main.js`; the page renders `MiniView`).
- **Computer-sound recording** — `getDisplayMedia` answered with the system
  loopback (`setDisplayMediaRequestHandler`); the picture is discarded.
- **Call detection** — `meetings.js` (Windows: the microphone-in-use registry
  list; Mac: Zoom's CptHost process).
- Global shortcuts, a tray icon, start with the computer.

## Run it

```
npm install
npm start                      # against the live site
LOCKIN_URL=http://localhost:4173/lockin/ npm start   # against tools/serve-php.ps1
npm test
```

`resources/whisper/<os>-<arch>/` must hold whisper-server (and on Windows
its DLLs) — CI fetches/builds them (`.github/workflows/desktop.yml`).

## Release

Bump `version` here and `DESKTOP_VERSION` + the download tag in
`src/lib/desktop.js`, then push a `desktop-vX.Y.Z` tag. CI builds
`LOCKIN-win-x64.exe`, `LOCKIN-mac-arm64.dmg`, `LOCKIN-mac-x64.dmg` and
attaches them to a release that is *not* marked latest (the Android link uses
`releases/latest`). Update `CAD_APP_DESKTOP` in the website's
`_lib/view-project.php` too.
