import paths from 'common/paths'
import type { TreeNode } from 'common/trees'
import { FileSaveResult } from 'common/FileSaveResult'
import type Workspace from './Workspace'
import WorkspaceTreeNode from './WorkspaceTreeNode'

export type FileLoadState = 'unloaded' | 'loading' | 'loaded' | 'new'

// How long to wait before retrying a save that the main process rejected
// (e.g. because the workspace was momentarily torn down).
const SAVE_RETRY_DELAY = 3000

export default abstract class File extends WorkspaceTreeNode {
	loadCount: number
	loadState: FileLoadState
	isDirty: boolean

	constructor(node: TreeNode, workspace: Workspace) {
		super(node, workspace)

		this.loadCount = 0
		this.loadState = 'unloaded'
		this.isDirty = false
	}

	rename(newName: string) {
		const superResult = super.rename(newName)

		if (this.loadState === 'new') {
			this.loadState = 'loaded'
		}

		return superResult
	}

	loadFile() {
		this.loadCount++
		if (!this.isLoaded) {
			this.api.openFile(this.path)
			if (this.loadState !== 'new' && this.loadState !== 'loaded') {
				this.loadState = 'loading'
			}
		}
	}

	setFileContent(content: string | unknown) {
		if (this.loadState === 'loading') {
			this.loadState = 'loaded'
		}
		this.realizeFile()
		this.onFileContentChanged(content)
	}

	/**
	 * Ensures that the file and all of its parents are marked as non-virtual
	 */
	realizeFile() {
		if (this.meta?.virtual) {
			this.meta.virtual = false
			this.workspace.ensureFolderExists(paths.dirname(this.path))
			this.notifyChanged()
		}
	}

	dropFile() {
		this.loadCount--
		if (this.loadCount < 0) {
			console.error('File load count dropped below 0', this)
		}
		if (this.loadCount <= 0) {
			this.unloadFile()
		}
	}

	unloadFile() {
		if (this.isLoaded) {
			if (this.isDirty) {
				this.saveFile();
			}
			this.onUnloaded()
			this.loadState = 'unloaded'

			if (this.saveRetryTimeout != null) {
				clearTimeout(this.saveRetryTimeout)
				this.saveRetryTimeout = null
			}

			this.api.closeFile(this.path)
		}
	}

	private saveRetryTimeout: ReturnType<typeof setTimeout> = null

	saveFile() {
		if (this.isDirty && this.isReady) {
			const content = this.getFileContent()
			if (typeof content !== 'string') {
				return
			}

			// Clear dirty optimistically; a rejected write re-arms it (below) so
			// the edit is retried rather than silently dropped.
			this.isDirty = false
			if (this.loadState === 'new') {
				this.loadState = 'loaded'
			}

			// TODO: An attempt to find why/when this is happening
			if (!content) {
				console.error('Almost wrote empty file', this)
			}
			else {
				console.log('saving', this.name)
				Promise.resolve(this.api.updateFile(this.path, content))
					.then(result => {
						if (result === FileSaveResult.Failed) {
							this.onSaveRejected()
						}
					})
					.catch(err => {
						console.error('Save failed for', this.path, err)
						this.onSaveRejected()
					})
			}

			this.notifyChanged()
		}
	}

	/**
	 * A save the main process refused (e.g. the workspace was torn down under a
	 * closing window). Mark the file dirty again and schedule a retry so the
	 * content isn't lost. A newer edit may already have re-dirtied the file and
	 * queued its own save; the retry timer is guarded so we don't stack them.
	 */
	private onSaveRejected() {
		if (!this.isDirty) {
			this.isDirty = true
			this.notifyChanged()
		}
		if (this.saveRetryTimeout != null) return
		this.saveRetryTimeout = setTimeout(() => {
			this.saveRetryTimeout = null
			if (this.isDirty && this.isReady) {
				this.saveFile()
			}
		}, SAVE_RETRY_DELAY)
	}

	/**
	 * Blocking save for the exit path (see `Workspace.shutdown`). Unlike
	 * `saveFile`, this waits for the write to land on disk before returning, so
	 * unsaved edits survive Cmd+Q / window close. Only clears the dirty flag if
	 * the write actually succeeded.
	 */
	saveFileSync() {
		if (this.isDirty && this.isReady) {
			const content = this.getFileContent()
			if (typeof content !== 'string' || !content) {
				return
			}
			const result = this.api.updateFileSync(this.path, content)
			if (result !== FileSaveResult.Failed) {
				this.isDirty = false
				if (this.loadState === 'new') {
					this.loadState = 'loaded'
				}
				this.notifyChanged()
			}
		}
	}

	abstract getFileContent(): string | unknown
	abstract onFileContentChanged(content: string | unknown)
	abstract onUnloaded()

	get isLoaded() {
		return this.loadState != 'unloaded'
	}

	get isReady() {
		return this.loadState === 'loaded' || this.loadState === 'new'
	}
}
