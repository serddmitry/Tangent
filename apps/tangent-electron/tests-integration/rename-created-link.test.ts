import fs from 'fs'
import path from 'path'

import type { Workspace } from 'app/model'
import { test, expect, wait } from './tangent'
import type TangentWindow from './TangentWindow'

async function waitForNode(window: TangentWindow, name: string) {
	await window.page.waitForFunction(name => {
		const workspace = (document as any).workspace as Workspace
		return !!workspace.directoryStore.getWithPortablePath('FILES/' + name)
	}, name)
}

test('renaming a note created by clicking its wiki link updates the source link', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()

	// Page A links to a note that does not exist yet
	await fs.promises.writeFile(path.join(workspace, 'Page A.md'), '[[hello]]', 'utf8')
	await waitForNode(window, 'Page A.md')

	await window.setThread({ paths: ['Page A.md'] })
	await window.page.waitForSelector('.current .noteEditor article')

	// The link is unresolved (target is virtual)
	await expect(window.page.locator('.current t-link').first())
		.toHaveAttribute('link-state', 'empty')

	// Click the link -> should create and open a real "hello.md"
	await window.page.locator('.current t-link').first().click()
	await waitForNode(window, 'hello.md')
	await wait(300)

	// The newly-created note is real (on disk, not virtual) and the source
	// link now resolves to it.
	expect(fs.existsSync(path.join(workspace, 'hello.md'))).toBe(true)
	await expect(window.page.locator('t-link[from$="Page A.md"]').first())
		.toHaveAttribute('link-state', 'resolved')

	// Rename hello.md -> "hello 2"
	await window.page.evaluate(() => {
		const workspace = (document as any).workspace as Workspace
		const node = workspace.directoryStore.getWithPortablePath('FILES/hello.md') as any
		node.rename('hello 2')
	})
	await waitForNode(window, 'hello 2.md')
	await wait(500)

	// Page A's link text should have been rewritten to point at the new name,
	// and remain resolved.
	const pageAContents = await fs.promises.readFile(path.join(workspace, 'Page A.md'), 'utf8')
	expect(pageAContents).toContain('[[hello 2]]')
})
