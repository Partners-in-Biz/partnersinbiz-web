#!/usr/bin/env tsx
/**
 * Design Audit Gate — the slop-blocking hook runner for the PiB web repo.
 *
 * Wires the T1 detector (lib/design-audit) into the development workflow:
 *   - Light pass (pre-commit, per-edit): runs on staged UI files, blocks on
 *     P0/P1 findings only, fast.
 *   - Deep pass (CI / completion): runs on changed files vs a base, reports
 *     all severities, blocks on P0/P1, prints P2/P3 as advisory.
 *
 * Unlike scripts/design-audit.ts (the raw detector CLI), this script owns the
 * GATE decision: it resolves which files to scan from git state, filters to UI
 * surfaces, applies the severity threshold, and ALWAYS prints a summary line —
 * silence can never read as clean.
 *
 * Exit codes: 0 pass / 2 blocked (P0/P1 findings) / 1 failure.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { runAudit, mergeResults } from '../lib/design-audit'
import type { AuditOptions, AuditResult, Finding, Severity } from '../lib/design-audit'
import { parseDesignMd, parseDesignJson } from '../lib/design-audit/design-context'

export const UI_EXTENSIONS = new Set(['.html', '.htm', '.jsx', '.tsx', '.vue', '.svelte', '.astro', '.mdx', '.css'])
const BLOCKING_SEVERITIES: Severity[] = ['P0', 'P1']
const MAX_PER_RULE_DEFAULT = 20

export interface GateOptions {
  mode: 'light' | 'deep'
  files?: string[]
  staged?: boolean
  base?: string
  json: boolean
  designContext?: string
  noDesignSystem: boolean
  ignoreRules: string[]
  ignoreValues: string[]
  ignoreFiles: string[]
  noInlineIgnores: boolean
  noConfig: boolean
  maxFindingsPerRule?: number
  /** Used by tests to inject a git diff source instead of shelling out. */
  _gitFiles?: (args: string[]) => string[]
}

export interface GateFileResult {
  file: string
  result: AuditResult
  blockedFindings: Finding[]
}

export interface GateResult {
  schema: 'pib-design-audit-gate/v1'
  mode: 'light' | 'deep'
  exitCode: 0 | 1 | 2
  blocked: boolean
  files: GateFileResult[]
  summary: {
    filesScanned: number
    filesBlocked: number
    findings: number
    blockedFindings: number
    bySeverity: Record<Severity, number>
    rulesRun: string[]
  }
  notes: string[]
  errors: string[]
}

export function gitFiles(args: string[]): string[] {
  try {
    const out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out.split(/\r?\n/).filter(Boolean)
  } catch {
    return []
  }
}

/** Resolve which files to scan from git state or an explicit list. */
export function resolveGateFiles(opts: GateOptions): string[] {
  // An explicitly provided list (even empty) wins — the caller says "scan
  // these", not "scan git state".
  if (opts.files !== undefined) {
    // Explicit lists keep missing paths so runGate can report a read error
    // (exit 1) instead of silently skipping — silence can never read as clean.
    return opts.files.filter((f) => UI_EXTENSIONS.has(path.extname(f).toLowerCase()))
  }
  const gitArgs = opts.staged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
    : ['diff', '--name-only', '--diff-filter=ACMR', ...(opts.base ? [opts.base] : ['HEAD'])]
  const raw = opts._gitFiles ? opts._gitFiles(gitArgs) : gitFiles(gitArgs)
  return raw
    .filter((f) => UI_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .filter((f) => fs.existsSync(f))
}

/** Severity filter: only P0/P1 findings block the gate. */
export function blockingFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => BLOCKING_SEVERITIES.includes(f.severity))
}

export function loadGateDesignSystem(contextPath: string): AuditOptions['designSystem'] {
  const resolved = path.resolve(contextPath)
  const text = fs.readFileSync(resolved, 'utf8')
  const parsed = resolved.endsWith('.json')
    ? parseDesignJson(text, path.basename(resolved))
    : parseDesignMd(text, path.basename(resolved))
  return parsed
}

export function findGateConfig(dir: string): Record<string, unknown> | null {
  let current = path.resolve(dir)
  for (;;) {
    const candidate = path.join(current, '.impeccable', 'config.json')
    if (fs.existsSync(candidate)) {
      try {
        return JSON.parse(fs.readFileSync(candidate, 'utf8')) as Record<string, unknown>
      } catch {
        return null
      }
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function runGate(opts: GateOptions): GateResult {
  const errors: string[] = []
  const notes: string[] = []
  const files = resolveGateFiles(opts)
  const baseDir = files.length ? path.dirname(files[0]) : process.cwd()
  const config = opts.noConfig ? null : findGateConfig(baseDir)
  const detector = (config?.detector ?? {}) as Record<string, unknown>
  const configIgnoreRules = Array.isArray(detector.ignoreRules) ? (detector.ignoreRules as string[]) : []
  const configIgnoreValues = Array.isArray(detector.ignoreValues) ? (detector.ignoreValues as string[]) : []
  const configIgnoreFiles = Array.isArray(detector.ignoreFiles) ? (detector.ignoreFiles as string[]) : []
  const designSystemEnabled = opts.noDesignSystem
    ? false
    : (detector.designSystem as { enabled?: boolean } | undefined)?.enabled !== false

  let designSystem: AuditOptions['designSystem'] | null = null
  if (designSystemEnabled && opts.designContext) {
    try {
      designSystem = loadGateDesignSystem(opts.designContext)
    } catch (err) {
      errors.push(`design-context: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const baseOptions: AuditOptions = {
    ignore: {
      rules: [...configIgnoreRules, ...opts.ignoreRules],
      values: [...configIgnoreValues, ...opts.ignoreValues],
      files: [...configIgnoreFiles, ...opts.ignoreFiles],
      inline: !opts.noInlineIgnores,
    },
    designSystem,
    designSystemEnabled,
    maxFindingsPerRule: opts.maxFindingsPerRule ?? MAX_PER_RULE_DEFAULT,
  }

  const fileResults: GateFileResult[] = []
  const mergedList: AuditResult[] = []
  for (const file of files) {
    let source: string
    try {
      source = fs.readFileSync(file, 'utf8')
    } catch (err) {
      errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    const result = runAudit(path.extname(file).toLowerCase() === '.css' ? `<style>${source}</style>` : source, {
      ...baseOptions,
      fileName: file,
    })
    mergedList.push(result)
    fileResults.push({ file, result, blockedFindings: blockingFindings(result.findings) })
  }

  const merged = mergedList.length ? mergeResults(mergedList) : mergeResults([])
  const blockedFiles = fileResults.filter((r) => r.blockedFindings.length > 0)
  const blockedCount = blockedFiles.reduce((n, r) => n + r.blockedFindings.length, 0)

  // Always emit a verdict line even with zero files scanned, so a no-op run
  // is visible rather than reading as clean.
  const summary = {
    filesScanned: files.length,
    filesBlocked: blockedFiles.length,
    findings: merged.summary.total,
    blockedFindings: blockedCount,
    bySeverity: merged.summary.bySeverity,
    rulesRun: merged.rulesRun,
  }

  const exitCode: 0 | 1 | 2 = errors.length ? 1 : blockedCount ? 2 : 0

  return {
    schema: 'pib-design-audit-gate/v1',
    mode: opts.mode,
    exitCode,
    blocked: blockedCount > 0,
    files: fileResults,
    summary,
    notes: [...notes, ...merged.notes],
    errors: [...errors, ...merged.errors],
  }
}

export function formatGateHuman(gate: GateResult): string {
  const lines: string[] = []
  if (gate.summary.filesScanned === 0) {
    lines.push(`design-audit gate (${gate.mode}): no UI files scanned — nothing to gate`)
  } else {
    lines.push(`design-audit gate (${gate.mode}): ${gate.summary.filesScanned} file(s), ` +
      `${gate.summary.blockedFindings} blocking P0/P1 finding(s), ` +
      `${gate.summary.findings} total finding(s)`)
  }
  for (const { file, blockedFindings } of gate.files) {
    if (!blockedFindings.length) continue
    lines.push(`  BLOCKED ${file}`)
    for (const f of blockedFindings) {
      lines.push(`    [${f.severity}] ${f.rule} @ ${f.ref}:${f.line || '-'} — ${f.message}`)
    }
  }
  if (gate.mode === 'deep') {
    for (const { file, result } of gate.files) {
      const advisory = result.findings.filter((f) => !BLOCKING_SEVERITIES.includes(f.severity))
      if (!advisory.length) continue
      lines.push(`  advisory ${file}: ${advisory.length} P2/P3 finding(s)`)
    }
  }
  for (const err of gate.errors) lines.push(`  error: ${err}`)
  for (const note of gate.notes) lines.push(`  note: ${note}`)
  lines.push(gate.exitCode === 0
    ? `design-audit gate: PASS`
    : gate.exitCode === 2
      ? `design-audit gate: BLOCKED — fix or explicitly ignore P0/P1 findings (git commit --no-verify is a manual override)`
      : `design-audit gate: FAILURE — see errors above`)
  return lines.join('\n')
}

function parseArgs(argv: string[]): { opts: GateOptions; help: boolean } {
  const opts: GateOptions = {
    mode: 'light',
    json: false,
    noDesignSystem: false,
    ignoreRules: [],
    ignoreValues: [],
    ignoreFiles: [],
    noInlineIgnores: false,
    noConfig: false,
  }
  let help = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--light':
        opts.mode = 'light'
        break
      case '--deep':
        opts.mode = 'deep'
        break
      case '--json':
        opts.json = true
        break
      case '--staged':
        opts.staged = true
        break
      case '--base':
        opts.base = argv[++i]
        break
      case '--design-context':
        opts.designContext = argv[++i]
        break
      case '--no-design-system':
        opts.noDesignSystem = true
        break
      case '--ignore-rule':
        opts.ignoreRules.push(argv[++i])
        break
      case '--ignore-value':
        opts.ignoreValues.push(argv[++i])
        break
      case '--ignore-file':
        opts.ignoreFiles.push(argv[++i])
        break
      case '--no-inline-ignores':
        opts.noInlineIgnores = true
        break
      case '--no-config':
        opts.noConfig = true
        break
      case '--max-findings-per-rule':
        opts.maxFindingsPerRule = parseInt(argv[++i], 10)
        break
      case '--file': {
        if (!opts.files) opts.files = []
        opts.files.push(argv[++i])
        break
      }
      case '--help':
      case '-h':
        help = true
        break
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
        if (!opts.files) opts.files = []
        opts.files.push(arg)
    }
  }
  return { opts, help }
}

function printHelp(): void {
  process.stdout.write(`Design Audit Gate — slop-blocking hook for the PiB web repo

Usage:
  npx tsx scripts/design-audit-gate.ts [--light|--deep] [--staged|--base <sha>|--file <path>...] [options]

Modes:
  --light   Per-edit pass (default). Scans staged UI files, blocks on P0/P1.
  --deep    Completion/CI pass. Scans changed files vs --base (default HEAD),
            reports all severities, blocks on P0/P1, P2/P3 advisory.

File selection (default: staged):
  --staged            git diff --cached UI files (pre-commit)
  --base <sha>        git diff <sha> UI files (CI deep pass)
  --file <path>...    explicit files (repeatable)

Options:
  --json                        JSON output (schema pib-design-audit-gate/v1)
  --design-context <path>       DESIGN.md or .impeccable/design.json (drift rules)
  --no-design-system            Skip drift rules even when context exists
  --ignore-rule <id>            Skip a rule entirely (repeatable)
  --ignore-value <rule:value>   Ignore one value for one rule (repeatable)
  --ignore-file <glob>          Ignore files matching a glob (repeatable)
  --no-inline-ignores           Ignore impeccable-disable comments/attributes
  --no-config                   Ignore .impeccable/config.json
  --max-findings-per-rule <n>   Per-rule cap (default 20)

Exit codes: 0 pass / 2 blocked (P0/P1 findings) / 1 failure
`)
}

async function main(): Promise<number> {
  let parsed: { opts: GateOptions; help: boolean }
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`design-audit-gate: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
  if (parsed.help) {
    printHelp()
    return 0
  }
  const gate = runGate(parsed.opts)
  if (parsed.opts.json) {
    process.stdout.write(JSON.stringify(gate, null, 2) + '\n')
  } else {
    process.stdout.write(formatGateHuman(gate) + '\n')
  }
  return gate.exitCode
}

// Only auto-run when invoked directly as a script. Importing this module from
// the doctor or tests must not trigger a gate run.
const isEntryPoint =
  typeof process !== 'undefined'
  && typeof process.argv?.[1] === 'string'
  && path.resolve(process.argv[1]) === __filename

if (isEntryPoint) {
  main().then((code) => {
    process.exitCode = code
  })
}
