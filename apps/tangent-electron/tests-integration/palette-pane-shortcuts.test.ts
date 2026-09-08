import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from './tangent'

test('Go To palette shows pane-opening shortcut hints', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow(false)
	const { keyboard } = window

	await fs.promises.writeFile(path.join(workspace, 'Note.md'), 'Some content.', 'utf8')

	await window.waitForReady()

	await window.shortcut('Mod+O')
	// Wait for the palette to mount before typing (the editor can briefly
	// steal focus from a freshly-opened modal).
	await window.page.locator('.ModalContainer input').waitFor()
	await keyboard.type('Note')

	// The footer only appears once a file/search result is selected.
	await expect(window.page.locator('.ModalContainer .selected')).toBeVisible()

	const footer = window.page.locator('.ModalContainer .paneShortcuts')
	await expect(footer).toBeVisible()

	// The default "Links & Panes" setting is 'new', so:
	await expect(footer.locator('.hint', { hasText: 'Go to file' })).toBeVisible()
	await expect(footer.locator('.hint', { hasText: 'Open in new pane' })).toBeVisible()
	await expect(footer.locator('.hint', { hasText: 'Replace current pane' })).toBeVisible()
	await expect(footer.locator('.hint', { hasText: 'Open in pane to the left' })).toBeVisible()
})
