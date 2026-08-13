import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'

import type { Workspace } from 'app/model'
import { test, expect } from './tangent'
import type TangentApp from './TangentApp'
import type TangentWindow from './TangentWindow'

/*
 * Links and embeds can point at files that live outside of the workspace. These
 * exercise both halves of that: the paths resolve to the right place, and the
 * two ways a link can turn into code execution are confirmed with the user
 * first (see `src/main/safeOpen.ts`).
 *
 * `shell` and `dialog` are stubbed in the main process so that nothing actually
 * opens, and so that what *would* have opened can be asserted on.
 */

/** A directory outside of the workspace, holding real files to embed. */
let externalDirectory: string

test.beforeAll(async () => {
	externalDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tangent-external-'))

	// A real pdf, so that the embed has something to actually render
	const textPath = path.join(externalDirectory, 'source.txt')
	await fs.promises.writeFile(textPath, 'External document.', 'utf8')
	execFileSync('/bin/sh', ['-c',
		`cupsfilter ${JSON.stringify(textPath)} > ${JSON.stringify(path.join(externalDirectory, 'sample.pdf'))} 2>/dev/null`])
	await fs.promises.rm(textPath)

	// A 1x1 png
	await fs.promises.writeFile(
		path.join(externalDirectory, 'sample.png'),
		Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

	await fs.promises.writeFile(path.join(externalDirectory, 'notes.txt'), 'Not embeddable.', 'utf8')
})

test.afterAll(async () => {
	if (externalDirectory) {
		await fs.promises.rm(externalDirectory, { recursive: true, force: true })
	}
})

interface ShellCalls {
	openPath: string[]
	openExternal: string[]
	messageBox: number
}

/**
 * Replaces the main process' shell & dialog calls with recording stubs.
 * @param confirmDialogs What the confirmation dialog should answer with.
 */
async function stubShell(tangent: TangentApp, confirmDialogs = false) {
	await tangent.app.evaluate(({ shell, dialog }, { confirmDialogs }) => {
		const record = { openPath: [], openExternal: [], messageBox: 0 }
		;(globalThis as any).__shellCalls = record

		shell.openPath = async (aPath: string) => {
			record.openPath.push(aPath)
			return ''
		}
		shell.openExternal = async (url: string) => {
			record.openExternal.push(url)
		}
		dialog.showMessageBox = (async () => {
			record.messageBox++
			// Button 0 is the confirmation, button 1 is cancel
			return { response: confirmDialogs ? 0 : 1, checkboxChecked: false }
		}) as any
	}, { confirmDialogs })
}

function getShellCalls(tangent: TangentApp): Promise<ShellCalls> {
	return tangent.app.evaluate(() => (globalThis as any).__shellCalls)
}

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
 * Clicks the nth link in the current note and returns what the shell was asked
 * to open. Links are addressed by position because a `t-link` contains its href
 * as well as its text, which makes matching on text unreliable.
 */
async function clickLink(window: TangentWindow, tangent: TangentApp, index: number) {
	await window.page.locator('.current t-link').nth(index).click()
	// The open request round trips through ipc
	await window.page.waitForTimeout(250)
	return getShellCalls(tangent)
}

test('links to files outside of the workspace open in their default app', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()
	await stubShell(tangent)

	const external = externalDirectory
	const relativeToWorkspace = path.relative(workspace, external)

	await openNote(window, workspace, 'External Links.md', [
		`- [relative](${relativeToWorkspace}/sample.pdf)`,
		`- [absolute](${external}/sample.pdf)`,
		`- [home](~/a-folder/sample.pdf)`,
		`- [file url](file://${external}/sample.pdf)`,
		`- [escaped](file://${external}/spaced%20name.pdf)`,
		`- [folder](${external})`,
		`- [shell escaped](${external.replace(/ /g, '\\ ')}/spaced\\ name.pdf)`
	].join('\n\n'))

	// Every one of these resolves outside the workspace, so every one is
	// "untracked": known to be a real location, but not a workspace node.
	const links = window.page.locator('.current t-link')
	await expect(links).toHaveCount(7)
	for (let i = 0; i < 7; i++) {
		await expect(links.nth(i)).toHaveAttribute('link-state', 'untracked')
	}

	expect((await clickLink(window, tangent, 0)).openPath.at(-1))
		.toEqual(path.join(external, 'sample.pdf'))

	expect((await clickLink(window, tangent, 1)).openPath.at(-1))
		.toEqual(path.join(external, 'sample.pdf'))

	// `~` expands to the home directory, and only as the first segment
	expect((await clickLink(window, tangent, 2)).openPath.at(-1))
		.toEqual(path.join(os.homedir(), 'a-folder/sample.pdf'))

	expect((await clickLink(window, tangent, 3)).openPath.at(-1))
		.toEqual(path.join(external, 'sample.pdf'))

	// Percent escapes are decoded back into a usable path
	expect((await clickLink(window, tangent, 4)).openPath.at(-1))
		.toEqual(path.join(external, 'spaced name.pdf'))

	// A folder opens too; the shell shows it in the file browser
	expect((await clickLink(window, tangent, 5)).openPath.at(-1))
		.toEqual(external)

	// Shell-escaped, the way macOS Finder's "Copy as Pathname" hands it over
	expect((await clickLink(window, tangent, 6)).openPath.at(-1))
		.toEqual(path.join(external, 'spaced name.pdf'))

	// None of this should have gone out to the shell as a url
	expect((await getShellCalls(tangent)).openExternal).toEqual([])
})

test('embeds render files from outside of the workspace without copying them in', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()
	await stubShell(tangent)

	const external = externalDirectory

	await openNote(window, workspace, 'External Embeds.md', [
		`![](${external}/sample.png)`,
		`![](${external}/sample.pdf)`,
		`![](file://${external}/sample.pdf)`
	].join('\n\n'))

	const embeds = window.page.locator('.current t-embed')
	await expect(embeds).toHaveCount(3)
	for (let i = 0; i < 3; i++) {
		await expect(embeds.nth(i)).toHaveAttribute('link-state', 'resolved', { timeout: 10000 })
	}

	// The image points at the file where it lives
	const imageSource = await embeds.nth(0).locator('img').getAttribute('src')
	expect(imageSource).toEqual('file://' + external.replace(/ /g, '%20') + '/sample.png')

	// Both pdfs render: a canvas with real dimensions means pdf.js read the
	// file off of disk, which is the part that file:// urls could have broken.
	for (const index of [1, 2]) {
		const canvas = embeds.nth(index).locator('canvas')
		await expect(canvas).toHaveCount(1, { timeout: 10000 })
		const size = await canvas.evaluate((c: HTMLCanvasElement) => ({ width: c.width, height: c.height }))
		expect(size.width).toBeGreaterThan(0)
		expect(size.height).toBeGreaterThan(0)
	}

	// Nothing was copied into the workspace
	const workspaceFiles = await fs.promises.readdir(workspace)
	expect(workspaceFiles).not.toContain('sample.pdf')
	expect(workspaceFiles).not.toContain('sample.png')
})

test('embeds refuse file types that have no viewer', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()
	await stubShell(tangent)

	// Note contents name the path, so the embed machinery should not be
	// pointable at arbitrary files on disk.
	await openNote(window, workspace, 'Bad Embed.md', `![](${externalDirectory}/notes.txt)`)

	const embed = window.page.locator('.current t-embed')
	await expect(embed).toHaveAttribute('link-state', 'error', { timeout: 10000 })
})

test('opening an executable asks before running it', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()
	await stubShell(tangent, false)

	await openNote(window, workspace, 'Executable Link.md',
		`- [payload](${externalDirectory}/Totally Safe.app)\n\n- [document](${externalDirectory}/sample.pdf)`)

	// Declining the dialog means the app never opens
	let calls = await clickLink(window, tangent, 0)
	expect(calls.messageBox).toEqual(1)
	expect(calls.openPath).toEqual([])

	// A document doesn't prompt at all
	calls = await clickLink(window, tangent, 1)
	expect(calls.messageBox).toEqual(1)
	expect(calls.openPath.at(-1)).toEqual(path.join(externalDirectory, 'sample.pdf'))

	// Accepting the dialog lets it through
	await stubShell(tangent, true)
	calls = await clickLink(window, tangent, 0)
	expect(calls.messageBox).toEqual(1)
	expect(calls.openPath.at(-1)).toEqual(path.join(externalDirectory, 'Totally Safe.app'))
})

test('opening a non-web url scheme asks first', async ({ tangent, workspace }) => {
	const window = await tangent.firstWindow()
	await stubShell(tangent, false)

	await openNote(window, workspace, 'Scheme Links.md',
		'- [custom](weird-scheme://do/something)\n\n- [web](https://example.com/page)')

	// Any registered scheme launches whatever app claimed it
	let calls = await clickLink(window, tangent, 0)
	expect(calls.messageBox).toEqual(1)
	expect(calls.openExternal).toEqual([])

	// Web links are not interrupted
	calls = await clickLink(window, tangent, 1)
	expect(calls.messageBox).toEqual(1)
	expect(calls.openExternal.at(-1)).toEqual('https://example.com/page')
})
