import { checkboxMatcher, matchList } from 'common/markdownModel/list';
import { getIndexFromNode, type Editor, type Line } from 'typewriter-editor';
import TangentCheckbox from './NoteEditor/t-checkbox';
import { tick } from 'svelte';
import { type ContextMenuConstructorOptions, appendContextTemplate } from 'app/model/menus'
import type { TodoState } from 'common/indexing/indexTypes'
import type { ReadableStore } from 'common/stores';

/**
 * A checkbox state to apply, or a toggle between that state and `open`.
 */
export type CheckboxTarget = TodoState | 'toggle' | 'toggleCanceled'

export default function tCheckboxModule(editor: Editor, config: {
	defaultTodoCompleteChar: string | ReadableStore<String> 
}){
	function onClick(event: MouseEvent) {
		if (event.defaultPrevented) return

		const checkbox = TangentCheckbox.getTangentCheckboxFromEvent(event)
		if (!checkbox) return

		const doc = editor.doc

		// Find the logical line by way of the line elements index
		const index = getIndexFromNode(editor, checkbox)
		const line = doc.getLineAt(index)
		setCheckboxOnLine(line)
	}

	function onContext(event: MouseEvent) {
		if (event.defaultPrevented) return

		const checkbox = TangentCheckbox.getTangentCheckboxFromEvent(event)
		if (!checkbox) return

		const doc = editor.doc

		// Find the logical line by way of the line elements index
		const index = getIndexFromNode(editor, checkbox)
		const line = doc.getLineAt(index)
		
		let menu: ContextMenuConstructorOptions[] = []

		let state = checkbox.getAttribute('state') as TodoState
		menu.push({
			type: 'radio',
			label: '☑︎ Complete',
			checked: state == 'checked',
			click() {
				setCheckboxOnLine(line, 'checked')
			}
		}, {
			type: 'radio',
			label: '☐ Open',
			checked: state == 'open',
			click() {
				setCheckboxOnLine(line, 'open')
			}
		}, {
			type: 'radio',
			label: '☒ Canceled',
			checked: state == 'canceled',
			click() {
				setCheckboxOnLine(line, 'canceled')
			}
		})

		appendContextTemplate(event, menu)
	}

	function getCheckboxText(targetState: CheckboxTarget, currentContents: string) {
		const completeChar = typeof config.defaultTodoCompleteChar === 'string' ?
									config.defaultTodoCompleteChar :
									config.defaultTodoCompleteChar.value

		switch (targetState) {
			case 'toggle':
				// Anything but an open checkbox toggles back to open
				return currentContents.trim() ? '[ ]' : `[${completeChar}]`
			case 'toggleCanceled':
				return currentContents.trim() === '-' ? '[ ]' : '[-]'
			case 'open':
				return '[ ]'
			case 'checked':
				return `[${completeChar}]`
			case 'canceled':
				return '[-]'
		}
	}

	function setCheckboxOnLine(line: Line, targetState: CheckboxTarget = 'toggle') {
		setCheckboxOnLines([line], targetState)
	}

	/**
	 * Sets the checkbox state of every todo line in `lines` with a single change.
	 * Lines must be in document order; lines without a checkbox are ignored.
	 */
	function setCheckboxOnLines(lines: Line[], targetState: CheckboxTarget = 'toggle') {
		const doc = editor.doc

		const originalSelection = doc.selection
		const change = editor.change
		let changedAnything = false

		for (const line of lines) {
			const lineRange = doc.getLineRange(line)
			const lineText = doc.getText(lineRange)

			const listData = matchList(lineText)
			if (!listData) continue

			if (listData.todoState == undefined) continue

			const checkMatch = listData.glyph.match(checkboxMatcher)
			if (!checkMatch) continue

			const editStart = lineRange[0] + listData.indent.length + checkMatch.index
			const editEnd = editStart + checkMatch[0].length

			change.delete([editStart, editEnd])
			change.insert(editStart, getCheckboxText(targetState, checkMatch[1]))
			changedAnything = true
		}

		if (!changedAnything) return

		// Manipulating the selection like this causes the page to jump to selection...
		if (originalSelection) {
			change.select(originalSelection)
		}

		// We don't want that, so we cache the current scroll loop...
		let scrolls = new Map<HTMLElement, number>()
		let walker = editor.root
		while (walker) {
			scrolls.set(walker, walker.scrollTop)
			walker = walker.parentElement
		}

		change.apply()

		// ...and then apply it on the next microtick.
		tick().then(() => {
			if (originalSelection) {
				if (document.activeElement !== editor.root) {
					editor.root.focus()
				}
			}
			for (let [element, scroll] of scrolls) {
				element.scrollTop = scroll
			}
		})
	}

	return {
		init() {
			editor.on('click', onClick)
			editor.root.addEventListener('contextmenu', onContext)
		},
		destroy() {
			editor.off('click', onClick)
			editor.root.removeEventListener('contextmenu', onContext)
		},
		setCheckboxOnLine,
		setCheckboxOnLines
	}
}

export type TCheckboxModule = ReturnType<typeof tCheckboxModule>
