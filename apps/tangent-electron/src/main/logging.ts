import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { getWorkspaceNamePrefix } from './environment'
import Logger from 'js-logger'
import { simpleTimestamp } from '../common/dates'
import { padString } from '../common/stringUtils'
import { valueToString } from '../common/logging'

// Re-exported so that logging consumers only need to know about this module.
export { valueToString }

const logPath = path.join(
	app?.getPath('logs') ?? '',
	getWorkspaceNamePrefix() + 'log.txt')

export function passLogsToConsole() {
	const defaultLogHandler = Logger.createDefaultHandler()
	Logger.setHandler(defaultLogHandler)
}

export function setupLogging() {
	const logStream = fs.createWriteStream(logPath, { flags: 'a' })

	const defaultLogHandler = Logger.createDefaultHandler({
		formatter: (messages: any[], context) => {
			if (context.name) {
				messages.unshift('[' + context.name + ']')
			}
			
			const message = messages.map(value => valueToString(value)).join(' ')
	
			logStream.write(`${padString(context.level.name, 5)} ${simpleTimestamp(new Date())}: ${message}\n`)
		}
	})
	Logger.setHandler(defaultLogHandler)
	
	app.on('quit', () => {
		Logger.info('Tangent Exiting')
		logStream.end()
		Logger.setHandler(null)
	})
}
