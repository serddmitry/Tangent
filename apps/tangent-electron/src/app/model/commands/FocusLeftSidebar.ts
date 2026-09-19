import { SidebarMode } from 'common/SidebarState'
import type Workspace from '../Workspace'
import WorkspaceCommand from './WorkspaceCommand'
import { wait } from '@such-n-such/core'
import { focusLeftSidebar } from 'app/utils/selection'

export default class FocusLeftSidebarCommand extends WorkspaceCommand {
	constructor(workspace: Workspace) {
		super(workspace, { shortcut: 'Mod+1' })
	}

	execute(_context) {
		const mode = this.workspace.viewState.leftSidebar.mode
		if (mode.value !== SidebarMode.pinned) {
			// Pin it open first, then focus once the sidebar has rendered
			mode.set(SidebarMode.pinned)
			wait().then(() => {
				focusLeftSidebar()
			})
		}
		else {
			focusLeftSidebar()
		}
	}

	getLabel(_context) {
		return 'Focus Left Sidebar'
	}

	getTooltip(_context) {
		return 'Moves keyboard focus into the left sidebar so the file tree can be navigated with the arrow keys.'
	}
}
