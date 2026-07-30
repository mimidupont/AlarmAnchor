# Building / running the Android app

## TL;DR — never open `android/` in Android Studio on a fresh clone

```bash
cd anchor-alarm-frontend
npm install
npm run android          # build web assets + cap sync + open Android Studio
```

Then press ▶ Run in Android Studio. Use `npm run android:prepare` instead if
you want to open the IDE yourself.

## Why the extra step is mandatory

Three things the Android project needs are **generated, not committed** (they
are in `android/.gitignore`, which is correct — they are build outputs):

| Path | Created by | Referenced by |
| :--- | :--- | :--- |
| `android/capacitor-cordova-android-plugins/` | `npx cap sync` | `settings.gradle`, `app/build.gradle`, `app/capacitor.build.gradle` |
| `android/app/src/main/assets/public/` | `npx cap sync` (copies `build/`) | the WebView at runtime |
| `android/app/src/main/assets/capacitor.config.json` / `capacitor.plugins.json` | `npx cap sync` | Capacitor plugin auto-registration |

On a fresh clone those directories do not exist yet, so opening `android/`
directly makes Gradle sync fail before compiling anything:

```
Could not read script '.../capacitor-cordova-android-plugins/cordova.variables.gradle'
```

`npx cap sync android` also needs `build/` to exist, which is why the web
build runs first. Re-run `npm run android:prepare` after **any** change to
`src/`, `capacitor.config.ts`, or the plugin list — the APK ships a snapshot
of `build/`, so without it the emulator keeps showing the previous version.

## Configuration baked in at build time

`.env.production` supplies `REACT_APP_BACKEND_URL`
(`https://alarmanchor-backend.fly.dev`). `npm run build` reads it, so the APK
talks to the Fly.io backend. Local `npm start` keeps using
`http://localhost:5000`.

## Emulator caveats for an anchor alarm

- **Set a location.** Emulator ▸ ⋯ ▸ Location ▸ set a lat/lng and *Send*,
  otherwise there is no GPS fix and the app sits on "Waiting for GPS signal".
  The routes tab can replay a track to exercise drift and the alarm.
- **Grant the permissions** when prompted (location + notifications). The
  background-geolocation foreground service also posts a persistent
  notification; that notification is what keeps GPS alive with the screen off.
- **Background location** ("Allow all the time") cannot be granted from the
  first dialog on Android 11+; use Settings ▸ Apps ▸ Anchor Alarm ▸
  Permissions if you want to test screen-off tracking.
- Play-services-free emulator images are fine — the app uses no Google APIs.

## Troubleshooting

| Symptom | Cause |
| :--- | :--- |
| Gradle sync: `Could not read script ... cordova.variables.gradle` | `npx cap sync android` never ran — see above |
| `resource color/colorPrimary not found` | `res/values/colors.xml` missing (fixed; do not delete it) |
| App launches but shows a blank/white screen | `assets/public/` missing or stale → `npm run android:prepare` |
| App opens but cannot create a session | Backend unreachable; check `https://alarmanchor-backend.fly.dev/health` |
