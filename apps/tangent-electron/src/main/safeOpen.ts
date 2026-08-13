import { BrowserWindow, dialog, shell } from 'electron'
import Logger from 'js-logger'

import paths from 'common/paths'
import { getExecutableExtensionMatch } from 'common/fileExtensions'
import { fileUrlToPath, isFileUrl } from 'common/links'

const log = Logger.get('safe-open')

/*
 * Handing a path or url to the OS shell is the point where note contents stop
 * being text and start being actions. Note contents are not necessarily
 * trustworthy—vaults get synced, shared, and downloaded—so the two things that
 * turn a link into code execution are confirmed with the user first:
 *
 *   - opening a file the shell will *run* rather than display
 *   - opening a url in a scheme other than the web's
 *
 * The checks live here, in the main process, rather than in the renderer. This
 * is the privilege boundary; a renderer-side check evaporates the moment the
 * renderer is compromised.
 */

const executableExtensionMatch = getExecutableExtensionMatch(process.platform)

/** Schemes that are understood to just open a browser or mail client. */
const webUrlSchemes = ['http:', 'https:', 'mailto:', 'tel:']

function getScheme(url: string): string {
	const match = url?.match(/^([A-Za-z][A-Za-z0-9+.\-]*):/)
	return match ? match[1].toLowerCase() + ':' : null
}

interface ConfirmOptions {
	title: string
	message: string
	detail: string
	confirmLabel: string
}

async function confirm(window: BrowserWindow, options: ConfirmOptions): Promise<boolean> {
	const messageBoxOptions: Electron.MessageBoxOptions = {
		type: 'warning',
		buttons: [options.confirmLabel, 'Cancel'],
		defaultId: 1,
		cancelId: 1,
		title: options.title,
		message: options.message,
		detail: options.detail
	}

	const result = window && !window.isDestroyed()
		? await dialog.showMessageBox(window, messageBoxOptions)
		: await dialog.showMessageBox(messageBoxOptions)

	return result.response === 0
}

/**
 * Opens a path in its default application, confirming first when doing so would
 * run code.
 * @returns The same error string contract as `shell.openPath`: empty on success
 * (or on user cancellation), an error message otherwise.
 */
export async function openPathSafely(aPath: string, window?: BrowserWindow): Promise<string> {
	if (aPath?.match(executableExtensionMatch)) {
		const confirmed = await confirm(window, {
			title: 'Run an application?',
			message: `"${paths.basename(aPath)}" can run code on your computer.`,
			detail: `Tangent was asked to open:\n${aPath}\n\nOnly continue if you trust this link. Notes can link to anything on your computer.`,
			confirmLabel: 'Open Anyway'
		})

		if (!confirmed) {
			log.info('User declined to open executable path:', aPath)
			return ''
		}
	}

	return shell.openPath(aPath)
}

/**
 * Opens a url with the system handler, confirming first for schemes outside of
 * the web's. Any registered scheme launches whatever app claimed it, which is a
 * short path from "clicked a link in a note" to "ran an arbitrary program".
 */
export async function openExternalSafely(url: string, window?: BrowserWindow): Promise<void> {
	const scheme = getScheme(url)

	// `file:` urls name something on disk. Route them through the path rules
	// instead of letting the shell interpret them as urls.
	if (isFileUrl(url)) {
		await openPathSafely(fileUrlToPath(url), window)
		return
	}

	// Schemeless links (e.g. `www.example.com`) are treated as web links.
	if (scheme && !webUrlSchemes.includes(scheme)) {
		const confirmed = await confirm(window, {
			title: 'Open an external application?',
			message: `This link opens with the app registered for "${scheme}" links.`,
			detail: `Tangent was asked to open:\n${url}\n\nOnly continue if you trust this link.`,
			confirmLabel: 'Open Anyway'
		})

		if (!confirmed) {
			log.info('User declined to open external url with scheme', scheme)
			return
		}
	}

	return shell.openExternal(url)
}
