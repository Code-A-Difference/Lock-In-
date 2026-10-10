# Releasing a new app version

The Android and desktop apps load this web app live from the site, so most
changes need no new app at all, deploy the site and every installed copy has
them. A new app is only needed when something in `android/` or `desktop/`
changes (native code, plugins, the Electron main process).

When you do release one, the installed apps tell their users: `UpdatePrompt`
compares the app's version with `src/lib/releases.js` and shows
"An update is available" with the notes and a download button.

## Android (`app-vX.Y.Z`)

1. `android/app/build.gradle`: raise `versionCode` by one, set `versionName`.
2. `src/lib/releases.js` → `RELEASES.android`: the same version, today's date,
   and 2–4 notes written for students (what they'll notice, not how).
3. `npx cap sync android`, delete `android/app/build`, then with
   `JAVA_HOME` = Android Studio's `jbr` and `LOCKIN_KEYSTORE_PROPERTIES`
   pointing at the release key: `gradlew assembleRelease`.
   The key is not in this repo (`%LOCALAPPDATA%\lockin-signing`), an APK signed
   with any other key can't update existing installs.
4. Publish a GitHub release tagged `app-vX.Y.Z`, marked **latest**, with the APK
   attached as `LOCKIN-android.apk` (the download links use
   `releases/latest/download/LOCKIN-android.apk`).
5. Build and deploy the site (`npm run build:site`), so installed apps see it.

## Desktop (`desktop-vX.Y.Z`)

1. `desktop/package.json` `version`.
2. `src/lib/releases.js` → `RELEASES.desktop`: version, date, notes, and the
   `desktop-vX.Y.Z` download URLs.
3. The website's `site/_lib/view-project.php` → `CAD_APP_DESKTOP`.
4. Push a `desktop-vX.Y.Z` tag. `.github/workflows/desktop.yml` builds Windows
   and both Macs and publishes the release **not** as latest (so the Android
   "latest" link keeps pointing at the APK).
5. When the release's files are there, build and deploy the site.

Deploy the site **after** the release files exist, or the prompt's download
button points at a file that isn't there yet.
