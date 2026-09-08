import fs from 'fs'
import path from 'path'

import type { Workspace } from 'app/model'
import { test, expect } from './tangent'
import type TangentWindow from './TangentWindow'

/*
 * In-document search paints each match as an "annotation". Editing the note
 * while search is open re-runs the search and rebuilds those annotations, and
 * that rebuild used to yank the caret onto the current match: type a space just
 * after a word whose prefix is the active match (e.g. searching "constr" and
 * editing right after "constraints") and the caret jumped back to the end of
 * "constr". Editing near a match must leave the caret exactly where the user
 * typed. See NoteEditor.svelte's onEditorChange / updateAnnotations.
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

/** Enables in-note search for `text` and waits for the highlights to render. */
async function search(window: TangentWindow, name: string, text: string) {
	await window.page.evaluate(({ name, text }) => {
		const workspace = (document as any).workspace as Workspace
		const node = workspace.directoryStore.getWithPortablePath('FILES/' + name)
		const state = workspace.viewState.tangent.context.getState(node) as any
		state.setSearch(text)
	}, { name, text })

	await window.page.waitForSelector('.current .noteEditor article .annotation')
}

/** Positions the caret via the live editor and returns the resulting offset. */
function setCaret(window: TangentWindow, name: string, offset: number) {
	return window.page.evaluate(({ name, offset }) => {
		const workspace = (document as any).workspace as Workspace
		const node = workspace.directoryStore.getWithPortablePath('FILES/' + name)
		const state = workspace.viewState.tangent.context.getState(node) as any
		state.editor.root.focus()
		state.editor.select([offset, offset])
		return state.editor.doc.selection?.[0]
	}, { name, offset })
}

function getCaret(window: TangentWindow, name: string) {
	return window.page.evaluate(name => {
		const workspace = (document as any).workspace as Workspace
		const node = workspace.directoryStore.getWithPortablePath('FILES/' + name)
		const state = workspace.viewState.tangent.context.getState(node) as any
		return state.editor.doc.selection?.[0]
	}, name)
}

test('editing after a search match leaves the caret in place', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()

	// The match "constr" is a prefix of "constraints"; the caret goes right
	// after "constraints", before the period.
	const name = 'Search Caret.md'
	const line = 'People do better when there are constraints.'
	await openNote(window, workspace, name, line)

	await search(window, name, 'constr')

	// Exactly one match, so the caret jump (if it happened) would be unambiguous.
	await expect(window.page.locator('.current .noteEditor article .annotation')).toHaveCount(1)

	const period = line.indexOf('.')
	const caret = await setCaret(window, name, period)
	expect(caret).toBe(period)

	// Type a space just before the period.
	await window.keyboard.type(' ')

	// The caret must sit right after the inserted space, not snap back onto the
	// "constr" match earlier in the line.
	expect(await getCaret(window, name)).toBe(period + 1)

	// Backspace must likewise land where the edit happened.
	await window.keyboard.press('Backspace')
	expect(await getCaret(window, name)).toBe(period)
})
