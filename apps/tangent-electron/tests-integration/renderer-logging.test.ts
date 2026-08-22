import fs from 'fs'
import path from 'path'

import type { Workspace } from 'app/model'
import { test, expect } from './tangent'
import type TangentApp from './TangentApp'

/*
 * Nothing the renderer said used to be recorded anywhere: `js-logger` had no
 * handler installed in the window, console output only existed while devtools
 * was open, and uncaught exceptions left no trace at all. That made a renderer
 * that had stopped responding impossible to investigate after the fact.
 *
 * These check the whole path: renderer -> `api.log.write` -> main -> log file.
 */

/** The log the main process is writing to, per `main/logging.ts`. */
async function getLogPath(tangent: TangentApp) {
	const logsDir = await tangent.app.evaluate(({ app }) => app.getPath('logs'))
	// `WORKSPACE_NAME` is set to `test_` by the fixture
	return path.join(logsDir, 'test_log.txt')
}

/**
 * The log stream is buffered, so give it a moment to make it to disk.
 */
function expectLogToContain(logPath: string, expected: RegExp) {
	return expect.poll(async () => {
		try {
			return await fs.promises.readFile(logPath, 'utf8')
		}
		catch {
			return ''
		}
	}, { timeout: 5000 }).toMatch(expected)
}

test('Renderer console errors reach the log file', async ({ tangent }) => {
	const tangentWindow = await tangent.firstWindow()
	const logPath = await getLogPath(tangent)

	await tangentWindow.page.evaluate(() => {
		console.error('A canary from the renderer', { detail: 'with an object' })
	})

	await expectLogToContain(logPath, /\[renderer\].*A canary from the renderer/)
	await expectLogToContain(logPath, /detail: with an object/)
})

test('Uncaught renderer errors reach the log file', async ({ tangent }) => {
	const tangentWindow = await tangent.firstWindow()
	const logPath = await getLogPath(tangent)

	await tangentWindow.page.evaluate(() => {
		// Thrown out of band so that it goes uncaught rather than back to the test
		setTimeout(() => { throw new Error('A canary exception') })
	})

	await expectLogToContain(logPath, /Uncaught error:[\s\S]*A canary exception/)
})

test('Unhandled promise rejections reach the log file', async ({ tangent }) => {
	const tangentWindow = await tangent.firstWindow()
	const logPath = await getLogPath(tangent)

	await tangentWindow.page.evaluate(() => {
		Promise.reject(new Error('A canary rejection'))
	})

	await expectLogToContain(logPath, /Unhandled promise rejection:[\s\S]*A canary rejection/)
})

test('Thread changes are recorded in the log file', async ({ tangent }) => {
	const tangentWindow = await tangent.firstWindow()
	const logPath = await getLogPath(tangent)

	await fs.promises.writeFile(
		path.join(tangent.workspacePath, 'Logged Note.md'), 'A note to navigate to.', 'utf8')

	await tangentWindow.page.waitForFunction(() => {
		const workspace = (document as any).workspace as Workspace
		return !!workspace.directoryStore.getWithPortablePath('FILES/Logged Note.md')
	})

	await tangentWindow.setThread({ paths: ['Logged Note.md'] })

	await expectLogToContain(logPath, /\[Session\] Thread:.*-> \[Logged Note\] @ Logged Note/)

	// Asking for the thread that is already open is the other half of the story:
	// it says the request arrived and was deliberately ignored.
	await tangentWindow.setThread({ paths: ['Logged Note.md'] })

	await expectLogToContain(logPath, /Thread update would not change the current state/)
})
