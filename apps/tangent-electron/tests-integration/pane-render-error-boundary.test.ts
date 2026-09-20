import fs from 'fs'
import path from 'path'

import type { Workspace } from 'app/model'
import { test, expect } from './tangent'

/*
 * A render error inside a pane (classically: a keyed `{#each}` handed a
 * duplicate key, which Svelte throws on) used to escape to the root and leave
 * Svelte's flush machinery mid-update. After that, every store-driven view in
 * the window silently stopped updating — New Note created files but never
 * opened them, Cmd+W did nothing, clicking a note did not change the panes.
 *
 * ThreadView now wraps each pane in a `<svelte:boundary>`, so a pane that
 * throws shows a fallback while the rest of the app keeps working. This test
 * forces a real duplicate-key throw in the inline backlinks and asserts the app
 * is still navigable afterwards.
 */

async function indexed(window: any, name: string) {
	await window.page.waitForFunction((name: string) => {
		const w = (document as any).workspace as Workspace
		return !!w.directoryStore.getWithPortablePath('FILES/' + name)
	}, name)
}

test('a pane render crash is isolated and does not freeze the app', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()

	const crashes: string[] = []
	window.page.on('console', msg => {
		if (msg.type() === 'error' && /each_key_duplicate/.test(msg.text())) crashes.push(msg.text())
	})
	window.page.on('pageerror', err => {
		if (/each_key_duplicate/.test(err.message)) crashes.push('pageerror: ' + err.message)
	})

	// `target` is linked to by `source`, so it has an inbound link (needed for the
	// inline backlinks section, which is the `{#each}` we will corrupt).
	await fs.promises.writeFile(path.join(workspace, 'target.md'), 'The target note.', 'utf8')
	await fs.promises.writeFile(path.join(workspace, 'source.md'), 'See [[target]].', 'utf8')
	await fs.promises.writeFile(path.join(workspace, 'other.md'), 'An unrelated note.', 'utf8')
	await indexed(window, 'target.md')
	await indexed(window, 'source.md')
	await indexed(window, 'other.md')

	// Turn on inline backlinks and open the target so its backlinks render.
	await window.page.evaluate(() => {
		const w = (document as any).workspace as Workspace
		;(w.settings as any).showInlineBacklinks.set(true)
	})
	await window.setThread({ paths: ['target.md'] })
	await window.page.waitForSelector('.current .inlineBacklinks')
	await expect(window.locateCurrentNoteTitle()).toHaveText('target')

	// Corrupt the backlinks into a duplicate key: two entries that key identically
	// in InlineBacklinks (`from_start-end_context`). This is exactly the shape of
	// throw that used to freeze the whole window.
	await window.page.evaluate(() => {
		const w = (document as any).workspace as Workspace
		const node: any = w.directoryStore.getWithPortablePath('FILES/target.md')
		const inLinks = node.meta.inLinks
		inLinks.push(inLinks[0]) // same object -> identical key
		node.notifyChanged()
	})

	// The pane shows the fallback instead of taking down the app.
	await window.page.waitForSelector('.current .paneError', { timeout: 4000 })
	expect(crashes.length).toBeGreaterThan(0)

	// The app is NOT frozen: navigating to another note still updates the pane.
	await window.setThread({ paths: ['other.md'] })
	await expect(window.locateCurrentNoteTitle()).toHaveText('other', { timeout: 4000 })
})
