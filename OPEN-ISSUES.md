# Open Issues

Follow-up work identified while adding links and embeds to files outside the
workspace. Nothing here is a regression from that change unless noted; most of
it is pre-existing, and surfaced because that feature widened what a note can
name.

## Context: the trust boundary

The thing to keep in mind for everything below is that **note contents are the
untrusted input, not the user**. A workspace is a folder of markdown that gets
synced, shared, cloned, and downloaded. "The user can already open any file in
Finder" is not an argument that a *note* should be able to make the app open
any file — the person reading a note did not necessarily write it.

Already mitigated (see `apps/tangent-electron/src/main/safeOpen.ts`):

- Opening a file the shell would *run* (`.app`, `.command`, `.pkg`, …) is
  confirmed with the user first, platform-aware.
- Opening a url in a scheme outside `http`/`https`/`mailto`/`tel` is confirmed
  first. Any registered scheme otherwise launches whatever app claimed it.
- Embeds of files outside the workspace are restricted to media types that
  actually have a viewer.

---

## 1. No Content-Security-Policy on the renderer — **high**

`apps/tangent-electron/static/index.html` sets no CSP, and no CSP header is
attached to the session. This is the single control that would bound what a
compromised renderer can do: without it, script injected into a note's rendered
output would have both arbitrary local file read (the page is served from
`file://`) and unrestricted network egress.

The app's other posture is good — `contextIsolation` and `sandbox` are on
(Electron defaults, and the preload uses `contextBridge.exposeInMainWorld` at
`src/preload/index.ts:285`) — which is what keeps this at "should fix" rather
than "on fire".

Adding one is not a one-liner: the renderer relies on inline styles, `blob:`
and `file:` media sources, and pdf.js workers. Expect to iterate with the
console open.

## 2. Renderer XSS surface is unaudited — **high, and gates #1's severity**

Nobody has checked whether note contents can execute script in the renderer
(raw HTML passthrough in the markdown pipeline, `t-*` custom elements, embed
handling, code preview). This is the multiplier on every other finding here: if
note content cannot run JS, arbitrary file *read* is limited to "a private file
is displayed in your own editor", because `<img src="file://…">` renders pixels
the page cannot read back. If it can, #1 becomes read + exfiltrate.

Audit this before deciding how much #1 matters.

## 3. No `will-navigate` guard — **medium**

Nothing in `src/main/windows.ts` handles `will-navigate`. If the renderer is
ever navigated to a remote origin, that page inherits the preload bridge and
its full IPC surface. `setWindowOpenHandler` is handled (it denies and defers to
`openExternalSafely`), but in-place navigation is not. Add a `will-navigate`
handler that cancels anything not pointing at the local bundle.

## 4. `getUrlData` is a no-click network beacon — **low**

`NodeHandle.resolve()` calls `workspace.api.links.getUrlData()` as soon as a
link resolves to an external url — no click required. Merely opening a note
containing `https://attacker/x` confirms the note was opened and leaks the
reader's IP. Consider gating link previews behind a setting, or fetching only
on hover/click.

## 5. `isExternalLink()` is doing too much with one regex — **low**

`src/common/links.ts` classifies with a url-matching regex borrowed from
urlregex.com. Two sharp edges:

- It returns **false** for `file:///…`, because the pattern wants a host after
  the scheme and a file url's host is empty. The current code depends on this
  (file urls must be treated as paths, not handed to `shell.openExternal`), and
  `links.test.ts` now pins the behavior — but it is accidental, and a
  well-meaning "fix" to that regex would silently route file links back to
  `openExternal`.
- It matches *any* `[A-Za-z]{3,9}:` scheme with a plausible host, so scheme
  handling is decided by a regex rather than a parser.

Worth replacing with explicit scheme parsing and an allowlist.

## 6. `paths.resolve()` does not clamp at the filesystem root — **low**

`..` segments pop unconditionally, so a path with more `..` than depth pops the
leading empty segment and silently turns an absolute path into a relative one.
Traversal out of the workspace is now intentional, so this is a correctness
nit rather than a security hole, but the result is surprising.

---

## Functional follow-ups for external files

## 7. External embeds have no cache busting

Workspace embeds get `?t=<mtime>` via `EmbedFile.cacheBustPath`. Files outside
the workspace are not indexed, so there is no mtime to hang that on, and an
edited external file may keep showing stale content until the note is reloaded.

## 8. External embeds are not watched, indexed, or rename-tracked

A file outside the workspace that moves or is deleted leaves a dead link with
no backlink bookkeeping and no "file moved" affordance. Acceptable for now —
worth stating so it is not mistaken for a bug.

## 9. iCloud placeholders are not handled

A file evicted to the cloud is a dataless placeholder on disk. `shell.openPath`
handles this (macOS downloads on demand), but pdf.js reading it directly will
fail, and the embed surfaces a generic error rather than "this file is in the
cloud". Also note macOS may prompt for access to iCloud Drive the first time,
and an ad-hoc-signed dev build can have trouble persisting that grant.

## 10. Scheme confirmations are not rememberable

`openExternalSafely` prompts every time for a non-web scheme. Someone who
routinely uses `zotero://` or `obsidian://` links will be prompted on each
click. Wants either a remembered per-scheme allowlist or a setting.

## 11. `test-results/` is not gitignored

Playwright writes `apps/tangent-electron/test-results/` on failure; it shows up
as untracked noise in `git status`. Add it to `.gitignore`.
