#!/usr/bin/env node
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const mainScript = join(__dirname, 'ts-type-cleaner.js')

const child = spawn('node', [mainScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
})

child.on('exit', code => {
  process.exit(code || 0)
})
