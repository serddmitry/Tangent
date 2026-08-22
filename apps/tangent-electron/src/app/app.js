import { mount } from 'svelte'
import App from './App.svelte'
import { setHomeDirectory } from 'common/paths'
import { setupRendererLogging } from './logging'

import './style/input.scss'
import './style/note.scss'

// First, so that anything going wrong below is recorded.
setupRendererLogging()

// Link resolution needs this before any note is rendered.
setHomeDirectory(window.api.system.homeDirectory)

import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs'
console.log({pdfWorker})
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

import 'pdfjs-dist/web/pdf_viewer.css'

const app = mount(App, {
	target: document.body,
})

export default app
