# Distributing test builds (Firebase App Distribution)

Signed release APKs to a small tester group, free, no Play Store account.

Live setup:

| | |
| --- | --- |
| Firebase project | `anchor-alarm-b7201` (Spark / free plan) |
| App ID | `1:661000526462:android:21bd203bee54816824d62f` |
| Package | `com.deschamps.anchoralarm` |
| Tester group | `crew` |
| Signing key | `anchor-alarm-upload`, stored outside the repo |

## Prerequisites

### JAVA_HOME must point at Java 21

Gradle 8.14.3 cannot run on Java 25. With a newer JDK first on the path the
build fails with a message that never mentions Java:

```
Unsupported class file major version 69
```

Point `JAVA_HOME` at the JBR bundled with Android Studio, which is Java 21 and
matches `sourceCompatibility VERSION_21` in `capacitor.build.gradle`:

```bat
:: Windows, permanent — reopen the terminal afterwards
setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
```

```bash
# macOS
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
# Linux
export JAVA_HOME="/opt/android-studio/jbr"
```

Verify with `java -version` → `21.x`.

### Toolchain

```bash
npm install -g firebase-tools
firebase login
```

## Signing key

The active key is **not** in the repository — deliberately, so it cannot be
committed by accident:

| | |
| --- | --- |
| Path | `C:\Users\Test\Keystores\anchor-alarm-upload.jks` |
| Alias | `anchor-alarm-upload` |
| Algorithm | RSA 2048, 10000 days |
| DN | `CN=Anchor Alarm, OU=Unknown, O=Unknown, L=Unknown, ST=Unknown, C=CZ` |
| SHA-256 | `f24212331055811507ff280e7a25a8136b2a2edaebdbaa761243974085078be1` |
| SHA-1 | `036231cb8da4e115efd129c79ff89f04bdb9f295` |

**That SHA-256 is the reference value.** Any release APK whose fingerprint does
not match it was signed with the wrong key, and Android will refuse to install
it over an existing build.

Backed up off the machine; passwords live in a password manager. Lose either and
testers can never be updated in place again — a new key means every tester
uninstalls and reinstalls.

Point Gradle at it via `anchor-alarm-frontend/android/keystore.properties`
(gitignored — copy `keystore.properties.example`):

```properties
storeFile=C:/Users/Test/Keystores/anchor-alarm-upload.jks
storePassword=…
keyAlias=anchor-alarm-upload
keyPassword=…
```

Forward slashes even on Windows: a backslash is an escape character in a
`.properties` file.

### The retired key

The original `anchor-alarm-release.jks` was committed to this public repo in
`e4cb1e1`, then deleted and replaced by the key above before anything was
distributed. It is still retrievable from git history — history was not
rewritten — but it signs nothing and must never be reused. Treat it as dead.

`*.jks`, `*.keystore` and `keystore.properties` are gitignored now; verify with
`git status --short` before committing, and `git ls-files | grep -i jks` should
return nothing.

## Firebase console (one-time, already done)

1. <https://console.firebase.google.com> → **Add project**. Analytics off is
   fine; App Distribution does not use it.
2. **Add app → Android**, package name exactly `com.deschamps.anchoralarm`.
3. Skip `google-services.json` and the SDK steps — App Distribution does not
   need them.
4. Project settings → General → the **App ID**.
5. **Release & Monitor → App Distribution → Testers & Groups** → group alias
   `crew`, add tester emails. The alias is what `--groups` references.

Then, locally:

```bash
cd anchor-alarm-frontend
cp .env.distribution.example .env.distribution
```

```properties
FIREBASE_APP_ID=1:661000526462:android:21bd203bee54816824d62f
FIREBASE_GROUPS=crew
```

`.env.distribution` is gitignored and loaded automatically by the release
script, so the App ID stays out of the repository.

## Every release

```bash
cd anchor-alarm-frontend
git status --short             # commit first — see versionCode below
npm run ship:android           # prepare + assembleRelease + upload to crew
```

Or in two steps:

```bash
npm run release:android        # web build + cap sync + signed APK
npm run distribute:android     # upload only
```

Extra arguments reach the firebase CLI:

```bash
npm run distribute:android -- --release-notes "New zone editor: circle/shape sheet"
```

The script stops with an actionable message if the App ID is missing or the APK
has not been built, rather than passing a confusing error to the CLI.

APK lands at `android/app/build/outputs/apk/release/app-release.apk`.

### Checklist

- [ ] `JAVA_HOME` is Java 21 (`java -version`)
- [ ] Work is **committed** — `versionCode` derives from the commit count
- [ ] `npm run release:android` — never `gradlew assembleRelease` alone, or the
      APK ships the previous web assets and still builds fine
- [ ] Fingerprint matches the reference SHA-256 above:
      `apksigner verify --print-certs app-release.apk`
      (Windows: `"%LOCALAPPDATA%\Android\Sdk\build-tools\36.0.0\apksigner.bat"`)
- [ ] Installs over the previous build without uninstalling
- [ ] Foreground-service notification appears while monitoring
- [ ] Position still updates with the screen off for 10+ minutes
- [ ] Remote monitor on another device receives the zone and the alarm

### versionCode

Derived automatically from `git rev-list --count HEAD` in
`android/app/build.gradle`. It increments with every commit, so it cannot
collide with an existing Firebase release and there is nothing to bump by hand.

The consequence: **commit before building.** Two builds from the same commit
produce the same `versionCode`, and Firebase rejects the second upload.

Bump `versionName` in `android/app/build.gradle` when a release is meaningful
to testers.

### Why APK and not AAB

App Distribution accepts AABs only with a linked Play Console account — the
thing this setup avoids.

### What gets baked in at build time

From `.env.production`:

- `REACT_APP_BACKEND_URL=https://alarmanchor-backend.fly.dev`
- `REACT_APP_FRONTEND_URL=https://alarm-anchor.vercel.app` — the base of QR join
  links. Without it they resolve to `http://localhost` inside the webview and
  are useless to another phone's camera.

`npm run android:prepare` runs first in every script above.

### Benign build warnings

Expected, not worth chasing: `flatDir` notices from Capacitor's generated Gradle
files, source/target 8 deprecation from `@capacitor-community/background-geolocation`,
and deprecated-API notes from `local-notifications`.

## What testers do

1. Accept the email invite, signing in with that Google account.
2. Install **Firebase App Tester** once. Android's "install from unknown apps"
   prompt appears there once, not per build.
3. New releases show up in App Tester; tap install.

Tell them explicitly: grant location **"Allow all the time"**. On Android 11+
that cannot be granted from the first dialog — Settings → Apps → Anchor Alarm →
Permissions → Location. Without it, tracking stops when the screen goes off,
which is the entire point of the app.

## Known limitations

- Android only. No iOS project in this repo.
- The Fly.io backend keeps sessions in memory: a restart drops every anchor
  position and zone mid-test. Warn testers before it gets reported as a bug.
- The retired signing key remains in git history (see above).
