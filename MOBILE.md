# LOCK IN! on phones

There are three ways onto a phone, all the same app:

| | How | Needs |
|---|---|---|
| **Android app** | `LOCKIN-android.apk` from the website's LOCK IN! page | Allow "install unknown apps" once |
| **iPhone / iPad** | Safari → Share → **Add to Home Screen** | Nothing; opens full-screen like an app |
| **iPhone app (native)** | `ios/` here, built on GitHub's Macs | An Apple Developer account to sign it (see below) |

## How the apps are built

The `android/` and `ios/` folders are [Capacitor](https://capacitorjs.com)
projects. They don't bundle a copy of the web app: their web view opens
`https://codeadifference.ct.ws/lockin/` (`capacitor.config.json` →
`server.url`). That's deliberate:

- Accounts use a same-site cookie, and the AI and transcription go through
  `/api/ai.php` on that domain. Loaded from the site, the app *is* same-site,
  so both work exactly as in a browser, no second API, no tokens.
- Deploying the website updates the apps. A new APK is only needed when the
  native side changes (permissions, plugins, icons).
- With no connection, the bundled `native-shell/offline.html` explains and
  offers a retry, instead of a blank screen.

Native plugins (bundled in the web app through `@capacitor/*`, and inert in
a browser, `src/lib/native.js`):

- **Speech recognition** (`@capacitor-community/speech-recognition`):
  Android's web view has no speech API, so "Hey Lock In" and push-to-talk
  listen through the phone's recogniser in the app (`src/lib/listen.js`).
- **Haptics**, **status bar** (follows dark mode), **splash screen**.

Lecture recording uses the web view's microphone (`getUserMedia`), which the
manifest/Info.plist permissions cover. Phones pause web views in the
background, so the recording screen asks you to keep LOCK IN! open; it keeps
the screen awake while recording.

## Android

```bash
npm install
npx cap sync android
cd android
./gradlew assembleRelease          # needs JAVA_HOME = a JDK 21 (Android Studio's jbr works)
```

Release builds are signed with a key that is **not** in this repo. Gradle
reads `keystore.properties` (storeFile, storePassword, keyAlias,
keyPassword) from the path in `LOCKIN_KEYSTORE_PROPERTIES`. Keep that key
backed up: Android only installs an update over an existing app if it's
signed with the same key. Without it, `assembleRelease` makes an unsigned
APK, and CI (`.github/workflows/mobile.yml`) builds a debug APK just to
prove the project compiles.

To publish: copy `android/app/build/outputs/apk/release/app-release.apk` to
the website as `site/lockin/app/LOCKIN-android.apk` and deploy. Bump
`versionCode`/`versionName` in `android/app/build.gradle` first.

## iPhone

`ios/` needs a Mac to build, so `.github/workflows/mobile.yml` builds it on
GitHub's: a Simulator build and an **unsigned** `.ipa`, attached to the
release when you push an `app-v*` tag.

An unsigned `.ipa` won't install on an iPhone as it is. To ship it:

1. Join the Apple Developer Program (US$99/year) with a Mac and Xcode.
2. Open `ios/App/App.xcodeproj`, set the Team under Signing & Capabilities
   (bundle id `org.codeadifference.lockin`).
3. Product → Archive → Distribute: **TestFlight** to share with students by
   invite link, or the App Store. Apple reviews apps that mostly show a
   website; the native recording, speech and haptics are what make the case.

Until then, Add to Home Screen gives iPhone users the same app full-screen,
with its own icon and no browser bars.

## Icons

`tools/make_icons.py` draws every icon from the LOCK IN! padlock into
`public/icons/` (web) and `assets/` (sources); then
`npx capacitor-assets generate --android --ios` makes the native sizes.
