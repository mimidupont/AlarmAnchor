#!/usr/bin/env bash
#
# Upload the signed release APK to Firebase App Distribution.
#
# The Firebase App ID lives in .env.distribution (gitignored) rather than in
# package.json, so it never lands in the repository. Any extra arguments are
# forwarded to the firebase CLI, e.g.
#
#   npm run distribute:android -- --release-notes "New zone editor"
#
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env.distribution ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.distribution
  set +a
fi

if [ -z "${FIREBASE_APP_ID:-}" ]; then
  cat >&2 <<'MSG'
FIREBASE_APP_ID is not set.

Create anchor-alarm-frontend/.env.distribution (gitignored):

  cp .env.distribution.example .env.distribution
  # then put your Firebase App ID in it

Or export FIREBASE_APP_ID in your shell.
MSG
  exit 1
fi

APK="android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK" ]; then
  echo "No release APK at $APK" >&2
  echo "Build one first:  npm run release:android" >&2
  exit 1
fi

echo "Uploading $APK"
echo "  app    : $FIREBASE_APP_ID"
echo "  groups : ${FIREBASE_GROUPS:-crew}"

exec firebase appdistribution:distribute "$APK" \
  --app "$FIREBASE_APP_ID" \
  --groups "${FIREBASE_GROUPS:-crew}" \
  "$@"
