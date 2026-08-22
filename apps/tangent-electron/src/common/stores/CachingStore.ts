import type { Readable } from 'svelte/store'
import { ReadableStore } from './ReadableStore'
import Logger from 'js-logger'

const log = Logger.get('stores')

/**
 * Wraps a store, providing an always-available cache
 */
export class CachingStore<T> extends ReadableStore<T> {
	store: Readable<T>
	onValueChanging?: (prev: T, next: T) => void
	private unsub: () => void

	constructor(store: Readable<T>, onValueChanging?: (prev: T, next: T) => void) {
		super(null)
		this.store = store
		this.onValueChanging = onValueChanging
		this.unsub = store.subscribe(v => {
			if (v !== this._value) {
				// This callback runs inside the source store's notification pass.
				// Svelte flushes store subscribers through a module-global queue
				// that is only cleared once the flush loop completes, so an
				// exception escaping from here leaves that queue permanently
				// non-empty and every later Svelte store update in the window
				// silently stops notifying anyone. Nothing downstream is worth
				// that, so the buck stops here.
				try {
					if (this.onValueChanging) {
						this.onValueChanging(this._value, v)
					}
				}
				catch (e) {
					log.error('A cached store\'s value change handler threw.', e)
				}

				// Set regardless: the cache exists to mirror the source store, and
				// letting it drift because a handler failed is its own bug.
				this._value = v

				try {
					this.notifyObservers()
				}
				catch (e) {
					log.error('A cached store failed to notify its observers.', e)
				}
			}
		})
	}

	dispose() {
		if (this.onValueChanging) {
			this.onValueChanging(this._value, null)
		}
		this.unsub()
	}
}
