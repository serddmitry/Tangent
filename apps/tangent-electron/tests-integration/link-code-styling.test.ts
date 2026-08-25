import fs from 'fs'
import path from 'path'

import type { Workspace } from 'app/model'
import { test, expect } from './tangent'
import type TangentWindow from './TangentWindow'

/*
 * Two appearance concerns:
 *   - Inline `code` spans should render in their own color (--inlineCodeColor),
 *     not the accent color that resolved links use.
 *   - The "Underline Links" setting toggles a persistent underline on link text
 *     via the `underline-links` body class.
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

test('inline code renders in its own color, distinct from links', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()

	await openNote(window, workspace, 'styling.md',
		'Some `inline code` and a [[styling]] link.\n')

	const code = window.page.locator('.current code.inline_code:not(.hidden)').first()
	await expect(code).toBeVisible()

	const codeColor = await code.evaluate(el => getComputedStyle(el).color)
	const link = window.page.locator('.current t-link .link_internal').first()
	const linkColor = await link.evaluate(el => getComputedStyle(el).color)

	// The inline code color should resolve to --inlineCodeColor, and it should
	// NOT be the same as the (accent) link color.
	expect(codeColor).not.toBe(linkColor)
})

test('the Underline Links setting toggles a persistent link underline', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()

	await openNote(window, workspace, 'underline.md',
		'A link to [[underline]] here.\n')

	const linkText = window.page.locator('.current t-link .link_internal:not(.hidden):not(.hashtag)').first()
	await expect(linkText).toBeVisible()

	const setUnderline = (value: boolean) => window.page.evaluate(value => {
		const workspace = (document as any).workspace as Workspace
		workspace.settings.underlineLinks.set(value)
	}, value)

	// Off by default: no persistent underline.
	await setUnderline(false)
	await expect.poll(() => window.page.evaluate(() =>
		document.body.classList.contains('underline-links'))).toBe(false)
	expect(await linkText.evaluate(el => getComputedStyle(el).textDecorationLine)).toBe('none')

	// On: body class applied and the link text is underlined.
	await setUnderline(true)
	await expect.poll(() => window.page.evaluate(() =>
		document.body.classList.contains('underline-links'))).toBe(true)
	expect(await linkText.evaluate(el => getComputedStyle(el).textDecorationLine)).toBe('underline')

	// Back off again.
	await setUnderline(false)
	await expect.poll(() => window.page.evaluate(() =>
		document.body.classList.contains('underline-links'))).toBe(false)
	expect(await linkText.evaluate(el => getComputedStyle(el).textDecorationLine)).toBe('none')
})
