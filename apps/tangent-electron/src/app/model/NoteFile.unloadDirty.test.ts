import { describe, it, expect, vi } from 'vitest'
import NoteFile from './NoteFile'
import type Workspace from './Workspace'
import type { TreeNode } from 'common/trees'

// Regression for the "note shows empty" bug: unloading a note used to route
// through the `lines` setter, spuriously marking it dirty. Since the
// onReceiveFileContents dirty-guard (deb1c54), a dirty file refuses incoming
// disk contents on reopen, so an untouched-but-unloaded note stayed blank.
function makeWorkspace() {
	return {
		api: { file: { closeFile: vi.fn(), openFile: vi.fn(), updateFile: vi.fn() } },
		settings: {
			rawLinksAutoEmbed: { value: false },
			allowInterTextUnderscoreFormatting: { value: false },
			allowUnknownHTMLTags: { value: false },
		},
	} as unknown as Workspace
}

function makeNote() {
	const node = { path: '/ws/note.md', name: 'note', fileType: 'md', depth: 2 } as TreeNode
	return new NoteFile(node, makeWorkspace())
}

describe('NoteFile unload', () => {
	it('does not mark an untouched note dirty when it is unloaded', () => {
		const file = makeNote()
		file.loadFile()
		file.setFileContent('Hello\nworld\n')
		expect(file.isDirty).toBe(false)

		file.dropFile() // loadCount -> 0 -> unloadFile -> onUnloaded

		expect(file.isDirty).toBe(false)
	})

	it('reloads content from disk after an unload/reopen cycle', () => {
		const file = makeNote()
		file.loadFile()
		file.setFileContent('Hello\nworld\n')

		file.dropFile()          // fully unload
		file.loadFile()          // reopen -> loading

		// Simulate the main process delivering the on-disk copy. This is what
		// Workspace.onReceiveFileContents forwards; it must not be blocked by a
		// stale dirty flag.
		expect(file.isDirty).toBe(false)
		file.setFileContent('Hello\nworld\n')
		expect(file.length).toBeGreaterThan(0)
	})
})
