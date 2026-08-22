/**
 * Logging helpers shared by the main and renderer processes.
 *
 * The main process owns the log file (see `main/logging.ts`); the renderer
 * forwards its messages there over IPC (see `app/logging.ts`). Both need the
 * same value formatting, and the renderer cannot import anything from `main`.
 */

// Need to strip out the console colors
const formatStripper = /\[\d\d?m/g

function depthToSpacing(depth: number) {
	let result = ''
	for (let i = 0; i < depth; i++) {
		result += '\t'
	}
	return result
}

/**
 * Prepares a value for printing to a log. Does _not_ produce JSON for objects
 * @param value The value to prepare for printing.
 * @param depth (optional) The current depth for spacing purposes.
 * @param visited (optional) The set of objects that have been printed already.
 * @returns A formatted string representing the value ready to be printed to a log file.
 */
export function valueToString(value: any, depth?: number, visited?: Set<any>) {
	if (value === null) return '<null>'
	if (value === undefined) return '<undefined>'
	if (value instanceof Error) {
		if (value.stack) {
			return value.stack + '\n'
		}
		return `${value.name}: ${value.message}`
	}
	if (typeof value === 'object') {
		visited = visited ?? new Set()
		visited.add(value)
		let out = '{\n'
		let innerDepth = (depth ?? 0) + 1
		let innerSpacing = depthToSpacing(innerDepth)
		for (const key of Object.keys(value)) {
			out += innerSpacing + key + ': '
			const innerValue = value[key]
			if (visited.has(innerValue)) {
				out += '<object already logged>'
			}
			else {
				out += valueToString(innerValue, innerDepth, visited)
			}
			if (!out.endsWith('\n')) {
				out += '\n'
			}
		}
		out += depthToSpacing(depth ?? 0) + '}\n'
		return out
	}
	return String(value).replace(formatStripper, '')
}

/**
 * The levels a renderer log message can be forwarded to the main process with.
 * These map onto the equivalent `js-logger` calls.
 */
export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export const logLevelNames: LogLevelName[] = ['trace', 'debug', 'info', 'warn', 'error']
