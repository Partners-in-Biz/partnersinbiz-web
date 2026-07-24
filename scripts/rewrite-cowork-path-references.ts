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
import { join, relative } from 'node:path'
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
  const dryFlag = flags.dryRun ? '1' : '0'
  const script = `set -euo pipefail
ROOT=${shellSingleQuote(VPS_COWORK_ROOT + '/' + PIB_COWORK_NESTING_SLUG)}
DRY=${dryFlag}
python3 - <<'PY'
import json, os, re, sys
root = os.environ["ROOT"]
dry = os.environ["DRY"] == "1"
nest = "partners"
text_names = {"AGENTS.md", "CLAUDE.md", "SOUL.md", "SOUL.local.md", "AGENTS.local.md"}
skip = {"node_modules", ".git", ".next", "dist", "build", ".turbo", ".claude", "venv", "__pycache__"}
reserved = {"Cowork", nest, "Partners in Biz — Client Growth", "Side Projects", "YouTube Business"}
patterns = [
    re.compile(r"~/Cowork/[^\\s\`\"'<>\\])|,]+"),
    re.compile(r"/var/lib/hermes/Cowork/[^\\s\`\"'<>\\])|,]+"),
    re.compile(r"/Users/[^/\\s]+/Cowork/[^\\s\`\"'<>\\])|,]+"),
]

def is_legacy(path: str) -> bool:
    m = re.match(r"^(?:~/Cowork|/var/lib/hermes/Cowork|/Users/[^/]+/Cowork)/([^/]+)(?:/.*)?$", path)
    if not m: return False
    return m.group(1) not in reserved and not m.group(1).startswith(".")

def rewrite_path(path: str) -> str | None:
    if not is_legacy(path):
        return None
    if path.startswith("~/Cowork/"):
        rest = path[len("~/Cowork/"):]
        return f"~/Cowork/{nest}/{rest}"
    if path.startswith("/var/lib/hermes/Cowork/"):
        rest = path[len("/var/lib/hermes/Cowork/"):]
        return f"/var/lib/hermes/Cowork/{nest}/{rest}"
    m = re.match(r"^(/Users/[^/]+/Cowork)/(.*)$", path)
    if m:
        return f"{m.group(1)}/{nest}/{m.group(2)}"
    return None

def rewrite_text(text: str):
    changes = 0
    def repl(match: re.Match[str]) -> str:
        nonlocal changes
        raw = match.group(0)
        core, trailing = raw, ""
        while core and core[-1] in ".,;:!?":
            trailing = core[-1] + trailing
            core = core[:-1]
        rewritten = rewrite_path(core)
        if not rewritten or rewritten == core:
            return raw
        changes += 1
        return rewritten + trailing
    out = text
    for pat in patterns:
        out = pat.sub(repl, out)
    return out, changes

changed = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in skip and not d.startswith(".")]
    for name in filenames:
        full = os.path.join(dirpath, name)
        if name in text_names:
            before = open(full, "r", encoding="utf-8", errors="ignore").read()
            after, n = rewrite_text(before)
            if n:
                if not dry:
                    open(full, "w", encoding="utf-8").write(after)
                changed.append({"path": full, "changes": n, "kind": "text"})
        elif name == ".pib-workspace.json":
            try:
                data = json.load(open(full, "r", encoding="utf-8"))
            except Exception:
                continue
            n = 0
            for key in ("localPath", "vpsPath", "agentDomainPath", "localAgentDomainPath"):
                value = data.get(key)
                if isinstance(value, str):
                    rewritten = rewrite_path(value.strip())
                    if rewritten and rewritten != value:
                        data[key] = rewritten
                        n += 1
            if n:
                if not dry:
                    open(full, "w", encoding="utf-8").write(json.dumps(data, indent=2) + "\\n")
                changed.append({"path": full, "changes": n, "kind": "json"})

# Hermes specialist SOUL files that hardcode Partners paths
profiles = "/var/lib/hermes/profiles"
if os.path.isdir(profiles):
    for name in os.listdir(profiles):
        soul = os.path.join(profiles, name, "SOUL.md")
        if not os.path.isfile(soul):
            continue
        before = open(soul, "r", encoding="utf-8", errors="ignore").read()
        after, n = rewrite_text(before)
        if n:
            if not dry:
                open(soul, "w", encoding="utf-8").write(after)
            changed.append({"path": soul, "changes": n, "kind": "text"})

print(json.dumps(changed))
PY`
  const envPrefix = `ROOT=${shellSingleQuote(`${VPS_COWORK_ROOT}/${PIB_COWORK_NESTING_SLUG}`)} DRY=${dryFlag} `
  const result = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', `root@${flags.host}`, envPrefix + script],
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
