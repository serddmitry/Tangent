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
