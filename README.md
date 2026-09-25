# LOCK IN!

A study app for high school and university students: everything that's due,
a focus timer that knows what you're working on, and an AI assistant.

| Page | What it's for |
|---|---|
| **Today** | One box adds anything — type `essay outline eng fri !` or `chem test oct 3` and it becomes homework or a test, with the class, date and priority read from the text (chips show how it was read; click one to change it). The agenda groups everything by when it's due. Each row has its actions on it: tick it off, **Focus**, **Break it down**, and a ⋯ menu (edit, move to tomorrow, quiz me, delete with Undo). The **Lock in** button starts a focus block on the most urgent thing. Focus stats, streak and a test countdown on the side. |
| **Focus** | The timer (25/5, 50/10, 90/20 or custom; a long break every 4th), background sound (rain, brown noise, a drone — generated live, nothing to download), the checklist for the task you picked, and voice control. Finished blocks are logged to that task and feed the streak. The timer keeps running on every other page; its countdown is in the nav and the tab title. |
| **Study** | AI assistant (web search, attach images and PDFs, answers can be read aloud), weekly planner, homework feedback, practice quizzes. |
| **Classes** | Add, edit, share with a code, delete. |
| **Settings** | Timer defaults, voice, dark mode, password, account. |

Keyboard: **N** or **/** add, **T F S C** go to a page, **?** lists them all. On
Focus: **Space** start/pause, **+ / −** five minutes, **M** talk.

### Two tools from the Code A Difference shelf live here now

- **Ambient Voice Study** became the Focus page. Kept: the timer, the drone,
  voice commands, the "Companion" wake word. Better: it counts to a
  timestamp (a throttled background tab doesn't lose time), survives a
  reload, logs every block, has more sounds with fades instead of hard cuts,
  understands ordinary phrasing ("give me five more minutes", "what's next",
  "I'm done with that step" — `src/lib/voiceCommands.js`), and hands-free
  listening is off until you switch it on, then needs "Hey Lock In" first.
- **Task Shredder** became **Break it down** on every homework row. It asks the
  AI for 4–8 small steps; if the AI isn't available it falls back to a
  ready-made checklist for that kind of work (essay, problem set, reading,
  lab report…, `src/lib/shredder.js`), so the button always does something.
  The steps show under the item and next to the timer, and "done" by voice
  ticks the next one off.

The originals are still on the site's shelf.

### The voice

`src/lib/voice.js` speaks through Gemini's text-to-speech (via the same
proxy and shared key, `mode: "speak"`), which sounds like a person. If that
isn't available — no key yet, or a key without speech access — it uses the
best voice the browser has (Edge "Natural", Chrome "Google", Apple enhanced;
never the novelty voices), and says which in Settings. Either way markdown is
stripped first and long answers go a sentence or two at a time, so nothing
is read out as "asterisk asterisk" and Chrome doesn't cut it off at 15
seconds.

Listening uses the browser's speech recognition. In Chrome and Edge that
sends the audio to the browser maker's speech service to transcribe; Safari
does it on the device. Settings and the Focus page say so.

## Where the data lives

**On the Code A Difference server, in the student's account.** Sign in from
any computer and everything is there. The server side is two files in the
website repo: `site/api/lockin.php` (the endpoint) and
`site/_lib/lockin-store.php` (storage).

- One JSON file per account for sign-in (a bcrypt password hash and the
  hashes of its sign-in tokens), one for its data. Both live in the site's
  `_data/lockin/`, which the web server refuses to serve and deploys never
  overwrite.
- Signing in sets an HttpOnly cookie. "Keep me signed in" makes it last 60
  days; otherwise it ends with the browser, or after a day unused.
- Every call carries an `X-LockIn: 1` header, which a page on another site
  can't add, so the cookie can't be used from elsewhere.
- Changes go up as small operations ("create this homework", "tick that
  step"), applied under a file lock, so a laptop and a phone signed in at
  once never overwrite each other. A tab that comes back into view picks up
  what the other device changed.
- Wrong passwords are rate-limited per network and per username.

| | |
|---|---|
| **No password reset** | There's no email on an account, so there's nowhere to send a reset. The sign-up page says so. |
| **No friends list** | Classes are shared with **share codes**: the code carries the class and its homework and tests, and pasting it again later brings in only what's new. Share codes are readable by whoever you send them to. |

**Before this, LOCK IN! kept everything in the browser**, encrypted in
IndexedDB (`src/api/vault.js`), with backup files to move between
computers. That copy is read one last time: the sign-in page notices it,
and creating an account with the same username and password carries it
up to the server and removes it from the browser.

## The backend

`src/api/db.js` implements the same interface the pages were written against
when this was a base44 export — `db.auth.*`, `db.entities.<Name>.list /
filter / get / create / update / delete`, `db.integrations.Core.UploadFile /
InvokeLLM` — plus `accounts`, `sharing` and `sync` (saving status and
changes from other devices). Reads come from the copy loaded at sign-in;
writes update it at once and queue for the server, retrying if the
connection drops. No `@base44` packages remain.

## AI features

They call `/api/ai.php` on the Code A Difference site, which holds the AI
keys (set in that site's `/admin/` → AI keys: Gemini, OpenAI, Anthropic or
any OpenAI-compatible service, tried in order) and never sends them to the
browser. So LOCK IN! has to be served **from that site** for AI to work —
same origin, no setup. Uploaded files (images, PDFs, text) go along inline;
the proxy caps them at 5 files and 6 MB.

## Running it

```bash
npm install
npm run dev
```

In development, `/api` is proxied to the site's local PHP preview on port
4173, so start that too (in the Code A Difference folder):

```bash
powershell -ExecutionPolicy Bypass -File .\tools\serve-php.ps1
```

## Building for the site

```bash
npm run build:site
```

Outputs `dist/` for `https://codeadifference.ct.ws/lockin/`. Copy its
contents — including `.htaccess`, which makes refreshing on `/lockin/Study`
work — to `htdocs/lockin/`.

## Tests

```bash
npm test
```

Node's built-in runner, no browser needed. They cover the parts that are
easy to get subtly wrong: reading quick-add text and dates (all local
calendar days — due dates are never parsed as UTC, which would shift them a
day for anyone west of Greenwich), what the voice commands mean, the
agenda order and what "Lock in" picks, streaks, and the text the voice is
given to read.
