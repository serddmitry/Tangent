<script lang="ts">
import { getContext } from 'svelte'
import type { ConnectionInfo, HrefFormedLink } from 'common/indexing/indexTypes'
import { getLinkDirectionFromEvent, type NavigationCallback } from 'app/events'
import type { Workspace, WorkspaceTreeNode } from 'app/model'
import LinkInfoView from '../summaries/LinkInfoView.svelte'

export let node: WorkspaceTreeNode
export let onNavigate: NavigationCallback

const workspace = getContext('workspace') as Workspace

$: inLinks = (($node?.meta?.inLinks ?? []) as ConnectionInfo[])
	.slice()
	.sort((a, b) => (a.from > b.from ? 1 : a.from < b.from ? -1 : 0))

function onSelect(event: KeyboardEvent | MouseEvent, inLink: ConnectionInfo) {
	if (event.defaultPrevented || !onNavigate) return

	// Mirror DetailBacklinksView: navigate to the note the link comes *from*.
	const link: HrefFormedLink = {
		...inLink,
		href: inLink.from,
		form: 'raw', // `from` is a full path
		from: node.path
	}
	event.preventDefault()
	onNavigate({
		link,
		origin: node,
		direction: getLinkDirectionFromEvent(event, workspace)
	})
}
</script>

{#if inLinks.length}
	<section class="inlineBacklinks">
		<h2>{inLinks.length === 1 ? '1 linked reference' : `${inLinks.length} linked references`}</h2>
		<div class="list">
			{#each inLinks as link (link.from + '_' + link.start + '-' + link.end + '_' + link.context)}
				<LinkInfoView
					{link}
					target="from"
					className="inlineBacklink"
					onSelect={e => onSelect(e, link)}
				/>
			{/each}
		</div>
	</section>
{/if}

<style lang="scss">
.inlineBacklinks {
	// Sits below the note body, muted relative to the note text but still readable
	// — à la the backlinks list on Andy Matuschak's notes.
	max-width: var(--noteWidthMax);
	margin: 2.5em auto 0;
	padding: 1em var(--noteHorizontalPadding, 2em) 0;
	box-sizing: border-box;
	border-top: 1px solid var(--borderColor);

	h2 {
		font-size: .7em;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: .06em;
		color: var(--deemphasizedTextColor);
		margin: 0 0 .75em;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: .25em;
	}

	// Flatten LinkInfoView's card into a muted, text-like row that brightens on hover
	:global(.inlineBacklink) {
		position: relative;
		background-color: transparent;
		padding: .35em .5em .35em 1.15em;
		border-radius: var(--inputBorderRadius);
		opacity: .78;
		cursor: pointer;
		transition: opacity .12s, background-color .12s;

		&::before {
			content: '–';
			position: absolute;
			left: .35em;
			top: .35em;
			color: var(--deemphasizedTextColor);
		}

		&:hover, &:focus {
			opacity: 1;
			background-color: var(--backgroundColor);
			outline: none;
		}

		:global(h1) {
			color: var(--accentTextColor);
			font-weight: 500;
		}
	}
}
</style>
