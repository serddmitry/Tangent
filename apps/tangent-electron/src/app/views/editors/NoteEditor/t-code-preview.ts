import { requestCallbackOnIdle } from '@such-n-such/core'
import mermaid from 'mermaid'

let nextIdValue = 0

/**
 * Sent (bubbling & composed) whenever a preview finishes rendering.
 * `naturalWidth` is only meaningful once this has fired.
 */
export const CODE_PREVIEW_RENDERED = 'code-preview-rendered'

class TangentCodePreview extends HTMLElement {
	private content: HTMLElement
	private isPendingUpdate = false

	/**
	 * The intrinsic width of the rendered output in pixels, or 0 when there is
	 * nothing rendered. Mermaid fits its svg to whatever width it is given, so
	 * this is what the note editor needs in order to know how much room a
	 * diagram would actually use if it were allowed into the note's margins.
	 */
	naturalWidth = 0

	constructor() {
		super()

		const shadow = this.attachShadow({ mode: 'open' })
		const content = document.createElement('div')
		content.style.textAlign = 'center'
		content.style.whiteSpace = 'normal'
		shadow.appendChild(content)

		this.content = content
	}

	static get observedAttributes() {
		return ['language', 'source']
	}

	attributeChangedCallback(name: string, oldValue: string, newValue: string) {
		if (name === 'language' || name === 'source') {
			this.debouncedUpdatePreview()
		}
	}

	connectedCallback() {
		console.log('Constructor!')
		if (this.isConnected) {
			this.content.innerHTML = '<span style="color: var(--deemphasizedTextColor);">loading…</span>'
			this.debouncedUpdatePreview()
		}
	}

	debouncedUpdatePreview() {
		if (!this.isPendingUpdate) {
			this.isPendingUpdate = true
			requestCallbackOnIdle(() => {
				this.updatePreview()
				this.isPendingUpdate = false
			}, 150)
		}
	}

	updatePreview() {
		const language = this.getAttribute('language')
		const source = this.getAttribute('source')

		if (language === 'mermaid') {
			mermaid.render('mermaid-diagram-' + nextIdValue++, source).then(result => {
				this.content.innerHTML = result.svg
				this.onContentUpdated()
			})
			.catch(error => {
				this.content.innerHTML = `<div>Invalid Mermaid Source</div>
					<div style="color: red; white-space: pre-wrap; text-align: left; font-family: var(--codeFontFamily); font-size: 80%;">${error}</div>`
				this.onContentUpdated()
			})
		}
		else {
			this.content.innerHTML = ''
			this.onContentUpdated()
		}
	}

	private onContentUpdated() {
		this.naturalWidth = this.measureNaturalWidth()
		this.dispatchEvent(new CustomEvent(CODE_PREVIEW_RENDERED, {
			bubbles: true,
			// The preview lives in a shadow root; without this the note editor
			// never sees the event.
			composed: true
		}))
	}

	private measureNaturalWidth() {
		const svg = this.content.querySelector('svg')
		if (!svg) return 0

		// With mermaid's default `useMaxWidth`, the svg is given `width: 100%`
		// and a `max-width` holding the size the diagram actually wants.
		const maxWidth = parseFloat(svg.style.maxWidth)
		if (maxWidth > 0) return maxWidth

		// Otherwise the diagram is fixed-size and the viewBox carries the truth.
		const viewBoxWidth = svg.viewBox?.baseVal?.width
		if (viewBoxWidth > 0) return viewBoxWidth

		const attributeWidth = parseFloat(svg.getAttribute('width'))
		return attributeWidth > 0 ? attributeWidth : 0
	}
}

customElements.define('t-code-preview', TangentCodePreview)
export default TangentCodePreview