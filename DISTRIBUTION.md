# Distributing test builds (Firebase App Distribution)

Signed release APKs to a small tester group, free, no Play Store account.

> ⚠️ **The keystore in commit `e4cb1e1` is compromised.** It was committed to
> this public repository. Generate a new one before your first release — see
> [Rotating the keystore](#rotating-the-keystore). Nothing has been distributed
> yet, so this costs nothing now; after testers install a build, changing the
> signing key forces every one of them to uninstall and reinstall.

## One-time setup

### 1. Keystore (local, never committed)

```bash
cd anchor-alarm-frontend/android
keytool -genkey -v -keystore anchor-alarm-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias anchor-alarm
```

Back up the `.jks` and both passwords somewhere durable (password manager).
Lose them and testers can never be updated in place again.

```bash
cp keystore.properties.example keystore.properties
# then fill in the real passwords
```

`*.jks`, `*.keystore` and `keystore.properties` are gitignored. Verify before
committing anything: `git status --short` must not list them.

### 2. Firebase console (browser)

1. <https://console.firebase.google.com> → **Add project**. Analytics can be
   disabled; App Distribution does not use it.
2. **Add app → Android**. Package name must be exactly
   **`com.deschamps.anchoralarm`**.
3. Skip the `google-services.json` download and SDK steps — App Distribution
   does not need them.
4. Project settings → General → copy the **App ID**
   (`1:123456789012:android:abc123…`).
5. **Release & Monitor → App Distribution → Testers & Groups** → new group with
   alias **`crew`**, add tester emails. The alias is what `--groups` references.

### 3. Local environment

```bash
npm install -g firebase-tools
firebase login

# Put this in your shell profile so npm run distribute:android picks it up
export FIREBASE_APP_ID="1:123456789012:android:abc123def456"
```

## Every release

```bash
cd anchor-alarm-frontend
npm run ship:android          # prepare + assembleRelease + upload to the crew group
```

Or in two steps:

```bash
npm run release:android       # web build + cap sync + signed APK
npm run distribute:android    # upload only
```

APK lands at `android/app/build/outputs/apk/release/app-release.apk`.

Add release notes by appending to the upload command:

```bash
npm run distribute:android -- --release-notes "New zone editor: circle/shape sheet"
```

### Why APK and not AAB

App Distribution accepts AABs only with a linked Play Console account — the
thing this setup avoids.

### versionCode

Derived automatically from the git commit count (`app/build.gradle`), so it
increments on every commit and can never collide with an existing Firebase
release. Nothing to bump by hand. Bump `versionName` in `app/build.gradle` when
a release is meaningful to testers.

Commit before building: the version code reflects committed history, so two
builds from the same commit produce the same code and Firebase rejects the
second.

### What gets baked in

`.env.production` supplies, at build time:

- `REACT_APP_BACKEND_URL=https://alarmanchor-backend.fly.dev`
- `REACT_APP_FRONTEND_URL=https://alarm-anchor.vercel.app` — the base of QR join
  links. Without it, QR codes resolve to `http://localhost` inside the webview
  and are useless to another phone's camera.

`npm run android:prepare` runs first in every script above; skipping it produces
an APK containing the *previous* web assets, and the build still succeeds.

## Rotating the keystore

Required once, because the original was published. No testers have a build yet,
so this is free right now.

```bash
cd anchor-alarm-frontend/android
rm -f anchor-alarm-release.jks                 # the exposed one
keytool -genkey -v -keystore anchor-alarm-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias anchor-alarm
# update keystore.properties with the new passwords
```

Optionally scrub it from git history too (rewriting published history; every
clone must be re-cloned afterwards):

```bash
pip install git-filter-repo
git filter-repo --path anchor-alarm-frontend/android/anchor-alarm-release.jks --invert-paths
git push --force origin main
```

Rotating is what actually protects you — history rewriting does not un-publish a
file that was public (forks, clones and caches keep it).

## What testers do

1. Accept the email invite, signing in with that Google account.
2. Install **Firebase App Tester** once. Android's "install from unknown apps"
   prompt appears here once, not per build.
3. New releases show up in App Tester; tap install.

Tell them explicitly: grant location **"Allow all the time"**. On Android 11+
that cannot be granted from the first dialog — Settings → Apps → Anchor Alarm →
Permissions → Location. Without it, tracking stops when the screen goes off,
which is the entire point of the app.

## Per-release checklist

- [ ] Changes committed (versionCode follows commit count)
- [ ] `npm run release:android` (never `gradlew` alone — web assets go stale)
- [ ] APK signed: `apksigner verify --print-certs app-release.apk`
- [ ] Installs over the previous build without uninstalling
- [ ] Foreground-service notification appears while monitoring
- [ ] Position still updates with the screen off for 10+ minutes
- [ ] Remote monitor on another device receives the zone and the alarm

## Known limitations

- Android only. No iOS project in this repo.
- The Fly.io backend keeps sessions in memory: a machine restart drops every
  anchor position and zone mid-test. Warn testers before it gets reported as a
  bug.
