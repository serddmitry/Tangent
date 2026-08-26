import fs from 'fs'
import path from 'path'

import type { Workspace } from 'app/model'
import { test, expect } from './tangent'
import type TangentWindow from './TangentWindow'

/*
 * Guards against silently losing unsaved editor content. Two failure modes are
 * covered, both reconstructed from a real data-loss incident:
 *
 *  1. The app is quit / the window closed with edits still only in renderer
 *     memory (the 5s autosave debounce hadn't fired). `beforeunload` calls
 *     `workspace.shutdown()`, which must flush those edits to disk *before* the
 *     renderer unloads — via the synchronous `saveFileSync` path.
 *
 *  2. A workspace reload re-sends every open file's on-disk contents. If the
 *     editor still holds unsaved changes, that stale disk copy must NOT
 *     overwrite them.
 */

/**
 * Opens a note with the given on-disk content and waits for it to be the
 * current editor.
 */
async function openNote(window: TangentWindow, workspace: string, name: string, content: string) {
	await fs.promises.writeFile(path.join(workspace, name), content, 'utf8')

	await window.page.waitForFunction(name => {
		const workspace = (document as any).workspace as Workspace
		return !!workspace.directoryStore.getWithPortablePath('FILES/' + name)
	}, name)

	await window.setThread({ paths: [name] })
	await window.page.waitForSelector('.current .noteEditor article')
}

/**
 * Makes the current note dirty in the renderer with new content, without
 * triggering a disk save — i.e. exactly the state after typing but before the
 * autosave debounce fires.
 */
function makeDirtyWithoutSaving(window: TangentWindow, text: string) {
	return window.page.evaluate(newText => {
		const workspace = (document as any).workspace as Workspace
		const file = workspace.viewState.tangent.currentNode.value as any
		file.setFileContent(newText)
		file.isDirty = true
	}, text)
}

test('unsaved edits are flushed to disk when the app shuts down', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()

	const name = 'Shutdown Flush.md'
	const original = 'Original saved content.'
	await openNote(window, workspace, name, original)

	const unsaved = 'First paragraph.\n\nA second paragraph that the autosave never captured.'
	await makeDirtyWithoutSaving(window, unsaved)

	// Precondition: the edit really is unsaved — disk still holds the original.
	const notePath = path.join(workspace, name)
	expect(await fs.promises.readFile(notePath, 'utf8')).toBe(original)

	// This is exactly what `beforeunload` runs on Cmd+Q / window close.
	await window.page.evaluate(() => (document as any).workspace.shutdown())

	// The synchronous exit flush must have written the in-memory content out.
	const onDisk = await fs.promises.readFile(notePath, 'utf8')
	expect(onDisk).toContain('A second paragraph that the autosave never captured.')
})

test('a workspace reload does not clobber unsaved in-memory edits', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()

	const name = 'Reload Guard.md'
	const original = 'Stale disk copy.'
	await openNote(window, workspace, name, original)

	const unsaved = 'Freshly typed text that only exists in memory.'
	await makeDirtyWithoutSaving(window, unsaved)

	// Simulate the reload path: the main process re-sends the on-disk contents
	// for every open file. The dirty guard must ignore it.
	const editorText = await window.page.evaluate(([name, diskContent]) => {
		const workspace = (document as any).workspace as Workspace
		const file = workspace.directoryStore.getWithPortablePath('FILES/' + name) as any
		workspace.onReceiveFileContents(file.path, diskContent)
		return file.getFileContent()
	}, [name, original] as const)

	expect(editorText).toContain('Freshly typed text that only exists in memory.')
	expect(editorText).not.toContain('Stale disk copy.')
})
