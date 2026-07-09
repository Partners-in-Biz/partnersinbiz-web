#!/usr/bin/env npx tsx
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import * as admin from 'firebase-admin'

interface WorkspaceAuditRow {
  workspaceId: string
  orgId: string
  orgName: string
  workspaceName: string
  agentDomain: string
  localWorkspaceExists: boolean
  localAgentDomainExists: boolean
  remoteWorkspaceExists: boolean | null
  remoteManifestExists: boolean | null
  remoteRequiredFoldersComplete: boolean | null
  remoteAgentDomainExists: boolean | null
  status: 'ok' | 'local_not_pulled' | 'review_required'
  notes: string[]
}

interface AuditOptions {
  checkVps: boolean
  host: string
  outputDir: string
}

const REQUIRED_FOLDERS = [
  'docs', 'briefs', 'assets', 'assets/private', 'marketing', 'research',
  'operations', 'operations/admin', 'deliverables', 'inbox', 'archive',
]

function loadEnv(): void {
  for (const filename of ['.env.local', '.env']) {
    const envPath = path.resolve(process.cwd(), filename)
    if (!existsSync(envPath)) continue
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 0) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
      if (!process.env[key]) process.env[key] = value
    }
  }
}

function initAdmin(): FirebaseFirestore.Firestore {
  if (admin.apps.length === 0) {
    const keyPath = path.resolve(process.cwd(), 'service-account.json')
    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim()
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim()
    const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()
    if (existsSync(keyPath)) {
      const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8')) as admin.ServiceAccount
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
    } else if (projectId && clientEmail && privateKey) {
      admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) })
    } else {
      admin.initializeApp({ credential: admin.credential.applicationDefault() })
    }
  }
  return admin.firestore()
}

function parseOptions(argv: string[]): AuditOptions {
  let checkVps = false
  let host = process.env.HERMES_VPS_HOST?.trim() || 'hermes-api.partnersinbiz.online'
  let outputDir = path.resolve(process.cwd(), 'scripts/workspace-audit-reports')
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--check-vps') checkVps = true
    else if (argv[index] === '--host') host = argv[++index]?.trim() || ''
    else if (argv[index] === '--output-dir') outputDir = path.resolve(argv[++index] || outputDir)
    else throw new Error(`Unknown argument: ${argv[index]}`)
  }
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) throw new Error('Host contains unsupported characters')
  return { checkVps, host, outputDir }
}

function nameFromVpsPath(vpsPath: string): string {
  const normalized = path.posix.normalize(vpsPath)
  if (!normalized.startsWith('/var/lib/hermes/Cowork/') || normalized === '/var/lib/hermes/Cowork') {
    throw new Error(`Unsafe VPS Workspace path: ${vpsPath}`)
  }
  const name = path.posix.basename(normalized)
  if (!name || name === '.' || name === '..') throw new Error(`Invalid VPS Workspace path: ${vpsPath}`)
  return name
}

function expandHome(value: string): string {
  if (value === '~') return process.env.HOME || value
  if (value.startsWith('~/')) return path.join(process.env.HOME || '', value.slice(2))
  return value
}

function queryRemote(host: string, workspaces: Array<{ workspaceId: string; vpsPath: string; agentDomainPath: string }>): Record<string, {
  workspace: boolean
  manifest: boolean
  requiredFolders: boolean
  agentDomain: boolean
}> {
  const payload = JSON.stringify({ workspaces, requiredFolders: REQUIRED_FOLDERS })
  const script = `
import json, os, pathlib, sys
payload = json.loads(${JSON.stringify(payload)})
result = {}
for item in payload['workspaces']:
    workspace = pathlib.Path(item['vpsPath']).resolve()
    agent = pathlib.Path(item['agentDomainPath']).resolve()
    allowed_workspace = pathlib.Path('/var/lib/hermes/Cowork').resolve()
    allowed_agent = pathlib.Path('/var/lib/hermes/cowork-wiki/agents').resolve()
    safe_workspace = workspace != allowed_workspace and allowed_workspace in workspace.parents
    safe_agent = agent != allowed_agent and allowed_agent in agent.parents
    result[item['workspaceId']] = {
        'workspace': safe_workspace and workspace.is_dir(),
        'manifest': safe_workspace and (workspace / '.pib-workspace.json').is_file(),
        'requiredFolders': safe_workspace and all((workspace / name).is_dir() for name in payload['requiredFolders']),
        'agentDomain': safe_agent and agent.is_dir(),
    }
print(json.dumps(result, sort_keys=True))
`
  const command = spawnSync('ssh', ['-o', 'BatchMode=yes', `root@${host}`, 'python3 -'], {
    input: script,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  })
  if (command.status !== 0) {
    throw new Error(`VPS audit failed: ${(command.stderr || command.stdout).trim()}`)
  }
  return JSON.parse(command.stdout.trim()) as ReturnType<typeof queryRemote>
}

async function run(): Promise<void> {
  loadEnv()
  const options = parseOptions(process.argv.slice(2))
  const db = initAdmin()
  const snap = await db.collection('org_workspaces').where('status', '==', 'active').get()
  const records = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, unknown> & { id: string }))
  const remoteInput = records.map((record) => ({
    workspaceId: String(record.workspaceId || record.id),
    vpsPath: String(record.vpsPath || ''),
    agentDomainPath: String(record.agentDomainPath || ''),
  }))
  const remote = options.checkVps ? queryRemote(options.host, remoteInput) : {}
  const expectedWorkspaceNames = new Set<string>()
  const expectedAgentDomains = new Set<string>()

  const rows: WorkspaceAuditRow[] = records.map((record) => {
    const workspaceId = String(record.workspaceId || record.id)
    const vpsPath = String(record.vpsPath || '')
    const workspaceName = nameFromVpsPath(vpsPath)
    const agentDomain = String(record.agentDomain || '')
    expectedWorkspaceNames.add(workspaceName)
    expectedAgentDomains.add(agentDomain)
    const localPath = expandHome(String(record.localPath || path.join(process.env.HOME || '', 'Cowork', workspaceName)))
    const localAgentPath = expandHome(String(record.localAgentDomainPath || path.join(process.env.HOME || '', 'Cowork', 'Cowork', 'agents', agentDomain)))
    const remoteRow = remote[workspaceId]
    const notes: string[] = []
    if (!existsSync(localPath)) notes.push('Workspace has not been pulled to this Mac')
    if (!existsSync(localAgentPath)) notes.push('Agent domain has not been pulled to this Mac')
    if (remoteRow && !remoteRow.workspace) notes.push('VPS Workspace directory missing')
    if (remoteRow && !remoteRow.manifest) notes.push('VPS manifest missing')
    if (remoteRow && !remoteRow.requiredFolders) notes.push('One or more required VPS folders missing')
    if (remoteRow && !remoteRow.agentDomain) notes.push('VPS agent domain missing')
    const remoteFailure = remoteRow && (!remoteRow.workspace || !remoteRow.manifest || !remoteRow.requiredFolders || !remoteRow.agentDomain)
    const status: WorkspaceAuditRow['status'] = remoteFailure
      ? 'review_required'
      : existsSync(localPath) && existsSync(localAgentPath)
        ? 'ok'
        : 'local_not_pulled'
    return {
      workspaceId,
      orgId: String(record.orgId || ''),
      orgName: String(record.orgName || ''),
      workspaceName,
      agentDomain,
      localWorkspaceExists: existsSync(localPath),
      localAgentDomainExists: existsSync(localAgentPath),
      remoteWorkspaceExists: remoteRow?.workspace ?? null,
      remoteManifestExists: remoteRow?.manifest ?? null,
      remoteRequiredFoldersComplete: remoteRow?.requiredFolders ?? null,
      remoteAgentDomainExists: remoteRow?.agentDomain ?? null,
      status,
      notes,
    }
  }).sort((a, b) => a.orgName.localeCompare(b.orgName))

  const localCoworkRoot = path.join(process.env.HOME || '', 'Cowork')
  const localAgentRoot = path.join(localCoworkRoot, 'Cowork', 'agents')
  const reservedTopLevel = new Set(['Cowork'])
  const nonWorkspaceDirectories = existsSync(localCoworkRoot)
    ? readdirSync(localCoworkRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !reservedTopLevel.has(entry.name) && !expectedWorkspaceNames.has(entry.name))
      .map((entry) => entry.name)
      .sort()
    : []
  const recognizedProjectDirectories = nonWorkspaceDirectories.filter((name) => {
    const directory = path.join(localCoworkRoot, name)
    return ['.git', 'AGENTS.md', 'CLAUDE.md'].some((marker) => existsSync(path.join(directory, marker)))
  })
  const unmappedTopLevelDirectories = nonWorkspaceDirectories.filter((name) => !recognizedProjectDirectories.includes(name))
  const reservedAgentDomains = new Set(['cowork', 'default', 'docs', 'elemental', 'hermes-agent', 'partners', 'side-hustle'])
  const unmappedAgentDomains = existsSync(localAgentRoot)
    ? readdirSync(localAgentRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !reservedAgentDomains.has(entry.name) && !expectedAgentDomains.has(entry.name))
      .map((entry) => entry.name)
      .sort()
    : []

  const report = {
    generatedAt: new Date().toISOString(),
    sourceOfTruth: 'vps',
    destructiveChangesPerformed: false,
    counts: {
      activeWorkspaces: rows.length,
      ok: rows.filter((row) => row.status === 'ok').length,
      localNotPulled: rows.filter((row) => row.status === 'local_not_pulled').length,
      reviewRequired: rows.filter((row) => row.status === 'review_required').length,
      recognizedProjectDirectories: recognizedProjectDirectories.length,
      unmappedTopLevelDirectories: unmappedTopLevelDirectories.length,
      unmappedAgentDomains: unmappedAgentDomains.length,
    },
    rows,
    manualReview: {
      recognizedProjectDirectories,
      unmappedTopLevelDirectories,
      unmappedAgentDomains,
      note: 'Directories with repository/instruction markers are recognized as non-Workspace projects. Remaining unmapped directories may be legacy material. This audit never deletes or moves them.',
    },
  }
  mkdirSync(options.outputDir, { recursive: true })
  const outputPath = path.join(options.outputDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-workspace-audit.json`)
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ outputPath, ...report.counts }, null, 2))
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
