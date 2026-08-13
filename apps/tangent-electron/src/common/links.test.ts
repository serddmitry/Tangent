import { describe, expect, it } from 'vitest'

import { fileUrlToPath, isExternalLink, isFileUrl, pathToFileUrl } from './links'

describe('isExternalLink', () => {
	it('Should match a normal url', () => {
		expect(isExternalLink('http://google.com')).toBe(true)
		expect(isExternalLink('https://www.apple.com')).toBe(true)
		expect(isExternalLink('ftp://place.it/location')).toBe(true)
	})

	it('Should not match a relative path', () => {
		expect(isExternalLink('../../My relative path')).toBe(false)
		expect(isExternalLink('./My relative path')).toBe(false)
	})

	it('Should not match a root path', () => {
		expect(isExternalLink('/My root path')).toBe(false)
	})

	it('Should not match a file url', () => {
		// These name a path, and are handled as one. If this ever starts
		// returning true, file links will be handed to `shell.openExternal`.
		expect(isExternalLink('file:///Users/me/doc.pdf')).toBe(false)
	})
})

describe('file urls', () => {
	it('Should identify file urls', () => {
		expect(isFileUrl('file:///Users/me/doc.pdf')).toBe(true)
		expect(isFileUrl('FILE:///Users/me/doc.pdf')).toBe(true)
		expect(isFileUrl('https://example.com')).toBe(false)
		expect(isFileUrl('/Users/me/doc.pdf')).toBe(false)
		expect(isFileUrl(null)).toBe(false)
	})

	it('Should convert file urls to paths', () => {
		expect(fileUrlToPath('file:///Users/me/doc.pdf')).toEqual('/Users/me/doc.pdf')
		expect(fileUrlToPath('file:///Users/me/a%20folder/doc.pdf')).toEqual('/Users/me/a folder/doc.pdf')
		expect(fileUrlToPath('file:///C:/Users/me/doc.pdf')).toEqual('C:/Users/me/doc.pdf')
	})

	it('Should leave non-file urls alone', () => {
		expect(fileUrlToPath('https://example.com')).toEqual('https://example.com')
	})

	it('Should survive malformed escapes', () => {
		expect(fileUrlToPath('file:///Users/me/100%.pdf')).toEqual('/Users/me/100%.pdf')
	})

	it('Should convert paths to file urls', () => {
		expect(pathToFileUrl('/Users/me/doc.pdf')).toEqual('file:///Users/me/doc.pdf')
		expect(pathToFileUrl('/Users/me/a folder/doc.pdf')).toEqual('file:///Users/me/a%20folder/doc.pdf')
		expect(pathToFileUrl('C:\\Users\\me\\doc.pdf')).toEqual('file:///C:/Users/me/doc.pdf')
	})

	it('Should escape characters that would truncate the url', () => {
		expect(pathToFileUrl('/Users/me/a#b.pdf')).toEqual('file:///Users/me/a%23b.pdf')
		expect(pathToFileUrl('/Users/me/a?b.pdf')).toEqual('file:///Users/me/a%3Fb.pdf')
	})

	it('Should round trip', () => {
		const original = '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/My Notes/a #1.pdf'
		expect(fileUrlToPath(pathToFileUrl(original))).toEqual(original)
	})
})
