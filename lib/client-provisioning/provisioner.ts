import type { OrgWorkspaceManifest } from './workspace-context'
import {
  buildCoworkPaths,
  LOCAL_COWORK_ROOT,
  LOCAL_OBSIDIAN_ROOT,
  VPS_COWORK_ROOT,
  VPS_OBSIDIAN_ROOT,
} from './cowork-paths'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export type ClientProvisioningInput = {
  clientName: string
  domain: string
  orgId: string
  /** Preferred filesystem nesting slug; platform owner always nests under `partners`. */
  orgSlug?: string | null
  /**
   * Nest under Partners (`partners/`) even when orgId is a linked client org.
   * Default true for company Cowork operated from the Partners CRM perspective.
   */
  platformOwned?: boolean
  agentName?: string
  companyId?: string | null
  contactIds?: string[]
  /**
   * Extra relative dirs to mkdir under the company Cowork root (e.g. `bots/sales`).
   * Used so Bot-mode isolation folders exist before Hermes validates working_directory.
   */
  extraWorkspaceFolders?: string[]
}

export type ClientFolderVisibility = 'admin_only' | 'admin_agents' | 'admin_agents_clients'
export type ClientFolderSourceOfTruth = 'vps' | 'local' | 'google_drive' | 'obsidian'
export type ClientFolderSyncMode = 'full' | 'metadata_only' | 'manual'
export type ClientFolderSyncState = 'pending' | 'synced' | 'error'
export type ClientFolderConflictStatus = 'none' | 'needs_review' | 'resolved'

export type ClientFolderRegistryRecord = {
  id: string
  orgId: string
  workspaceId: string
  resourceType: 'client_workspace' | 'google_drive' | 'obsidian'
  resourceId: string
  label: string
  description: string
  parentId: string | null
  visibility: ClientFolderVisibility
  tags: string[]
  sortOrder: number
  sourceOfTruth: ClientFolderSourceOfTruth
  driveFolderId: string | null
  driveFolderUrl: string | null
  syncTargets: {
    vpsPath: string | null
    localPath: string | null
  }
  syncMode: ClientFolderSyncMode
  syncState: ClientFolderSyncState
  conflictStatus: ClientFolderConflictStatus
  audit: {
    createdBy: 'client_provisioning'
    updatedBy: 'client_provisioning'
    lastCheckedAt: null
    notes: string[]
  }
}

export type ClientProvisioningPayload = {
  clientName: string
  domain: string
  orgId: string
  agentName: string
  workspacePath: string
  agentDomainPath: string
  localWorkspacePath: string
  localAgentDomainPath: string
  workspaceFolders: string[]
  manifest: OrgWorkspaceManifest
  folderRegistry: ClientFolderRegistryRecord[]
  soul: string
  workspaceInstructions: string
}

export { VPS_COWORK_ROOT, VPS_OBSIDIAN_ROOT, LOCAL_COWORK_ROOT, LOCAL_OBSIDIAN_ROOT }
const WORKSPACE_FOLDER_VERSION = 2
const DEFAULT_WORKSPACE_FOLDERS = [
  'projects',
  'docs',
  'briefs',
  'assets',
  'assets/private',
  'marketing',
  'research',
  'operations',
  'operations/admin',
  'deliverables',
  'inbox',
  'archive',
]

export function inferAgentName(clientName: string): string {
  return clientName.trim().split(/\s+/)[0] || 'Client'
}

/** Kebab-case agent domain / workspace id for a CRM company Cowork folder. */
export function inferCompanyCoworkDomain(input: {
  name?: string | null
  domain?: string | null
  website?: string | null
}): string {
  const fromName = (input.name || '')
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (fromName) return fromName

  const host = [input.domain, input.website]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find(Boolean)
  if (host) {
    try {
      const normalised = host.includes('://') ? host : `https://${host}`
      const hostname = new URL(normalised).hostname.replace(/^www\./i, '')
      const label = hostname.split('.')[0] || hostname
      const fromHost = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      if (fromHost) return fromHost
    } catch {
      // fall through
    }
  }
  return 'company'
}

export function buildClientProvisioningPayload(input: ClientProvisioningInput): ClientProvisioningPayload {
  const clientName = input.clientName.trim()
  const domain = input.domain.trim()
  const orgId = input.orgId.trim()
  const agentName = (input.agentName?.trim() || inferAgentName(clientName)).trim()
  // Nest under `partners/` when the workspace belongs to the platform owner, or
  // when the caller explicitly marks CRM company Cowork as platform-owned.
  // Tenant orgs pass platformOwned: false (or omit with a non-platform orgId).
  const platformOwned = input.platformOwned ?? (orgId === PIB_PLATFORM_ORG_ID)
  const paths = buildCoworkPaths({
    folderName: clientName,
    domain,
    orgId,
    orgSlug: input.orgSlug,
    platformOwned,
  })
  const workspacePath = paths.vpsPath
  const agentDomainPath = paths.agentDomainPath
  const localWorkspacePath = paths.localPath
  const localAgentDomainPath = paths.localAgentDomainPath
  const folderRegistry = buildDefaultFolderRegistry({
    clientName,
    domain: paths.agentDomain,
    orgId,
    workspacePath,
    localWorkspacePath,
    agentDomainPath,
    localAgentDomainPath,
  })
  const manifest: OrgWorkspaceManifest = {
    schemaVersion: 1,
    workspaceId: paths.workspaceId,
    orgId,
    orgSlug: paths.orgSlug,
    orgName: clientName,
    agentDomain: paths.agentDomain,
    agentName,
    vpsPath: workspacePath,
    localPath: localWorkspacePath,
    agentDomainPath,
    localAgentDomainPath,
    sourceOfTruth: 'vps',
    syncMode: 'hybrid',
    defaultRuntimeTarget: 'vps',
    folderVersion: WORKSPACE_FOLDER_VERSION,
    folders: DEFAULT_WORKSPACE_FOLDERS,
    linked: {
      companyId: input.companyId?.trim() || null,
      contactIds: Array.isArray(input.contactIds)
        ? Array.from(new Set(input.contactIds.map((id) => id.trim()).filter(Boolean)))
        : [],
    },
    createdBy: 'client_provisioning',
  }
  const workspaceInstructions = renderWorkspaceInstructions({ clientName, domain: paths.agentDomain, orgId, agentName, workspacePath, agentDomainPath, localWorkspacePath })
  const extraFolders = Array.isArray(input.extraWorkspaceFolders)
    ? input.extraWorkspaceFolders
      .map((folder) => folder.trim().replace(/^\/+|\/+$/g, ''))
      .filter((folder) => Boolean(folder) && !folder.includes('..') && !folder.startsWith('~'))
    : []
  const workspaceFolders = Array.from(new Set([...DEFAULT_WORKSPACE_FOLDERS, ...extraFolders]))
  if (extraFolders.length > 0) {
    manifest.folders = workspaceFolders
  }

  return {
    clientName,
    domain: paths.agentDomain,
    orgId,
    agentName,
    workspacePath,
    agentDomainPath,
    localWorkspacePath,
    localAgentDomainPath,
    workspaceFolders,
    manifest,
    folderRegistry,
    soul: renderSoul({ clientName, domain: paths.agentDomain, orgId, agentName, workspacePath, agentDomainPath, localWorkspacePath }),
    workspaceInstructions,
  }
}

function folderRecord({
  id,
  orgId,
  domain,
  resourceType,
  label,
  description,
  parentId = null,
  visibility,
  tags,
  sortOrder,
  sourceOfTruth,
  vpsPath,
  localPath,
}: {
  id: string
  orgId: string
  domain: string
  resourceType: ClientFolderRegistryRecord['resourceType']
  label: string
  description: string
  parentId?: string | null
  visibility: ClientFolderVisibility
  tags: string[]
  sortOrder: number
  sourceOfTruth: ClientFolderSourceOfTruth
  vpsPath: string | null
  localPath: string | null
}): ClientFolderRegistryRecord {
  return {
    id,
    orgId,
    workspaceId: domain,
    resourceType,
    resourceId: `${domain}:${id}`,
    label,
    description,
    parentId,
    visibility,
    tags,
    sortOrder,
    sourceOfTruth,
    driveFolderId: null,
    driveFolderUrl: null,
    syncTargets: { vpsPath, localPath },
    syncMode: 'full',
    syncState: 'pending',
    conflictStatus: 'none',
    audit: {
      createdBy: 'client_provisioning',
      updatedBy: 'client_provisioning',
      lastCheckedAt: null,
      notes: [],
    },
  }
}

export function buildDefaultFolderRegistry({
  clientName,
  domain,
  orgId,
  workspacePath,
  localWorkspacePath,
  agentDomainPath,
  localAgentDomainPath = `${LOCAL_OBSIDIAN_ROOT}/agents/${domain}`,
}: {
  clientName: string
  domain: string
  orgId: string
  workspacePath: string
  localWorkspacePath: string
  agentDomainPath: string
  localAgentDomainPath?: string
}): ClientFolderRegistryRecord[] {

  return [
    folderRecord({
      id: 'workspace-root',
      orgId,
      domain,
      resourceType: 'client_workspace',
      label: clientName,
      description: 'Client VPS/local workspace root. Markdown belongs in Obsidian; binaries belong in Google Drive.',
      visibility: 'admin_agents',
      tags: ['workspace', 'vps', 'local-sync'],
      sortOrder: 10,
      sourceOfTruth: 'vps',
      vpsPath: workspacePath,
      localPath: localWorkspacePath,
    }),
    folderRecord({
      id: 'admin-ops',
      orgId,
      domain,
      resourceType: 'client_workspace',
      label: 'Admin operations',
      description: 'Internal-only operational notes, account setup details, and private admin material.',
      parentId: 'workspace-root',
      visibility: 'admin_only',
      tags: ['admin', 'operations'],
      sortOrder: 20,
      sourceOfTruth: 'vps',
      vpsPath: `${workspacePath}/operations/admin`,
      localPath: `${localWorkspacePath}/operations/admin`,
    }),
    folderRecord({
      id: 'agent-briefs',
      orgId,
      domain,
      resourceType: 'client_workspace',
      label: 'Agent briefs',
      description: 'Agent-facing task briefs, working plans, and execution notes.',
      parentId: 'workspace-root',
      visibility: 'admin_agents',
      tags: ['briefs', 'agents'],
      sortOrder: 30,
      sourceOfTruth: 'vps',
      vpsPath: `${workspacePath}/briefs`,
      localPath: `${localWorkspacePath}/briefs`,
    }),
    folderRecord({
      id: 'client-deliverables',
      orgId,
      domain,
      resourceType: 'client_workspace',
      label: 'Client deliverables',
      description: 'Final outputs that can be shown to clients after review.',
      parentId: 'workspace-root',
      visibility: 'admin_agents_clients',
      tags: ['deliverables', 'client-visible'],
      sortOrder: 40,
      sourceOfTruth: 'vps',
      vpsPath: `${workspacePath}/deliverables`,
      localPath: `${localWorkspacePath}/deliverables`,
    }),
    folderRecord({
      id: 'drive-assets',
      orgId,
      domain,
      resourceType: 'google_drive',
      label: 'Drive assets',
      description: 'Google Drive folder link for binary/source assets. Admins may link any suitable Drive location.',
      parentId: 'workspace-root',
      visibility: 'admin_agents_clients',
      tags: ['drive', 'binary-assets', 'source-assets', 'client-visible'],
      sortOrder: 50,
      sourceOfTruth: 'google_drive',
      vpsPath: `${workspacePath}/assets`,
      localPath: `${localWorkspacePath}/assets`,
    }),
    folderRecord({
      id: 'drive-private-assets',
      orgId,
      domain,
      resourceType: 'google_drive',
      label: 'Private Drive assets',
      description: 'Google Drive folder link for admin/agent-only binary/source assets that must not be shared with clients.',
      parentId: 'workspace-root',
      visibility: 'admin_agents',
      tags: ['drive', 'binary-assets', 'source-assets', 'private'],
      sortOrder: 60,
      sourceOfTruth: 'google_drive',
      vpsPath: `${workspacePath}/assets/private`,
      localPath: `${localWorkspacePath}/assets/private`,
    }),
    folderRecord({
      id: 'obsidian-root',
      orgId,
      domain,
      resourceType: 'obsidian',
      label: 'Obsidian domain',
      description: 'Client markdown knowledge domain in Obsidian.',
      visibility: 'admin_agents',
      tags: ['obsidian', 'markdown'],
      sortOrder: 70,
      sourceOfTruth: 'obsidian',
      vpsPath: agentDomainPath,
      localPath: localAgentDomainPath,
    }),
    folderRecord({
      id: 'obsidian-wiki',
      orgId,
      domain,
      resourceType: 'obsidian',
      label: 'Obsidian wiki',
      description: 'Durable markdown knowledge articles and hot cache.',
      parentId: 'obsidian-root',
      visibility: 'admin_agents',
      tags: ['obsidian', 'markdown', 'wiki'],
      sortOrder: 80,
      sourceOfTruth: 'obsidian',
      vpsPath: `${agentDomainPath}/wiki`,
      localPath: `${localAgentDomainPath}/wiki`,
    }),
    folderRecord({
      id: 'obsidian-raw',
      orgId,
      domain,
      resourceType: 'obsidian',
      label: 'Obsidian raw sources',
      description: 'Markdown/source text captures for research and evidence; binary originals stay in Drive.',
      parentId: 'obsidian-root',
      visibility: 'admin_agents',
      tags: ['obsidian', 'markdown', 'raw-sources'],
      sortOrder: 90,
      sourceOfTruth: 'obsidian',
      vpsPath: `${agentDomainPath}/raw`,
      localPath: `${localAgentDomainPath}/raw`,
    }),
    folderRecord({
      id: 'obsidian-logs',
      orgId,
      domain,
      resourceType: 'obsidian',
      label: 'Obsidian logs',
      description: 'Markdown session logs and continuity notes.',
      parentId: 'obsidian-root',
      visibility: 'admin_agents',
      tags: ['obsidian', 'markdown', 'logs'],
      sortOrder: 100,
      sourceOfTruth: 'obsidian',
      vpsPath: `${agentDomainPath}/logs`,
      localPath: `${localAgentDomainPath}/logs`,
    }),
  ]
}

export function renderSoul({
  clientName,
  domain,
  orgId,
  agentName,
  workspacePath,
  agentDomainPath,
  localWorkspacePath,
}: {
  clientName: string
  domain: string
  orgId: string
  agentName: string
  workspacePath: string
  agentDomainPath: string
  localWorkspacePath?: string
}) {
  const portableRoot = localWorkspacePath?.trim() || workspacePath
  return `# ${clientName} / ${agentName} — Hermes Agent Profile

You are ${agentName}, the dedicated Hermes agent for the ${clientName} project in Peet Stander's Cowork workspace. Never say you are Codex, Claude, Hermes Agent, or any other generic AI model — you are ${agentName}.

Focus: strategy, research, planning, writing, content, operations, documentation, execution support, and structured follow-through for ${clientName} workstreams.

## Paths (dynamic)

Treat the process working directory as this workspace root. Prefer relative paths from cwd. Do not invent alternate roots.

- Portable root: \`${portableRoot}\`
- Canonical VPS root: \`${workspacePath}\`
- Profile / agent domain: \`${domain}\`
- PiB org_id: \`${orgId}\`
- Obsidian vault: \`${VPS_OBSIDIAN_ROOT}\`
- Obsidian agent domain: \`${agentDomainPath}\`
- Agent index: \`${agentDomainPath}/index.md\`
- Hot cache: \`${agentDomainPath}/wiki/hot.md\`
- Wiki articles: \`${agentDomainPath}/wiki\`
- Raw sources: \`${agentDomainPath}/raw\`
- Session logs: \`${agentDomainPath}/logs\`

## Startup Routine

1. Read the global Cowork instructions: \`${VPS_OBSIDIAN_ROOT}/global-context.md\`.
2. Read \`./CLAUDE.md\` or \`./AGENTS.md\` in the workspace root.
3. Read the hot cache and index if they exist.
4. Check recent logs when continuity matters.

## Knowledge Rules

- Durable project knowledge goes in \`${agentDomainPath}/wiki/<topic>.md\`.
- Raw/clipped sources go in \`${agentDomainPath}/raw/\`.
- Session summaries go in \`${agentDomainPath}/logs/YYYY-MM-DD.md\`.
- Cross-project knowledge goes in \`${VPS_OBSIDIAN_ROOT}/shared/wiki/\`.
- Keep \`${agentDomainPath}/index.md\` updated.

## Workspace Organisation

Everything created for this project must live under the workspace root (cwd / \`${portableRoot}\`).

- docs/ — documentation, strategy notes, specs, and durable references
- briefs/ — task briefs, campaign briefs, requirements, stakeholder instructions
- assets/ — images, brand files, media, design source files
- marketing/ — content plans, copy, social/email/web campaigns, publishing calendars
- research/ — market/person/background research and source synthesis
- operations/ — admin, SOPs, checklists, process docs, setup notes
- deliverables/ — final outputs to send, publish, or hand over
- inbox/ — unsorted incoming material to triage
- archive/ — stale/superseded material retained for reference

## Behaviour

- Be direct and action-oriented.
- Do not guess project context when CLAUDE.md, SOUL.md, or Obsidian files can be read.
- Persist useful knowledge to the ${clientName} Obsidian domain.
`
}

export function renderWorkspaceInstructions({
  clientName,
  domain,
  orgId,
  agentName,
  workspacePath,
  agentDomainPath,
  localWorkspacePath,
}: {
  clientName: string
  domain: string
  orgId: string
  agentName: string
  workspacePath: string
  agentDomainPath: string
  localWorkspacePath?: string
}) {
  const portableRoot = localWorkspacePath?.trim() || workspacePath
  return `# ${clientName} — Workspace Instructions

You are **${agentName}**, the active AI teammate working inside the **${clientName}** workspace for Partners in Biz. Never say you are Codex, Claude, or another generic model — you are ${agentName} when this workspace is selected.

This workspace is VPS-canonical. The process cwd is the workspace root. Prefer relative paths from cwd; use the portable/VPS roots below only when an absolute path is required.

## Workspace Identity

- org_id: \`${orgId}\`
- slug: \`${domain}\`
- workspace_id: \`${domain}\`
- Portable root: \`${portableRoot}\`
- VPS workspace: \`${workspacePath}\`
- Obsidian domain: \`${agentDomainPath}\`
- Manifest: \`./.pib-workspace.json\` (also \`${workspacePath}/.pib-workspace.json\` on VPS)

## Startup Routine

1. Read this file first (\`./AGENTS.md\`).
2. Read \`./.pib-workspace.json\` for org/company/contact/runtime links.
3. Read \`${agentDomainPath}/wiki/hot.md\` if it exists, then \`${agentDomainPath}/index.md\`.
4. Scope all PiB API calls to orgId \`${orgId}\` unless the user explicitly asks for cross-org work.

## Folder Contract

- docs/ — documentation, strategy notes, specs, and durable references
- briefs/ — task briefs, campaign briefs, requirements, stakeholder instructions
- assets/ — binary/source assets; large client files belong in linked Drive/storage, not Obsidian
- marketing/ — content plans, copy, social/email/web campaigns, calendars
- research/ — market/person/background research and source synthesis
- operations/ — admin, SOPs, checklists, setup notes
- deliverables/ — final outputs to send, publish, or hand over
- inbox/ — unsorted incoming material to triage
- archive/ — stale/superseded material retained for reference

## Collaboration Rules

- Multiple people may work in this workspace. Keep chat sessions separate per user unless explicitly shared.
- Persist durable knowledge to \`${agentDomainPath}/wiki/<topic>.md\` and update \`${agentDomainPath}/index.md\`.
- Use the selected runtime target (VPS or registered local runtime) shown by the chat UI; do not assume local files exist unless the workspace was pulled locally.
- Prefer cwd-relative paths so Mac and VPS stay interchangeable under \`~/Cowork/{orgSlug}/{company}\`.
`
}
