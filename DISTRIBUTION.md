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

### Java 21 — two separate requirements

**1. The JVM that runs Gradle.** Gradle 8.14.3 cannot run on Java 25. With a
newer JDK first on the path the build fails with a message that never mentions
Java:

```
Unsupported class file major version 69
```

**2. A JDK 21 that Gradle can find on disk.** The Capacitor plugins declare
`kotlin { jvmToolchain(21) }`, a *toolchain* request: Gradle looks for a
matching JDK installation and does **not** fall back to the JVM it is running
on. Setting `JAVA_HOME` alone does not satisfy this unless that JVM is itself
21 and gets auto-detected. The failure looks like:

```
Cannot find a Java installation on your machine matching:
{languageVersion=21, ...}. Toolchain download repositories have not been configured.
```

`android/settings.gradle` applies the Foojay resolver so Gradle downloads a
JDK 21 itself when none is found. To use one you already have instead, add to
`~/.gradle/gradle.properties`:

```properties
org.gradle.java.installations.paths=C:/Program Files/Android/Android Studio/jbr
```

Check what Gradle can see with `gradlew -q javaToolchains`.

### The reliable way: pin the JVM

`JAVA_HOME` is easy to get wrong — `setx` does **not** affect the terminal you
run it in, only new ones, so a window can still be on the system default (Java
25) while you believe it is on the JBR. The symptom is Gradle failing before it
compiles anything:

```
BUG! exception in phase 'semantic analysis' in source unit '_BuildScript_'
Unsupported class file major version 69
```

Pin it instead, in `%USERPROFILE%\.gradle\gradle.properties` (user-level, not
the repo — the path is machine-specific):

```properties
org.gradle.java.home=C:/Program Files/Android/Android Studio/jbr
```

That wins over `JAVA_HOME` and `PATH`, so it cannot be undone by which window
the build runs in. Run `gradlew --stop` after any change: a running daemon keeps
the JVM it was started with, and an already-running one can silently make a
build succeed that would otherwise fail (or the reverse).

For requirement 1, point `JAVA_HOME` at the JBR bundled with Android Studio:

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
npm test                       # must pass before shipping — see below
npm run ship:android           # prepare + assembleRelease + upload to crew
```

`npm test` runs once and exits (`test:watch` is the interactive mode). It
covers the local zone check in `utils/alarm.js` — the property that keeps the
alarm armed with no server — and the rule that a lost session makes the boat
phone recover rather than stop tracking. A red suite there means the alarm
itself may be broken, so never ship past it.

The backend has its own suite for the session snapshot round-trip:

```bash
cd ../anchor-alarm-backend && npm test
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
- [ ] `npm test` passes in **both** `anchor-alarm-frontend` and
      `anchor-alarm-backend`
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

### The two version numbers

Firebase shows releases as **`versionName (versionCode)`** — e.g. `1.1.0 (63)`.
They move independently:

| | Where | Behaviour |
| :--- | :--- | :--- |
| `versionCode` | `android/app/build.gradle`, from `git rev-list --count HEAD` | Automatic. Rises with every commit, so it jumps by however many commits landed since the last build — `49` → `63` is 14 commits, not a mistake. Android only requires it to increase; gaps are harmless. |
| `versionName` | `android/app/build.gradle` + `src/version.js` | Manual. **Bump it whenever a build is meaningfully different**, or two unrelated builds both show as `1.0.0` and testers cannot tell them apart. |

`versionCode` being automatic has one consequence: **commit before building.**
Two builds from the same commit produce the same code, and Firebase rejects the
second upload.

When bumping `versionName`, change it in both places — `build.gradle` (what
testers see in App Tester) and `src/version.js` (what shows on the session
screen). They are separate on purpose: the in-app one lets you check the boat
phone and a remote monitor are on the same build.

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
