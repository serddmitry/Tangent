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
# Quit any running Tangent FIRST (see below), then:
npm run build          # REQUIRED: rebuilds the webpack bundle into __build
npm run package:test   # electron-builder --dir -c.mac.identity=null
xattr -dr com.apple.quarantine dist/mac-arm64/Tangent.app  # unsigned → clear Gatekeeper
open dist/mac-arm64/Tangent.app
```

**Quit the running app before packaging, not after.** `package:test` wipes and
rewrites `dist/mac-arm64/`, including the ~70MB `app.asar`. If Tangent is
running, two things go wrong at once: the live renderer ends up sitting on an
archive that was swapped out from under it (it starts rendering garbage — e.g.
a theme CSS file as the document), and `open` hits Electron's single-instance
lock, so it just signals the *old* process instead of launching the new build.
The result looks like a catastrophic code bug and is neither. Verify with
`ps aux | grep -i "[T]angent"` before packaging, and check the new process's
start time (`ps -o lstart= -p <pid>`) after launching.

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

### Verifying app behavior: use the integration harness, not the packaged app

`tests-integration/` is a Playwright + Electron harness that **launches the real
app** against a throwaway workspace. This is the way to verify anything that
involves the UI, the renderer, or IPC — clicking links, rendering embeds,
editor behavior, main-process side effects. Reach for it before considering
packaging.

```bash
cd apps/tangent-electron
npm run build:dev                              # e2e runs against __build
npx playwright test --project=Tests <name>     # note: --project=Tests, with the `=`
```

Do **not** try to verify by driving the packaged app on this machine: screen
recording and Accessibility are not granted, so `screencapture` fails with
"could not create image from display" and AppleScript keystrokes fail with
error -1743. You cannot see or click the running app. And do not write test
notes into the user's real workspace (`~/my-notes`) — the harness creates and
deletes its own.

Writing a test (see `tests-integration/external-file-links.test.ts` for a full
example, and `TangentWindow.ts` for the helpers):

- Write note files into `workspace` with `fs`, wait for the index via
  `page.waitForFunction(... directoryStore.getWithPortablePath('FILES/x.md'))`,
  then open them with `window.setThread({ paths: [...] })`.
- Assert on the DOM: `page.locator('.current t-link')`, `t-embed`, and their
  `link-state` attributes (`resolved` / `untracked` / `empty` / `error`).
- Reach into the renderer with `page.evaluate` — `(document as any).workspace`
  is the live `Workspace`.
- Reach into the **main process** with `tangent.app.evaluate(({ shell, dialog })
  => ...)`. Monkeypatching `shell.openPath`/`openExternal`/`dialog.showMessageBox`
  there lets a test assert what the app *would* have done without anything
  actually opening.
- Address links by position (`.nth(i)`), not `:has-text()`: a `t-link` contains
  its href as well as its text, so text matching picks up unintended links.

After an e2e run, `__build` holds a **development** bundle. Re-run
`npm run build` before packaging or you ship a dev build (see the warning
above about the `dev_` workspace namespace).

`npm run build:tangent-electron` (from repo root) builds the bundle + workspace
deps but does **not** produce a runnable macOS app — use `package:test` for that.

## Logs

`Show Logs` in the app opens the folder holding `log.txt` (`~/Library/Logs/Tangent`
on macOS; `dev_`/`test_` prefixed for those builds). The main process owns the
file — see `src/main/logging.ts`.

The renderer has no filesystem access, so it forwards everything over the api
(`src/app/logging.ts` → `api.log.write` → `rendererLog` in
`src/main/messages/index.ts`), tagged `[renderer]`. That covers `js-logger`
(`Logger.get(...)` anywhere in `common/` or `app/`), `console.error`/`console.warn`,
uncaught exceptions, and unhandled promise rejections. Prefer `Logger.get('Thing')`
over bare `console.log` for anything worth having after the fact: `console.log` is
deliberately **not** forwarded.

Note that the main process filters at `INFO` in production, so a renderer
`log.debug()` will not reach a packaged build's log file.

When a window stops responding to navigation, `[Session] Thread: … -> …` says
whether the request arrived, and `[Tangent] Active session …` covers the session
handoff that navigation depends on.
