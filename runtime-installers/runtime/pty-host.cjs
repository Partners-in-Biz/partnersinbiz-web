#!/usr/bin/env node
/**
 * Node.js PTY sidecar for the packaged pib-runtime binary.
 *
 * Bun-compiled runtimes cannot spawn node-pty native addons (posix_spawnp fails).
 * The runtime launches this script with the system `node` binary and talks over
 * line-delimited JSON on stdin/stdout.
 *
 * Protocol (parent → host, one JSON object per line):
 *   { "type": "start", "file": "/bin/zsh", "args": ["-l"], "cols": 120, "rows": 40, "cwd": "...", "env": { ... } }
 *   { "type": "write", "data": "ls\n" }
 *   { "type": "resize", "cols": 100, "rows": 30 }
 *   { "type": "kill" }
 *
 * Protocol (host → parent):
 *   { "type": "ready", "pid": 12345 }
 *   { "type": "data", "data": "..." }
 *   { "type": "exit", "exitCode": 0, "signal": null }
 *   { "type": "error", "message": "..." }
 */
'use strict'

const path = require('path')
const fs = require('fs')
const readline = require('readline')
const { createRequire } = require('module')

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function loadNodePty() {
  const roots = [
    path.dirname(process.execPath),
    __dirname,
    path.join(__dirname, '..'),
    process.cwd(),
  ]
  const errors = []
  for (const root of roots) {
    const moduleDir = path.join(root, 'node_modules', 'node-pty')
    const pkgJson = path.join(root, 'package.json')
    if (fs.existsSync(moduleDir)) {
      try {
        return require(moduleDir)
      } catch (error) {
        errors.push(`${moduleDir}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (fs.existsSync(pkgJson)) {
      try {
        return createRequire(pkgJson)('node-pty')
      } catch (error) {
        errors.push(`${pkgJson}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  try {
    return require('node-pty')
  } catch (error) {
    errors.push(`default: ${error instanceof Error ? error.message : String(error)}`)
  }
  throw new Error(
    'node-pty is not installed beside the runtime. Run `npm install node-pty` in the runtime install directory. '
    + errors.slice(0, 3).join(' | '),
  )
}

let ptyProcess = null

function start(message) {
  if (ptyProcess) {
    send({ type: 'error', message: 'pty already started' })
    return
  }
  let nodePty
  try {
    nodePty = loadNodePty()
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'node-pty missing' })
    process.exitCode = 1
    return
  }

  const file = typeof message.file === 'string' ? message.file : '/bin/zsh'
  const args = Array.isArray(message.args) ? message.args.filter((a) => typeof a === 'string') : []
  const cols = Number.isFinite(message.cols) ? Math.max(1, Math.min(300, Math.trunc(message.cols))) : 120
  const rows = Number.isFinite(message.rows) ? Math.max(1, Math.min(300, Math.trunc(message.rows))) : 40
  const cwd = typeof message.cwd === 'string' && message.cwd ? message.cwd : process.cwd()
  const env = message.env && typeof message.env === 'object' ? { ...process.env, ...message.env } : process.env

  try {
    ptyProcess = nodePty.spawn(file, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    })
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'pty spawn failed' })
    process.exitCode = 1
    return
  }

  send({ type: 'ready', pid: ptyProcess.pid })
  ptyProcess.onData((data) => {
    send({ type: 'data', data: String(data) })
  })
  ptyProcess.onExit(({ exitCode, signal }) => {
    send({
      type: 'exit',
      exitCode: Number.isSafeInteger(exitCode) ? exitCode : null,
      signal: signal == null ? null : Number(signal),
    })
    process.exit(0)
  })
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  if (!line.trim()) return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    send({ type: 'error', message: 'invalid json control line' })
    return
  }
  switch (message.type) {
    case 'start':
      start(message)
      break
    case 'write':
      if (!ptyProcess) {
        send({ type: 'error', message: 'pty not started' })
        return
      }
      if (typeof message.data === 'string') ptyProcess.write(message.data)
      break
    case 'resize':
      if (!ptyProcess) {
        send({ type: 'error', message: 'pty not started' })
        return
      }
      if (Number.isFinite(message.cols) && Number.isFinite(message.rows)) {
        ptyProcess.resize(
          Math.max(1, Math.min(300, Math.trunc(message.cols))),
          Math.max(1, Math.min(300, Math.trunc(message.rows))),
        )
      }
      break
    case 'kill':
      if (ptyProcess) {
        try { ptyProcess.kill() } catch { /* already gone */ }
      } else {
        process.exit(0)
      }
      break
    default:
      send({ type: 'error', message: `unknown control type: ${message.type}` })
  }
})

rl.on('close', () => {
  if (ptyProcess) {
    try { ptyProcess.kill() } catch { /* ignore */ }
  }
})
