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
		const node = workspace.directoryStore.getWithPortablePath('FILES/A.md') as unknown as {
			rename(newName: string): boolean
		}
		node.rename('Renamed A')
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

test('custom wiki link text disables native spellcheck while editing', async ({ tangent, workspace }) => {
	await fs.promises.writeFile(path.join(workspace, 'A.md'), 'Target note.', 'utf8')
	await fs.promises.writeFile(path.join(workspace, 'B.md'), 'Заканчивай [[A|таймбокс]], всё.', 'utf8')

	const window = await tangent.firstWindow()
	await window.page.waitForFunction(() => {
		const workspace = (document as any).workspace as Workspace
		return workspace.directoryStore.getWithPortablePath('FILES/B.md')?.meta?.structure?.length
	})
	await window.setThread({ paths: ['B.md'], current: 'B.md' })

	const alias = window.page.locator('.current t-link [spellcheck="false"]')
		.filter({ hasText: 'таймбокс' })
	await expect(alias).toHaveCount(1)
})

test('linked reference context updates when text is appended after an unchanged link', async ({ tangent, workspace }) => {
	await fs.promises.writeFile(path.join(workspace, 'A.md'), 'Target note.', 'utf8')
	await fs.promises.writeFile(path.join(workspace, 'B.md'), 'Old context around [[A]].', 'utf8')

	const window = await tangent.firstWindow()
	await window.page.waitForFunction(() => {
		const workspace = (document as any).workspace as Workspace
		return workspace.directoryStore.getWithPortablePath('FILES/A.md')?.meta?.inLinks?.length
	})

	await window.page.evaluate(() => {
		const workspace = (document as any).workspace as Workspace
		workspace.settings.showInlineBacklinks.set(true)
	})
	await window.setThread({ paths: ['A.md', 'B.md'], current: 'B.md' })

	const reference = window.page.locator('.inlineBacklink')
	await expect(reference).toContainText('Old context around')

	await window.locateCurrentNoteBody().click()
	await window.keyboard.press('End')
	await window.keyboard.type(' Fresh context after the link.')

	expect(await window.getCurrentEditorText()).toContain('Fresh context after the link')
	await expect.poll(() => window.page.evaluate(() => {
		const workspace = (document as any).workspace as Workspace
		return workspace.directoryStore
			.getWithPortablePath('FILES/A.md')?.meta?.inLinks?.[0]?.context
	})).toContain('Fresh context after the link')
	await expect(reference).toContainText('Fresh context after the link', { timeout: 2000 })
	await expect.poll(() => fs.promises.readFile(path.join(workspace, 'B.md'), 'utf8'))
		.toBe('Old context around [[A]].')
})
