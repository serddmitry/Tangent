import fs from 'fs'
import path from 'path'

import { test, expect } from './tangent'
import TangentWindow from './TangentWindow'
import type TangentApp from './TangentApp'

/*
 * On mac, closing a window does not quit the app; it sits in the dock with no
 * windows and its window handles dropped. These cover the two ways the app used
 * to forget what was open in that state: re-activating it dumped you on the
 * workspace selection screen, and quitting it wrote out an empty set of open
 * workspaces, so the _next_ launch asked as well.
 */

function countWindows(tangent: TangentApp) {
	return tangent.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
}

async function closeAllWindows(tangent: TangentApp) {
	await tangent.app.evaluate(({ BrowserWindow }) => {
		for (const window of BrowserWindow.getAllWindows()) {
			window.close()
		}
	})
	await expect.poll(() => countWindows(tangent)).toBe(0)
}

test('Reactivating with no windows reopens the last workspace', async ({ tangent, workspace }) => {
	test.skip(process.platform !== 'darwin', 'Only mac keeps the app alive without windows')

	const window = await tangent.firstWindow()
	expect(await window.getWorkspacePath()).toEqual(workspace)

	await closeAllWindows(tangent)

	// Stands in for clicking the dock icon
	const nextWindow = tangent.app.waitForEvent('window')
	await tangent.app.evaluate(({ app }) => { app.emit('activate') })

	const reactivated = new TangentWindow(tangent, await nextWindow)
	await reactivated.waitForReady()

	// Without this, the new window has no workspace and shows the selector
	expect(await reactivated.getWorkspacePath()).toEqual(workspace)
})

test('Shutting down with no windows remembers the open workspace', async ({
	tangent, workspace, workspaceInfoName
}) => {
	test.skip(process.platform !== 'darwin', 'Only mac keeps the app alive without windows')

	await tangent.firstWindow()

	const workspaceInfoPath = path.join(
		await tangent.app.evaluate(({ app }) => app.getPath('userData')),
		workspaceInfoName + 'workspaces.json')

	await fs.promises.rm(workspaceInfoPath, { force: true })

	await closeAllWindows(tangent)

	// The real quit path runs this same handler. Emitting it directly saves
	// workspace info without killing the app out from under the fixture.
	await tangent.app.evaluate(({ app }) => { app.emit('before-quit') })

	await expect.poll(async () => {
		try {
			return JSON.parse(await fs.promises.readFile(workspaceInfoPath, 'utf8'))
		}
		catch {
			return null
		}
	}).toMatchObject({
		openWorkspaces: [workspace]
	})
})
