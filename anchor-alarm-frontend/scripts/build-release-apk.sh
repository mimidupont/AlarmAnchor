#!/usr/bin/env bash
#
# Assemble the signed release APK.
#
# This exists because npm on Windows runs scripts through cmd.exe even when
# invoked from Git Bash, and cmd cannot parse "./gradlew" — it fails with
# "'.' is not recognized as an internal or external command". Routing
# through bash (as distribute:android already does) keeps one command
# working on Windows, macOS and Linux.
#
set -euo pipefail
cd "$(dirname "$0")/../android"

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) GRADLEW=./gradlew.bat ;;
  *) GRADLEW=./gradlew ;;
esac

echo "Running $GRADLEW assembleRelease"
exec "$GRADLEW" assembleRelease "$@"
