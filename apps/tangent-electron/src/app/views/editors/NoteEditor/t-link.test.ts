import { afterEach, describe, expect, it } from 'vitest'

import type { TreeNode } from 'common/trees'
import { TangentLink } from './t-link'

describe('TangentLink open-note highlighting', () => {
	afterEach(() => {
		document.body.replaceChildren()
		delete (document as any).workspace
	})

	it('stays highlighted when its already-open target is renamed in place', () => {
		const target = { path: '/A.md' } as TreeNode
		;(document as any).workspace = {
			viewState: {
				tangent: {
					thread: {
						subscribe(callback: (thread: TreeNode[]) => void) {
							callback([target])
							return () => {}
						}
					}
				}
			}
		}

		const link = new TangentLink()
		link.resolvedNode = target
		document.body.append(link)
		expect(link.hasAttribute('data-open')).toBe(true)

		target.path = '/Renamed.md'
		link.applyOpenState()

		expect(link.hasAttribute('data-open')).toBe(true)
	})
})
