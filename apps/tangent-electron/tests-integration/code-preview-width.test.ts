import fs from 'fs'
import path from 'path'

import type { Workspace } from 'app/model'
import { FocusLevel } from 'common/dataTypes/TangentInfo'
import { test, expect, wait } from './tangent'
import type TangentWindow from './TangentWindow'
import type TangentApp from './TangentApp'

// A long left-to-right chain, so the diagram's natural width is driven by the
// number of nodes rather than by label wrapping. This has to come out wider
// than the whole window, so that every pane width under test is a real
// constraint the diagram is pushing against.
const DIAGRAM = `\`\`\`mermaid
flowchart LR
${['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth']
	.map((name, i) => `\tn${i}(The ${name} step in a deliberately long chain)`)
	.join('\n')}
${[0, 1, 2, 3, 4, 5, 6].map(i => `\tn${i} --> n${i + 1}`).join('\n')}
\`\`\``

// Likewise long enough to overflow the column and trigger the code block path.
const LONG_CODE_LINE = 'const x = "' + 'y'.repeat(300) + '"'

const NOTE = `${DIAGRAM}

\`\`\`js
${LONG_CODE_LINE}
\`\`\`
`

// The narrowest supported column. Keeps the diagram reliably wider than the
// text column while leaving plenty of margin for it to expand into.
const NARROW_COLUMN = 450

type Metrics = {
	naturalWidth: number
	previewWidth: number
	svgWidth: number
	codeBlockWidth: number
	contentWidth: number
	containerWidth: number
}

function measure(window: TangentWindow): Promise<Metrics> {
	return window.page.evaluate(() => {
		const editor = document.querySelector('.current .noteEditor') as HTMLElement
		const article = editor?.querySelector('article') as HTMLElement
		const preview = editor?.querySelector('t-code-preview') as HTMLElement & { naturalWidth: number }
		// A plain code block is a bare `pre`; the diagram's source `pre` is
		// wrapped in the output `figure`, so this only matches the former.
		const codeBlock = editor?.querySelector('article > pre') as HTMLElement

		const articleStyle = getComputedStyle(article)

		return {
			naturalWidth: preview?.naturalWidth ?? 0,
			previewWidth: preview?.getBoundingClientRect().width ?? 0,
			svgWidth: preview?.shadowRoot?.querySelector('svg')?.getBoundingClientRect().width ?? 0,
			codeBlockWidth: codeBlock?.getBoundingClientRect().width ?? 0,
			contentWidth: article.clientWidth
				- parseFloat(articleStyle.paddingLeft)
				- parseFloat(articleStyle.paddingRight),
			containerWidth: editor.getBoundingClientRect().width
		}
	})
}

function setExpansion(window: TangentWindow, code: boolean, preview: boolean) {
	return window.page.evaluate(({ code, preview }) => {
		const workspace = (document as any).workspace as Workspace
		workspace.settings.letCodeExpand.set(code)
		workspace.settings.letCodePreviewExpand.set(preview)
	}, { code, preview })
}

async function openNoteWithDiagram(tangent: TangentApp, workspace: string) {
	await fs.promises.writeFile(path.join(workspace, 'Diagram.md'), NOTE, 'utf8')

	const window = await tangent.firstWindow()
	await window.page.waitForFunction(() => {
		const workspace = (document as any).workspace as Workspace
		return workspace.directoryStore.getWithPortablePath('FILES/Diagram.md')
	})

	await window.setSize({ width: 1400, height: 900 })
	await window.page.evaluate(([width]) => {
		const workspace = (document as any).workspace as Workspace
		workspace.settings.noteWidthMax.set(width)
	}, [NARROW_COLUMN])

	await window.setThread({ paths: ['Diagram.md'], current: 'Diagram.md' })

	// Diagrams render asynchronously, so the size isn't known up front
	await expect.poll(
		async () => (await measure(window)).naturalWidth,
		{ message: 'diagram never reported a natural width' }
	).toBeGreaterThan(0)

	// Let the post-render sizing pass settle
	await wait(300)

	return window as TangentWindow
}

test('wide diagrams expand into the note margins', async ({ tangent, workspace }) => {
	const window = await openNoteWithDiagram(tangent, workspace)

	await setExpansion(window, true, true)
	await wait(300)
	const expanded = await measure(window)

	// Precondition: the diagram genuinely wants more room than the column,
	// and the pane is wide enough to give it some
	expect(expanded.naturalWidth).toBeGreaterThan(expanded.contentWidth)
	expect(expanded.containerWidth).toBeGreaterThan(expanded.contentWidth)

	// It reached out past the text column...
	expect(expanded.previewWidth).toBeGreaterThan(expanded.contentWidth)
	// ...without escaping the pane...
	expect(expanded.previewWidth).toBeLessThanOrEqual(expanded.containerWidth)
	// ...and the rendered diagram actually got bigger, which is the point
	expect(expanded.svgWidth).toBeGreaterThan(expanded.contentWidth)

	// Turning the setting off puts it back in the column
	await setExpansion(window, true, false)
	await wait(300)
	const collapsed = await measure(window)

	expect(collapsed.previewWidth).toBeLessThan(expanded.previewWidth)
	expect(Math.abs(collapsed.previewWidth - collapsed.contentWidth)).toBeLessThan(2)
})

test('diagram and code expansion are independently controlled', async ({ tangent, workspace }) => {
	const window = await openNoteWithDiagram(tangent, workspace)

	// Each element is compared against its own expanded width rather than the
	// text column: a resting `pre` already sits 1em wider than the column, to
	// counteract the padding that keeps its text aligned.
	await setExpansion(window, false, false)
	await wait(300)
	const neither = await measure(window)

	await setExpansion(window, true, true)
	await wait(300)
	const both = await measure(window)

	// Precondition: both expand, so a failure to collapse is meaningful
	expect(both.previewWidth).toBeGreaterThan(neither.previewWidth)
	expect(both.codeBlockWidth).toBeGreaterThan(neither.codeBlockWidth)

	// Turning off diagrams leaves wide code alone
	await setExpansion(window, true, false)
	await wait(300)
	const codeOnly = await measure(window)

	expect(codeOnly.previewWidth).toBeCloseTo(neither.previewWidth, 0)
	expect(codeOnly.codeBlockWidth).toBeCloseTo(both.codeBlockWidth, 0)

	// And turning off wide code leaves diagrams alone
	await setExpansion(window, false, true)
	await wait(300)
	const previewOnly = await measure(window)

	expect(previewOnly.previewWidth).toBeCloseTo(both.previewWidth, 0)
	expect(previewOnly.codeBlockWidth).toBeCloseTo(neither.codeBlockWidth, 0)
})

test('file focus mode gives a wide diagram room the text column never gets', async ({ tangent, workspace }) => {
	const window = await openNoteWithDiagram(tangent, workspace)

	await setExpansion(window, true, true)
	await wait(300)
	const threaded = await measure(window)

	await window.setFocusLevel(FocusLevel.File)
	await wait(500)
	const focused = await measure(window)

	// Precondition: the diagram is bigger than the unfocused pane, so focus
	// mode genuinely has something to give it
	expect(threaded.naturalWidth).toBeGreaterThan(threaded.containerWidth)

	// The pane grows to fill the window...
	expect(focused.containerWidth).toBeGreaterThan(threaded.containerWidth)
	// ...but the text column does not; that stays capped by Max Note Width.
	// This is why focus mode on its own does nothing for a wide diagram.
	expect(focused.contentWidth).toBeCloseTo(threaded.contentWidth, 0)

	// The diagram is what claims the extra room, and never overruns the pane
	expect(focused.previewWidth).toBeGreaterThan(threaded.previewWidth)
	expect(focused.previewWidth).toBeLessThanOrEqual(focused.containerWidth)
	expect(focused.previewWidth).toBeLessThanOrEqual(focused.naturalWidth)

	// With expansion off, focus mode alone leaves the diagram in the column
	await setExpansion(window, true, false)
	await wait(300)
	const unexpanded = await measure(window)

	expect(unexpanded.containerWidth).toBeCloseTo(focused.containerWidth, 0)
	expect(Math.abs(unexpanded.previewWidth - unexpanded.contentWidth)).toBeLessThan(2)
})
