const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '.env') })

const { notarize } = require('@electron/notarize')

const config = require('../electron-builder.json')

exports.default = async function notarizeTheApp(context) {

	if (context.electronPlatformName !== 'darwin') {
		return
	}

	const publishIndex = process.argv.indexOf('--publish')
	if (publishIndex >= 0 && process.env.NOTARIZE !== 'force') {
		if (process.argv[publishIndex + 1] === 'never') {
			return
		}
	}

	const appName = context.packager.appInfo.productFilename

	let notarizeConfig = {
		tool: 'notarytool',
		appBundleId: config.appId,
		appPath: `${context.appOutDir}/${appName}.app`
	}

	// Prefer env-var credentials when fully provided (e.g. CI); otherwise fall
	// back to a Keychain profile created with `xcrun notarytool store-credentials`
	// (default name "TangentNotary"), so no app-specific password lives on disk.
	if (process.env.APPLE_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_ID_PASSWORD) {
		notarizeConfig.appleId = process.env.APPLE_ID
		notarizeConfig.teamId = process.env.APPLE_TEAM_ID
		notarizeConfig.appleIdPassword = process.env.APPLE_ID_PASSWORD
	}
	else {
		notarizeConfig.keychainProfile = process.env.NOTARY_PROFILE || 'TangentNotary'
	}

	console.log('notarizing...')

	let start = new Date()

	await notarize(notarizeConfig)

	let end = new Date()

	console.log('Notarized in ' + ((end - start) / 1000) + ' seconds')
}