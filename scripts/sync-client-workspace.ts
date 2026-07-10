#!/usr/bin/env npx tsx

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

export type SyncDirection = 'pull' | 'push' | 'both'
export type SyncClassification = 'unchanged' | 'pull' | 'push' | 'conflict' | 'local_deleted' | 'remote_deleted'
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
  pushWorkspaceId?: string
  json: boolean
  planId?: string
  approvedPaths: string[]
  resolutions: Record<string, 'local' | 'remote'>
  remoteIdentity?: RemoteWorkspaceIdentity
}

export interface RemoteWorkspaceIdentity {
  schemaVersion: number
  workspaceId: string
  orgId: string
  agentDomain: string
  vpsPath: string
  agentDomainPath: string
  sourceOfTruth: 'vps'
  manifestHash: string
  canonicalWorkspaceRoot: string
  canonicalAgentRoot: string
}

interface RemoteSnapshot {
  identity: RemoteWorkspaceIdentity
  inventory: FileInventory
}

interface SyncIdentity {
  workspaceName: string
  agentDomain: string
  host: string
  user: string
  localRoot: string
  remote: RemoteWorkspaceIdentity
}

interface PersistedPlan {
  version: 2
  id: string
  createdAt: string
  expiresAt: string
  identity: SyncIdentity
  direction: SyncDirection
  localInventory: FileInventory
  remoteInventory: FileInventory
  baseline: SyncBaseline
  plan: SyncPlanEntry[]
  digest: string
}

interface OperationResult {
  path: string
  action: 'pull' | 'push'
  status: 'pending' | 'running' | 'completed' | 'failed'
  expectedLocalHash: string | null
  expectedRemoteHash: string | null
  backupPath?: string
  backupHash?: string
  verifiedHash?: string
  error?: string
}

interface ApplyJournal {
  version: 1
  planId: string
  identity: SyncIdentity
  startedAt: string
  updatedAt: string
  status: 'running' | 'completed' | 'failed'
  approvedPaths: string[]
  operations: OperationResult[]
}

const IGNORED_NAMES = new Set(['.git', '.DS_Store', 'node_modules'])
const SSH_ARGS = [
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=15',
  '-o', 'StrictHostKeyChecking=yes',
]
const RSYNC_SSH = 'ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes'
const PLAN_TTL_MS = 30 * 60 * 1000

function cleanRelativePath(value: string): string {
  return value.split(sep).join('/')
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function stableInventory(inventory: FileInventory): FileInventory {
  return Object.fromEntries(Object.entries(inventory).sort(([a], [b]) => a.localeCompare(b)))
}

function inventoriesEqual(left: FileInventory, right: FileInventory): boolean {
  return JSON.stringify(stableInventory(left)) === JSON.stringify(stableInventory(right))
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

function readRepeated(argv: string[], flag: string): string[] {
  const values: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag) values.push(argv[index + 1] ?? '')
  }
  return values
}

function splitInventoryPath(inventoryPath: string): { scope: 'workspace' | 'agent'; parts: string[] } {
  const [rawScope, ...parts] = inventoryPath.split('/')
  if (rawScope !== 'workspace' && rawScope !== 'agent') throw new Error(`Invalid inventory scope: ${rawScope}`)
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0') || part.includes('\n') || part.includes('\r'))) {
    throw new Error(`Unsafe inventory path: ${inventoryPath}`)
  }
  if (extname(parts.at(-1) ?? '').toLowerCase() !== '.md') {
    throw new Error(`Only Markdown files are eligible for Workspace sync: ${inventoryPath}`)
  }
  return { scope: rawScope, parts }
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
  const pushWorkspaceId = read('--confirm-workspace')
  if (allowPush && !pushWorkspaceId) throw new Error('--allow-push requires --confirm-workspace <manifest workspaceId>')
  if (!allowPush && pushWorkspaceId) throw new Error('--confirm-workspace is only valid with --allow-push')
  const planId = read('--plan')
  if (apply && (!planId || !/^[a-f0-9]{64}$/.test(planId))) {
    throw new Error('Apply requires --plan with the immutable 64-character plan id')
  }
  if (!apply && planId) throw new Error('--plan is only valid with --apply')

  const approvedPaths = readRepeated(argv, '--approve-path')
  for (const path of approvedPaths) splitInventoryPath(path)
  if (apply && approvedPaths.length === 0) throw new Error('Apply requires at least one explicit --approve-path')
  if (!apply && approvedPaths.length > 0) throw new Error('--approve-path is only valid with --apply')

  const resolutions: Record<string, 'local' | 'remote'> = {}
  for (const value of readRepeated(argv, '--resolve')) {
    const separator = value.lastIndexOf('=')
    const path = separator > 0 ? value.slice(0, separator) : ''
    const choice = separator > 0 ? value.slice(separator + 1) : ''
    splitInventoryPath(path)
    if (choice !== 'local' && choice !== 'remote') {
      throw new Error('--resolve must use <workspace/path.md|agent/path.md>=local|remote')
    }
    resolutions[path] = choice
  }
  if (apply && Object.keys(resolutions).length > 0) throw new Error('Conflict resolutions must be recorded when the immutable plan is created')
  if (Object.values(resolutions).includes('local') && direction === 'pull') {
    throw new Error('Resolving with local content requires --direction push or both')
  }
  if (Object.values(resolutions).includes('remote') && direction === 'push') {
    throw new Error('Resolving with VPS content requires --direction pull or both')
  }

  const localRoot = resolve(read('--local-root') ?? join(process.env.HOME ?? '', 'Cowork'))
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
    pushWorkspaceId,
    json: argv.includes('--json'),
    planId,
    approvedPaths: Array.from(new Set(approvedPaths)),
    resolutions,
  }
}

function actionFor(classification: SyncClassification, direction: SyncDirection): 'pull' | 'push' | 'none' {
  if ((classification === 'pull' || classification === 'local_deleted') && (direction === 'pull' || direction === 'both')) return 'pull'
  if (classification === 'push' && (direction === 'push' || direction === 'both')) return 'push'
  return 'none'
}

export function buildSyncPlan(local: FileInventory, remote: FileInventory, baseline: SyncBaseline, direction: SyncDirection): SyncPlanEntry[] {
  const paths = Array.from(new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(baseline)])).sort()
  return paths.map((path) => {
    const localHash = local[path] ?? null
    const remoteHash = remote[path] ?? null
    const baselineHash = baseline[path] ?? null
    let classification: SyncClassification
    let reason: string
    if (!localHash && !remoteHash) {
      classification = 'unchanged'
      reason = 'The file is absent on both sides; its old baseline tombstone can be removed.'
    } else if (localHash && remoteHash && localHash === remoteHash) {
      classification = 'unchanged'
      reason = 'Local and VPS content match.'
    } else if (!baselineHash) {
      if (remoteHash && !localHash) {
        classification = 'pull'
        reason = 'File exists only on the canonical VPS.'
      } else if (localHash && !remoteHash) {
        classification = 'push'
        reason = 'File exists only locally; push requires path-scoped approval.'
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
          reason = 'Only the local file changed; push requires path-scoped approval.'
        }
      } else {
        classification = 'conflict'
        reason = 'The file state is inconsistent with the recorded baseline.'
      }
    }
    return { path, classification, baselineHash, localHash, remoteHash, action: actionFor(classification, direction), reason }
  })
}

export function applyConflictResolutions(plan: SyncPlanEntry[], resolutions: Record<string, 'local' | 'remote'>): SyncPlanEntry[] {
  const plannedPaths = new Set(plan.map((entry) => entry.path))
  for (const path of Object.keys(resolutions)) {
    if (!plannedPaths.has(path)) throw new Error(`Conflict resolution path was not found: ${path}`)
  }
  return plan.map((entry) => {
    const resolution = resolutions[entry.path]
    if (!resolution) return entry
    if (entry.classification !== 'conflict') throw new Error(`Explicit resolution is only valid for a conflict: ${entry.path}`)
    if (resolution === 'local' && !entry.localHash) throw new Error(`Local conflict version is missing: ${entry.path}`)
    if (resolution === 'remote' && !entry.remoteHash) throw new Error(`VPS conflict version is missing: ${entry.path}`)
    return {
      ...entry,
      action: resolution === 'local' ? 'push' : 'pull',
      resolution,
      reason: `${entry.reason} Operator explicitly selected the ${resolution} version in this plan.`,
    }
  })
}

function isEligibleMarkdown(name: string): boolean {
  return extname(name).toLowerCase() === '.md' && !name.startsWith('.pib-')
}

async function assertNoSymlinkAncestors(path: string, root: string): Promise<void> {
  const absoluteRoot = resolve(root)
  const absolutePath = resolve(path)
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error(`Path escapes its approved local root: ${path}`)
  }
  let cursor = absoluteRoot
  const segments = relative(absoluteRoot, absolutePath).split(sep).filter(Boolean)
  const check = [cursor, ...segments.map((segment) => (cursor = join(cursor, segment)))]
  for (const candidate of check) {
    if (!existsSync(candidate)) continue
    const info = await lstat(candidate)
    if (info.isSymbolicLink()) throw new Error(`Symlink paths are not allowed in Workspace sync: ${candidate}`)
  }

  const canonicalize = async (candidate: string): Promise<string> => {
    let existing = candidate
    const missingSegments: string[] = []
    while (!existsSync(existing)) {
      const parent = dirname(existing)
      if (parent === existing) throw new Error(`Cannot resolve local path containment for ${candidate}`)
      missingSegments.unshift(basename(existing))
      existing = parent
    }
    return resolve(await realpath(existing), ...missingSegments)
  }
  const canonicalRoot = await canonicalize(absoluteRoot)
  const canonicalPath = await canonicalize(absolutePath)
  if (canonicalPath !== canonicalRoot && !canonicalPath.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error(`Path escapes its canonical local root: ${path}`)
  }
}

async function inventoryTree(root: string, prefix: 'workspace' | 'agent'): Promise<FileInventory> {
  const result: FileInventory = {}
  if (!existsSync(root)) return result
  await assertNoSymlinkAncestors(root, root)
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith('.pib-')) continue
      const absolute = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Symlink encountered in Workspace sync tree: ${absolute}`)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile() && isEligibleMarkdown(entry.name)) {
        result[`${prefix}/${cleanRelativePath(relative(root, absolute))}`] = await sha256File(absolute)
      }
    }
  }
  await walk(root)
  return stableInventory(result)
}

function localRoots(options: SyncOptions) {
  return {
    workspace: join(options.localRoot, options.workspaceName),
    agent: join(options.localRoot, 'Cowork', 'agents', options.agentDomain),
  }
}

export async function buildLocalInventory(options: SyncOptions): Promise<FileInventory> {
  const roots = localRoots(options)
  return { ...(await inventoryTree(roots.workspace, 'workspace')), ...(await inventoryTree(roots.agent, 'agent')) }
}

function run(command: string, args: string[], capture = false, input?: string): string {
  const result = capture
    ? spawnSync(command, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input })
    : spawnSync(command, args, { encoding: 'utf8', stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'], input })
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${String(result.stderr ?? '').trim()}`)
  return capture ? String(result.stdout) : ''
}

function remoteRoots(options: SyncOptions) {
  return {
    workspace: `/var/lib/hermes/Cowork/${options.workspaceName}`,
    agent: `/var/lib/hermes/cowork-wiki/agents/${options.agentDomain}`,
  }
}

export function remoteInventoryScript(options: SyncOptions): string {
  const encodedConfig = Buffer.from(JSON.stringify({
    requestedAgentDomain: options.agentDomain,
    expected: remoteRoots(options),
    approvedParents: {
      workspace: '/var/lib/hermes/Cowork',
      agent: '/var/lib/hermes/cowork-wiki/agents',
    },
  }), 'utf8').toString('base64')
  return [
    'import base64,hashlib,json,os,stat,sys',
    `config=json.loads(base64.b64decode("${encodedConfig}").decode("utf-8"))`,
    'expected=config["expected"]; approved=config["approvedParents"]',
    'manifest_path=os.path.join(expected["workspace"],".pib-workspace.json")',
    'if os.path.islink(manifest_path) or not os.path.isfile(manifest_path): raise RuntimeError("missing or unsafe remote Workspace manifest")',
    'with open(manifest_path,"rb") as f: manifest_bytes=f.read()',
    'manifest_hash=hashlib.sha256(manifest_bytes).hexdigest()',
    'try: manifest=json.loads(manifest_bytes.decode("utf-8"))',
    'except Exception as error: raise RuntimeError("invalid remote Workspace manifest JSON") from error',
    'if not isinstance(manifest,dict): raise RuntimeError("remote Workspace manifest must be an object")',
    'required=("workspaceId","orgId","agentDomain","vpsPath","agentDomainPath","sourceOfTruth")',
    'if type(manifest.get("schemaVersion")) is not int or manifest["schemaVersion"] != 1: raise RuntimeError("unsupported remote Workspace manifest schemaVersion")',
    'for field in required:',
    '  value=manifest.get(field)',
    '  if not isinstance(value,str) or not value.strip() or value != value.strip() or any(c in value for c in ("\\x00","\\n","\\r")): raise RuntimeError("invalid remote Workspace manifest field: "+field)',
    'if manifest["agentDomain"] != config["requestedAgentDomain"]: raise RuntimeError("remote Workspace manifest agentDomain mismatch")',
    'if manifest["sourceOfTruth"] != "vps": raise RuntimeError("remote Workspace manifest sourceOfTruth must be vps")',
    'canonical={"workspace":os.path.realpath(manifest["vpsPath"]),"agent":os.path.realpath(manifest["agentDomainPath"])}',
    'expected_canonical={key:os.path.realpath(value) for key,value in expected.items()}',
    'approved_canonical={key:os.path.realpath(value) for key,value in approved.items()}',
    'for key in ("workspace","agent"):',
    '  root=canonical[key]; parent=approved_canonical[key]',
    '  if root != expected_canonical[key]: raise RuntimeError("remote Workspace manifest canonical "+key+" root mismatch")',
    '  if root == parent or not root.startswith(parent+os.sep): raise RuntimeError("remote Workspace manifest "+key+" root escapes approved parent")',
    '  if not os.path.isdir(root): raise RuntimeError("missing remote Workspace "+key+" root")',
    'roots=canonical',
    'out={}',
    'ignored={".git",".DS_Store","node_modules"}',
    'for prefix,root in roots.items():',
    '  for base,dirs,files in os.walk(root,followlinks=False):',
    '    for d in list(dirs):',
    '      p=os.path.join(base,d)',
    '      if d in ignored or d.startswith(".pib-"): dirs.remove(d)',
    '      elif os.path.islink(p): raise RuntimeError("symlink in sync tree: "+p)',
    '    for name in files:',
    '      if name in ignored or name.startswith(".pib-") or not name.lower().endswith(".md"): continue',
    '      path=os.path.join(base,name)',
    '      if os.path.islink(path): raise RuntimeError("symlink in sync tree: "+path)',
    '      rel=os.path.relpath(path,root).replace(os.sep,"/")',
    '      h=hashlib.sha256()',
    '      with open(path,"rb") as f:',
    '        for chunk in iter(lambda:f.read(1024*1024),b""): h.update(chunk)',
    '      out[prefix+"/"+rel]=h.hexdigest()',
    'identity={"schemaVersion":manifest["schemaVersion"],"workspaceId":manifest["workspaceId"],"orgId":manifest["orgId"],"agentDomain":manifest["agentDomain"],"vpsPath":manifest["vpsPath"],"agentDomainPath":manifest["agentDomainPath"],"sourceOfTruth":manifest["sourceOfTruth"],"manifestHash":manifest_hash,"canonicalWorkspaceRoot":canonical["workspace"],"canonicalAgentRoot":canonical["agent"]}',
    'print(json.dumps({"identity":identity,"inventory":out},sort_keys=True))',
  ].join('\n')
}

export function remoteInventoryCommand(options: SyncOptions): string[] {
  return [...SSH_ARGS, `${options.user}@${options.host}`, 'python3', '-']
}

function validateRemoteSnapshot(value: unknown): RemoteSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Remote Workspace snapshot must be an object')
  const snapshot = value as { identity?: Record<string, unknown>; inventory?: unknown }
  const identity = snapshot.identity
  if (!identity || typeof identity !== 'object') throw new Error('Remote Workspace snapshot is missing authoritative identity')
  const requiredStrings = ['workspaceId', 'orgId', 'agentDomain', 'vpsPath', 'agentDomainPath', 'manifestHash', 'canonicalWorkspaceRoot', 'canonicalAgentRoot'] as const
  if (identity.schemaVersion !== 1) throw new Error('Remote Workspace manifest schemaVersion must be 1')
  for (const field of requiredStrings) {
    if (typeof identity[field] !== 'string' || !(identity[field] as string).trim() || identity[field] !== (identity[field] as string).trim()) {
      throw new Error(`Remote Workspace identity has invalid ${field}`)
    }
  }
  if (identity.sourceOfTruth !== 'vps') throw new Error('Remote Workspace manifest sourceOfTruth must be vps')
  if (!/^[a-f0-9]{64}$/.test(identity.manifestHash as string)) throw new Error('Remote Workspace manifest hash is invalid')
  if (!snapshot.inventory || typeof snapshot.inventory !== 'object' || Array.isArray(snapshot.inventory)) {
    throw new Error('Remote Workspace inventory is invalid')
  }
  for (const [path, hash] of Object.entries(snapshot.inventory as Record<string, unknown>)) {
    splitInventoryPath(path)
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Remote inventory hash is invalid: ${path}`)
  }
  return { identity: identity as unknown as RemoteWorkspaceIdentity, inventory: stableInventory(snapshot.inventory as FileInventory) }
}

export function buildRemoteSnapshot(options: SyncOptions): RemoteSnapshot {
  return validateRemoteSnapshot(JSON.parse(run('ssh', remoteInventoryCommand(options), true, remoteInventoryScript(options))))
}

export function buildRemoteInventory(options: SyncOptions): FileInventory {
  return buildRemoteSnapshot(options).inventory
}

function localPathFor(options: SyncOptions, inventoryPath: string): string {
  const { scope, parts } = splitInventoryPath(inventoryPath)
  return join(localRoots(options)[scope], ...parts)
}

function remotePathFor(options: SyncOptions, inventoryPath: string): string {
  const { scope, parts } = splitInventoryPath(inventoryPath)
  return `${remoteRoots(options)[scope]}/${parts.join('/')}`
}

function quoteRemotePath(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`
}

function remoteSafetyScript(options: SyncOptions, inventoryPath: string, createParent: boolean): string {
  const { scope } = splitInventoryPath(inventoryPath)
  const payload = Buffer.from(JSON.stringify({ root: remoteRoots(options)[scope], path: remotePathFor(options, inventoryPath), createParent }), 'utf8').toString('base64')
  return [
    'import base64,json,os',
    `p=json.loads(base64.b64decode("${payload}").decode("utf-8"))`,
    'root=os.path.abspath(p["root"]); path=os.path.abspath(p["path"])',
    'if path==root or not path.startswith(root+os.sep): raise RuntimeError("path escapes approved root")',
    'cursor=root',
    'if os.path.lexists(cursor) and os.path.islink(cursor): raise RuntimeError("sync root is a symlink")',
    'for part in os.path.relpath(os.path.dirname(path),root).split(os.sep):',
    '  if part in ("","."): continue',
    '  cursor=os.path.join(cursor,part)',
    '  if os.path.lexists(cursor) and os.path.islink(cursor): raise RuntimeError("symlink ancestor: "+cursor)',
    'if p["createParent"]: os.makedirs(os.path.dirname(path),exist_ok=True)',
    'if os.path.lexists(path) and os.path.islink(path): raise RuntimeError("destination is a symlink")',
  ].join('\n')
}

function assertRemoteSafe(options: SyncOptions, path: string, createParent: boolean) {
  run('ssh', remoteInventoryCommand(options), false, remoteSafetyScript(options, path, createParent))
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}

function identityFor(options: SyncOptions, remote: RemoteWorkspaceIdentity): SyncIdentity {
  return {
    workspaceName: options.workspaceName,
    agentDomain: options.agentDomain,
    host: options.host,
    user: options.user,
    localRoot: realpathSync(options.localRoot),
    remote,
  }
}

function requestedIdentityMatches(options: SyncOptions, identity: SyncIdentity): boolean {
  return identity.workspaceName === options.workspaceName
    && identity.agentDomain === options.agentDomain
    && identity.host === options.host
    && identity.user === options.user
    && identity.localRoot === realpathSync(options.localRoot)
}

function identitiesEqual(left: SyncIdentity | RemoteWorkspaceIdentity, right: SyncIdentity | RemoteWorkspaceIdentity): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function identityKey(identity: SyncIdentity): string {
  return sha256Text(JSON.stringify(identity))
}

function statePathFor(options: SyncOptions, identity: SyncIdentity): string {
  return join(options.stateRoot, 'states', `${identityKey(identity)}.json`)
}

async function loadBaseline(options: SyncOptions, identity: SyncIdentity): Promise<SyncBaseline> {
  const path = statePathFor(options, identity)
  if (!existsSync(path)) return {}
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { identity?: SyncIdentity; baseline?: SyncBaseline }
  if (!parsed.identity || !identitiesEqual(parsed.identity, identity)) {
    throw new Error('Sync-state identity does not match this authoritative Workspace target')
  }
  return parsed.baseline ?? {}
}

function planDigest(plan: Omit<PersistedPlan, 'id' | 'digest'>): string {
  return sha256Text(JSON.stringify(plan))
}

async function persistPlan(options: SyncOptions, identity: SyncIdentity, localInventory: FileInventory, remoteInventory: FileInventory, baseline: SyncBaseline, plan: SyncPlanEntry[]): Promise<PersistedPlan> {
  const createdAt = new Date()
  const body: Omit<PersistedPlan, 'id' | 'digest'> = {
    version: 2,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + PLAN_TTL_MS).toISOString(),
    identity,
    direction: options.direction,
    localInventory,
    remoteInventory,
    baseline,
    plan,
  }
  const digest = planDigest(body)
  const persisted: PersistedPlan = { ...body, id: digest, digest }
  const path = join(options.stateRoot, 'plans', `${digest}.json`)
  if (!existsSync(path)) await atomicWrite(path, persisted)
  return persisted
}

async function loadPlan(options: SyncOptions): Promise<PersistedPlan> {
  const path = join(options.stateRoot, 'plans', `${options.planId}.json`)
  if (!existsSync(path)) throw new Error(`Immutable plan not found: ${options.planId}`)
  const persisted = JSON.parse(await readFile(path, 'utf8')) as PersistedPlan
  const { id: _id, digest: _digest, ...body } = persisted
  const expectedDigest = planDigest(body)
  if (persisted.id !== expectedDigest || persisted.digest !== expectedDigest || persisted.id !== options.planId) {
    throw new Error('Immutable plan digest verification failed')
  }
  if (Date.parse(persisted.expiresAt) <= Date.now()) throw new Error('Immutable plan has expired; create and review a new plan')
  if (!requestedIdentityMatches(options, persisted.identity)) {
    throw new Error('Immutable plan identity does not match the requested Workspace target')
  }
  return persisted
}

export function commonBaseline(local: FileInventory, remote: FileInventory): SyncBaseline {
  return Object.fromEntries(Object.entries(local).filter(([path, hash]) => remote[path] === hash))
}

async function localBackup(options: SyncOptions, path: string, journalId: string): Promise<{ backupPath?: string; backupHash?: string }> {
  const source = localPathFor(options, path)
  if (!existsSync(source)) return {}
  const backupPath = join(options.stateRoot, 'backups', journalId, 'local', path)
  await mkdir(dirname(backupPath), { recursive: true })
  await copyFile(source, backupPath)
  return { backupPath, backupHash: await sha256File(backupPath) }
}

function remoteBackup(options: SyncOptions, path: string, journalId: string): { backupPath?: string; backupHash?: string } {
  const { scope } = splitInventoryPath(path)
  const payload = Buffer.from(JSON.stringify({
    root: remoteRoots(options)[scope],
    source: remotePathFor(options, path),
    backupRoot: `/var/lib/hermes/.pib-sync-backups/${options.agentDomain}/${journalId}`,
    relativePath: path,
  }), 'utf8').toString('base64')
  const script = [
    'import base64,hashlib,json,os,shutil',
    `p=json.loads(base64.b64decode("${payload}").decode("utf-8"))`,
    'root=os.path.abspath(p["root"]); source=os.path.abspath(p["source"])',
    'if not source.startswith(root+os.sep): raise RuntimeError("backup source escapes approved root")',
    'if not os.path.exists(source): print("{}"); raise SystemExit(0)',
    'if os.path.islink(source): raise RuntimeError("backup source is a symlink")',
    'dest=os.path.join(p["backupRoot"],p["relativePath"])',
    'os.makedirs(os.path.dirname(dest),exist_ok=True)',
    'shutil.copy2(source,dest)',
    'h=hashlib.sha256()',
    'with open(dest,"rb") as f:',
    '  for chunk in iter(lambda:f.read(1024*1024),b""): h.update(chunk)',
    'print(json.dumps({"backupPath":dest,"backupHash":h.hexdigest()}))',
  ].join('\n')
  return JSON.parse(run('ssh', remoteInventoryCommand(options), true, script)) as { backupPath?: string; backupHash?: string }
}

async function applyPull(options: SyncOptions, entry: SyncPlanEntry, journalId: string): Promise<{ backupPath?: string; backupHash?: string }> {
  const destination = localPathFor(options, entry.path)
  const { scope } = splitInventoryPath(entry.path)
  await assertNoSymlinkAncestors(destination, localRoots(options)[scope])
  const backup = await localBackup(options, entry.path, journalId)
  await mkdir(dirname(destination), { recursive: true })
  assertRemoteSafe(options, entry.path, false)
  run('rsync', ['-a', '-e', RSYNC_SSH, `${options.user}@${options.host}:${quoteRemotePath(remotePathFor(options, entry.path))}`, destination])
  return backup
}

async function applyPush(options: SyncOptions, entry: SyncPlanEntry, journalId: string, workspaceId: string): Promise<{ backupPath?: string; backupHash?: string }> {
  if (!options.allowPush) throw new Error('Push operation blocked without --allow-push')
  if (options.pushWorkspaceId !== workspaceId) {
    throw new Error(`Push confirmation must match manifest workspaceId: ${workspaceId}`)
  }
  const source = localPathFor(options, entry.path)
  const { scope } = splitInventoryPath(entry.path)
  await assertNoSymlinkAncestors(source, localRoots(options)[scope])
  assertRemoteSafe(options, entry.path, true)
  const backup = remoteBackup(options, entry.path, journalId)
  run('rsync', ['-a', '-e', RSYNC_SSH, source, `${options.user}@${options.host}:${quoteRemotePath(remotePathFor(options, entry.path))}`])
  return backup
}

function summary(plan: SyncPlanEntry[]) {
  return plan.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.classification] = (counts[entry.classification] ?? 0) + 1
    return counts
  }, {})
}

async function createPlan(options: SyncOptions) {
  const remoteSnapshot = buildRemoteSnapshot(options)
  const identity = identityFor(options, remoteSnapshot.identity)
  const [local, baseline] = await Promise.all([buildLocalInventory(options), loadBaseline(options, identity)])
  const remote = remoteSnapshot.inventory
  const plan = applyConflictResolutions(buildSyncPlan(local, remote, baseline, options.direction), options.resolutions)
  const persisted = await persistPlan(options, identity, local, remote, baseline, plan)
  return {
    mode: 'plan' as const,
    planId: persisted.id,
    expiresAt: persisted.expiresAt,
    workspaceId: identity.remote.workspaceId,
    statePath: statePathFor(options, identity),
    summary: summary(plan),
    operations: plan.filter((entry) => entry.action !== 'none'),
    unresolved: plan.filter((entry) => (entry.classification === 'conflict' && !entry.resolution) || entry.classification === 'remote_deleted'),
    plan,
  }
}

function assertAuthoritativeRemoteIdentity(actual: RemoteWorkspaceIdentity, expected: RemoteWorkspaceIdentity): void {
  if (!identitiesEqual(actual, expected)) {
    throw new Error('Authoritative remote Workspace manifest identity changed after planning')
  }
}

async function writeBaselineState(options: SyncOptions, persisted: PersistedPlan, baseline: SyncBaseline, journalPath: string): Promise<void> {
  await atomicWrite(statePathFor(options, persisted.identity), {
    version: 2,
    identity: persisted.identity,
    updatedAt: new Date().toISOString(),
    baseline,
    lastPlanId: persisted.id,
    lastJournalPath: journalPath,
  })
}

async function applyPersistedPlan(options: SyncOptions) {
  const persisted = await loadPlan(options)
  const approved = new Set(options.approvedPaths)
  const operations = persisted.plan.filter((entry) => entry.action !== 'none')
  for (const path of approved) {
    if (!operations.some((entry) => entry.path === path)) throw new Error(`Approved path is not an operation in the immutable plan: ${path}`)
  }
  const selected = operations.filter((entry) => approved.has(entry.path))
  if (selected.some((entry) => entry.action === 'push')) {
    if (!options.allowPush) throw new Error('Applying approved push paths requires --allow-push')
    if (options.pushWorkspaceId !== persisted.identity.remote.workspaceId) {
      throw new Error(`Push confirmation must match manifest workspaceId: ${persisted.identity.remote.workspaceId}`)
    }
  }

  const initialRemote = buildRemoteSnapshot(options)
  assertAuthoritativeRemoteIdentity(initialRemote.identity, persisted.identity.remote)
  const localNow = await buildLocalInventory(options)
  if (!inventoriesEqual(localNow, persisted.localInventory) || !inventoriesEqual(initialRemote.inventory, persisted.remoteInventory)) {
    throw new Error('Immutable plan is stale: local or VPS inventory changed after planning')
  }

  const journalId = `${persisted.id.slice(0, 12)}-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const journalPath = join(options.stateRoot, 'journals', `${journalId}.json`)
  const journal: ApplyJournal = {
    version: 1,
    planId: persisted.id,
    identity: persisted.identity,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'running',
    approvedPaths: [...approved].sort(),
    operations: selected.map((entry) => ({
      path: entry.path,
      action: entry.action as 'pull' | 'push',
      status: 'pending',
      expectedLocalHash: entry.localHash,
      expectedRemoteHash: entry.remoteHash,
    })),
  }
  await atomicWrite(journalPath, journal)
  const advancedBaseline: SyncBaseline = {
    ...persisted.baseline,
    ...commonBaseline(persisted.localInventory, persisted.remoteInventory),
  }
  // The immutable snapshots were just revalidated, so every currently
  // identical file is a trustworthy three-way ancestor even when no transfer
  // is selected. Persist these anchors before operations so a later one-sided
  // edit is not misclassified as an unknown two-sided conflict.
  await writeBaselineState(options, persisted, advancedBaseline, journalPath)

  try {
    for (let index = 0; index < selected.length; index += 1) {
      const entry = selected[index]
      const result = journal.operations[index]
      result.status = 'running'
      journal.updatedAt = new Date().toISOString()
      await atomicWrite(journalPath, journal)

      const beforeRemote = buildRemoteSnapshot(options)
      assertAuthoritativeRemoteIdentity(beforeRemote.identity, persisted.identity.remote)
      const beforeLocal = await buildLocalInventory(options)
      if ((beforeLocal[entry.path] ?? null) !== entry.localHash || (beforeRemote.inventory[entry.path] ?? null) !== entry.remoteHash) {
        throw new Error(`Source or destination changed before approved operation: ${entry.path}`)
      }

      const backup = entry.action === 'pull'
        ? await applyPull(options, entry, journalId)
        : await applyPush(options, entry, journalId, persisted.identity.remote.workspaceId)
      Object.assign(result, backup)

      const afterRemote = buildRemoteSnapshot(options)
      assertAuthoritativeRemoteIdentity(afterRemote.identity, persisted.identity.remote)
      const afterLocal = await buildLocalInventory(options)
      const expected = entry.action === 'pull' ? entry.remoteHash : entry.localHash
      if (!expected || afterLocal[entry.path] !== expected || afterRemote.inventory[entry.path] !== expected) {
        throw new Error(`Checksum verification failed after ${entry.action}: ${entry.path}`)
      }

      result.verifiedHash = expected
      advancedBaseline[entry.path] = expected
      await writeBaselineState(options, persisted, advancedBaseline, journalPath)
      result.status = 'completed'
      journal.updatedAt = new Date().toISOString()
      await atomicWrite(journalPath, journal)
    }
    journal.status = 'completed'
    journal.updatedAt = new Date().toISOString()
    await atomicWrite(journalPath, journal)
  } catch (error) {
    const running = journal.operations.find((operation) => operation.status === 'running')
    if (running) {
      running.status = 'failed'
      running.error = error instanceof Error ? error.message : String(error)
    }
    journal.status = 'failed'
    journal.updatedAt = new Date().toISOString()
    await atomicWrite(journalPath, journal)
    throw error
  }

  return {
    mode: 'apply' as const,
    planId: persisted.id,
    journalPath,
    operations: journal.operations,
    status: journal.status,
  }
}

export async function runWorkspaceSync(options: SyncOptions) {
  const result = options.apply ? await applyPersistedPlan(options) : await createPlan(options)
  return {
    ...result,
    direction: options.apply ? undefined : options.direction,
    workspace: options.workspaceName,
    agentDomain: options.agentDomain,
  }
}

async function main() {
  const options = parseSyncArgs(process.argv.slice(2))
  const report = await runWorkspaceSync(options)
  if (options.json) console.log(JSON.stringify(report, null, 2))
  else if (report.mode === 'plan') {
    console.log(`PLAN ${report.workspace} (${report.direction})`)
    console.log(`Plan id: ${report.planId}`)
    console.log(`Expires: ${report.expiresAt}`)
    console.log(`Summary: ${JSON.stringify(report.summary)}`)
    for (const entry of report.plan.filter((item) => item.classification !== 'unchanged')) {
      console.log(`${entry.action.padEnd(4)} ${entry.classification.padEnd(14)} ${entry.path} — ${entry.reason}`)
    }
    console.log('Review this immutable plan. Apply only selected paths with --apply --plan <id> --approve-path <path>.')
    if (report.unresolved.length) console.log(`${report.unresolved.length} unresolved conflict/deletion item(s); no conflicting content was overwritten.`)
  } else {
    console.log(`APPLY ${report.workspace}: ${report.status}`)
    console.log(`Plan id: ${report.planId}`)
    console.log(`Journal: ${report.journalPath}`)
    for (const operation of report.operations) console.log(`${operation.status.padEnd(9)} ${operation.action.padEnd(4)} ${operation.path}`)
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
