import { describe, it, expect, vi } from 'vitest'
import File from './File'
import { FileSaveResult } from 'common/FileSaveResult'
import type Workspace from './Workspace'
import type { TreeNode } from 'common/trees'

// A minimal concrete File so we can exercise the base save/retry logic without
// pulling in markdown parsing or a real workspace.
class TestFile extends File {
	content = 'hello world'
	getFileContent() { return this.content }
	onFileContentChanged() {}
	onUnloaded() {}
}

type ApiMocks = {
	updateFile?: (path: string, content: string) => Promise<FileSaveResult>
	updateFileSync?: (path: string, content: string) => FileSaveResult
}

function makeFile(api: ApiMocks) {
	const workspace = {
		api: {
			file: {
				closeFile: vi.fn(),
				openFile: vi.fn(),
				...api
			}
		}
	} as unknown as Workspace

	const node = { path: '/ws/note.md', name: 'note', fileType: 'md', depth: 2 } as TreeNode
	const file = new TestFile(node, workspace)
	file.loadState = 'loaded' // makes isReady true
	file.isDirty = true
	return file
}

// Flush a handful of microtask turns so queued `.then` callbacks run.
async function flushMicrotasks() {
	for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('File save durability', () => {

	describe('saveFile (async, acknowledged)', () => {
		it('clears dirty and stays clean when the write succeeds', async () => {
			const updateFile = vi.fn().mockResolvedValue(FileSaveResult.Success)
			const file = makeFile({ updateFile })

			file.saveFile()

			expect(updateFile).toHaveBeenCalledWith('/ws/note.md', 'hello world')
			expect(file.isDirty).toBe(false)

			await flushMicrotasks()
			expect(file.isDirty).toBe(false)
		})

		it('re-dirties and retries when the write is rejected', async () => {
			vi.useFakeTimers()
			try {
				const updateFile = vi.fn()
					.mockResolvedValueOnce(FileSaveResult.Failed)
					.mockResolvedValueOnce(FileSaveResult.Success)
				const file = makeFile({ updateFile })

				file.saveFile()
				// Optimistically cleared, then the rejection flips it back.
				await flushMicrotasks()
				expect(file.isDirty).toBe(true)
				expect(updateFile).toHaveBeenCalledTimes(1)

				// The scheduled retry (3s) fires and this time succeeds.
				await vi.advanceTimersByTimeAsync(3100)
				await flushMicrotasks()
				expect(updateFile).toHaveBeenCalledTimes(2)
				expect(file.isDirty).toBe(false)
			}
			finally {
				vi.useRealTimers()
			}
		})

		it('does not stack multiple retry timers', async () => {
			vi.useFakeTimers()
			try {
				const updateFile = vi.fn().mockResolvedValue(FileSaveResult.Failed)
				const file = makeFile({ updateFile })

				// Two failed saves in a row should schedule only one retry.
				file.saveFile()
				await flushMicrotasks()
				file.isDirty = true
				file.saveFile()
				await flushMicrotasks()

				const callsBeforeRetry = updateFile.mock.calls.length
				await vi.advanceTimersByTimeAsync(3100)
				await flushMicrotasks()

				// Exactly one additional attempt from the single retry timer.
				expect(updateFile.mock.calls.length).toBe(callsBeforeRetry + 1)
			}
			finally {
				vi.useRealTimers()
			}
		})
	})

	describe('saveFileSync (blocking, exit path)', () => {
		it('clears dirty when the sync write succeeds', () => {
			const updateFileSync = vi.fn().mockReturnValue(FileSaveResult.Success)
			const file = makeFile({ updateFileSync })

			file.saveFileSync()

			expect(updateFileSync).toHaveBeenCalledWith('/ws/note.md', 'hello world')
			expect(file.isDirty).toBe(false)
		})

		it('keeps dirty when the sync write fails, so nothing is silently lost', () => {
			const updateFileSync = vi.fn().mockReturnValue(FileSaveResult.Failed)
			const file = makeFile({ updateFileSync })

			file.saveFileSync()

			expect(file.isDirty).toBe(true)
		})

		it('does nothing when the file is not dirty', () => {
			const updateFileSync = vi.fn().mockReturnValue(FileSaveResult.Success)
			const file = makeFile({ updateFileSync })
			file.isDirty = false

			file.saveFileSync()

			expect(updateFileSync).not.toHaveBeenCalled()
		})
	})
})
