import fs from 'fs'
import path from 'path'

import type { Workspace } from 'app/model'
import { test, expect } from './tangent'

test('renaming an open note preserves its link highlight', async ({ tangent, workspace }) => {
	await fs.promises.writeFile(path.join(workspace, 'A.md'), 'Target note.', 'utf8')
	await fs.promises.writeFile(path.join(workspace, 'B.md'), 'Link to [[A]].', 'utf8')

	const window = await tangent.firstWindow()
	await window.page.waitForFunction(() => {
		const workspace = (document as any).workspace as Workspace
		return workspace.directoryStore.getWithPortablePath('FILES/A.md')
			&& workspace.directoryStore.getWithPortablePath('FILES/B.md')?.meta?.structure?.length
	})

	await window.setThread({ paths: ['A.md', 'B.md'], current: 'B.md' })

	const link = window.page.locator('.current t-link[form="wiki"]')
	await expect(link).toHaveCount(1)
	await expect(link).toHaveAttribute('data-open', '')

	await window.page.evaluate(() => {
		const workspace = (document as any).workspace as Workspace
		workspace.directoryStore.getWithPortablePath('FILES/A.md').rename('Renamed A')
	})

	await expect(link).toHaveAttribute('href', 'Renamed A')
	await expect(link).toHaveAttribute('data-open', '')
})

test('linked references have a visible list marker', async ({ tangent, workspace }) => {
	await fs.promises.writeFile(path.join(workspace, 'A.md'), 'Target note.', 'utf8')
	await fs.promises.writeFile(path.join(workspace, 'B.md'), 'Link to [[A]].', 'utf8')

	const window = await tangent.firstWindow()
	await window.page.waitForFunction(() => {
		const workspace = (document as any).workspace as Workspace
		return workspace.directoryStore.getWithPortablePath('FILES/A.md')?.meta?.inLinks?.length
	})

	await window.page.evaluate(() => {
		const workspace = (document as any).workspace as Workspace
		workspace.settings.showInlineBacklinks.set(true)
	})
	await window.setThread({ paths: ['A.md'], current: 'A.md' })

	const reference = window.page.locator('.current .inlineBacklink')
	await expect(reference).toHaveCount(1)
	await expect(reference).toBeVisible()
	expect(await reference.evaluate(element =>
		getComputedStyle(element, '::before').content
	)).toBe('"–"')
})
