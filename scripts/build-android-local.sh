#!/usr/bin/env bash
# Builds the Android debug APK using only the toolchain under ./.toolchain (JDK 21, Android SDK,
# Gradle 8.14.3) — nothing from a global JAVA_HOME / ANDROID_HOME. Run from Git Bash on Windows:
#   bash scripts/build-android-local.sh [gradle task]      default: assembleSideloadDebug
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC_WIN="$(cygpath -w "$ROOT/.toolchain" 2>/dev/null || echo "$ROOT/.toolchain")"
export JAVA_HOME="$TC_WIN\jdk21"
export ANDROID_HOME="$TC_WIN\android-sdk" ANDROID_SDK_ROOT="$TC_WIN\android-sdk"
export GRADLE_USER_HOME="$TC_WIN\gradle"
export PATH="$ROOT/.toolchain/jdk21/bin:$PATH"

cd "$ROOT/frontend"
VITE_MOBILE=1 npx vite build
node ../scripts/catalogue/stage-media.mjs dist
npx cap sync android
cd android
"$ROOT/.toolchain/gradle-8.14.3/bin/gradle" --no-daemon "${1:-assembleSideloadDebug}"
echo "APK(s):"; find app/build/outputs/apk -name '*.apk'
