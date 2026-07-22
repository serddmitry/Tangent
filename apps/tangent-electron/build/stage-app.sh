#!/usr/bin/env bash
# Post-process a freshly signed+notarized build for hand-off:
#   1. staple the notarization ticket onto the arm64 .app, verify Gatekeeper
#   2. stage a faithful copy at ~/Downloads/Tangent.app (ditto folder-copy, which
#      preserves symlinks + xattrs exactly)
# Run automatically at the end of `npm run package:notarized`.
#
# Hand-off: AirDrop ~/Downloads/Tangent.app directly to the other Mac. Do NOT zip
# it — this app has xattrs on its framework symlinks, and zipping turns those into
# stray "._" AppleDouble files that break the code seal on extraction (even via
# Finder). AirDrop transfers the bundle faithfully; the app is notarized+stapled,
# so it opens despite the quarantine flag AirDrop adds. Then move it to
# /Applications (any non-iCloud folder).
set -euo pipefail

DIST_DIR="dist"
APP="$DIST_DIR/mac-arm64/Tangent.app"
STAGED="$HOME/Downloads/Tangent.app"

if [ ! -d "$APP" ]; then
	echo "stage-app: $APP not found — did the build/notarize step run?" >&2
	exit 1
fi

echo "==> Stapling notarization ticket onto the app..."
xcrun stapler staple "$APP"
echo "==> Verifying Gatekeeper acceptance..."
spctl -a -vvv -t exec "$APP"
xcrun stapler validate "$APP"

echo "==> Staging faithful copy at $STAGED ..."
rm -rf "$STAGED"
ditto "$APP" "$STAGED"

echo
echo "Ready to AirDrop (do NOT zip it):"
echo "  $STAGED"
