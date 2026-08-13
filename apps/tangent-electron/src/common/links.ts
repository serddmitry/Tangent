import { isWindows } from 'common/platform'

// From http://urlregex.com
const externalLinkMatch = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[\-;:&=\+\$,\w]+@)?[A-Za-z0-9\.\-]+|(?:www\.|[\-;:&=\+\$,\w]+@)[A-Za-z0-9\.\-]+)((?:\/[\+~%\/\.\w\-_]*)?\??(?:[\-\+=&;%@\.\w_]*)#?(?:[\.\!\/\\\w]*))?)/

export function isExternalLink(link: string) {
	return link?.match(externalLinkMatch) != null
}

// Dead simple
const rootLinkMatch = /^\/|\\/
export function isRootLink(link: string) {
	return link?.match(rootLinkMatch)
}

/*
 * Backslash escapes in front of a space or ASCII punctuation. macOS's Finder
 * produces these for "Copy as Pathname", as does dragging a file into a
 * terminal, so escaped paths are what users actually have on the clipboard.
 * Markdown uses the same convention for escaping punctuation.
 *
 * A backslash in front of anything else (`C:\Users`) is left alone: that's a
 * Windows separator, not an escape.
 */
const pathEscapeMatch = /\\([ !"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g

/**
 * Removes backslash escapes from a link href being treated as a filesystem
 * path. Not applied on Windows, where `\` really is a path separator.
 *
 * A literal backslash in a filename needs to be written as `%5C`.
 */
export function unescapeLinkPath(href: string): string {
	if (!href || isWindows) return href
	return href.replace(pathEscapeMatch, '$1')
}

const fileUrlMatch = /^file:\/\//i

/**
 * Whether the link is a `file://` url naming something on the local disk.
 *
 * Note that `isExternalLink()` returns *false* for these: its pattern expects a
 * host name after the scheme, and a `file://` url has an empty host. That works
 * in our favor—these need to be treated as paths, not handed to the shell as
 * urls—but it's surprising enough to be worth stating.
 */
export function isFileUrl(link: string) {
	return link != null && fileUrlMatch.test(link)
}

/**
 * Converts a `file://` url into a plain filesystem path.
 */
export function fileUrlToPath(link: string): string {
	if (!isFileUrl(link)) return link

	let result = link.replace(fileUrlMatch, '')
	try {
		result = decodeURIComponent(result)
	}
	catch (e) {
		// Malformed percent escapes; the raw value is the best guess available.
	}

	// Windows drive paths arrive with a leading separator: `file:///C:/foo`
	return result.replace(/^\/([A-Za-z]:)/, '$1')
}

/**
 * Converts a filesystem path into a `file://` url safe to use as the `src` of
 * an element. Bare paths mostly work as urls—the app is served from `file://`,
 * so they resolve against the disk root—but anything containing a space, `#`,
 * or `?` needs escaping first.
 */
export function pathToFileUrl(aPath: string): string {
	if (!aPath) return aPath

	const normalized = aPath.replace(/\\/g, '/')
	// `encodeURI` leaves `/` and `:` alone (so drive letters survive) but does
	// not escape `#` or `?`, which would otherwise truncate the url.
	const encoded = encodeURI(normalized)
		.replace(/#/g, '%23')
		.replace(/\?/g, '%3F')

	return 'file://' + (encoded.startsWith('/') ? '' : '/') + encoded
}
