import { requestCallbackOnIdle } from '@such-n-such/core'
import type { Workspace } from 'app/model'
import { type HrefForm, type HrefFormedLink, StructureType } from 'common/indexing/indexTypes'
import { isExternalLink } from 'common/links'
import { type HandleResult, isNode } from 'app/model/NodeHandle'
import { dropTooltip, requestTooltip, type TooltipConfig } from 'app/utils/tooltips'
import type { SvelteConstructor } from 'app/utils/svelte'
import type { TreeNode } from 'common/trees'

export type LinkState = 'uninitialized' | 'empty' | 'resolved' | 'ambiguous' | 'untracked' | 'external' | 'error'

let tooltipComponent: SvelteConstructor = null
export function setTLinkTooltipComponent(component: SvelteConstructor) {
	tooltipComponent = component
}

// Tracks which paths are currently open in the thread (the sliding panels),
// shared across every <t-link> instance via a single subscription rather than
// one per element. A per-element subscription would only get (re)established
// the next time that specific element's idle-throttled updateState() runs,
// which means an element that gets torn down and recreated by the editor
// mid-navigation (e.g. while the very thread change it should react to is
// happening) can miss that change and end up stuck. Reading from this shared,
// always-current set sidesteps that race entirely: a freshly (re)connected
// element just reads whatever is already true right now.
const openLinks = new Set<TangentLink>()
let openNodes = new Set<TreeNode>()
let threadWatcherUnsub: () => void = null

function ensureThreadWatcher(workspace: Workspace) {
	if (threadWatcherUnsub) return
	threadWatcherUnsub = workspace.viewState.tangent.thread.subscribe(thread => {
		// Tree nodes retain their identity when they are renamed. Keeping the nodes
		// themselves here means an in-place path update cannot make this snapshot
		// stale before the thread store next emits.
		openNodes = new Set(thread ?? [])
		for (const link of openLinks) {
			link.applyOpenState()
		}
	})
}

export class TangentLink extends HTMLElement {

	protected linkState: LinkState
	// Whether this link's target is currently open in the thread. Tracked as a
	// field (not just read off the DOM) because the editor's virtual DOM will
	// happily strip our runtime-added `data-open` attribute when it re-renders
	// the element; this is the source of truth we re-assert it from.
	protected openState = false
	handleUnsub: () => void
	resolvedNode: TreeNode = null

	constructor() {
		super()
		this.addEventListener('click', this.onClick)
		this.addEventListener('auxclick', this.onClick)
		this.addEventListener('dblclick', this.onClick)
		this.addEventListener('mousedown', this.onClick)
		this.addEventListener('mouseup', this.onClick)
		this.addEventListener('contextmenu', this.onClick)
		this.addEventListener('mouseenter', this.makeTooltipRequest)
		this.addEventListener('mousemove', this.makeTooltipRequest)
		this.addEventListener('mouseleave', this.onMouseLeave)
	}

	connectedCallback() {
		if (this.isConnected) {
			openLinks.add(this)

			const doc = document as any
			const workspace = doc.workspace as Workspace
			if (workspace) {
				ensureThreadWatcher(workspace)
			}
			// Apply whatever the shared open-paths set already knows immediately,
			// rather than waiting on the idle-throttled updateState() below.
			this.applyOpenState()

			requestCallbackOnIdle(() => this.updateState(), 1000)
		}
	}

	disconnectedCallback() {
		openLinks.delete(this)
		this.dropNodeHandle()
		dropTooltip(this, false)
	}

	static get observedAttributes() {
		return ['link-state', 'data-open', 'href', 'content_id', 'form', 'from']
	}

	attributeChangedCallback(name: string, oldValue: string, newValue: string) {
		switch (name) {
			case 'link-state':
				// This is a hack to ensure that the link state values *alwasy* remain, even if
				// a silly virtual dom thinks it's better than us and wants to override the
				// attributes
				if (newValue !== this.linkState) {
					this.setAttribute(name, this.linkState)
				}
				break
			case 'data-open':
				// Same story as link-state: the editor's virtual DOM strips this
				// runtime-added attribute when it re-renders the element (e.g. when
				// the cursor moves into the link and reveals its raw markdown).
				// Re-assert it from our tracked openState so the highlight survives.
				if ((newValue !== null) !== this.openState) {
					this.toggleAttribute('data-open', this.openState)
				}
				break
			case 'href':
			case 'content_id':
				requestCallbackOnIdle(() => this.updateState(), 1000)
				break
		}
	}

	updateState() {
		if (!this.isConnected) return

		let link = this.getLinkInfo()
		if (link) {
			if (isExternalLink(link.href)) {
				this.setLinkState('external', null)
				this.dropNodeHandle()
			}
			else {
				const doc = document as any
				const workspace = doc.workspace as Workspace
				if (workspace) {
					this.dropNodeHandle()
					this.handleUnsub = workspace
						.getHandle(link)
						.subscribe(v => this.onNodeHandleChanged(v))
				}
			}
		}
		else {
			this.setLinkState('resolved', null)
		}
	}
	
	private onNodeHandleChanged(value: HandleResult) {
		let newState: LinkState = 'empty'
		let resolvedNode: TreeNode = null

		if (typeof value === 'string') {
			newState = 'untracked'
		}
		else if (Array.isArray(value)) {
			if (value.length > 1) {
				newState = 'ambiguous'
			}
		}
		else if (value) {
			if (!isNode(value)) {
				newState = 'external'
			}
			else if (!value.meta?.virtual) {
				let contentId = this.getAttribute('content_id')
				if (contentId) {
					// TODO
				}
				newState = 'resolved'
				resolvedNode = value
			}
		}

		this.resolvedNode = resolvedNode
		this.setLinkState(newState, value)
		this.applyOpenState()
	}

	private dropNodeHandle() {
		if (this.handleUnsub) {
			this.handleUnsub()
			this.handleUnsub = null
		}
	}

	// Highlights the link when its target is already open somewhere in the
	// current thread (i.e. the sliding panels), mirroring Andy Matuschak's notes.
	applyOpenState() {
		this.openState = !!(this.resolvedNode && openNodes.has(this.resolvedNode))
		this.toggleAttribute('data-open', this.openState)
	}

	getLinkState() {
		return this.linkState
	}

	setLinkState(value: LinkState, context: HandleResult) {
		this.linkState = value
		this.setAttribute('link-state', value)
	}

	onClick(event) {
		event.tLink = this
	}

	getTooltip(): TooltipConfig {
		return {
			tooltip: tooltipComponent ?? 'Use `setTLinkTooltipComponent()` to define the component',
			maxWidth: '500px',
			interactive: true,
			args: {
				origin: this,
				link: this.getLinkInfo(),
				state: this.linkState
			}
		}
	}

	makeTooltipRequest(event: MouseEvent) {
		if (this.linkState === 'uninitialized') return
		requestTooltip(this, this.getTooltip(), event)
	}

	onMouseLeave() {
		dropTooltip(this)
	}

	getCleanedHref() {
		let href = this.getAttribute('href')
		if (this.linkState === 'external') return href
		return decodeURIComponent(href)
	}

	getLinkInfo(): HrefFormedLink {
		return {
			type: StructureType.Link,
			href: this.getCleanedHref(),
			form: this.getAttribute('form') as HrefForm,
			from: this.getAttribute('from'),
			content_id: this.getAttribute('content_id'),
			text: this.getAttribute('text')
		}
	}

	static isTangentLinkEvent(event: Event) {
		return this.getTangentLinkFromEvent(event) !== undefined
	}

	static isNavigationLinkOverride(event: Event) {
		return (event as any).tNavigationOverride === true
	}

	static getTangentLinkFromEvent(event: Event) {
		return (event as any).tLink as TangentLink
	}
}

customElements.define('t-link', TangentLink)
