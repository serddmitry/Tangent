import fs from 'fs'
import path from 'path'

import { test, expect, wait } from './tangent'
import type Workspace from 'app/model/Workspace'

/**
 * The `[[` autocomplete popup (and the Cmd+O file list, which shares the sort)
 * should list notes most-recently-opened first, regardless of their modified
 * date or name. This drives the notes to a deliberately contradictory order:
 * write order (→ modified date) and alphabetical order both disagree with the
 * order the notes are opened in, so only recency ordering produces the expected
 * result.
 */
test('the [[ popup lists notes most-recently-opened first', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()
	const { keyboard } = window

	// Write order sets modified date: Beta oldest, then Gamma, then Alpha.
	for (const name of ['Beta', 'Gamma', 'Alpha']) {
		await fs.promises.writeFile(path.join(workspace, name + '.md'), name + ' body', 'utf8')
		await wait(50)
	}

	// Wait for all three to be indexed
	await window.page.waitForFunction(() => {
		const workspace = (document as any).workspace as Workspace
		const store = workspace.directoryStore
		return ['Alpha', 'Beta', 'Gamma'].every(n => !!store.getWithPortablePath('FILES/' + n + '.md'))
	})

	// Open the notes in an order that matches neither modified date nor name.
	// Resulting recency (newest first): Beta, Gamma, Alpha.
	for (const name of ['Alpha', 'Gamma', 'Beta']) {
		await window.setThread({ paths: [name + '.md'] })
		await window.page.waitForSelector('.current .noteEditor article')
		await wait(50)
	}

	// Open a fresh origin note to type the link into. It becomes the current
	// node (so it is excluded from its own suggestions) without disturbing the
	// relative recency of the three target notes.
	await fs.promises.writeFile(path.join(workspace, 'Origin.md'), '', 'utf8')
	await window.page.waitForFunction(() => {
		const workspace = (document as any).workspace as Workspace
		return !!workspace.directoryStore.getWithPortablePath('FILES/Origin.md')
	})
	await window.setThread({ paths: ['Origin.md'] })
	await window.page.waitForSelector('.current .noteEditor article')

	// A version bump makes the app greet launch with the changelog modal, which
	// would swallow the click below. Dismiss anything covering the editor.
	while (await window.page.locator('.modal').count() > 0) {
		await keyboard.press('Escape')
		await wait(100)
	}

	// Open the `[[` autocomplete with an empty query
	await window.locateCurrentNoteBody().click()
	await keyboard.type('[[')

	await window.page.waitForSelector('.autocomplete-window .option.wikilink .path')

	const names = await window.page
		.locator('.autocomplete-window .option.wikilink .path')
		.allInnerTexts()

	// Most-recently-opened first — not modified-date (Alpha, Gamma, Beta) and
	// not alphabetical (Alpha, Beta, Gamma).
	expect(names.slice(0, 3).map(n => n.trim())).toEqual(['Beta', 'Gamma', 'Alpha'])
})

/**
 * Recency is keyed by path, so a note that is renamed after being opened — the
 * common case being a freshly created note the moment you give it a title —
 * must carry its recency across the rename. Otherwise it looks "never opened"
 * and sinks below notes opened much earlier.
 */
test('a note keeps its recency after being renamed', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()
	const { keyboard } = window

	// Draft is written first, so it has the *older* modified date. If recency is
	// lost on rename, it would fall back to modified date and sink below Early.
	await fs.promises.writeFile(path.join(workspace, 'Draft.md'), 'draft body', 'utf8')
	await wait(50)
	await fs.promises.writeFile(path.join(workspace, 'Early.md'), 'early body', 'utf8')

	await window.page.waitForFunction(() => {
		const workspace = (document as any).workspace as Workspace
		const store = workspace.directoryStore
		return ['Draft', 'Early'].every(n => !!store.getWithPortablePath('FILES/' + n + '.md'))
	})

	// Open Early first, then Draft — so Draft is the more recently opened of the two.
	for (const name of ['Early', 'Draft']) {
		await window.setThread({ paths: [name + '.md'] })
		await window.page.waitForSelector('.current .noteEditor article')
		await wait(50)
	}

	// Rename Draft.md -> Renamed.md the way the app does (which fires a `moved`
	// tree change), then wait for the move to land in the store.
	await window.page.evaluate(() => {
		const workspace = (document as any).workspace as Workspace
		const node = workspace.directoryStore.getWithPortablePath('FILES/Draft.md') as any
		node.rename('Renamed')
	})
	await window.page.waitForFunction(() => {
		const store = ((document as any).workspace as Workspace).directoryStore
		return !!store.getWithPortablePath('FILES/Renamed.md')
			&& !store.getWithPortablePath('FILES/Draft.md')
	})

	// Open a fresh origin note to type the link into, without disturbing the
	// relative recency of the target notes.
	await fs.promises.writeFile(path.join(workspace, 'Origin.md'), '', 'utf8')
	await window.page.waitForFunction(() => {
		const workspace = (document as any).workspace as Workspace
		return !!workspace.directoryStore.getWithPortablePath('FILES/Origin.md')
	})
	await window.setThread({ paths: ['Origin.md'] })
	await window.page.waitForSelector('.current .noteEditor article')

	while (await window.page.locator('.modal').count() > 0) {
		await keyboard.press('Escape')
		await wait(100)
	}

	await window.locateCurrentNoteBody().click()
	await keyboard.type('[[')

	await window.page.waitForSelector('.autocomplete-window .option.wikilink .path')

	const names = await window.page
		.locator('.autocomplete-window .option.wikilink .path')
		.allInnerTexts()

	// Renamed (opened last, as Draft) must still rank above Early despite Early's
	// newer modified date — proving recency followed the rename.
	expect(names.slice(0, 2).map(n => n.trim())).toEqual(['Renamed', 'Early'])
})
