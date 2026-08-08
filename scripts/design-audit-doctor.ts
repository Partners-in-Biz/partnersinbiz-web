#!/usr/bin/env tsx
/**
 * Design Audit Doctor — `/impeccable doctor` equivalent.
 *
 * Verifies the slop-blocking hook actually runs, so silence can never be read
 * as clean:
 *   1. Engine works (clean sample exits 0, slop sample exits 2).
 *   2. Gate script works (light + deep modes resolve files and gate correctly).
 *   3. Pre-commit hook is installed (core.hooksPath -> .githooks, hook file
 *      present + executable, installer script present).
 *   4. CI workflow contains the deep design-audit pass.
 *   5. Studio gate is wired into the creative-canvas graph route.
 *
 * Always prints an explicit PASS/FAIL line and exits 1 on any failure — a
 * broken or missing hook is a red doctor, never a silent green.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { runAudit } from '../lib/design-audit'
import { runGate, resolveGateFiles, blockingFindings } from './design-audit-gate'

const REPO_ROOT = path.resolve(__dirname, '..')

interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

const results: CheckResult[] = []

function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail })
  const icon = ok ? 'PASS' : 'FAIL'
  process.stdout.write(`  [${icon}] ${name}: ${detail}\n`)
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function main(): number {
  process.stdout.write('Design Audit Doctor — verifying the slop-blocking hook really runs\n')

  // 1. Engine smoke tests.
  const cleanSource = '<html lang="en"><body><h1>Clean</h1><p>Plain copy.</p></body></html>'
  const slopSource = '<html><body><div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"><h2 style="font-style: italic; font-family: Georgia">Hero</h2></div></body></html>'
  const clean = runAudit(cleanSource, { fileName: 'doctor-clean.html' })
  const slop = runAudit(slopSource, { fileName: 'doctor-slop.html' })
  record('engine-clean-exit-0', clean.exitCode === 0, `clean sample -> exit ${clean.exitCode}`)
  record('engine-slop-exit-2', slop.exitCode === 2, `slop sample -> exit ${slop.exitCode}, ${slop.summary.total} finding(s)`)

  // 2. Gate script works.
  const gateClean = runGate({ mode: 'light', files: [], json: false, noDesignSystem: false, ignoreRules: [], ignoreValues: [], ignoreFiles: [], noInlineIgnores: false, noConfig: true })
  const filesResolved = resolveGateFiles({ mode: 'light', files: [], json: false, noDesignSystem: false, ignoreRules: [], ignoreValues: [], ignoreFiles: [], noInlineIgnores: false, noConfig: true })
  record('gate-runs', gateClean.schema === 'pib-design-audit-gate/v1', `gate returns ${gateClean.schema}, resolved ${filesResolved.length} UI file(s) from git`)
  const blocking = blockingFindings(slop.findings)
  record('gate-blocks-p0p1', blocking.length > 0, `blocking filter keeps ${blocking.length} P0/P1 of ${slop.findings.length} findings`)

  // 3. Pre-commit hook installed.
  const hooksPath = git(['config', 'core.hooksPath'])
  const hookFile = path.join(REPO_ROOT, '.githooks', 'pre-commit')
  const hookExists = fs.existsSync(hookFile)
  const hookExec = hookExists && (fs.statSync(hookFile).mode & 0o111) !== 0
  record('hook-core-hooks-path', hooksPath === '.githooks', `core.hooksPath = "${hooksPath || '(unset)'}"`)
  record('hook-file-present', hookExists, `.githooks/pre-commit ${hookExists ? 'present' : 'MISSING'}`)
  record('hook-file-executable', hookExec, `.githooks/pre-commit ${hookExec ? 'executable' : 'NOT executable'}`)
  record('hook-installer-present', fs.existsSync(path.join(REPO_ROOT, 'scripts', 'install-design-hooks.mjs')), 'scripts/install-design-hooks.mjs present')
  const prepared = git(['config', '--local', '--get-regexp', 'core.hooksPath'])
  record('hook-installed', hooksPath === '.githooks' && hookExists && hookExec, `hook active: ${prepared || 'none'}`)

  // 4. CI workflow contains the deep pass.
  const ciPath = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml')
  const ciExists = fs.existsSync(ciPath)
  const ciHasGate = ciExists && fs.readFileSync(ciPath, 'utf8').includes('design-audit-gate.ts --deep')
  record('ci-deep-gate', ciExists && ciHasGate, `.github/workflows/ci.yml ${ciExists ? (ciHasGate ? 'has deep design-audit step' : 'MISSING deep step') : 'MISSING'}`)

  // 5. Studio gate wired.
  const graphRoute = path.join(REPO_ROOT, 'app', 'api', 'v1', 'creative-canvas', '[id]', 'graph', 'route.ts')
  const studioWired = fs.existsSync(graphRoute) && fs.readFileSync(graphRoute, 'utf8').includes('buildStudioStamp')
  record('studio-gate-wired', studioWired, `graph route ${studioWired ? 'stamps designAudit on Studio artifacts' : 'NOT wired'}`)

  const failed = results.filter((r) => !r.ok)
  const passed = results.length - failed.length
  process.stdout.write(`\nDesign Audit Doctor: ${passed}/${results.length} checks passed.\n`)
  if (failed.length) {
    process.stdout.write('Design Audit Doctor: FAIL — silence is NOT clean.\n')
    for (const r of failed) process.stdout.write(`  - ${r.name}: ${r.detail}\n`)
    process.stdout.write('Fix the failed checks (npm run prepare / reinstall hooks, npm ci, re-push CI) before trusting the gate.\n')
    return 1
  }
  process.stdout.write('Design Audit Doctor: PASS — hook installed, engine working, CI + Studio wired.\n')
  return 0
}

process.exitCode = main()
