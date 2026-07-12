#!/usr/bin/env npx tsx
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export interface PullWorkspaceOptions {
  workspaceName: string
  agentDomain: string
  host: string
  apply: boolean
  planOnly: boolean
  localCoworkRoot: string
  remoteCoworkRoot: string
  remoteAgentRoot: string
  skipAgentDomain: boolean
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1]?.trim()
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

export function slugifyWorkspaceName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function validateWorkspaceName(value: string): string {
  const clean = value.trim()
  if (!clean || clean === '.' || clean === '..' || clean.includes('/') || clean.includes('\\') || clean.includes('\0')) {
    throw new Error('Workspace name must be a single safe folder name')
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .,'’&()_+-]*$/u.test(clean)) {
    throw new Error('Workspace name contains unsupported characters')
  }
  return clean
}

export function validateAgentDomain(value: string): string {
  const clean = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(clean)) {
    throw new Error('Agent domain must be a lowercase slug')
  }
  return clean
}

export function parsePullWorkspaceArgs(argv: string[]): PullWorkspaceOptions {
  let workspaceName = ''
  let agentDomain = ''
  let host = process.env.HERMES_VPS_HOST?.trim() || 'hermes-api.partnersinbiz.online'
  let apply = false
  let planOnly = false
  let skipAgentDomain = false
  let localCoworkRoot = process.env.COWORK_ROOT?.trim() || path.join(homedir(), 'Cowork')

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--workspace') workspaceName = requiredValue(argv, index++, arg)
    else if (arg === '--agent-domain') agentDomain = requiredValue(argv, index++, arg)
    else if (arg === '--host') host = requiredValue(argv, index++, arg)
    else if (arg === '--local-root') localCoworkRoot = requiredValue(argv, index++, arg)
    else if (arg === '--apply') apply = true
    else if (arg === '--dry-run') apply = false
    else if (arg === '--plan') planOnly = true
    else if (arg === '--skip-agent-domain') skipAgentDomain = true
    else if (arg === '--help' || arg === '-h') {
      throw new Error('HELP')
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  const safeWorkspaceName = validateWorkspaceName(workspaceName)
  const safeDomain = validateAgentDomain(agentDomain || slugifyWorkspaceName(safeWorkspaceName))
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) throw new Error('Host contains unsupported characters')

  return {
    workspaceName: safeWorkspaceName,
    agentDomain: safeDomain,
    host,
    apply,
    planOnly,
    localCoworkRoot: path.resolve(localCoworkRoot),
    remoteCoworkRoot: '/var/lib/hermes/Cowork',
    remoteAgentRoot: '/var/lib/hermes/cowork-wiki/agents',
    skipAgentDomain,
  }
}

function quoteRemotePath(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildPullCommands(options: PullWorkspaceOptions): string[][] {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const common = [
    '-a',
    '--human-readable',
    '--itemize-changes',
    '--exclude=.git/',
    '--exclude=.pib-pull-backups/',
    ...(options.apply
      ? ['--backup', `--backup-dir=.pib-pull-backups/${timestamp}`]
      : ['--dry-run']),
  ]
  const workspaceSource = `root@${options.host}:${quoteRemotePath(`${options.remoteCoworkRoot}/${options.workspaceName}/`)}`
  const workspaceDestination = path.join(options.localCoworkRoot, options.workspaceName, path.sep)
  const agentSource = `root@${options.host}:${quoteRemotePath(`${options.remoteAgentRoot}/${options.agentDomain}/`)}`
  const agentDestination = path.join(options.localCoworkRoot, 'Cowork', 'agents', options.agentDomain, path.sep)
  return [
    ['rsync', ...common, workspaceSource, workspaceDestination],
    ...(!options.skipAgentDomain ? [['rsync', ...common, agentSource, agentDestination]] : []),
  ]
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/pull-client-workspace.ts --workspace "Client Name" [options]',
    '',
    'Options:',
    '  --agent-domain <slug>  Override the derived agent-domain slug',
    '  --host <hostname>      VPS SSH host (default: hermes-api.partnersinbiz.online)',
    '  --local-root <path>    Local Cowork root (default: ~/Cowork)',
    '  --dry-run              Preview rsync changes (default)',
    '  --plan                 Print the safe command plan without connecting',
    '  --skip-agent-domain    Pull only the Workspace; preserve the existing local Obsidian domain',
    '  --apply                Pull from canonical VPS; backups replaceable local files',
    '',
    'The command never uses --delete and never pushes local files to the VPS.',
  ].join('\n')
}

export function runPullWorkspace(argv: string[]): number {
  let options: PullWorkspaceOptions
  try {
    options = parsePullWorkspaceArgs(argv)
  } catch (error) {
    if (error instanceof Error && error.message === 'HELP') {
      console.log(usage())
      return 0
    }
    console.error(error instanceof Error ? error.message : String(error))
    console.error(usage())
    return 2
  }

  const commands = buildPullCommands(options)
  console.log(`Mode: ${options.planOnly ? 'PLAN' : options.apply ? 'APPLY' : 'DRY RUN'}`)
  console.log(`Workspace: ${options.workspaceName}`)
  console.log(`Agent domain: ${options.agentDomain}`)
  console.log(`Source of truth: VPS (${options.host})`)

  if (options.planOnly) {
    for (const command of commands) console.log(command.map((part) => JSON.stringify(part)).join(' '))
    return 0
  }

  mkdirSync(path.join(options.localCoworkRoot, options.workspaceName), { recursive: true })
  if (!options.skipAgentDomain) {
    mkdirSync(path.join(options.localCoworkRoot, 'Cowork', 'agents', options.agentDomain), { recursive: true })
  }
  for (const [command, ...args] of commands) {
    const result = spawnSync(command, args, { stdio: 'inherit' })
    if (result.error) {
      console.error(result.error.message)
      return 1
    }
    if (result.status !== 0) return result.status ?? 1
  }
  console.log(options.apply ? 'Workspace pull completed.' : 'Dry run completed; rerun with --apply to pull changes.')
  return 0
}

if (require.main === module) process.exitCode = runPullWorkspace(process.argv.slice(2))
