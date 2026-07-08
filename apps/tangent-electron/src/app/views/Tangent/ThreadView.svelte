<script lang="ts">
import { createEventDispatcher, getContext, tick } from 'svelte'
import { fly } from 'svelte/transition'
import { flip } from 'svelte/animate'
import { scrollTo } from 'app/utils'

import type Tangent from "app/model/Tangent"
import type Workspace from 'app/model/Workspace'
import command from 'app/model/commands/CommandAction'
import { resizeObserver } from 'app/utils/resizeObserver'

import { FocusLevel } from 'common/dataTypes/TangentInfo'
import { derived } from 'svelte/store'
import type { NavigationCallback, NavigationData } from 'app/events'
import NodeViewSelector from '../node-views/NodeViewSelector.svelte'
import ThreadViewVerticalTitleBar from './ThreadViewVerticalTitleBar.svelte'
import type { NodeViewState } from 'app/model/nodeViewStates'
import SvgIcon from '../smart-icons/SVGIcon.svelte'
import { wait } from '@such-n-such/core'

// TODO: These should be based on settings values
const collapsedWidth = 32

const workspace = getContext('workspace') as Workspace

const {
	createNewFile,
	goTo,
	setMapFocusLevel
} = workspace.commands

const {
	panelWidthMin,
	dirtyIndicatorVisibility
} = workspace.settings

export let tangent: Tangent

export let onNavigate: NavigationCallback = null

$: focusLevel = tangent.focusLevel
$: currentNode = tangent.currentNode
$: currentState = tangent.currentThreadState

let lastFocusLevel = $focusLevel
let isFirstView = true

// Latch scroll requests to avoid duplicate requests
let scrollToCurrentDelay = null
function requestScrollToCurrent() {
	if (!scrollToCurrentDelay) {
		scrollToCurrentDelay = wait().then(() => {
			scrollToCurrent($currentState)
			scrollToCurrentDelay = null
		})
	}
}

const states = derived([tangent.focusLevel, tangent.threadLenses, tangent.currentThreadState], ([fl, lenses, currentState]) => {
	let result: NodeViewState[]
	if (fl <= FocusLevel.Thread) {
		result = lenses.map(l => l.parent)
	}
	else {
		result = currentState ? [currentState] : []
	}
	if (lastFocusLevel !== fl) {
		// This is necessary because sizes can shift over the course of the transition in/out of focus
		// TODO: This causes rightmost notes to restore from focus strangely
		setTimeout(() => scrollToCurrent(currentState), 310)
		lastFocusLevel = fl
	}
	else {
		// Delay so that the new nodes list is available
		// Goes through latch to avoid duplicate requests
		requestScrollToCurrent()
	}
	return result
})

const supportDirty = derived([tangent.focusLevel, states, dirtyIndicatorVisibility], ([fl, states, di]) => {
	if (di === 'focus') return true
	if (di === 'single-file') return fl === FocusLevel.Thread
	if (di === 'thread') return states.length > 1
	return false
})

$: currentStateIndex = $states.indexOf($currentState)
$: if ($states) {
	// Pane count/order changed; wait for the DOM to reflect it before re-measuring
	tick().then(updateCoverage)
}

// Only slide a new pane in from the right when it's genuinely *appended* to the
// end of the thread (i.e. you followed a link from the last pane). When a link is
// followed from an earlier pane, the panes after it are replaced in place — a
// slide-in there just reads as jank, so it should appear without animating.
let prevStates: NodeViewState[] = null
let animateIn = false
let clipDuringFly = false
$: {
	const cur = $states
	const isAppend = prevStates !== null
		&& cur.length > prevStates.length
		&& prevStates.every((s, i) => cur[i] === s)
	animateIn = isAppend
	// A slide-in briefly translates the new pane past the container's right edge.
	// If the thread doesn't already overflow, that transient overflow would flash a
	// horizontal scrollbar and bounce every pane's height. Clip the overflow for the
	// duration of the slide in that case. If it already overflows, the scrollbar is
	// present and stable, so leave it alone (clipping would just make it blink).
	if (isAppend && container) {
		clipDuringFly = container.scrollWidth <= container.clientWidth + 1
	}
	prevStates = cur
}

let container: HTMLElement
let scrollStopper: () => void = null

let containerBasedMin = 10000
$: trueMinWidth = Math.min(containerBasedMin, $panelWidthMin)
function onContainerResized(entries: ResizeObserverEntry[]) {
	const entry = entries[0]
	if (entry) {
		containerBasedMin = Math.max(
			entry.contentBoxSize[0].inlineSize - collapsedWidth * ($states.length - 1),
			260 // A fallback "true minimum"
		)
	}
	updateCoverage()
}

// A pane is "covered" when a later pane is sticking over part of it, in which
// case it can only show its collapsed vertical spine, not its full title.
// This is purely a function of live layout (panes never shrink; later
// siblings just paint over earlier ones), so it has to be measured rather
// than derived from state count alone.
let coveredIndices = new Set<number>()
function updateCoverage() {
	if (!container) return

	const children = Array.from(container.children).filter(
		c => c instanceof HTMLElement && c.classList.contains('nodeContainer')
	) as HTMLElement[]

	const next = new Set<number>()
	for (let i = 0; i < children.length - 1; i++) {
		const rect = children[i].getBoundingClientRect()
		const nextRect = children[i + 1].getBoundingClientRect()
		// Small tolerance for subpixel rounding so perfectly-adjacent panes
		// don't flicker into "covered"
		if (nextRect.left < rect.right - 1) {
			next.add(i)
		}
	}

	coveredIndices = next
}


$: scrollToCurrent(null, container, trueMinWidth) // Only want to trigger this outside of the $lenses derived store when the container changes
function scrollToCurrent(state: NodeViewState, _c?, minWidth = trueMinWidth) {
	state = state || $currentState
	if (!state || !container || !$states) return

	const lensIndex = $states.indexOf(state)
	if (lensIndex < 0) return

	setTimeout(() => {
		if (!container) return
		const containerRect = container.getBoundingClientRect()
		const containerScroll = container.scrollLeft

		const max = minWidth * lensIndex - collapsedWidth * lensIndex
		const min = max - (containerRect.width - minWidth - collapsedWidth * ($states.length - 1))

		if (containerScroll > min && containerScroll < max) {
			return
		}

		if (scrollStopper) {
			scrollStopper()
		}

		const distanceToMax = Math.abs(max - containerScroll)
		const distanceToMin = Math.abs(min - containerScroll)

		const x = distanceToMin < distanceToMax ? min : max
		if (x === containerScroll) {
			return
		}

		scrollStopper = scrollTo({
			container,
			duration: isFirstView ? 0 : 300,
			x,
			onDone: () => {
				scrollStopper = null
				updateCoverage()
			}
		})

		isFirstView = false
	})

	// Apply Focus
	const nodeContainer = container.children[lensIndex]
	if (!nodeContainer.contains(document.activeElement)) {
		if (state?.focus) {
			state.focus(nodeContainer as HTMLElement)
		}
	}
}

function getNodeContainerStyle(totalCount: number, index: number, min: number) {
	let result = `min-width: ${min}px;`
	result += `left: ${collapsedWidth * index}px;`
	result += `right: -${min - collapsedWidth * (totalCount - index)}px;`
	return result
}

function handleNavigate(data: NavigationData) {
	const origin = data.origin
	if (origin !== 'current') {
		tangent.updateThread({ currentNode: origin, thread: 'retain' })
	}
	if (onNavigate) onNavigate(data)
}

function onNodeContainerClicked(event: MouseEvent, state: NodeViewState) {
	if (event.defaultPrevented) return
	
	// Use state instead of node to account for states representing other nodes
	if ($currentState !== state) {
		if ($states.includes(state)) {
			console.log('clicked changing current')
			tangent.updateThread({ currentNode: state.node, thread: 'retain' })
		}
	}
	else {
		// We always want to scroll to the thing we've clicked on
		console.log('clicked scrolling current')
		scrollToCurrent(state)
	}
}

function onWheel(event: WheelEvent, state: NodeViewState) {
	// Forward along for containers
	(event as any).treeNode = state.node
}
</script>

<main bind:this={container}
	use:resizeObserver={onContainerResized}
	on:scroll={updateCoverage}
	class="ThreadView"
	class:multiple={$states.length > 1}
	class:threadFixedWidth={$focusLevel <= FocusLevel.Thread}
	class:clippingFly={clipDuringFly}>
	{#each $states as state, index (state)}
		{@const isCurrent = state === $currentState}
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div class="nodeContainer"
			style={getNodeContainerStyle($states.length, index, trueMinWidth)}
			class:current={isCurrent}
			class:covered={coveredIndices.has(index)}
			on:click={e => onNodeContainerClicked(e, state)}
			on:wheel={e => onWheel(e, state)}
			in:fly|global={{
				x: currentStateIndex > index ? -500 : 500,
				duration: (animateIn && $states.length > 1) ? 200 : 0
			}}
			on:introend={() => clipDuringFly = false}
			animate:flip={{ duration: 200 }}>
			<div class="viewContainer"
				style={`left: ${($focusLevel <= FocusLevel.Thread || $states.length > 1) ? collapsedWidth : 0}px;`}>
				<NodeViewSelector
					{state}
					{isCurrent}
					extraTop={36}
					focusLevel={Math.max($focusLevel, FocusLevel.Thread)}
					onNavigate={handleNavigate}
				/>
			</div>
			<ThreadViewVerticalTitleBar
				node={state.node}
				{tangent}
				{collapsedWidth}
				supportDirty={$supportDirty}
			/>
		</div>
	{:else}
		<div class="empty">
			<SvgIcon
				ref="tangent-icon-nocolor.svg#icon"
				size="256"
				styleString="--iconStroke: var(--embossedBackgroundColor);"
				/>
			<h1>No files in your thread. Create or open a note from the left sidebar.</h1>
			<div class="buttons">
				<!-- svelte-ignore a11y_consider_explicit_label -->
				<button use:command={{
					command: createNewFile,
					labelShortcut: true
				}} class="subtle"></button>
				<!-- svelte-ignore a11y_consider_explicit_label -->
				<button use:command={{
					command: goTo,
					labelShortcut: true
				}} class="subtle"></button>
				<!-- svelte-ignore a11y_consider_explicit_label -->
				<button use:command={{
					command: setMapFocusLevel,
					labelShortcut: true
				}} class="subtle"></button>
			</div>
		</div>
	{/each}
</main>

<style lang="scss">


main {
	display: flex;
	height: 100%;
	width: 100%;
	position: relative;
	overflow-x: auto;
	overflow-y: hidden;

	background: var(--noteBackgroundColor);

	// Slim, subtle horizontal scrollbar — the native macOS one renders as a chunky
	// light bar sitting over the note footers. The transparent border + padding-box
	// clip give the thumb some breathing room so it reads as a thin pill.
	&::-webkit-scrollbar {
		height: 10px;
	}
	&::-webkit-scrollbar-track {
		background-color: transparent;
	}
	&::-webkit-scrollbar-thumb {
		background-color: var(--scrollbarColor);
		border-radius: 5px;
		border: 3px solid var(--noteBackgroundColor);
		background-clip: padding-box;

		&:hover { background-color: var(--scrollbarHoverColor); }
		&:active { background-color: var(--scrollbarActiveColor); }
	}

	// While a pane is sliding in and the thread doesn't yet overflow, clip instead
	// of scrolling so the transient transform-overflow can't flash a horizontal
	// scrollbar and bounce the panes' height. Genuine overflow (panes wider than
	// the viewport) keeps the normal auto scrollbar.
	&.clippingFly {
		overflow-x: hidden;
	}
}

.nodeContainer {
	position: sticky;
	top: 0;
	bottom: 0;
	overflow-y: auto;

	flex-grow: 1;

	background-color: var(--noteBackgroundColor);

	&:not(:first-child) {
		box-shadow: 0 0 5px rgba(0, 0, 0, .3);
	}
}

// In thread view, hold every pane (including a lone one) at the panel width
// instead of letting a single pane flex-grow to fill the whole container.
// Otherwise the first note reflows from a wide, centered column to a narrow
// one the moment a second pane opens. Focus mode (File+) is left untouched so
// a focused single note can still fill the view.
main.threadFixedWidth .nodeContainer {
	flex-grow: 0;
}

.viewContainer {
	position: absolute;
	top: 0;
	bottom: 0;
	right: 0;

	overflow: hidden;
}

.empty {
	margin-top: 25vh;
	color: var(--deemphasizedTextColor);
	font-style: italic;
	text-align: center;
	flex-grow: 1;

	h1 {
		margin-top: 10vh;
		font-size: 110%;
		font-weight: normal;
	}

	.buttons {
		display: inline-flex;
		flex-direction: column;
		align-items: stretch;

		margin-top: 1em;
		gap: .25em;
		
		button {
			text-align: left;
			display: flex;
			justify-content: space-between;
			color: var(--deemphasizedTextColor);

			:global(.shortcut) {
				margin-left: 1em;
			}
		}
	}
}
</style>
