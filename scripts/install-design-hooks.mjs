#!/usr/bin/env node
/**
 * Install the Design Audit pre-commit hook.
 *
 * Sets core.hooksPath to .githooks for this checkout (local config only, not
 * global), so the light per-edit design-audit pass runs on every commit.
 * Idempotent and safe: no network, no writes outside this repo's .git/config
 * and the .githooks directory.
 *
 * Verification: npm run design:doctor reports whether the hook is installed.
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const repoRoot = process.cwd()
const hooksDir = path.join(repoRoot, '.githooks')

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts })
}

try {
  const hook = path.join(hooksDir, 'pre-commit')
  if (!fs.existsSync(hook)) {
    console.error('design-audit: .githooks/pre-commit missing; run npm ci from repo root first')
    process.exit(1)
  }

  // Local repo config only. Never touches global config.
  git(['config', 'core.hooksPath', '.githooks'])

  const current = git(['config', 'core.hooksPath']).trim()
  if (current === '.githooks') {
    console.log('design-audit: pre-commit hook installed (core.hooksPath=.githooks)')
  } else {
    console.error(`design-audit: failed to set core.hooksPath (got "${current}")`)
    process.exit(1)
  }
} catch (err) {
  console.error(`design-audit: hook install failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
