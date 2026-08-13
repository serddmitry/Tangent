import { describe, expect, it } from 'vitest'

import { EmbedType, getEmbedTypeFromPath } from './embedding'

describe('getEmbedTypeFromPath', () => {
	it('Should identify media by extension', () => {
		expect(getEmbedTypeFromPath('/Users/me/a.png')).toEqual(EmbedType.Image)
		expect(getEmbedTypeFromPath('/Users/me/a.pdf')).toEqual(EmbedType.PDF)
		expect(getEmbedTypeFromPath('/Users/me/a.mp3')).toEqual(EmbedType.Audio)
		expect(getEmbedTypeFromPath('/Users/me/a.mp4')).toEqual(EmbedType.Video)
		expect(getEmbedTypeFromPath('/Users/me/a.css')).toEqual(EmbedType.Style)
	})

	it('Should work on bare file types', () => {
		expect(getEmbedTypeFromPath('.pdf')).toEqual(EmbedType.PDF)
		expect(getEmbedTypeFromPath('folder')).toEqual(EmbedType.Invalid)
	})

	it('Should ignore cache busting queries', () => {
		expect(getEmbedTypeFromPath('/Users/me/a.pdf?t=12345')).toEqual(EmbedType.PDF)
	})

	it('Should reject anything without a viewer', () => {
		// Note contents name the path; only media types should be loadable.
		expect(getEmbedTypeFromPath('/Users/me/.ssh/id_rsa')).toEqual(EmbedType.Invalid)
		expect(getEmbedTypeFromPath('/Users/me/secrets.txt')).toEqual(EmbedType.Invalid)
		expect(getEmbedTypeFromPath('/Users/me/Thing.app')).toEqual(EmbedType.Invalid)
		expect(getEmbedTypeFromPath(null)).toEqual(EmbedType.Invalid)
	})
})
