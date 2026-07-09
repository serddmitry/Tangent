# Tangent

Electron + Svelte note editor. The app lives in `apps/tangent-electron`; shared
editor logic is in `lib/typewriter` and `apps/tangent-electron/src/common`.

## Verifying changes — build and run as a real macOS app

The user runs Tangent as a packaged macOS app (from Finder), not via the dev
server. After making changes, verify by producing a packaged `.app` and
launching it — do **not** rely on `dev:prod` (that runs Electron against the
bundle and does not repackage `dist/mac-arm64/Tangent.app`).

From `apps/tangent-electron`:

```bash
npm run build          # REQUIRED: rebuilds the webpack bundle into __build
npm run package:test   # electron-builder --dir -c.mac.identity=null
xattr -dr com.apple.quarantine dist/mac-arm64/Tangent.app  # unsigned → clear Gatekeeper
open dist/mac-arm64/Tangent.app
```

`npm run build` is **not optional**: `package:test` (electron-builder) only
packages whatever is already in `__build` — it does **not** rebuild the bundle.
Skip the build and you ship a stale bundle that silently omits your changes.

Use plain `npm run build` (production), **not** `build:dev`, for the app you
hand to the user. `build:dev` bakes `NODE_ENV=development`, which makes the main
process use a `dev_`-prefixed settings/workspace namespace
(`getWorkspaceNamePrefix()` in `src/main/environment.ts`) — so the app opens an
empty `dev_workspaces.json` and prompts to pick a workspace instead of reopening
the user's real one (e.g. `~/my-notes`).

`package:test` is the fast packaging path: `--dir` skips the `.dmg` and
`-c.mac.identity=null` skips code-signing — the two slow stages of a full build.

Avoid `package:mac` / `release` unless you actually need a signed,
distributable `.dmg`: they code-sign every embedded binary and build a DMG,
which takes minutes.

## Tests

Unit tests (fast, run these after editing pure logic):

```bash
cd apps/tangent-electron && npx vitest run <path>
```

`npm run build:tangent-electron` (from repo root) builds the bundle + workspace
deps but does **not** produce a runnable macOS app — use `package:test` for that.
