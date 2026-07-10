#!/usr/bin/env npx tsx

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

export type SyncDirection = 'pull' | 'push' | 'both'
export type SyncClassification =
  | 'unchanged'
  | 'pull'
  | 'push'
  | 'conflict'
  | 'local_deleted'
  | 'remote_deleted'

export type FileInventory = Record<string, string>
export type SyncBaseline = Record<string, string>

export interface SyncPlanEntry {
  path: string
  classification: SyncClassification
  baselineHash: string | null
  localHash: string | null
  remoteHash: string | null
  action: 'pull' | 'push' | 'none'
  resolution?: 'local' | 'remote'
  reason: string
}

export interface SyncOptions {
  workspaceName: string
  agentDomain: string
  host: string
  user: string
  localRoot: string
  stateRoot: string
  direction: SyncDirection
  apply: boolean
  allowPush: boolean
  json: boolean
  resolutions: Record<string, 'local' | 'remote'>
}

const IGNORED_NAMES = new Set(['.git', '.DS_Store', 'node_modules'])
const SSH_ARGS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15']
const RSYNC_SSH = 'ssh -o BatchMode=yes -o ConnectTimeout=15'

function cleanRelativePath(value: string): string {
  return value.split(sep).join('/')
}

export function slugifyWorkspaceName(name: string): string {
  return name.normalize('NFKD').replace(/[’']/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

export function validateSafeName(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0') || trimmed.includes('\n') || trimmed.includes('\r')) {
    throw new Error(`${label} must be a single safe folder name`)
  }
  return trimmed
}

export function validateHost(value: string): string {
  const trimmed = value.trim()
  if (!/^[a-zA-Z0-9.-]+$/.test(trimmed)) throw new Error('Host contains unsafe characters')
  return trimmed
}

export function validateUser(value: string): string {
  const trimmed = value.trim()
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(trimmed)) throw new Error('SSH user contains unsafe characters')
  return trimmed
}

export function parseSyncArgs(argv: string[]): SyncOptions {
  const read = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const workspaceName = validateSafeName(read('--workspace') ?? '', 'Workspace')
  const agentDomain = validateSafeName(read('--agent-domain') ?? slugifyWorkspaceName(workspaceName), 'Agent domain')
  const direction = (read('--direction') ?? 'pull') as SyncDirection
  if (!['pull', 'push', 'both'].includes(direction)) throw new Error('direction must be pull, push, or both')
  const apply = argv.includes('--apply')
  const allowPush = argv.includes('--allow-push')
  if (apply && direction !== 'pull' && !allowPush) {
    throw new Error('Applying push or both directions requires --allow-push')
  }
  const localRoot = resolve(read('--local-root') ?? join(process.env.HOME ?? '', 'Cowork'))
  const resolutions: Record<string, 'local' | 'remote'> = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--resolve') continue
    const value = argv[index + 1] ?? ''
    const separator = value.lastIndexOf('=')
    const path = separator > 0 ? value.slice(0, separator) : ''
    const choice = separator > 0 ? value.slice(separator + 1) : ''
    if (!path || (choice !== 'local' && choice !== 'remote')) {
      throw new Error('--resolve must use <workspace/path|agent/path>=local|remote')
    }
    if (!path.startsWith('workspace/') && !path.startsWith('agent/')) {
      throw new Error('--resolve path must start with workspace/ or agent/')
    }
    if (path.split('/').some((part) => !part || part === '.' || part === '..' || part.includes('\0') || part.includes('\n') || part.includes('\r'))) {
      throw new Error('--resolve contains an unsafe inventory path')
    }
    resolutions[path] = choice
  }
  if (Object.values(resolutions).includes('local') && direction === 'pull') {
    throw new Error('Resolving a conflict with the local version requires --direction push or both')
  }
  if (Object.values(resolutions).includes('remote') && direction === 'push') {
    throw new Error('Resolving a conflict with the remote version requires --direction pull or both')
  }
  if (apply && Object.values(resolutions).includes('local') && !allowPush) {
    throw new Error('Applying a local conflict resolution requires --allow-push')
  }
  return {
    workspaceName,
    agentDomain,
    host: validateHost(read('--host') ?? process.env.PIB_VPS_HOST ?? '72.61.166.143'),
    user: validateUser(read('--user') ?? process.env.PIB_VPS_USER ?? 'root'),
    localRoot,
    stateRoot: resolve(read('--state-root') ?? join(localRoot, '.pib-workspace-sync')),
    direction,
    apply,
    allowPush,
    json: argv.includes('--json'),
    resolutions,
  }
}

function actionFor(classification: SyncClassification, direction: SyncDirection): 'pull' | 'push' | 'none' {
  if ((classification === 'pull' || classification === 'local_deleted') && (direction === 'pull' || direction === 'both')) return 'pull'
  if (classification === 'push' && (direction === 'push' || direction === 'both')) return 'push'
  return 'none'
}

export function buildSyncPlan(
  local: FileInventory,
  remote: FileInventory,
  baseline: SyncBaseline,
  direction: SyncDirection,
): SyncPlanEntry[] {
  const paths = Array.from(new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(baseline)])).sort()
  return paths.map((path) => {
    const localHash = local[path] ?? null
    const remoteHash = remote[path] ?? null
    const baselineHash = baseline[path] ?? null
    let classification: SyncClassification
    let reason: string

    if (localHash && remoteHash && localHash === remoteHash) {
      classification = 'unchanged'
      reason = 'Local and VPS content match.'
    } else if (!baselineHash) {
      if (remoteHash && !localHash) {
        classification = 'pull'
        reason = 'File exists only on the canonical VPS.'
      } else if (localHash && !remoteHash) {
        classification = 'push'
        reason = 'File exists only locally; push requires explicit approval.'
      } else {
        classification = 'conflict'
        reason = 'Different local and VPS files appeared without a common baseline.'
      }
    } else {
      const localChanged = localHash !== baselineHash
      const remoteChanged = remoteHash !== baselineHash
      if (localChanged && remoteChanged) {
        classification = 'conflict'
        reason = 'Both local and VPS content changed since the common baseline.'
      } else if (remoteChanged) {
        if (!remoteHash) {
          classification = 'remote_deleted'
          reason = 'The canonical VPS file was removed; local deletion is never automatic.'
        } else {
          classification = 'pull'
          reason = 'Only the canonical VPS file changed.'
        }
      } else if (localChanged) {
        if (!localHash) {
          classification = 'local_deleted'
          reason = 'The local mirror file is missing and can be restored from VPS.'
        } else {
          classification = 'push'
          reason = 'Only the local file changed; push requires explicit approval.'
        }
      } else {
        classification = 'conflict'
        reason = 'The file state is inconsistent with the recorded baseline.'
      }
    }

    return {
      path,
      classification,
      baselineHash,
      localHash,
      remoteHash,
      action: actionFor(classification, direction),
      reason,
    }
  })
}

export function applyConflictResolutions(
  plan: SyncPlanEntry[],
  resolutions: Record<string, 'local' | 'remote'>,
): SyncPlanEntry[] {
  const plannedPaths = new Set(plan.map((entry) => entry.path))
  for (const path of Object.keys(resolutions)) {
    if (!plannedPaths.has(path)) throw new Error(`Conflict resolution path was not found: ${path}`)
  }
  return plan.map((entry) => {
    const resolution = resolutions[entry.path]
    if (!resolution) return entry
    if (entry.classification !== 'conflict') {
      throw new Error(`Explicit resolution is only valid for a conflict: ${entry.path}`)
    }
    if (resolution === 'local' && !entry.localHash) throw new Error(`Local conflict version is missing: ${entry.path}`)
    if (resolution === 'remote' && !entry.remoteHash) throw new Error(`Remote conflict version is missing: ${entry.path}`)
    return {
      ...entry,
      action: resolution === 'local' ? 'push' as const : 'pull' as const,
      resolution,
      reason: `${entry.reason} Operator explicitly selected the ${resolution} version.`,
    }
  })
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function inventoryTree(root: string, prefix: string): Promise<FileInventory> {
  const result: FileInventory = {}
  if (!existsSync(root)) return result
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith('.pib-')) continue
      const absolute = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile()) result[`${prefix}/${cleanRelativePath(relative(root, absolute))}`] = await sha256(absolute)
    }
  }
  await walk(root)
  return result
}

export async function buildLocalInventory(options: SyncOptions): Promise<FileInventory> {
  const workspaceRoot = join(options.localRoot, options.workspaceName)
  const agentRoot = join(options.localRoot, 'Cowork', 'agents', options.agentDomain)
  return {
    ...(await inventoryTree(workspaceRoot, 'workspace')),
    ...(await inventoryTree(agentRoot, 'agent')),
  }
}

function run(command: string, args: string[], capture = false, input?: string): string {
  const result = capture
    ? spawnSync(command, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input })
    : spawnSync(command, args, {
        encoding: 'utf8',
        stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
        input,
      })
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${capture ? result.stderr.trim() : ''}`)
  return capture ? result.stdout : ''
}

function remoteRoots(options: SyncOptions) {
  return {
    workspace: `/var/lib/hermes/Cowork/${options.workspaceName}`,
    agent: `/var/lib/hermes/cowork-wiki/agents/${options.agentDomain}`,
  }
}

export function remoteInventoryScript(options: SyncOptions): string {
  const roots = remoteRoots(options)
  const encodedRoots = Buffer.from(JSON.stringify(roots), 'utf8').toString('base64')
  return [
    'import base64,hashlib,json,os',
    `roots=json.loads(base64.b64decode("${encodedRoots}").decode("utf-8"))`,
    'out={}',
    'ignored={".git",".DS_Store","node_modules"}',
    'for prefix,root in roots.items():',
    '  if not os.path.isdir(root): continue',
    '  for base,dirs,files in os.walk(root):',
    '    dirs[:]=[d for d in dirs if d not in ignored and not d.startswith(".pib-")]',
    '    for name in files:',
    '      if name in ignored or name.startswith(".pib-"): continue',
    '      path=os.path.join(base,name)',
    '      if os.path.islink(path): continue',
    '      rel=os.path.relpath(path,root).replace(os.sep,"/")',
    '      h=hashlib.sha256()',
    '      with open(path,"rb") as f:',
    '        for chunk in iter(lambda:f.read(1024*1024),b""): h.update(chunk)',
    '      out[prefix+"/"+rel]=h.hexdigest()',
    'print(json.dumps(out,sort_keys=True))',
  ].join('\n')
}

export function remoteInventoryCommand(options: SyncOptions): string[] {
  return [...SSH_ARGS, `${options.user}@${options.host}`, 'python3', '-']
}

export function buildRemoteInventory(options: SyncOptions): FileInventory {
  return JSON.parse(run('ssh', remoteInventoryCommand(options), true, remoteInventoryScript(options))) as FileInventory
}

function splitInventoryPath(inventoryPath: string): { scope: 'workspace' | 'agent'; parts: string[] } {
  const [rawScope, ...parts] = inventoryPath.split('/')
  if (rawScope !== 'workspace' && rawScope !== 'agent') throw new Error(`Invalid inventory scope: ${rawScope}`)
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0') || part.includes('\n') || part.includes('\r'))) {
    throw new Error(`Unsafe inventory path: ${inventoryPath}`)
  }
  return { scope: rawScope, parts }
}

function localPathFor(options: SyncOptions, inventoryPath: string): string {
  const { scope, parts } = splitInventoryPath(inventoryPath)
  const root = scope === 'workspace'
    ? join(options.localRoot, options.workspaceName)
    : join(options.localRoot, 'Cowork', 'agents', options.agentDomain)
  return join(root, ...parts)
}

function remotePathFor(options: SyncOptions, inventoryPath: string): string {
  const { scope, parts } = splitInventoryPath(inventoryPath)
  return `${remoteRoots(options)[scope]}/${parts.join('/')}`
}

function remoteMkdir(options: SyncOptions, path: string) {
  const encoded = Buffer.from(path, 'utf8').toString('base64')
  const script = `import base64,os\nos.makedirs(base64.b64decode("${encoded}").decode("utf-8"),exist_ok=True)\n`
  run('ssh', [...SSH_ARGS, `${options.user}@${options.host}`, 'python3', '-'], false, script)
}

function quoteRemotePath(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`
}

async function applyPull(options: SyncOptions, entry: SyncPlanEntry, backupRoot: string) {
  const destination = localPathFor(options, entry.path)
  await mkdir(dirname(destination), { recursive: true })
  if (existsSync(destination)) {
    const backup = join(backupRoot, 'local', entry.path)
    await mkdir(dirname(backup), { recursive: true })
    await copyFile(destination, backup)
  }
  run('rsync', ['-a', '-e', RSYNC_SSH, `${options.user}@${options.host}:${quoteRemotePath(remotePathFor(options, entry.path))}`, destination])
}

async function applyPush(options: SyncOptions, entry: SyncPlanEntry, timestamp: string) {
  if (!options.allowPush) throw new Error('Push operation blocked without --allow-push')
  const destination = remotePathFor(options, entry.path)
  remoteMkdir(options, dirname(destination))
  const remoteBackup = `/var/lib/hermes/.pib-sync-backups/${options.agentDomain}/${timestamp}`
  remoteMkdir(options, remoteBackup)
  run('rsync', ['-a', '-e', RSYNC_SSH, '--backup', `--backup-dir=${remoteBackup}`, localPathFor(options, entry.path), `${options.user}@${options.host}:${quoteRemotePath(destination)}`])
}

export function commonBaseline(local: FileInventory, remote: FileInventory): SyncBaseline {
  return Object.fromEntries(Object.entries(local).filter(([path, hash]) => remote[path] === hash))
}

async function loadBaseline(path: string): Promise<SyncBaseline> {
  if (!existsSync(path)) return {}
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { baseline?: SyncBaseline }
  return parsed.baseline ?? {}
}

async function saveState(path: string, options: SyncOptions, baseline: SyncBaseline, plan: SyncPlanEntry[]) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({
    version: 1,
    workspaceName: options.workspaceName,
    agentDomain: options.agentDomain,
    host: options.host,
    updatedAt: new Date().toISOString(),
    baseline,
    unresolved: plan.filter((entry) => entry.classification === 'conflict' || entry.classification === 'remote_deleted'),
  }, null, 2)}\n`, { mode: 0o600 })
}

function summary(plan: SyncPlanEntry[]) {
  return plan.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.classification] = (counts[entry.classification] ?? 0) + 1
    return counts
  }, {})
}

export async function runWorkspaceSync(options: SyncOptions) {
  const statePath = join(options.stateRoot, `${options.agentDomain}.json`)
  const [local, baseline] = await Promise.all([buildLocalInventory(options), loadBaseline(statePath)])
  const remote = buildRemoteInventory(options)
  const plan = buildSyncPlan(local, remote, baseline, options.direction)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupRoot = join(options.stateRoot, 'backups', options.agentDomain, timestamp)

  if (options.apply) {
    for (const entry of plan) {
      if (entry.action === 'pull') await applyPull(options, entry, backupRoot)
      else if (entry.action === 'push') await applyPush(options, entry, timestamp)
    }
    const nextLocal = await buildLocalInventory(options)
    const nextRemote = buildRemoteInventory(options)
    const nextBaseline = { ...baseline, ...commonBaseline(nextLocal, nextRemote) }
    await saveState(statePath, options, nextBaseline, buildSyncPlan(nextLocal, nextRemote, nextBaseline, options.direction))
  }

  return {
    mode: options.apply ? 'apply' : 'plan',
    direction: options.direction,
    workspace: options.workspaceName,
    agentDomain: options.agentDomain,
    statePath,
    summary: summary(plan),
    operations: plan.filter((entry) => entry.action !== 'none'),
    unresolved: plan.filter((entry) => entry.classification === 'conflict' || entry.classification === 'remote_deleted'),
    plan,
  }
}

async function main() {
  const options = parseSyncArgs(process.argv.slice(2))
  const report = await runWorkspaceSync(options)
  if (options.json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`${report.mode.toUpperCase()} ${report.workspace} (${report.direction})`)
    console.log(`Summary: ${JSON.stringify(report.summary)}`)
    for (const entry of report.plan.filter((item) => item.classification !== 'unchanged')) {
      console.log(`${entry.action.padEnd(4)} ${entry.classification.padEnd(14)} ${entry.path} — ${entry.reason}`)
    }
    if (!options.apply) console.log('Plan only. Add --apply to transfer planned files; push/both also requires --allow-push.')
    if (report.unresolved.length) console.log(`${report.unresolved.length} unresolved conflict/deletion item(s); no conflicting content was overwritten.`)
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
