#!/usr/bin/env tsx
/**
 * Rewrite flat Partners-era Cowork path tokens inside instruction / wiki text
 * and `.pib-workspace.json` so they match the nested `partners/` layout.
 *
 * Dry-run by default.
 *
 *   npx tsx scripts/rewrite-cowork-path-references.ts
 *   npx tsx scripts/rewrite-cowork-path-references.ts --commit
 *   npx tsx scripts/rewrite-cowork-path-references.ts --commit --mac-only
 *   npx tsx scripts/rewrite-cowork-path-references.ts --commit --vps-only
 *   npx tsx scripts/rewrite-cowork-path-references.ts --commit --wiki-only
 */
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  PIB_COWORK_NESTING_SLUG,
  VPS_COWORK_ROOT,
  rewriteLegacyFlatCoworkPathsInText,
  rewriteLegacyFlatCoworkPath,
} from '@/lib/client-provisioning/cowork-paths'
import { DEFAULT_PIB_VPS_HOST, shellSingleQuote } from '@/scripts/lib/org-scoped-cowork-migration'

const MAC_COWORK = '/Users/peetstander/Cowork'
const MAC_WIKI = join(MAC_COWORK, 'Cowork')
const TEXT_NAMES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'SOUL.md',
  'SOUL.local.md',
  'AGENTS.local.md',
])
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.turbo',
  '.claude',
  'venv',
  '__pycache__',
])

type Flags = {
  dryRun: boolean
  macOnly: boolean
  vpsOnly: boolean
  wikiOnly: boolean
  skipWiki: boolean
  host: string
}

type FileChange = { path: string; changes: number; kind: 'text' | 'json' }

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    dryRun: true,
    macOnly: false,
    vpsOnly: false,
    wikiOnly: false,
    skipWiki: false,
    host: process.env.PIB_VPS_HOST?.trim() || DEFAULT_PIB_VPS_HOST,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--commit' || arg === '--apply') flags.dryRun = false
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--mac-only') flags.macOnly = true
    else if (arg === '--vps-only') flags.vpsOnly = true
    else if (arg === '--wiki-only') flags.wikiOnly = true
    else if (arg === '--skip-wiki') flags.skipWiki = true
  }
  return flags
}

function walkFiles(root: string, predicate: (name: string, full: string) => boolean, maxDepth = 8): string[] {
  const out: string[] = []
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (SKIP_DIR_NAMES.has(name)) continue
      const full = join(dir, name)
      let stat
      try {
        stat = lstatSync(full)
      } catch {
        continue
      }
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) {
        if (name.startsWith('.') && name !== '.pib-workspace.json') continue
        visit(full, depth + 1)
        continue
      }
      if (stat.isFile() && predicate(name, full)) out.push(full)
    }
  }
  visit(root, 0)
  return out
}

function rewriteTextFile(filePath: string, dryRun: boolean): FileChange | null {
  const before = readFileSync(filePath, 'utf8')
  const { text, changes } = rewriteLegacyFlatCoworkPathsInText(before)
  if (!changes || text === before) return null
  if (!dryRun) writeFileSync(filePath, text, 'utf8')
  return { path: filePath, changes, kind: 'text' }
}

function rewritePibWorkspaceJson(filePath: string, dryRun: boolean): FileChange | null {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
  let changes = 0
  const next: Record<string, unknown> = { ...parsed }
  for (const key of ['localPath', 'vpsPath', 'agentDomainPath', 'localAgentDomainPath'] as const) {
    const value = typeof parsed[key] === 'string' ? String(parsed[key]) : ''
    if (!value) continue
    const rewritten = rewriteLegacyFlatCoworkPath(value)
    if (rewritten && rewritten !== value) {
      next[key] = rewritten
      changes += 1
    }
  }
  if (!changes) return null
  if (!dryRun) writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return { path: filePath, changes, kind: 'json' }
}

function rewriteMacWorkspaceInstructions(dryRun: boolean): FileChange[] {
  const nest = join(MAC_COWORK, PIB_COWORK_NESTING_SLUG)
  if (!existsSync(nest)) return []
  const changes: FileChange[] = []
  for (const company of readdirSync(nest)) {
    const companyRoot = join(nest, company)
    if (!lstatSync(companyRoot).isDirectory() || lstatSync(companyRoot).isSymbolicLink()) continue
    for (const file of walkFiles(companyRoot, (name) => TEXT_NAMES.has(name), 3)) {
      const result = rewriteTextFile(file, dryRun)
      if (result) changes.push(result)
    }
    const manifest = join(companyRoot, '.pib-workspace.json')
    if (existsSync(manifest) && !lstatSync(manifest).isSymbolicLink()) {
      const result = rewritePibWorkspaceJson(manifest, dryRun)
      if (result) changes.push(result)
    }
  }
  return changes
}

function rewriteWiki(dryRun: boolean): FileChange[] {
  if (!existsSync(MAC_WIKI)) return []
  const changes: FileChange[] = []
  for (const file of walkFiles(
    MAC_WIKI,
    (name, full) => name.endsWith('.md') || name.endsWith('.mdc'),
    10,
  )) {
    // Skip enormous generated dumps if any; normal wiki notes only.
    if (relative(MAC_WIKI, file).split('/').length > 8) continue
    const result = rewriteTextFile(file, dryRun)
    if (result) changes.push(result)
  }
  return changes
}

function rewriteVps(flags: Flags): FileChange[] {
  const localScript = resolve(__dirname, 'rewrite-cowork-path-references-vps.py')
  const remoteScript = '/tmp/rewrite-cowork-path-references-vps.py'
  const userHost = `root@${flags.host}`
  const copy = spawnSync(
    'scp',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', localScript, `${userHost}:${remoteScript}`],
    { encoding: 'utf8' },
  )
  if (copy.status !== 0) {
    throw new Error(`VPS script copy failed: ${copy.stderr || copy.stdout || 'no output'}`)
  }
  const result = spawnSync(
    'ssh',
    [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=20',
      userHost,
      `ROOT=${shellSingleQuote(`${VPS_COWORK_ROOT}/${PIB_COWORK_NESTING_SLUG}`)} DRY=${flags.dryRun ? '1' : '0'} python3 ${shellSingleQuote(remoteScript)}`,
    ],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  )
  if (result.status !== 0) {
    throw new Error(`VPS rewrite failed: ${result.stderr || result.stdout || 'no output'}`)
  }
  const lines = result.stdout.trim().split('\n').filter(Boolean)
  const jsonLine = lines[lines.length - 1] || '[]'
  try {
    return JSON.parse(jsonLine) as FileChange[]
  } catch {
    console.warn('Could not parse VPS JSON output; raw tail:', jsonLine.slice(0, 500))
    return []
  }
}

function main() {
  const flags = parseFlags(process.argv.slice(2))
  const doMac = !flags.vpsOnly && !flags.wikiOnly
  const doWiki = !flags.vpsOnly && !flags.macOnly && !flags.skipWiki
  const doVps = !flags.macOnly && !flags.wikiOnly

  console.log(`Mode: ${flags.dryRun ? 'DRY-RUN' : 'COMMIT'}`)
  const all: FileChange[] = []

  if (doMac) {
    const mac = rewriteMacWorkspaceInstructions(flags.dryRun)
    console.log(`Mac workspace instruction files: ${mac.length}`)
    all.push(...mac)
  }
  if (doWiki) {
    const wiki = rewriteWiki(flags.dryRun)
    console.log(`Obsidian wiki markdown files: ${wiki.length}`)
    all.push(...wiki)
  }
  if (doVps) {
    const vps = rewriteVps(flags)
    console.log(`VPS instruction/SOUL files: ${vps.length}`)
    all.push(...vps)
  }

  const totalChanges = all.reduce((sum, row) => sum + row.changes, 0)
  console.log(`Files touched: ${all.length}`)
  console.log(`Path token rewrites: ${totalChanges}`)
  for (const row of all.slice(0, 40)) {
    console.log(`  [${row.kind}] ${row.changes}  ${row.path}`)
  }
  if (all.length > 40) console.log(`  … ${all.length - 40} more`)
  if (flags.dryRun) console.log('Dry-run complete. Re-run with --commit to apply.')
}

if (require.main === module) main()
