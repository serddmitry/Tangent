import { describe, test, expect, it } from 'vitest'

import { getEditInfo, snapPositionOutOfHiddenLinkBrackets, snapPositionPastTrailingLinkBrackets } from '.'
import { Delta } from '@typewriter/delta'
import { Op } from '@typewriter/document'
import { markdownToTextDocument } from '../markdownModel/parser'

describe('Edit Info', () => {
	test('Raw Delta insert', () => {
		expect(getEditInfo(new Delta([
			{ retain: 4 },
			{ insert: 'Foo' },
			{ retain: 3 }
		]))).toEqual({ offset: 4, insert: 'Foo', shift: 3 })

		expect(getEditInfo(new Delta([
			{ retain: 5 },
			{ insert: 'Food' }
		]))).toEqual({ offset: 5, insert: 'Food', shift: 4 })

		expect(getEditInfo(new Delta([
			{ insert: 'G' }
		]))).toEqual({ offset: 0, insert: 'G', shift: 1 })
	})

	test('Raw Delta delete', () => {
		expect(getEditInfo(new Delta([
			{ retain: 4 },
			{ delete: 3 },
			{ retain: 3 }
		]))).toEqual({ offset: 4, shift: -3 })

		expect(getEditInfo(new Delta([
			{ delete: 1 }
		]))).toEqual({ offset: 0, shift: -1 })
	})

	test('Compound retain insert', () => {
		expect(getEditInfo(new Delta([
			{ retain: 4 },
			{ retain: 2 },
			{ retain: 12 },
			{ insert: 'Foo' },
			{ retain: 3 }
		]))).toEqual({ offset: 18, insert: 'Foo', shift: 3 })
	})

	test('Compound retain delete', () => {
		expect(getEditInfo(new Delta([
			{ retain: 4 },
			{ retain: 2 },
			{ retain: 12 },
			{ delete: 1 },
			{ retain: 3 },
			{ retain: 16 }
		]))).toEqual({ offset: 18, shift: -1 })
	})
})

describe('snapPositionPastTrailingLinkBrackets', () => {
	// Find the contiguous trailing run of hidden, link_internal ops that ends in an
	// `end: true` op (the `]]` / `](url)` closing brackets), returning the position
	// just before it and just after it. Structure-driven so we don't hand-count.
	function closingBracketRange(doc: ReturnType<typeof markdownToTextDocument>) {
		const ops = doc.lines[0].content.ops
		let index = 0
		let runStart = -1
		for (const op of ops) {
			const a = op.attributes ?? {}
			const isClosingPart = a.hidden && a.link_internal
			if (isClosingPart && runStart < 0) runStart = index
			else if (!isClosingPart) runStart = -1
			index += Op.length(op)
			if (isClosingPart && a.end && runStart >= 0) {
				return { before: runStart, after: index }
			}
		}
		return null
	}

	it('snaps a caret before a wiki link\'s `]]` to after it', () => {
		const doc = markdownToTextDocument(`Go to [[SMART Goals]]`)
		const { before, after } = closingBracketRange(doc)
		expect(before).not.toEqual(after)
		expect(snapPositionPastTrailingLinkBrackets(doc, before)).toEqual(after)
	})

	it('snaps a caret before a custom-text wiki link\'s `]]` to after it', () => {
		const doc = markdownToTextDocument(`See [[smart-goals|SMART Goals]] here`)
		const { before, after } = closingBracketRange(doc)
		expect(snapPositionPastTrailingLinkBrackets(doc, before)).toEqual(after)
	})

	it('snaps a caret before a markdown link\'s closing brackets to after them', () => {
		const doc = markdownToTextDocument(`See [Goals](http://example.com) here`)
		const { before, after } = closingBracketRange(doc)
		expect(snapPositionPastTrailingLinkBrackets(doc, before)).toEqual(after)
	})

	it('leaves a caret already after `]]` untouched', () => {
		const doc = markdownToTextDocument(`Go to [[SMART Goals]]`)
		const { after } = closingBracketRange(doc)
		expect(snapPositionPastTrailingLinkBrackets(doc, after)).toEqual(after)
	})

	it('does not move a caret to the left of a link (before `[[`)', () => {
		const doc = markdownToTextDocument(`Go to [[SMART Goals]]`)
		const beforeOpen = 'Go to '.length
		expect(snapPositionPastTrailingLinkBrackets(doc, beforeOpen)).toEqual(beforeOpen)
	})

	it('does not move a caret inside the visible link text', () => {
		const doc = markdownToTextDocument(`Go to [[SMART Goals]]`)
		const inside = 'Go to [[SMART'.length
		expect(snapPositionPastTrailingLinkBrackets(doc, inside)).toEqual(inside)
	})

	it('does not touch a caret before a non-link hidden closing group (italics)', () => {
		const doc = markdownToTextDocument(`Some *bold* text`)
		// Caret just before the closing `*` — italics are not link_internal, so no snap.
		const beforeClosing = 'Some *bold'.length
		expect(snapPositionPastTrailingLinkBrackets(doc, beforeClosing)).toEqual(beforeClosing)
	})
})

describe('snapPositionOutOfHiddenLinkBrackets', () => {
	// Structure-driven: find every contiguous run of hidden link_internal ops (the
	// `[[` opening and `]]` / `](url)` closing brackets) so tests don't hand-count.
	function bracketRuns(doc: ReturnType<typeof markdownToTextDocument>) {
		const ops = doc.lines[0].content.ops
		const runs: { start: number, end: number, closing: boolean }[] = []
		let index = 0
		let runStart = -1
		let closing = false
		for (const op of ops) {
			const a = op.attributes ?? {}
			const isBracket = a.hidden && a.link_internal
			if (isBracket) {
				if (runStart < 0) { runStart = index; closing = false }
				if (a.end) closing = true
			}
			else if (runStart >= 0) {
				runs.push({ start: runStart, end: index, closing })
				runStart = -1
			}
			index += Op.length(op)
		}
		if (runStart >= 0) runs.push({ start: runStart, end: index, closing })
		return runs
	}

	it('snaps a caret at an opening `[[`\'s inner edge out to before the brackets', () => {
		// The reported bug: pressing Up onto a line that starts with a link lands
		// the caret just after `[[` (before the visible text); pull it out to before `[[`.
		const doc = markdownToTextDocument(`[[SMART Goals]] and more`)
		const opening = bracketRuns(doc).find(r => !r.closing)!
		expect(snapPositionOutOfHiddenLinkBrackets(doc, opening.end)).toEqual(opening.start)
	})

	it('snaps a caret inside an opening `[[` out to before the brackets', () => {
		const doc = markdownToTextDocument(`Go to [[SMART Goals]]`)
		const opening = bracketRuns(doc).find(r => !r.closing)!
		const inside = opening.start + 1
		expect(inside).toBeLessThan(opening.end)
		expect(snapPositionOutOfHiddenLinkBrackets(doc, inside)).toEqual(opening.start)
	})

	it('snaps a caret inside a wiki link\'s `]]` out to after the brackets', () => {
		const doc = markdownToTextDocument(`Go to [[SMART Goals]]`)
		const closing = bracketRuns(doc).find(r => r.closing)!
		const inside = closing.start + 1
		expect(inside).toBeLessThan(closing.end)
		expect(snapPositionOutOfHiddenLinkBrackets(doc, inside)).toEqual(closing.end)
	})

	it('snaps a caret at a closing `]]`\'s inner edge out to after the brackets', () => {
		const doc = markdownToTextDocument(`Go to [[SMART Goals]] today`)
		const closing = bracketRuns(doc).find(r => r.closing)!
		expect(snapPositionOutOfHiddenLinkBrackets(doc, closing.start)).toEqual(closing.end)
	})

	it('snaps a caret inside a markdown link\'s closing brackets out past them', () => {
		const doc = markdownToTextDocument(`See [Goals](http://example.com) here`)
		const closing = bracketRuns(doc).find(r => r.closing)!
		const inside = closing.start + 1
		expect(snapPositionOutOfHiddenLinkBrackets(doc, inside)).toEqual(closing.end)
	})

	it('leaves a caret at a bracket-run outer edge untouched', () => {
		const doc = markdownToTextDocument(`Go to [[SMART Goals]]`)
		const opening = bracketRuns(doc).find(r => !r.closing)!
		const closing = bracketRuns(doc).find(r => r.closing)!
		// Outer edge of opening = before `[[`; outer edge of closing = after `]]`.
		expect(snapPositionOutOfHiddenLinkBrackets(doc, opening.start)).toEqual(opening.start)
		expect(snapPositionOutOfHiddenLinkBrackets(doc, closing.end)).toEqual(closing.end)
	})

	it('leaves a caret in the visible link text untouched', () => {
		const doc = markdownToTextDocument(`Go to [[SMART Goals]]`)
		const inside = 'Go to [[SMART'.length
		expect(snapPositionOutOfHiddenLinkBrackets(doc, inside)).toEqual(inside)
	})

	it('does not touch a caret inside a non-link hidden group (italics)', () => {
		const doc = markdownToTextDocument(`Some *bold* text`)
		const inside = 'Some *bold'.length
		expect(snapPositionOutOfHiddenLinkBrackets(doc, inside)).toEqual(inside)
	})
})
