import Logger from 'js-logger'
import { valueToString, type LogLevelName } from 'common/logging'

/**
 * Renderer-side logging.
 *
 * The main process owns Tangent's log file, so everything worth keeping has to
 * be pushed across the api. Before this existed, nothing the renderer said was
 * recorded anywhere: `js-logger` has no handler installed by default (so every
 * `log.*` call in `common/` was dropped on the floor), console output only
 * existed for as long as devtools was open, and an uncaught exception left no
 * trace at all. That made renderer-only failures effectively uninvestigable
 * after the fact.
 */

// Captured before console is patched so that forwarding can report problems
// without recursing back into itself.
const nativeConsole = {
	error: console.error.bind(console),
	warn: console.warn.bind(console),
	info: console.info.bind(console)
}

let forwarding = false

function forward(level: LogLevelName, args: any[]) {
	// A failure while forwarding must never take out the thing being logged.
	if (forwarding) return
	forwarding = true
	try {
		window.api?.log?.write(level, args.map(a => valueToString(a)).join(' '))
	}
	catch (e) {
		nativeConsole.error('Could not forward a log message to the main process', e)
	}
	finally {
		forwarding = false
	}
}

function patchConsole(level: 'error' | 'warn', native: (...args: any[]) => void) {
	console[level] = (...args: any[]) => {
		native(...args)
		forward(level, args)
	}
}

export function setupRendererLogging() {
	// Gives every `Logger.get(...)` call in `common/` somewhere to go.
	Logger.setLevel(Logger.DEBUG)
	Logger.setHandler((messages, context) => {
		const args = Array.from(messages)
		if (context.name) {
			args.unshift('[' + context.name + ']')
		}

		const level = (context.level.name.toLowerCase() as LogLevelName)

		// Bypasses the patched console so that the message is forwarded once.
		switch (level) {
			case 'error':
				nativeConsole.error(...args)
				break
			case 'warn':
				nativeConsole.warn(...args)
				break
			default:
				nativeConsole.info(...args)
				break
		}

		forward(level, args)
	})

	// Existing `console.error`/`console.warn` calls are the bulk of what the app
	// already says when something goes wrong; picking them up here means they
	// land in the log without having to rewrite every call site.
	patchConsole('error', nativeConsole.error)
	patchConsole('warn', nativeConsole.warn)

	window.addEventListener('error', event => {
		forward('error', [
			'Uncaught error:',
			event.error ?? event.message,
			{ source: event.filename, line: event.lineno, column: event.colno }
		])
	})

	window.addEventListener('unhandledrejection', event => {
		forward('error', ['Unhandled promise rejection:', event.reason])
	})
}
