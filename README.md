# LOCK IN!

Track every class, see what's due, and let the AI planner build study time
around it. Homework, tests, a calendar, an AI study assistant, quizzes, and
homework grading.

## Where the data lives

**In the student's own browser, not on a server.** Each account's data is one
encrypted blob in IndexedDB (`src/api/vault.js`):

- PBKDF2-SHA256, 600,000 rounds, turns the password into an AES-256 key.
- AES-GCM encrypts the whole account, with the username bound in so one
  account's data can't be passed off as another's.
- On a shared school computer every student uses the same browser storage.
  Encrypted, anyone opening devtools sees ciphertext, not someone's homework.

Consequences that the app says out loud, and you should know too:

| | |
|---|---|
| **No password reset** | The password *is* the key. Forget it and the data is unrecoverable. |
| **One device** | Data doesn't follow you. Settings → **Download backup** makes an encrypted `.lockin` file; **Restore from a backup** on the sign-in page loads it anywhere. |
| **Browsers can clear storage** | Under low disk space some browsers evict site data. The app asks to be kept, and Settings shows whether the browser agreed. Backups are the real safety net. |
| **No friends list** | That needs a shared database to look people up in. Classes are shared with **share codes** instead: the code carries the class and its homework and tests, and pasting it again later brings in only what's new. Share codes are *not* encrypted — they're meant to be read by whoever you send them to. |

What *is* visible without a password: each account's username and display
name, which the sign-in page lists under "On this device".

## The backend

`src/api/db.js` implements the same interface the pages were written against
when this was a base44 export — `db.auth.*`, `db.entities.<Name>.list /
filter / get / create / update / delete`, `db.integrations.Core.UploadFile /
InvokeLLM` — plus `accounts`, `backup` and `sharing`. No `@base44` packages
remain.

## AI features

They call `/api/ai.php` on the Code A Difference site, which holds one shared
Gemini key (set in that site's `/admin/` → AI key) and never sends it to the
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
