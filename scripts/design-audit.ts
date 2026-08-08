#!/usr/bin/env tsx
/**
 * Design Audit CLI — deterministic anti-slop / WCAG / quality / drift lint.
 *
 * Modeled on `npx impeccable detect`:
 *   npx tsx scripts/design-audit.ts <file|dir|stdin> [--json] [--scope type|layout]
 *       [--design-context DESIGN.md|design.json] [--no-design-system]
 *       [--ignore-rule <id>]... [--ignore-value <rule:value>]... [--ignore-file <glob>]...
 *       [--no-inline-ignores] [--no-config]
 *
 * Exit codes: 0 clean / 2 findings / 1 failure.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { runAudit, mergeResults } from '../lib/design-audit'
import type { AuditOptions, AuditResult } from '../lib/design-audit'
import { parseDesignMd, parseDesignJson } from '../lib/design-audit/design-context'

const SCAN_EXTENSIONS = new Set(['.html', '.htm', '.jsx', '.tsx', '.vue', '.svelte', '.astro', '.css', '.mdx'])

interface CliOptions {
  json: boolean
  scope?: AuditOptions['scope']
  designContext?: string
  noDesignSystem: boolean
  ignoreRules: string[]
  ignoreValues: string[]
  ignoreFiles: string[]
  noInlineIgnores: boolean
  noConfig: boolean
  maxFindingsPerRule?: number
}

function parseArgs(argv: string[]): { target?: string; opts: CliOptions } {
  const opts: CliOptions = {
    json: false,
    noDesignSystem: false,
    ignoreRules: [],
    ignoreValues: [],
    ignoreFiles: [],
    noInlineIgnores: false,
    noConfig: false,
  }
  let target: string | undefined
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--json':
        opts.json = true
        break
      case '--scope': {
        const value = argv[++i]
        if (value !== 'type' && value !== 'layout') throw new Error(`--scope must be type|layout, got "${value}"`)
        opts.scope = value
        break
      }
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
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
        positional.push(arg)
    }
  }
  if (positional.length > 1) throw new Error(`Expected at most one target, got ${positional.length}`)
  target = positional[0]
  return { target, opts }
}

function printHelp(): void {
  process.stdout.write(`Design Audit — deterministic design lint (Impeccable-style port)

Usage:
  npx tsx scripts/design-audit.ts <file|dir> [options]
  cat page.html | npx tsx scripts/design-audit.ts [options]

Options:
  --json                        JSON output (schema pib-design-audit/v1)
  --scope type|layout           Narrow to one design domain
  --design-context <path>       DESIGN.md or .impeccable/design.json (enables drift rules)
  --no-design-system            Skip drift rules even when context exists
  --ignore-rule <id>            Skip a rule entirely (repeatable)
  --ignore-value <rule:value>   Ignore one value for one rule (repeatable)
  --ignore-file <glob>          Ignore files matching a glob (repeatable)
  --no-inline-ignores           Ignore impeccable-disable comments/attributes
  --no-config                   Ignore .impeccable/config.json
  --max-findings-per-rule <n>   Per-rule cap (default 50)

Exit codes: 0 clean / 2 findings / 1 failure
`)
}

function findConfig(dir: string): Record<string, unknown> | null {
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

interface LoadedDesignSystem {
  palette: string[]
  fonts: string[]
  radii: number[]
  fontSize: number[]
  source: string
}

function loadDesignSystem(contextPath: string): LoadedDesignSystem {
  const resolved = path.resolve(contextPath)
  let stat: fs.Stats
  try {
    stat = fs.statSync(resolved)
  } catch {
    throw new Error(`Design context not found: ${contextPath}`)
  }
  if (stat.isDirectory()) {
    const json = path.join(resolved, '.impeccable', 'design.json')
    if (fs.existsSync(json)) return loadDesignSystem(json)
    const md = path.join(resolved, 'DESIGN.md')
    if (fs.existsSync(md)) return loadDesignSystem(md)
    throw new Error(`No DESIGN.md or .impeccable/design.json in ${contextPath}`)
  }
  const text = fs.readFileSync(resolved, 'utf8')
  const parsed = resolved.endsWith('.json') ? parseDesignJson(text, path.basename(resolved)) : parseDesignMd(text, path.basename(resolved))
  return { ...parsed }
}

function walkFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, out)
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full)
  }
}

function sourceForFile(file: string): string {
  const text = fs.readFileSync(file, 'utf8')
  if (path.extname(file).toLowerCase() === '.css') return `<style>${text}</style>`
  return text
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function main(): Promise<number> {
  let parsed: { target?: string; opts: CliOptions }
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`design-audit: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
  const { target, opts } = parsed

  const baseDir = target ? (fs.statSync(target).isDirectory() ? target : path.dirname(target)) : process.cwd()
  const config = opts.noConfig ? null : findConfig(baseDir)
  const detector = (config?.detector ?? {}) as Record<string, unknown>
  const configIgnoreRules = Array.isArray(detector.ignoreRules) ? (detector.ignoreRules as string[]) : []
  const configIgnoreValues = Array.isArray(detector.ignoreValues) ? (detector.ignoreValues as string[]) : []
  const configIgnoreFiles = Array.isArray(detector.ignoreFiles) ? (detector.ignoreFiles as string[]) : []
  const designSystemEnabled = opts.noDesignSystem
    ? false
    : (detector.designSystem as { enabled?: boolean } | undefined)?.enabled !== false

  let designSystem: ReturnType<typeof loadDesignSystem> | null = null
  if (designSystemEnabled && opts.designContext) {
    try {
      designSystem = loadDesignSystem(opts.designContext)
    } catch (err) {
      process.stderr.write(`design-audit: ${err instanceof Error ? err.message : String(err)}\n`)
      return 1
    }
  }

  const baseOptions: AuditOptions = {
    scope: opts.scope,
    designSystem,
    designSystemEnabled,
    ignore: {
      rules: [...configIgnoreRules, ...opts.ignoreRules],
      values: [...configIgnoreValues, ...opts.ignoreValues],
      files: [...configIgnoreFiles, ...opts.ignoreFiles],
      inline: !opts.noInlineIgnores,
    },
    maxFindingsPerRule: opts.maxFindingsPerRule,
  }

  const files: string[] = []
  const stdinMode = !target
  if (target) {
    const stat = fs.statSync(target)
    if (stat.isDirectory()) walkFiles(target, files)
    else files.push(target)
  }

  const results: AuditResult[] = []
  const fileResults: Array<{ file: string; result: AuditResult }> = []

  try {
    if (stdinMode) {
      const source = await readStdin()
      const result = runAudit(source, { ...baseOptions, fileName: '<stdin>' })
      fileResults.push({ file: '<stdin>', result })
      results.push(result)
    } else {
      for (const file of files) {
        const result = runAudit(sourceForFile(file), { ...baseOptions, fileName: file })
        fileResults.push({ file, result })
        results.push(result)
      }
    }
  } catch (err) {
    process.stderr.write(`design-audit: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }

  const merged = mergeResults(results)

  if (opts.json) {
    const payload = {
      schema: merged.schema,
      exitCode: merged.exitCode,
      summary: merged.summary,
      files: fileResults.map(({ file, result }) => ({
        file,
        findings: result.findings,
        rulesRun: result.rulesRun,
        rulesIgnored: result.rulesIgnored,
        errors: result.errors,
        durationMs: result.durationMs,
      })),
      designSystem: merged.designSystem,
      notes: merged.notes,
    }
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
  } else {
    if (merged.designSystem.present) process.stdout.write(`Design context: ${merged.designSystem.source}\n`)
    for (const { file, result } of fileResults) {
      if (!result.findings.length) continue
      process.stdout.write(`\n${file}\n`)
      for (const f of result.findings) {
        process.stdout.write(`  [${f.severity}] ${f.rule} @ ${f.ref}:${f.line || '-'} — ${f.message}\n`)
      }
    }
    process.stdout.write(`\n${merged.summary.total} finding(s): ` +
      `P0 ${merged.summary.bySeverity.P0}, P1 ${merged.summary.bySeverity.P1}, P2 ${merged.summary.bySeverity.P2}, P3 ${merged.summary.bySeverity.P3}\n`)
    for (const err of merged.errors) process.stderr.write(`error: ${err}\n`)
    for (const note of merged.notes) process.stderr.write(`note: ${note}\n`)
  }

  if (merged.errors.length) return 1
  return merged.findings.length ? 2 : 0
}

main().then((code) => {
  process.exitCode = code
})
