import { describe, expect, it } from 'vitest'

import { getExecutableExtensionMatch, getFileTypeRegex } from './fileExtensions'

describe('File Extension Utils', () => {
	it('Should always line up with the end', () => {
		const mdMatch = getFileTypeRegex(['.md', 'folder'])
		expect('.mdx'.match(mdMatch)).toBeNull()
	})
	it('Should always line up with the end', () => {
		const mdMatch = getFileTypeRegex(['.md', '.txt'])
		expect('.mdx'.match(mdMatch)).toBeNull()
		expect('.md'.match(mdMatch)).not.toBeNull()
	})
})

describe('getExecutableExtensionMatch', () => {
	const mac = getExecutableExtensionMatch('darwin')
	const windows = getExecutableExtensionMatch('win32')

	it('Should catch things the shell will run', () => {
		expect('/Users/me/Invoice.app').toMatch(mac)
		expect('/Users/me/run.command').toMatch(mac)
		expect('/Users/me/install.pkg').toMatch(mac)
		expect('/Users/me/go.sh').toMatch(mac)
		expect('C:/Users/me/thing.exe').toMatch(windows)
		expect('C:/Users/me/thing.bat').toMatch(windows)
	})

	it('Should leave documents alone', () => {
		expect('/Users/me/spec.pdf').not.toMatch(mac)
		expect('/Users/me/notes.md').not.toMatch(mac)
		expect('/Users/me/photo.png').not.toMatch(mac)
		expect('/Users/me/a folder').not.toMatch(mac)
	})

	it('Should only flag what the running platform actually executes', () => {
		// `.js` runs via the script host on Windows; on macOS it opens in an
		// editor, and prompting there would just be noise.
		expect('/Users/me/script.js').not.toMatch(mac)
		expect('C:/Users/me/script.js').toMatch(windows)
	})

	it('Should catch url-forwarding files that can name other schemes', () => {
		expect('/Users/me/link.webloc').toMatch(mac)
		expect('C:/Users/me/link.url').toMatch(windows)
	})
})
