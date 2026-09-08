import { describe, test, expect, it } from 'vitest'

import type { TreeNode } from './trees'
import { IndexData, StructureType } from './indexing/indexTypes'
import { bestMatchForSearch, buildFuzzySegementMatcher, buildMatcher, compareNodeSearch, nodeSearchResults, orderTreeNodesForSearch, type SegmentSearchNodePair } from './search'

describe('Match building', () => {
	it('should split characters by whitespace', () => {
		// Not matching diacritics here for readability
		expect(buildFuzzySegementMatcher('foo bar', false)).toEqual(/(foo).*(bar)/di)
	})
})

describe('Match ordering', () => {
	it('Should prefer earlier searches', () => {
		const matcher = buildMatcher('t t', { fuzzy: true })
		const source = ['Totally', 'Tonally Totalled']
		const matched = source.map(s => ({
			text: s,
			match: s.match(matcher)
		}))

		matched.sort((a, b) => compareNodeSearch(a.match, b.match))

		const sortedText = matched.map(i => i.text)

		expect(sortedText).toEqual([
			'Totally',
			'Tonally Totalled'
		])
	})

	it('Should prefer earlier searches, relative to the first directory split', () => {
		const matcher = buildMatcher('test', { fuzzy: true })
		const source = [
			'foo/test',
			'foo/some test',
			'foo/place/a test'
		]
		const matched = source.map(s => ({
			text: s,
			match: s.match(matcher)
		}))

		matched.sort((a, b) => compareNodeSearch(a.match, b.match))
		expect(matched.map(i => i.text)).toEqual([
			'foo/test',
			'foo/place/a test',
			'foo/some test'
		])
	})

	it('Should prefer searches that match more of the source', () => {
		const matcher = buildMatcher('test', { fuzzy: true })
		const source = [
			'test something',
			'test',
			'testing the other thing'
		]
		const matched = source.map(s => ({
			text: s,
			match: s.match(matcher)
		}))

		matched.sort((a, b) => compareNodeSearch(a.match, b.match))
		expect(matched.map(i => i.text)).toEqual([
			'test',
			'test something',
			'testing the other thing'
		])
	})

	it('Preference for larger matches should be relative to directory', () => {
		const matcher = buildMatcher('test', { fuzzy: true })
		const source = [
			'foo/test me',
			'foo/test this thing',
			'foo/place/test'
		]
		const matched = source.map(s => ({
			text: s,
			match: s.match(matcher)
		}))

		matched.sort((a, b) => compareNodeSearch(a.match, b.match))
		expect(matched.map(i => i.text)).toEqual([
			'foo/place/test',
			'foo/test me',
			'foo/test this thing'
		])
	})

	it('Preference for larger matches should work at the top level', () => {
		const matcher = buildMatcher('Tangent', { fuzzy: true })
		const source = [
			'Tangent',
			'Inbox/Tangent thing',
			'Archive/Tangent other thing'
		]
		const matched = source.map(s => ({
			text: s,
			match: s.match(matcher)
		}))

		matched.sort((a, b) => compareNodeSearch(a.match, b.match))
		expect(matched.map(i => i.text)).toEqual([
			'Tangent',
			'Inbox/Tangent thing',
			'Archive/Tangent other thing'
		])
	})

	it('Should set directory matches above children', () => {
		const matcher = buildMatcher('test', { fuzzy: true })
		const source = [
			'foo/test/my thing',
			'foo/test',
			'foo/test/the other thing'
		]
		const matched = source.map(s => ({
			text: s,
			match: s.match(matcher)
		}))

		matched.sort((a, b) => compareNodeSearch(a.match, b.match))
		expect(matched.map(i => i.text)).toEqual([
			'foo/test',
			'foo/test/my thing',
			'foo/test/the other thing'
		])
	})

	it('Should set the directory above a child of the same name', () => {
		const matcher = buildMatcher('Im', { fuzzy: true })
		const source = [
			'Projects/Immortals/Immortals',
			'Projects/Immortals',
			'Projects/Immortals/the other thing'
		]
		const matched = source.map(s => ({
			text: s,
			match: s.match(matcher)
		}))

		matched.sort((a, b) => compareNodeSearch(a.match, b.match))
		expect(matched.map(i => i.text)).toEqual([
			'Projects/Immortals',
			'Projects/Immortals/Immortals',
			'Projects/Immortals/the other thing'
		])
	})
})

describe('Matchless ordering (empty [[ query)', () => {
	// Nodes named so that alphabetical order is the opposite of recency,
	// letting these tests prove the sort is by modified time, not by name.
	const node = (name: string, modified: Date): SegmentSearchNodePair => ({
		node: { name, modified } as TreeNode,
		match: undefined
	})

	it('Should order same-day notes by exact modified time, newest first', () => {
		const nodes = [
			node('Apple', new Date(2026, 7, 31, 12, 0, 0)),   // earlier today
			node('Zebra', new Date(2026, 7, 31, 12, 30, 0))   // just now
		]
		nodes.sort(orderTreeNodesForSearch)
		expect(nodes.map(n => n.node.name)).toEqual(['Zebra', 'Apple'])
	})

	it('Should order across days by modified date, newest first', () => {
		const nodes = [
			node('Zebra', new Date(2026, 7, 30, 23, 0, 0)),   // yesterday
			node('Apple', new Date(2026, 7, 31, 1, 0, 0))     // today
		]
		nodes.sort(orderTreeNodesForSearch)
		expect(nodes.map(n => n.node.name)).toEqual(['Apple', 'Zebra'])
	})

	it('Should fall back to name when modified times are identical', () => {
		const when = new Date(2026, 7, 31, 12, 0, 0)
		const nodes = [
			node('Zebra', when),
			node('Apple', when)
		]
		nodes.sort(orderTreeNodesForSearch)
		expect(nodes.map(n => n.node.name)).toEqual(['Apple', 'Zebra'])
	})
})

describe('Last-opened ordering', () => {
	// A note whose modified date makes it *lose* on the modified-time tiebreak,
	// so these tests prove ordering is driven by last-opened, not modified date.
	const node = (name: string, path: string, modified: Date): SegmentSearchNodePair => ({
		node: { name, path, modified } as TreeNode,
		match: undefined
	})

	it('Should order most-recently-opened first, ahead of modified time', () => {
		const older = node('Apple', 'a.md', new Date(2026, 7, 31, 12, 0, 0))  // newest modified
		const newer = node('Zebra', 'z.md', new Date(2026, 7, 30, 12, 0, 0))  // oldest modified
		const opened = new Map<string, number>([['a.md', 1], ['z.md', 2]])
		const getLastOpened = (n: TreeNode) => opened.get(n.path) ?? 0

		const nodes = [older, newer]
		nodes.sort((a, b) => orderTreeNodesForSearch(a, b, true, getLastOpened))
		// z.md was opened most recently, so it wins despite its older modified date
		expect(nodes.map(n => n.node.name)).toEqual(['Zebra', 'Apple'])
	})

	it('Should place never-opened notes after opened ones, ordered by modified time', () => {
		const opened = node('Opened', 'o.md', new Date(2026, 7, 29, 12, 0, 0))   // oldest modified
		const freshA = node('FreshOld', 'fa.md', new Date(2026, 7, 30, 12, 0, 0))
		const freshB = node('FreshNew', 'fb.md', new Date(2026, 7, 31, 12, 0, 0)) // newest modified
		const openMap = new Map<string, number>([['o.md', 5]])
		const getLastOpened = (n: TreeNode) => openMap.get(n.path) ?? 0

		const nodes = [freshA, freshB, opened]
		nodes.sort((a, b) => orderTreeNodesForSearch(a, b, true, getLastOpened))
		// Opened note first; the two never-opened notes fall back to modified time
		expect(nodes.map(n => n.node.name)).toEqual(['Opened', 'FreshNew', 'FreshOld'])
	})
})

describe('Alias Searching', () => {
	test('Alias Names', () => {
		const testNode: TreeNode = {
			path: 'Some/File I made.md',
			fileType: '.md',
			name: 'File I made',
			meta: {
				uuid: '',
				structure: [
					{
						type: StructureType.FrontMatter,
						// Fake range
						start: 0,
						end: 10,
						data: { aliases: ['I made files'] }
					}
				]
			}
		}

		expect(IndexData.findAliasPaths(testNode)).toEqual([
			'Some/I made files.md'
		])
	})
})

describe('Diacritics', () => {
	it('Fuzy matches diacritics', () => {
		let matcher = buildMatcher('Note', { fuzzy: true })
		expect(matcher.test('Noté')).toBeTruthy()
		expect(matcher.test('note')).toBeTruthy()
		expect(matcher.test('nôte')).toBeTruthy()
		expect(matcher.test('nøte')).toBeTruthy()

		matcher = buildMatcher('and', { fuzzy: true })
		expect(matcher.test('ånd')).toBeTruthy()
	})

	it('Fuzzy matching i', () => {
		let matcher = buildMatcher('diacritics', { fuzzy: true })
		expect(matcher.test('Dîacritics')).toBeTruthy()
	})

	it('Fuzy matches diacritics across multiple tokens', () => {
		let matcher = buildMatcher('note with diacritics', { fuzzy: true })
		expect(matcher.test('Noté With dîacritics')).toBeTruthy()
		expect(matcher.test('note with diacritics')).toBeTruthy()
		expect(matcher.test('nôte With Dîacritics')).toBeTruthy()
		expect(matcher.test('nøte with diacritics')).toBeTruthy()
	})
})
